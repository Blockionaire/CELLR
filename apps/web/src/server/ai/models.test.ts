import { describe, expect, it } from "vitest";
import { isReasoningModel, planCall } from "./models";

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

  it("knows reasoning models from GPT-4.x", () => {
    expect(["gpt-6-luna", "gpt-5.6-luna", "o4-mini"].every(isReasoningModel)).toBe(true);
    expect(["gpt-4.1", "gpt-4.1-mini", "gpt-4o"].some(isReasoningModel)).toBe(false);
  });
});
