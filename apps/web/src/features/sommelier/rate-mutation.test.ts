import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RateSommelierAnswer, SommelierRating } from "@cellr/domain";

const put = vi.fn();
vi.mock("@/lib/api", () => ({ api: { put: (...args: unknown[]) => put(...args) } }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import { CHAT_KEY, rateMutation } from "./hooks";
import { ratingIn, type ChatState } from "./turns";

/**
 * Two quick taps on the thumbs of one answer, each of which may fail: when both are done, the screen shows what
 * the server holds. (Putting back "what was on screen before this tap" left the two disagreeing: the second tap's
 * "before" is the first tap's unconfirmed guess.)
 */
const M = "6f1c2b0a-1111-4111-8111-111111111111";
const chat = (rating: SommelierRating | null): ChatState => ({
  lastAskedAt: 1,
  turns: [
    { role: "user", id: "6f1c2b0a-0000-4000-8000-000000000000", text: "What goes with lamb?" },
    {
      role: "sommelier",
      id: M,
      rating,
      answer: { source: "basic", text: null, basic: "pairing", bottles: [], reason: null },
    },
  ],
});

function setup(held: SommelierRating | null) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  client.setQueryData(CHAT_KEY, chat(held));
  const failed = vi.fn();
  const observer = () => new MutationObserver(client, rateMutation(client, M, failed));
  const shown = () => ratingIn(client.getQueryData<ChatState>(CHAT_KEY), M);
  return { observer, shown, failed };
}

type Result = "ok" | "fail";

/**
 * The server, as far as a rating goes: it holds one value, a request that arrives stores what it was sent and
 * says so, a request that fails changes nothing. The two taps reach it one after the other.
 */
async function tapTwice(
  held: SommelierRating | null,
  taps: [SommelierRating | null, SommelierRating | null],
  results: [Result, Result],
) {
  const { observer, shown, failed } = setup(held);
  let server = held;
  for (const result of results)
    put.mockImplementationOnce(async (_path: string, input: RateSommelierAnswer) => {
      if (result === "fail") throw new Error("offline");
      server = input.rating;
      return { rating: server };
    });
  const sent = taps.map((rating) =>
    observer()
      .mutate({ messageId: M, rating })
      .catch(() => null),
  );
  // Both taps show at once, before any answer: the last one is what the screen has.
  expect(shown()).toBe(taps[1]);
  await Promise.all(sent);
  return { shown: shown(), server, failures: failed.mock.calls.length };
}

describe("two quick taps on the thumbs of one answer", () => {
  beforeEach(() => put.mockReset());

  it("both stored: the screen shows the second", async () => {
    expect(await tapTwice(null, ["positive", "negative"], ["ok", "ok"])).toEqual({
      shown: "negative",
      server: "negative",
      failures: 0,
    });
  });

  it("both failed: the screen shows no rating, because none is stored", async () => {
    expect(await tapTwice(null, ["positive", "negative"], ["fail", "fail"])).toEqual({
      shown: null,
      server: null,
      failures: 2,
    });
  });

  it("the first failed, the second was stored: the screen shows the second", async () => {
    expect(await tapTwice(null, ["positive", "negative"], ["fail", "ok"])).toEqual({
      shown: "negative",
      server: "negative",
      failures: 1,
    });
  });

  it("the first was stored, the second failed: the screen shows the first", async () => {
    expect(await tapTwice(null, ["positive", "negative"], ["ok", "fail"])).toEqual({
      shown: "positive",
      server: "positive",
      failures: 1,
    });
  });

  it("both failed on an answer that was rated: the rating it had is back", async () => {
    // Taken back, then the other thumb: neither arrived, so the first rating still stands.
    expect(await tapTwice("positive", [null, "negative"], ["fail", "fail"])).toEqual({
      shown: "positive",
      server: "positive",
      failures: 2,
    });
  });

  it("every order ends with the screen showing what the server holds", async () => {
    const orders: [Result, Result][] = [
      ["ok", "ok"],
      ["fail", "fail"],
      ["fail", "ok"],
      ["ok", "fail"],
    ];
    for (const held of [null, "positive", "negative"] as const)
      for (const results of orders) {
        const end = await tapTwice(
          held,
          [held === "positive" ? null : "positive", "negative"],
          results,
        );
        expect(end.shown, `${held} → ${results.join("/")}`).toBe(end.server);
      }
  });
});

describe("one tap", () => {
  beforeEach(() => put.mockReset());

  it("shows the rating at once and keeps it when it is stored", async () => {
    const { observer, shown, failed } = setup(null);
    let stored!: (value: { rating: SommelierRating | null }) => void;
    put.mockReturnValueOnce(new Promise((resolve) => (stored = resolve)));
    const sent = observer().mutate({ messageId: M, rating: "positive" });
    await vi.waitFor(() => expect(put).toHaveBeenCalledOnce());
    expect(shown()).toBe("positive");
    stored({ rating: "positive" });
    await sent;
    expect(shown()).toBe("positive");
    expect(put).toHaveBeenCalledWith("/sommelier/feedback", { messageId: M, rating: "positive" });
    expect(failed).not.toHaveBeenCalled();
  });

  it("puts the earlier rating back when it fails, and says so", async () => {
    const { observer, shown, failed } = setup("negative");
    put.mockRejectedValueOnce(new Error("offline"));
    await observer()
      .mutate({ messageId: M, rating: "positive" })
      .catch(() => null);
    expect(shown()).toBe("negative");
    expect(failed).toHaveBeenCalledOnce();
  });

  it("shows what the server stored, not what was sent, when they differ", async () => {
    const { observer, shown } = setup(null);
    put.mockResolvedValueOnce({ rating: "negative" });
    await observer().mutate({ messageId: M, rating: "positive" });
    expect(shown()).toBe("negative");
  });

  it("starts from the screen again once nothing is on its way", async () => {
    // A failed tap leaves nothing behind: the next one is measured against what is then on screen.
    const { observer, shown } = setup(null);
    put.mockResolvedValueOnce({ rating: "positive" });
    await observer().mutate({ messageId: M, rating: "positive" });
    put.mockRejectedValueOnce(new Error("offline"));
    await observer()
      .mutate({ messageId: M, rating: null })
      .catch(() => null);
    expect(shown()).toBe("positive");
  });
});
