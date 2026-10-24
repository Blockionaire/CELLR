import { describe, expect, it, vi } from "vitest";
import { withBudget } from "./budget";
import type { GenerateObjectRequest, LlmProvider } from "./types";

const request: GenerateObjectRequest<string> = {
  task: "sommelier_chat",
  model: "chat",
  system: "s",
  user: "u",
  schemaName: "x",
  jsonSchema: {},
  parse: (v) => String(v),
  maxOutputTokens: 900,
  timeoutMs: 1000,
};
const provider = (): LlmProvider & { calls: number } => {
  const p = {
    calls: 0,
    async generateObject<T>() {
      p.calls += 1;
      return {
        ok: true as const,
        value: "answer" as T,
        usage: { model: "gpt-4.1-mini", tokensIn: 10, tokensOut: 5, latencyMs: 1, reported: true },
      };
    },
  };
  return p;
};
const model = () => ({ model: "gpt-4.1-mini", maxOutputTokens: 900 });

describe("the platform AI budget", () => {
  it("a call that fits gets its hold, which rides on the usage to be released when recorded", async () => {
    const inner = provider();
    const hold = vi.fn<(task: string, estimate: number) => Promise<string>>(async () => "hold-1");
    const result = await withBudget(inner, model, hold).generateObject(request);
    expect(inner.calls).toBe(1);
    expect(hold).toHaveBeenCalledWith("sommelier_chat", expect.any(Number));
    expect(result.usage.budgetHold).toEqual({
      id: "hold-1",
      estimateUsdMicro: hold.mock.calls[0]![1],
    });
  });

  it("a used-up budget: no request is made, the caller gets `budget` and a confirmed-zero usage", async () => {
    const inner = provider();
    const result = await withBudget(inner, model, async () => null).generateObject(request);
    expect(inner.calls).toBe(0);
    expect(result).toMatchObject({
      ok: false,
      kind: "budget",
      usage: { notSent: true, tokensIn: 0 },
    });
  });

  it("no budget configured (no hold needed) or a budget that cannot be checked: the call goes ahead", async () => {
    for (const hold of [async () => "", async () => Promise.reject(new Error("db down"))]) {
      const inner = provider();
      const result = await withBudget(inner, model, hold).generateObject(request);
      expect(inner.calls).toBe(1);
      expect(result.ok).toBe(true);
      expect(result.usage.budgetHold).toBeUndefined();
    }
  });

  it("simultaneous calls each ask for their own hold (the database serialises them)", async () => {
    let room = 2;
    const hold = async () => (room-- > 0 ? "h" : null);
    const guarded = withBudget(provider(), model, hold);
    const results = await Promise.all([1, 2, 3, 4].map(() => guarded.generateObject(request)));
    expect(results.filter((r) => r.ok)).toHaveLength(2);
    expect(results.filter((r) => !r.ok && r.kind === "budget")).toHaveLength(2);
  });

  it("estimates the call that is made: a reasoning model's extra output room is held too", async () => {
    const held: number[] = [];
    const hold = async (_task: string, estimate: number) => (held.push(estimate), "h");
    await withBudget(provider(), model, hold).generateObject(request);
    await withBudget(
      provider(),
      () => ({ model: "gpt-6-luna", maxOutputTokens: 2900 }),
      hold,
    ).generateObject(request);
    expect(held[1]).toBeGreaterThan(0);
    expect(held[1]).toBeGreaterThanOrEqual(Math.ceil(2900 * 0.5));
  });
});
