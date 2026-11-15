import { describe, expect, it } from "vitest";
import { AskSommelierSchema } from "./sommelier";
import {
  isStoredAnswer,
  RateSommelierAnswerSchema,
  SOMMELIER_QUESTION_KINDS,
  sommelierQuestionKind,
} from "./sommelier-conversation";

const ID = "6f1c1d2e-3a4b-4c5d-8e9f-0a1b2c3d4e5f";

describe("sommelierQuestionKind", () => {
  it("tells questions about the cellar itself apart, by what they want to know", () => {
    expect(sommelierQuestionKind("Where is my Musar?")).toBe("cellar_location");
    expect(sommelierQuestionKind("Hoeveel flessen heb ik?")).toBe("cellar_quantity");
    expect(sommelierQuestionKind("Which wines do I have from Italy?")).toBe("cellar_selection");
  });

  it("calls a dish a pairing, an evening an occasion, and the rest general", () => {
    expect(sommelierQuestionKind("What goes with steak?")).toBe("pairing");
    expect(sommelierQuestionKind("Friends over for dinner, what should I open?")).toBe("occasion");
    expect(sommelierQuestionKind("Tell me something about Barolo")).toBe("general");
  });

  it("only ever gives a kind the database accepts", () => {
    for (const q of ["", "?", "steak", "waar ligt de Barolo", "verjaardag", "hoi"])
      expect(SOMMELIER_QUESTION_KINDS).toContain(sommelierQuestionKind(q));
  });
});

describe("the kept conversation's contracts", () => {
  it("a question may carry the id the screen gave it, and must be a uuid", () => {
    const messages = [{ role: "user", text: "Anything?" }];
    expect(AskSommelierSchema.parse({ messages, questionId: ID }).questionId).toBe(ID);
    expect(AskSommelierSchema.parse({ messages }).questionId).toBeUndefined();
    expect(AskSommelierSchema.safeParse({ messages, questionId: "abc" }).success).toBe(false);
  });

  it("a rating is positive, negative or taken back (null), for one answer", () => {
    expect(RateSommelierAnswerSchema.parse({ messageId: ID, rating: "positive" }).rating).toBe(
      "positive",
    );
    expect(RateSommelierAnswerSchema.parse({ messageId: ID, rating: null }).rating).toBeNull();
    expect(RateSommelierAnswerSchema.safeParse({ messageId: ID, rating: "meh" }).success).toBe(
      false,
    );
    expect(RateSommelierAnswerSchema.safeParse({ messageId: ID }).success).toBe(false);
    expect(RateSommelierAnswerSchema.safeParse({ messageId: "x", rating: null }).success).toBe(
      false,
    );
  });

  it("only an answer the screen can draw is drawn again", () => {
    const answer = { source: "ai", text: "Open it.", basic: null, bottles: [], reason: null };
    expect(isStoredAnswer(answer)).toBe(true);
    expect(isStoredAnswer({ ...answer, source: "basic", text: null, basic: "soon" })).toBe(true);
    expect(isStoredAnswer({ ...answer, source: "magic" })).toBe(false);
    expect(isStoredAnswer({ ...answer, bottles: "none" })).toBe(false);
    expect(isStoredAnswer({ ...answer, text: 3 })).toBe(false);
    expect(isStoredAnswer(null)).toBe(false);
    expect(isStoredAnswer("Open it.")).toBe(false);
  });
});
