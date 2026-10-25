import { describe, expect, it, vi } from "vitest";
import { getAiEnv } from "@/server/env";
import { planCall, reasoningEfforts } from "./models";

const env = {
  visionModel: "gpt-4.1",
  chatModel: "gpt-4.1-mini",
  adviceModel: "gpt-4.1-mini",
  reasoningEffort: "none" as const,
};
const req = (over: Partial<Parameters<typeof planCall>[1]> = {}) => ({
  task: "sommelier_chat" as const,
  model: "chat" as const,
  maxOutputTokens: 900,
  temperature: 0.4,
  ...over,
});

describe("which model answers", () => {
  it("unchanged by default: advice falls back to the chat model, no reasoning parameter", () => {
    expect(planCall(env, req())).toEqual({
      model: "gpt-4.1-mini",
      reasoningEffort: null,
      maxOutputTokens: 900,
      temperature: 0.4,
    });
  });

  it("a wine profile with its web research stays on the advice model", () => {
    const luna = { ...env, adviceModel: "gpt-6-luna" };
    expect(planCall(luna, req({ task: "wine_insight", webSearch: true }))).toMatchObject({
      model: "gpt-6-luna",
      reasoningEffort: "low",
    });
  });

  it("the advice model serves Sommelier and wine profiles only; scans and valuations keep theirs", () => {
    const luna = { ...env, adviceModel: "gpt-6-luna" };
    expect(planCall(luna, req()).model).toBe("gpt-6-luna");
    expect(planCall(luna, req({ task: "wine_insight" })).model).toBe("gpt-6-luna");
    expect(planCall(luna, req({ task: "label_extraction", model: "vision" })).model).toBe(
      "gpt-4.1",
    );
    expect(planCall(luna, req({ task: "wine_valuation", webSearch: true })).model).toBe(
      "gpt-4.1-mini",
    );
  });

  it("gpt-6-luna at effort none keeps temperature and the limit; low drops temperature, adds room", () => {
    const luna = { ...env, adviceModel: "gpt-6-luna" };
    expect(planCall(luna, req())).toEqual({
      model: "gpt-6-luna",
      reasoningEffort: "none",
      maxOutputTokens: 900,
      temperature: 0.4,
    });
    expect(planCall({ ...luna, reasoningEffort: "low" }, req())).toEqual({
      model: "gpt-6-luna",
      reasoningEffort: "low",
      maxOutputTokens: 2900,
      temperature: undefined,
    });
  });

  it("reasoning parameters only for models with documented efforts; GPT-4.x and unknown models get none", () => {
    expect(reasoningEfforts("gpt-6-luna")).toEqual(["none", "low", "medium"]);
    expect(reasoningEfforts("gpt-6-luna-2026-09-22")).toEqual(["none", "low", "medium"]);
    for (const m of ["gpt-4.1", "gpt-4.1-mini", "gpt-6-astra", "gpt-5.6-luna", "o4-mini"])
      expect(reasoningEfforts(m)).toBeNull();
    const astra = { ...env, adviceModel: "gpt-6-astra", reasoningEffort: "low" as const };
    expect(planCall(astra, req())).toMatchObject({ reasoningEffort: null, temperature: 0.4 });
  });

  it("a web search thinks at least low, with room for it; scans stay at the configured effort", () => {
    const luna = {
      ...env,
      visionModel: "gpt-6-luna",
      chatModel: "gpt-6-luna",
      adviceModel: "gpt-6-luna",
    };
    const valuation = req({ task: "wine_valuation", webSearch: true, maxOutputTokens: 700 });
    expect(planCall(luna, valuation)).toEqual({
      model: "gpt-6-luna",
      reasoningEffort: "low",
      maxOutputTokens: 2700,
      temperature: undefined,
    });
    expect(planCall({ ...luna, reasoningEffort: "medium" }, valuation).reasoningEffort).toBe(
      "medium",
    );
    expect(
      planCall(luna, req({ task: "label_extraction", model: "vision", maxOutputTokens: 800 })),
    ).toMatchObject({ model: "gpt-6-luna", reasoningEffort: "none", maxOutputTokens: 800 });
  });
});

describe("defaults and overrides", () => {
  it("every task defaults to gpt-6-luna; each variable overrides its own tasks", () => {
    vi.stubEnv("AI_MODEL_VISION", "");
    vi.stubEnv("AI_MODEL_CHAT", "");
    vi.stubEnv("AI_MODEL_ADVICE", "");
    vi.stubEnv("AI_REASONING_EFFORT", "");
    expect(getAiEnv()).toMatchObject({
      visionModel: "gpt-6-luna",
      chatModel: "gpt-6-luna",
      adviceModel: "gpt-6-luna",
      reasoningEffort: "none",
    });
    vi.stubEnv("AI_MODEL_VISION", "gpt-4.1");
    vi.stubEnv("AI_MODEL_CHAT", "gpt-4.1-mini");
    vi.stubEnv("AI_REASONING_EFFORT", "max"); // not one we allow: falls back to none
    const e = getAiEnv();
    expect(e).toMatchObject({
      visionModel: "gpt-4.1",
      chatModel: "gpt-4.1-mini",
      adviceModel: "gpt-4.1-mini",
      reasoningEffort: "none",
    });
    vi.stubEnv("AI_MODEL_ADVICE", "gpt-6-luna");
    expect(getAiEnv().adviceModel).toBe("gpt-6-luna");
    vi.unstubAllEnvs();
  });
});
