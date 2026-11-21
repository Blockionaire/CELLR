import { describe, expect, it } from "vitest";
import type { AiResult, GenerateObjectRequest, LlmProvider } from "@/server/ai/types";
import { v1Ai } from "./engines/v1-ai";
import {
  BudgetReached,
  estimating,
  metered,
  newMeter,
  PAID_ENV,
  PAID_PHRASE,
  paidAllowed,
} from "./paid";
import { scenariosOf } from "./sets";

/**
 * THE BENCHMARK SPENDS NOTHING UNLESS THE OWNER SAID YES. These tests hold that: no key or no phrase is a no,
 * an estimate sends nothing, and a run for real stops at its own limit. No test here calls a network.
 */
const REQUEST = {
  task: "sommelier_chat",
  model: "chat",
  system: "s".repeat(300),
  user: "u".repeat(600),
  schemaName: "x",
  jsonSchema: {},
  parse: (v: unknown) => v,
  maxOutputTokens: 900,
  timeoutMs: 1000,
} satisfies GenerateObjectRequest<unknown>;
const AI = {
  visionModel: "gpt-6-luna",
  chatModel: "gpt-6-luna",
  adviceModel: "gpt-6-luna",
  reasoningEffort: "none" as const,
};

/** A stand-in provider that answers like V1's model would, and counts how often it was asked. */
function fake(tokensOut = 200) {
  const state = { calls: 0 };
  const provider: LlmProvider = {
    async generateObject<T>(request: GenerateObjectRequest<T>): Promise<AiResult<T>> {
      state.calls += 1;
      return {
        ok: true,
        value: request.parse({
          answer: "Open the first one.",
          bottle_refs: [],
          verdict: "none",
          buy: [],
          used_taste: false,
        }),
        usage: {
          model: "gpt-6-luna",
          servedModel: "gpt-6-luna-2026-09-22",
          tokensIn: 2000,
          tokensOut,
          latencyMs: 1,
          reported: true,
        },
      };
    },
  };
  return { provider, state };
}

describe("whether a run may spend money", () => {
  it("needs the owner's phrase and a key, both", () => {
    expect(paidAllowed({})).toBe(false);
    expect(paidAllowed({ OPENAI_API_KEY: "k" })).toBe(false);
    expect(paidAllowed({ [PAID_ENV]: PAID_PHRASE })).toBe(false);
    expect(paidAllowed({ [PAID_ENV]: PAID_PHRASE, OPENAI_API_KEY: "  " })).toBe(false);
    expect(paidAllowed({ [PAID_ENV]: "yes", OPENAI_API_KEY: "k" })).toBe(false);
    expect(paidAllowed({ [PAID_ENV]: "1", OPENAI_API_KEY: "k" })).toBe(false);
    expect(paidAllowed({ [PAID_ENV]: PAID_PHRASE, OPENAI_API_KEY: "k" })).toBe(true);
  });

  it("the paid engine refuses to be built without it, and says how to estimate instead", () => {
    expect(() => v1Ai({ estimate: false, maxUsd: 2, env: {} })).toThrow(/--estimate/);
    expect(() => v1Ai({ estimate: false, maxUsd: 2, env: { OPENAI_API_KEY: "k" } })).toThrow(
      /owner's approval/,
    );
  });
});

describe("an estimate", () => {
  it("sends nothing and counts the prompt high", async () => {
    const meter = newMeter();
    const result = await estimating(AI, meter).generateObject(REQUEST);
    expect(result).toMatchObject({ ok: false, kind: "unavailable", usage: { notSent: true } });
    expect(meter.calls).toBe(1);
    expect(meter.inputTokens).toBe(301);
    expect(meter.outputTokens).toBe(900);
    expect(meter.usdMicro).toBeGreaterThan(0);
  });

  it("runs a scenario on V1's fallback without any key in the environment", async () => {
    const run = v1Ai({ estimate: true, maxUsd: 2, env: {} });
    const scenario = scenariosOf("main").find(
      (s) => s.needs.every((n) => n === "pairing") && s.turns.length === 1 && s.cellar !== "empty",
    )!;
    const { answer } = await run.engine.run(scenario);
    expect(run.mode).toBe("estimate");
    expect(run.meter.calls).toBe(1);
    expect(answer.ai).toMatchObject({ calls: 1 });
  });
});

describe("a run for real", () => {
  it("counts what the provider reported and names the model that answered", async () => {
    const meter = newMeter();
    const { provider } = fake();
    await metered(provider, meter, 1_000_000).generateObject(REQUEST);
    expect(meter).toMatchObject({ calls: 1, inputTokens: 2000, outputTokens: 200, unknownCost: 0 });
    expect(meter.usdMicro).toBeGreaterThan(0);
    expect([...meter.servedModels]).toEqual(["gpt-6-luna-2026-09-22"]);
  });

  it("stops before the next call once its limit is reached", async () => {
    const meter = newMeter();
    const { provider, state } = fake(100_000);
    const limited = metered(provider, meter, 10);
    await limited.generateObject(REQUEST);
    await expect(limited.generateObject(REQUEST)).rejects.toBeInstanceOf(BudgetReached);
    expect(state.calls).toBe(1);
  });

  const silent: LlmProvider = {
    generateObject: async () => ({
      ok: false,
      kind: "timeout",
      usage: { model: "gpt-6-luna", tokensIn: 0, tokensOut: 0, latencyMs: 1 },
    }),
  };

  it("a call whose cost was not reported is unknown, never free: it counts at a high estimate", async () => {
    const meter = newMeter();
    await metered(silent, meter, 1_000_000).generateObject(REQUEST);
    expect(meter).toMatchObject({ calls: 1, unknownCost: 1 });
    expect(meter.usdMicro).toBeGreaterThan(0);
  });

  it("the limit also stops a run whose calls never report a cost", async () => {
    const meter = newMeter();
    const limited = metered(silent, meter, 10);
    await limited.generateObject(REQUEST);
    await expect(limited.generateObject(REQUEST)).rejects.toBeInstanceOf(BudgetReached);
    expect(meter.calls).toBe(1);
  });

  it("refuses a model the app has no price for: its spend could not be limited", () => {
    const before = process.env.AI_MODEL_ADVICE;
    process.env.AI_MODEL_ADVICE = "a-model-with-no-price";
    try {
      expect(() =>
        v1Ai({ estimate: false, maxUsd: 2, env: { [PAID_ENV]: PAID_PHRASE, OPENAI_API_KEY: "k" } }),
      ).toThrow(/no price/);
      // An estimate sends nothing, so it may still run (priced as the dearest model known).
      expect(v1Ai({ estimate: true, maxUsd: 2, env: {} }).mode).toBe("estimate");
    } finally {
      if (before === undefined) delete process.env.AI_MODEL_ADVICE;
      else process.env.AI_MODEL_ADVICE = before;
    }
  });

  it("asks the model once per turn, never for a scenario V1 cannot attempt, and reads its verdict", async () => {
    const { provider, state } = fake();
    const run = v1Ai({
      estimate: false,
      maxUsd: 2,
      env: { [PAID_ENV]: PAID_PHRASE, OPENAI_API_KEY: "k" },
      provider,
    });
    const all = scenariosOf("main");
    const beyond = all.find((s) => s.needs.includes("social"))!;
    expect((await run.engine.run(beyond)).answer.unsupported).toContain("social");
    expect(state.calls).toBe(0);
    const pairing = all.find(
      (s) => s.needs.every((n) => n === "pairing") && s.turns.length === 1 && s.cellar !== "empty",
    )!;
    const { answer } = await run.engine.run(pairing);
    expect(state.calls).toBe(1);
    expect(answer.verdict).toBe("none");
    expect(answer.ai).toMatchObject({ calls: 1, inputTokens: 2000, outputTokens: 200 });
  });
});
