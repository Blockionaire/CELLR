import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { costOf } from "@/server/ai/pricing";
import type { AiResult, GenerateObjectRequest, LlmProvider } from "@/server/ai/types";
import { v1Ai } from "./engines/v1-ai";
import {
  BudgetReached,
  estimating,
  Ledger,
  metered,
  newMeter,
  reservationFor,
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
    // It also says what a run for real would hold back for this call: more than the estimate.
    expect(meter.reservationsMicro).toBe(reservationFor(AI, REQUEST));
    expect(meter.reservationsMicro).toBeGreaterThan(meter.usdMicro);
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
  const reserve = (request: GenerateObjectRequest<unknown>) => reservationFor(AI, request);
  const guard = { reserve };
  const ONE = reservationFor(AI, REQUEST);

  it("counts what the provider reported and names the model that answered", async () => {
    const meter = newMeter();
    const { provider } = fake();
    await metered(provider, meter, 1_000_000, guard).generateObject(REQUEST);
    expect(meter).toMatchObject({ calls: 1, inputTokens: 2000, outputTokens: 200, unknownCost: 0 });
    expect(meter.usdMicro).toBeGreaterThan(0);
    expect(meter.reservedMicro).toBe(0);
    expect([...meter.servedModels]).toEqual(["gpt-6-luna-2026-09-22"]);
  });

  it("reserves at least what the worst answer can cost: both attempts, full output, the repair's longer prompt", () => {
    const chars =
      REQUEST.system.length + REQUEST.user.length + JSON.stringify(REQUEST.jsonSchema).length;
    // The provider's worst case as pricing.ts would bill it: two attempts, every output token used, the
    // repair's prompt carrying the first answer, and tokens as small as one per two characters.
    const worst = costOf({
      model: "gpt-6-luna",
      tokensIn: Math.ceil(chars / 2) * 2 + 900 + 400,
      tokensOut: 900 * 2,
      latencyMs: 1,
      reported: true,
    }).usdMicro!;
    expect(ONE).toBeGreaterThanOrEqual(worst);
  });

  it("never sends a call whose reservation does not fit in what is left of the run's limit", async () => {
    const meter = newMeter();
    const { provider, state } = fake();
    await expect(
      metered(provider, meter, ONE - 1, guard).generateObject(REQUEST),
    ).rejects.toBeInstanceOf(BudgetReached);
    expect(state.calls).toBe(0);
    expect(meter.stopped).toBe(true);
    expect(meter.usdMicro).toBe(0);
  });

  it("keeps a whole run under its limit, however expensive each answer is up to its reservation", async () => {
    const meter = newMeter();
    // Every answer uses its whole output allowance.
    const { provider, state } = fake(900);
    const limit = ONE * 3 + Math.floor(ONE / 2);
    const limited = metered(provider, meter, limit, guard);
    let refused = false;
    for (let i = 0; i < 10 && !refused; i++)
      await limited.generateObject(REQUEST).catch((e) => {
        expect(e).toBeInstanceOf(BudgetReached);
        refused = true;
      });
    expect(refused).toBe(true);
    expect(meter.usdMicro).toBeLessThanOrEqual(limit);
    // It stops only when the next reservation no longer fits, not earlier.
    expect(limit - meter.usdMicro).toBeLessThan(ONE);
    expect(state.calls).toBe(meter.calls);
  });

  const silent: LlmProvider = {
    generateObject: async () => ({
      ok: false,
      kind: "timeout",
      usage: { model: "gpt-6-luna", tokensIn: 0, tokensOut: 0, latencyMs: 1 },
    }),
  };

  it("a call whose cost was not reported is unknown, never free: it counts at its whole reservation", async () => {
    const meter = newMeter();
    await metered(silent, meter, 1_000_000, guard).generateObject(REQUEST);
    expect(meter).toMatchObject({ calls: 1, unknownCost: 1, usdMicro: ONE });
  });

  it("a provider that throws costs its whole reservation, and the error still reaches the caller", async () => {
    const meter = newMeter();
    const broken: LlmProvider = {
      generateObject: async () => {
        throw new Error("socket hang up");
      },
    };
    await expect(metered(broken, meter, 1_000_000, guard).generateObject(REQUEST)).rejects.toThrow(
      /socket/,
    );
    expect(meter).toMatchObject({ calls: 1, unknownCost: 1, usdMicro: ONE, reservedMicro: 0 });
  });

  it("stops the run at once when a call costs more than its reservation (a dearer model, a price change)", async () => {
    const meter = newMeter();
    const dear: LlmProvider = {
      generateObject: async (request) => ({
        ok: true,
        value: request.parse({}),
        usage: {
          model: "gpt-4.1",
          tokensIn: 200_000,
          tokensOut: 50_000,
          latencyMs: 1,
          reported: true,
        },
      }),
    };
    const limited = metered(dear, meter, 100_000_000, guard);
    await limited.generateObject(REQUEST);
    expect(meter.overReservation).toBe(1);
    expect(meter.stopped).toBe(true);
    await expect(limited.generateObject(REQUEST)).rejects.toBeInstanceOf(BudgetReached);
  });

  it("refuses, before sending, what it cannot bound: a model with no price, a web search", async () => {
    const meter = newMeter();
    const { provider, state } = fake();
    const unpriced = metered(provider, meter, 1_000_000, {
      reserve: (r) =>
        reservationFor({ ...AI, adviceModel: "no-such-model", chatModel: "no-such-model" }, r),
    });
    await expect(unpriced.generateObject(REQUEST)).rejects.toThrow(/no price/);
    await expect(
      metered(provider, newMeter(), 1_000_000, guard).generateObject({
        ...REQUEST,
        webSearch: true,
      }),
    ).rejects.toThrow(/web-search/);
    expect(state.calls).toBe(0);
  });

  describe("the total over several runs (budget file)", () => {
    const dir = () => mkdtempSync(join(tmpdir(), "sommelier-budget-"));

    it("three runs together never pass the total, even with a per-run limit of the whole total each", async () => {
      const file = join(dir(), "budget.json");
      const total = ONE * 4 + Math.floor(ONE / 3);
      const { provider, state } = fake(900);
      let spent = 0;
      for (let run = 0; run < 3; run++) {
        const ledger = Ledger.open(file, total);
        const meter = newMeter();
        const limited = metered(provider, meter, total, { reserve, ledger });
        for (let i = 0; i < 10 && !meter.stopped; i++)
          await limited.generateObject(REQUEST).catch(() => undefined);
        ledger.end(false);
        spent += meter.usdMicro;
      }
      const saved = JSON.parse(readFileSync(file, "utf8"));
      expect(saved.spentMicro).toBe(spent);
      expect(saved.spentMicro).toBeLessThanOrEqual(total);
      expect(saved.pendingMicro).toBe(0);
      expect(saved.runs).toHaveLength(3);
      expect(saved.runs.every((r: { complete: boolean }) => r.complete === false)).toBe(true);
      expect(total - saved.spentMicro).toBeLessThan(ONE);
      expect(state.calls).toBe(
        saved.runs.reduce((n: number, r: { calls: number }) => n + r.calls, 0),
      );
    });

    it("a reservation is on disk before the call is sent: a crash mid-call leaves it counted", async () => {
      const file = join(dir(), "budget.json");
      const ledger = Ledger.open(file, 1_000_000);
      let onDisk = -1;
      const peeking: LlmProvider = {
        generateObject: async () => {
          onDisk = JSON.parse(readFileSync(file, "utf8")).pendingMicro;
          return new Promise(() => undefined); // never answers: the process "dies" here
        },
      };
      void metered(peeking, newMeter(), 1_000_000, { reserve, ledger }).generateObject(REQUEST);
      await new Promise((r) => setTimeout(r, 10));
      expect(onDisk).toBe(ONE);
      expect(Ledger.open(file, 1_000_000).remainingMicro()).toBe(1_000_000 - ONE);
    });

    it("refuses a file inside the repository, one for another total, and one it did not write", () => {
      const inside = fileURLToPath(new URL("./budget-test.json", import.meta.url));
      expect(() => Ledger.open(inside, 1_000_000)).toThrow(/outside the repository/);
      expect(existsSync(inside)).toBe(false);
      const file = join(dir(), "budget.json");
      Ledger.open(file, 1_000_000);
      expect(() => Ledger.open(file, 2_000_000)).toThrow(/refusing to change it/);
      const junk = join(dir(), "junk.json");
      writeFileSync(junk, "{not json");
      expect(() => Ledger.open(junk, 1_000_000)).toThrow(/cannot be read/);
      writeFileSync(junk, JSON.stringify({ version: 2 }));
      expect(() => Ledger.open(junk, 1_000_000)).toThrow(/not one this tool wrote/);
    });

    it("the paid engine is not built without a budget file", () => {
      expect(() =>
        v1Ai({ estimate: false, maxUsd: 1, env: { [PAID_ENV]: PAID_PHRASE, OPENAI_API_KEY: "k" } }),
      ).toThrow(/--budget-file/);
    });

    it("an estimate needs no budget file and touches none", async () => {
      const file = join(dir(), "budget.json");
      const run = v1Ai({ estimate: true, maxUsd: 1, env: {} });
      const scenario = scenariosOf("main").find(
        (s) =>
          s.needs.every((n) => n === "pairing") && s.turns.length === 1 && s.cellar !== "empty",
      )!;
      await run.engine.run(scenario);
      expect(run.mode).toBe("estimate");
      expect(existsSync(file)).toBe(false);
    });
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
      ledger: Ledger.open(
        join(mkdtempSync(join(tmpdir(), "sommelier-budget-")), "b.json"),
        2_000_000,
      ),
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
