import { describe, expect, it } from "vitest";
import {
  SetSommelierOutcomeSchema,
  type AskSommelier,
  type SetSommelierOutcome,
  type SommelierAnswer,
} from "@cellr/domain";
import { createSommelierChatService } from "./conversation";
import type { ExchangeEntry, RecordedExchange, SommelierConversationRepository } from "./types";

const QID = "6f1c1d2e-3a4b-4c5d-8e9f-0a1b2c3d4e5f";
const answerOf = (text: string, source: "ai" | "basic" = "ai"): SommelierAnswer => ({
  source,
  text: source === "ai" ? text : null,
  basic: source === "ai" ? null : "soon",
  bottles: [],
  reason: source === "ai" ? null : "ai-down",
});
const chat = (text: string, extra: Partial<AskSommelier> = {}): AskSommelier => ({
  messages: [{ role: "user", text }],
  questionId: QID,
  ...extra,
});

function setup(
  options: {
    answer?: SommelierAnswer;
    /** What is kept, per household: a question is only ever found in the household it was kept in. */
    kept?: Record<string, Awaited<ReturnType<SommelierConversationRepository["findExchange"]>>>;
    record?: RecordedExchange | null | "fails";
    household?: "fails" | string;
    social?: boolean;
  } = {},
) {
  const state = {
    asked: [] as AskSommelier[],
    recorded: [] as Array<Omit<ExchangeEntry, "userId">>,
    cleared: [] as string[],
    rated: [] as Array<[string, string | null]>,
    outcomes: [] as SetSommelierOutcome[],
    lookedUp: [] as Array<[string, string]>,
  };
  const repo: SommelierConversationRepository = {
    current: async (householdId) => ({
      id: `c-${householdId}`,
      lastActivityAt: "2026-11-15T10:00:00.000Z",
      messages: [],
    }),
    findExchange: async (householdId, questionId) => {
      state.lookedUp.push([householdId, questionId]);
      return options.kept?.[householdId] ?? null;
    },
    clear: async (userId) => void state.cleared.push(userId),
    rate: async (messageId, rating) => {
      state.rated.push([messageId, rating]);
      return rating;
    },
    setOutcome: async (input) => {
      state.outcomes.push(input);
      return input.opened
        ? { vintageId: input.vintageId, withDish: input.withDish, enjoyed: input.enjoyed }
        : null;
    },
  };
  const service = createSommelierChatService({
    ask: async (request, observe) => {
      state.asked.push(request);
      const answer = options.answer ?? answerOf("Open the Barolo.");
      if (answer.source === "ai") observe.model("gpt-6-luna-2026-09-22");
      return answer;
    },
    repo,
    record: async (entry) => {
      state.recorded.push(entry);
      if (options.record === "fails") throw new Error("database down");
      return options.record === undefined
        ? { conversationId: "c1", messageId: "a1", replayed: false, answer: null }
        : options.record;
    },
    userId: "u1",
    householdId: async () => {
      if (options.household === "fails") throw new Error("no household");
      return options.household ?? "h1";
    },
    ...(options.social === undefined ? {} : { social: options.social }),
  });
  return { service, state };
}

describe("the kept conversation", () => {
  it("keeps a chat question with its answer, the model that wrote it and the kind of question", async () => {
    const { service, state } = setup();
    const reply = await service.ask(chat("What goes with lamb?"));
    expect(reply).toMatchObject({
      text: "Open the Barolo.",
      saved: { conversationId: "c1", messageId: "a1" },
    });
    expect(state.recorded).toEqual([
      {
        householdId: "h1",
        questionId: QID,
        question: "What goes with lamb?",
        answer: answerOf("Open the Barolo."),
        model: "gpt-6-luna-2026-09-22",
        questionKind: "pairing",
      },
    ]);
  });

  it("names no model for a plain answer", async () => {
    const { service, state } = setup({ answer: answerOf("", "basic") });
    await service.ask(chat("Where is my Musar?"));
    expect(state.recorded[0]).toMatchObject({ model: null, questionKind: "cellar_location" });
  });

  it("only sends the last question along: the model hears what the screen sent, unchanged", async () => {
    const { service, state } = setup();
    const request = chat("And after that?", {
      messages: [
        { role: "user", text: "What should I open?" },
        { role: "assistant", text: "The Barolo." },
        { role: "user", text: "And after that?" },
      ],
    });
    await service.ask(request);
    expect(state.asked).toEqual([request]);
    expect(state.recorded[0]!.question).toBe("And after that?");
  });

  it("a question already answered gets the kept answer back, without asking the model again", async () => {
    const kept = { h1: { conversationId: "c1", messageId: "a0", answer: answerOf("Kept.") } };
    const { service, state } = setup({ kept });
    const reply = await service.ask(chat("What goes with lamb?"));
    expect(reply).toMatchObject({
      text: "Kept.",
      saved: { conversationId: "c1", messageId: "a0" },
    });
    expect(state.lookedUp).toEqual([["h1", QID]]);
    expect(state.asked).toHaveLength(0);
    expect(state.recorded).toHaveLength(0);
  });

  it("a question kept in another household is never brought back: it is asked, and kept, in this one", async () => {
    const kept = { h1: { conversationId: "c1", messageId: "a0", answer: answerOf("About h1.") } };
    const { service, state } = setup({ kept, household: "h2" });
    const reply = await service.ask(chat("What goes with lamb?"));
    expect(reply).toMatchObject({ text: "Open the Barolo.", saved: { messageId: "a1" } });
    expect(state.lookedUp).toEqual([["h2", QID]]);
    expect(state.asked).toHaveLength(1);
    expect(state.recorded[0]).toMatchObject({ householdId: "h2", questionId: QID });
  });

  it("without a household nothing is looked up or kept; the sommelier still answers", async () => {
    const { service, state } = setup({ household: "fails" });
    const reply = await service.ask(chat("Anything?"));
    expect(reply).toMatchObject({ text: "Open the Barolo.", saved: null });
    expect(state.lookedUp).toHaveLength(0);
    expect(state.recorded).toHaveLength(0);
  });

  it("the same question twice at once: the one kept first is the answer", async () => {
    const { service } = setup({
      record: { conversationId: "c1", messageId: "a0", replayed: true, answer: answerOf("First.") },
    });
    expect(await service.ask(chat("Twice?"))).toMatchObject({
      text: "First.",
      saved: { messageId: "a0" },
    });
  });

  it("an answer that could not be kept is still given, and says it was not kept", async () => {
    for (const options of [
      { record: null },
      { record: "fails" as const },
      { household: "fails" as const },
    ]) {
      const reply = await setup(options).service.ask(chat("Anything?"));
      expect(reply.text).toBe("Open the Barolo.");
      expect(reply.saved).toBeNull();
    }
  });

  it("Tonight, and a caller without a question id, keep nothing", async () => {
    const { service, state } = setup();
    const tonight = await service.ask(chat("Steak tonight", { mode: "tonight", budget: "mid" }));
    const plain = await service.ask({ messages: [{ role: "user", text: "Hi" }] });
    expect(state.asked).toHaveLength(2);
    expect(state.recorded).toHaveLength(0);
    expect(tonight).not.toHaveProperty("saved");
    expect(plain).not.toHaveProperty("saved");
  });

  it("loads the conversation of the active household, starts anew for this person, and rates as them", async () => {
    const { service, state } = setup();
    expect(await service.current()).toEqual({
      conversation: { id: "c-h1", lastActivityAt: "2026-11-15T10:00:00.000Z", messages: [] },
    });
    await service.clear();
    expect(state.cleared).toEqual(["u1"]);
    expect(await service.rate({ messageId: "a1", rating: "negative" })).toEqual({
      rating: "negative",
    });
    expect(await service.rate({ messageId: "a1", rating: null })).toEqual({ rating: null });
    expect(state.rated).toEqual([
      ["a1", "negative"],
      ["a1", null],
    ]);
  });

  it("what came of a bottle is its own record: saying it rates nothing, and rating says nothing about it", async () => {
    const { service, state } = setup();
    const said = SetSommelierOutcomeSchema.parse({
      messageId: "6f1c2b0a-1111-4111-8111-111111111111",
      vintageId: "6f1c2b0a-2222-4222-8222-222222222222",
      opened: true,
      withDish: true,
      enjoyed: "mixed",
    });
    expect(await service.outcome(said)).toEqual({
      outcome: { vintageId: said.vintageId, withDish: true, enjoyed: "mixed" },
    });
    expect(state.rated).toEqual([]);
    await service.rate({ messageId: said.messageId, rating: "positive" });
    expect(state.outcomes).toEqual([said]);
    // Taking it back.
    expect(
      await service.outcome(
        SetSommelierOutcomeSchema.parse({ ...said, opened: false, withDish: null, enjoyed: null }),
      ),
    ).toEqual({ outcome: null });
  });

  it("refuses an outcome that says more than the person can know", () => {
    const base = {
      messageId: "6f1c2b0a-1111-4111-8111-111111111111",
      vintageId: "6f1c2b0a-2222-4222-8222-222222222222",
    };
    // How it went together, without having had them together.
    expect(
      SetSommelierOutcomeSchema.safeParse({ ...base, opened: true, enjoyed: "yes" }).success,
    ).toBe(false);
    expect(
      SetSommelierOutcomeSchema.safeParse({ ...base, opened: true, withDish: false, enjoyed: "no" })
        .success,
    ).toBe(false);
    // Not opened, and yet something about it.
    expect(
      SetSommelierOutcomeSchema.safeParse({ ...base, opened: false, withDish: true }).success,
    ).toBe(false);
    expect(
      SetSommelierOutcomeSchema.safeParse({ ...base, opened: true, enjoyed: "great" }).success,
    ).toBe(false);
    expect(SetSommelierOutcomeSchema.parse({ ...base, opened: true })).toMatchObject({
      withDish: null,
      enjoyed: null,
    });
  });

  it("keeps a question with an '@' in it as it always did, unless the social sommelier is switched on", async () => {
    // Found by the final review: the "do not keep a question that names a friend" rule ran with every switch
    // off, so "what do I open @home tonight" was answered but not kept, could not be rated and was gone on reload.
    for (const social of [undefined, false] as const) {
      const { service, state } = setup(social === undefined ? {} : { social });
      const reply = await service.ask(chat("What do I open @home tonight?"));
      expect(reply.saved).toEqual({ conversationId: "c1", messageId: "a1" });
      expect(state.recorded).toHaveLength(1);
    }
    const on = setup({ social: true });
    const reply = await on.service.ask(chat("What do I open @home tonight?"));
    expect(reply.saved).toBeNull();
    expect(on.state.recorded).toEqual([]);
    // With it on, a question without a name is kept as ever.
    const plain = setup({ social: true });
    expect((await plain.service.ask(chat("What do I open tonight?"))).saved).not.toBeNull();
  });
});
