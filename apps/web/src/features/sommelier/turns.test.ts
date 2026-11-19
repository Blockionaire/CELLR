import { describe, expect, it } from "vitest";
import type { SommelierAnswer } from "@cellr/domain";
import { AskSommelierSchema } from "@cellr/domain";
import {
  chatExpired,
  chatStateFrom,
  newQuestionId,
  outcomeIn,
  ratingIn,
  spoken,
  withOutcome,
  withRating,
  type ChatState,
} from "./turns";

const answer = (text: string | null): SommelierAnswer => ({
  source: text === null ? "basic" : "ai",
  text,
  basic: text === null ? "soon" : null,
  bottles: [],
  reason: null,
});

describe("the kept chat on screen", () => {
  const state = chatStateFrom({
    conversation: {
      id: "c1",
      lastActivityAt: "2026-11-10T12:00:00.000Z",
      messages: [
        { id: "q1", role: "user", text: "What now?" },
        { id: "a1", role: "assistant", answer: answer("Open the Barolo."), rating: "positive" },
        { id: "q2", role: "user", text: "And then?" },
        { id: "a2", role: "assistant", answer: answer(null), rating: null },
      ],
    },
  });

  it("comes back as the same turns, with their ids and ratings", () => {
    expect(state.turns.map((t) => [t.role, "id" in t ? t.id : null])).toEqual([
      ["user", "q1"],
      ["sommelier", "a1"],
      ["user", "q2"],
      ["sommelier", "a2"],
    ]);
    expect(ratingIn(state, "a1")).toBe("positive");
    expect(ratingIn(state, "a2")).toBeNull();
    expect(chatStateFrom({ conversation: null })).toEqual({ turns: [], lastAskedAt: null });
  });

  it("is let go 7 days after its last question, also when the screen stayed open that long", () => {
    const asked = Date.parse("2026-11-10T12:00:00.000Z");
    expect(state.lastAskedAt).toBe(asked);
    const day = 86_400_000;
    expect(chatExpired(state, asked + 7 * day - 1)).toBe(false);
    expect(chatExpired(state, asked + 7 * day + 1)).toBe(true);
    // nothing kept (or not yet): nothing to let go
    expect(chatExpired({ turns: [], lastAskedAt: null }, asked + 30 * day)).toBe(false);
    expect(chatExpired(undefined, asked)).toBe(false);
    // a rating keeps when the last question was asked
    expect(withRating(state, "a1", null).lastAskedAt).toBe(asked);
  });

  it("is what the model hears next: the words, a plain answer in its own sentence", () => {
    expect(state.turns.map((t) => spoken(t, () => "These are ready."))).toEqual([
      { role: "user", text: "What now?" },
      { role: "assistant", text: "Open the Barolo." },
      { role: "user", text: "And then?" },
      { role: "assistant", text: "These are ready." },
    ]);
    expect(spoken({ role: "error", message: "x", retry: "y" }, () => "")).toBeNull();
  });

  it("sends back a long answer no longer than a turn of history may be, so the next question still goes through", () => {
    const long = "A".repeat(900);
    const sent = spoken(
      {
        role: "sommelier",
        answer: { source: "ai", text: long, basic: null, bottles: [], reason: null },
      },
      () => "",
    );
    expect(sent?.text).toHaveLength(800);
    const request = AskSommelierSchema.safeParse({
      messages: [{ role: "user", text: "And with fish?" }, sent, { role: "user", text: "Thanks" }],
    });
    expect(request.success).toBe(true);
  });

  it("a rating changes one answer only, and can be taken back", () => {
    const changed = withRating(state, "a2", "negative");
    expect(ratingIn(changed, "a2")).toBe("negative");
    expect(ratingIn(changed, "a1")).toBe("positive");
    expect(ratingIn(withRating(changed, "a1", null), "a1")).toBeNull();
    // the questions are untouched
    expect(changed.turns[0]).toBe(state.turns[0]);
  });

  it("gives every question a fresh uuid", () => {
    const ids = new Set(Array.from({ length: 50 }, newQuestionId));
    expect(ids.size).toBe(50);
    for (const id of ids)
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("what came of a bottle, on screen", () => {
  const state: ChatState = {
    lastAskedAt: 1,
    turns: [
      { role: "user", id: "q1", text: "Lamb?" },
      {
        role: "sommelier",
        id: "a1",
        rating: "positive",
        answer: { source: "basic", text: null, basic: "pairing", bottles: [], reason: null },
      },
    ],
  };

  it("is kept per bottle of an answer, changed in place, and taken back", () => {
    expect(outcomeIn(state, "a1", "v1")).toBeNull();
    const opened = withOutcome(state, "a1", "v1", {
      vintageId: "v1",
      withDish: null,
      enjoyed: null,
    });
    const both = withOutcome(opened, "a1", "v2", {
      vintageId: "v2",
      withDish: false,
      enjoyed: null,
    });
    const said = withOutcome(both, "a1", "v1", {
      vintageId: "v1",
      withDish: true,
      enjoyed: "mixed",
    });
    expect(outcomeIn(said, "a1", "v1")).toEqual({
      vintageId: "v1",
      withDish: true,
      enjoyed: "mixed",
    });
    expect(outcomeIn(said, "a1", "v2")).toEqual({
      vintageId: "v2",
      withDish: false,
      enjoyed: null,
    });
    const back = withOutcome(said, "a1", "v1", null);
    expect(outcomeIn(back, "a1", "v1")).toBeNull();
    expect(outcomeIn(back, "a1", "v2")).not.toBeNull();
  });

  it("never touches the rating of the answer, and a rating never touches it", () => {
    const said = withOutcome(state, "a1", "v1", { vintageId: "v1", withDish: true, enjoyed: "no" });
    expect(ratingIn(said, "a1")).toBe("positive");
    const rated = withRating(said, "a1", null);
    expect(outcomeIn(rated, "a1", "v1")).toEqual({
      vintageId: "v1",
      withDish: true,
      enjoyed: "no",
    });
    // An answer that is not there changes nothing.
    expect(
      withOutcome(state, "nope", "v1", { vintageId: "v1", withDish: null, enjoyed: null }),
    ).toEqual(state);
  });
});
