import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SetSommelierOutcome, SommelierOutcome } from "@cellr/domain";

const put = vi.fn();
vi.mock("@/lib/api", () => ({ api: { put: (...args: unknown[]) => put(...args) } }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import { CHAT_KEY, outcomeMutation } from "./hooks";
import { outcomeIn, type ChatState } from "./turns";

/**
 * Two quick taps on one bottle, each of which may fail: when both are done, the screen shows what the server
 * holds. (Found by the security review: putting back "what was on screen before this tap" left the screen and
 * the server disagreeing.)
 */
const M = "6f1c2b0a-1111-4111-8111-111111111111";
const V = "6f1c2b0a-2222-4222-8222-222222222222";
const start: ChatState = {
  lastAskedAt: 1,
  turns: [
    {
      role: "sommelier",
      id: M,
      rating: null,
      outcomes: [],
      answer: { source: "basic", text: null, basic: "pairing", bottles: [], reason: null },
    },
  ],
};
const opened: SetSommelierOutcome = {
  messageId: M,
  vintageId: V,
  opened: true,
  withDish: null,
  enjoyed: null,
};
const withDish: SetSommelierOutcome = { ...opened, withDish: true };
const stored = (input: SetSommelierOutcome): { outcome: SommelierOutcome | null } => ({
  outcome: input.opened ? { vintageId: V, withDish: input.withDish, enjoyed: input.enjoyed } : null,
});

function setup() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  client.setQueryData(CHAT_KEY, start);
  const failed = vi.fn();
  const observer = () => new MutationObserver(client, outcomeMutation(client, M, failed));
  const shown = () => outcomeIn(client.getQueryData<ChatState>(CHAT_KEY), M, V);
  return { observer, shown, failed };
}
const tapTwice = async (first: "ok" | "fail", second: "ok" | "fail") => {
  const { observer, shown, failed } = setup();
  for (const result of [first, second])
    put.mockImplementationOnce(async (_path: string, input: SetSommelierOutcome) => {
      if (result === "fail") throw new Error("offline");
      return stored(input);
    });
  const a = observer()
    .mutate(opened)
    .catch(() => null);
  const b = observer()
    .mutate(withDish)
    .catch(() => null);
  // Both taps show at once, before any answer.
  expect(shown()).toEqual({ vintageId: V, withDish: true, enjoyed: null });
  await Promise.all([a, b]);
  return { shown: shown(), failures: failed.mock.calls.length };
};

describe("two quick taps on one bottle", () => {
  beforeEach(() => put.mockReset());

  it("both stored: the screen shows the second", async () => {
    expect(await tapTwice("ok", "ok")).toEqual({
      shown: { vintageId: V, withDish: true, enjoyed: null },
      failures: 0,
    });
  });

  it("both failed: the screen shows nothing, because nothing is stored", async () => {
    expect(await tapTwice("fail", "fail")).toEqual({ shown: null, failures: 2 });
  });

  it("the first failed, the second was stored: the screen shows the second", async () => {
    expect(await tapTwice("fail", "ok")).toEqual({
      shown: { vintageId: V, withDish: true, enjoyed: null },
      failures: 1,
    });
  });

  it("the first was stored, the second failed: the screen shows the first", async () => {
    expect(await tapTwice("ok", "fail")).toEqual({
      shown: { vintageId: V, withDish: null, enjoyed: null },
      failures: 1,
    });
  });

  it("shows what the server stored, not what was sent, when they differ", async () => {
    const { observer, shown } = setup();
    put.mockResolvedValueOnce({ outcome: { vintageId: V, withDish: true, enjoyed: null } });
    await observer().mutate({ ...withDish, enjoyed: "yes" });
    expect(shown()).toEqual({ vintageId: V, withDish: true, enjoyed: null });
  });
});
