import { describe, expect, it } from "vitest";
import {
  advance,
  EMPTY_STATE,
  nextQuestion,
  readMoney,
  readState,
  withAsked,
  type ConversationState,
  type TurnInput,
} from "./state";

const say = (state: ConversationState, text: string, more: Partial<TurnInput> = {}) =>
  advance(state, { text, ...more });
const talk = (...turns: Array<string | [string, Partial<TurnInput>]>) =>
  turns.reduce<ConversationState>(
    (s, t) => (typeof t === "string" ? say(s, t) : say(s, t[0], t[1])),
    EMPTY_STATE,
  );
const situation = { dishKnown: true, ownedSuits: false, onTopic: true };

describe("reading a price", () => {
  it.each([
    ["under €15", 15],
    ["Hooguit 25 euro.", 25],
    ["I can spend under €10.", 10],
    ["Niet meer dan € 12,50 per fles.", 12.5],
    ["Max 50.", 50],
    ["Onder de 40 euro graag.", 40],
    ["max 15 euro per fles", 15],
    ["tot 60 euro", 60],
    ["Hmm, toch maximaal 25.", 25],
    ["€25.", 25],
    ["Actually, make that up to €40.", 40],
    ["Under 30, online is fine.", 30],
    ["€ 20 en online is goed.", 20],
    ["20 euro", 20],
  ])("%s", (text, max) => {
    expect(readMoney(text)).toEqual({ max, min: null, open: false });
  });
  it("reads a range, a floor and 'around'", () => {
    expect(readMoney("between €20 and €30")).toEqual({ min: 20, max: 30, open: false });
    expect(readMoney("tussen de 15 en 25 euro")).toEqual({ min: 15, max: 25, open: false });
    expect(readMoney("at least €30")).toEqual({ min: 30, max: null, open: false });
    expect(readMoney("around €40").max).toBe(40);
  });
  it("knows when price does not matter", () => {
    expect(readMoney("Money is no object.")).toEqual({ max: null, min: null, open: true });
    expect(readMoney("Geld speelt geen rol")).toEqual({ max: null, min: null, open: true });
  });
  it("does not take a year, a guest count or a vintage for money", () => {
    expect(readMoney("A Chablis 2022 for 8 guests")).toEqual({ max: null, min: null, open: false });
    expect(readMoney("25")).toEqual({ max: null, min: null, open: false });
  });
  it("takes a bare number as money only when the budget was just asked", () => {
    expect(readMoney("25", true).max).toBe(25);
    expect(readMoney("20.", true).max).toBe(20);
    expect(readMoney("we are with 25", true).max).toBeNull();
  });
});

describe("what a conversation establishes", () => {
  it("the owner's example: either → budget → where → location", () => {
    let s = say(
      EMPTY_STATE,
      "What should I drink with sea bass from my cellar, or should I buy something?",
      {
        dish: "sea bass",
      },
    );
    expect(s).toMatchObject({ intent: "either", dish: "sea bass", budgetMaxEuros: null });
    expect(nextQuestion(s, situation)).toBe("budget");
    s = withAsked(s, "budget");

    s = say(s, "€25.");
    expect(s).toMatchObject({ intent: "buy", dish: "sea bass", budgetMaxEuros: 25 });
    expect(nextQuestion(s, situation)).toBe("channel");
    s = withAsked(s, "channel");

    s = say(s, "Collect today, preferably nearby.");
    expect(s).toMatchObject({ channel: "pickup", budgetMaxEuros: 25, dish: "sea bass" });
    expect(nextQuestion(s, situation)).toBe("location-consent");
    s = withAsked(s, "location-consent");

    s = say(s, "Yes, that's fine");
    expect(s.locationConsent).toBe(true);
    expect(nextQuestion(s, situation)).toBeNull();
  });
  it("does not ask to buy when something owned suits", () => {
    const s = say(
      EMPTY_STATE,
      "What should I drink with sea bass from my cellar, or should I buy something?",
      {
        dish: "sea bass",
      },
    );
    expect(nextQuestion(s, { ...situation, ownedSuits: true })).toBeNull();
  });
  it("a new budget replaces the old and keeps the dish", () => {
    const s = talk(
      ["I need to buy a wine for roast chicken, under €20.", { dish: "roast chicken" }],
      "Actually, make that up to €40.",
    );
    expect(s).toMatchObject({ intent: "buy", budgetMaxEuros: 40, dish: "roast chicken" });
    const lower = talk(
      ["Bij de ribeye wil ik iets kopen, tot 60 euro.", { dish: "ribeye" }],
      "Hmm, toch maximaal 25.",
    );
    expect(lower).toMatchObject({ budgetMaxEuros: 25, dish: "ribeye" });
  });
  it("a new dish replaces the old and keeps the budget", () => {
    const s = talk(
      ["Ik zoek een fles om te kopen voor bij zalm, max 20 euro.", { dish: "zalm" }],
      ["Toch maar geen zalm, we eten stoofvlees.", { dish: "stoofvlees" }],
    );
    expect(s).toMatchObject({ intent: "buy", dish: "stoofvlees", budgetMaxEuros: 20 });
  });
  it("a colour wish is kept beside the dish", () => {
    expect(
      talk(
        ["What goes with roast chicken tonight?", { dish: "roast chicken" }],
        "Something lighter please, a white.",
      ),
    ).toMatchObject({
      wineType: "white",
      dish: "roast chicken",
    });
    expect(
      talk(["Wat drinken we bij de lamsbout?", { dish: "lamsbout" }], "Liever wit eigenlijk."),
    ).toMatchObject({
      wineType: "white",
      dish: "lamsbout",
    });
    expect(say(EMPTY_STATE, "Welke rode wijn moet ik halen voor lamsbout? Max 50.").wineType).toBe(
      "red",
    );
  });
  it("several answers in one turn", () => {
    const s = talk(
      ["I want to buy a wine for salmon.", { dish: "salmon" }],
      "Under 30, online is fine.",
    );
    expect(s).toMatchObject({
      intent: "buy",
      budgetMaxEuros: 30,
      channel: "online",
      dish: "salmon",
    });
    expect(nextQuestion(s, situation)).toBeNull();
    const nl = talk(
      ["Wat moet ik drinken bij Thaise groene curry?", { dish: "Thaise groene curry" }],
      "Ik heb niks in huis, dus het wordt kopen.",
      "Max 20 euro, en ik haal het op in de winkel.",
    );
    expect(nl).toMatchObject({ intent: "buy", budgetMaxEuros: 20, channel: "pickup" });
    expect(nextQuestion(nl, situation)).toBe("location-consent");
  });
  it("'only from my cellar' ends the buying", () => {
    const s = talk(
      ["What goes with oysters?", { dish: "oysters" }],
      "Just from my cellar, I don't want to buy anything.",
    );
    expect(s.intent).toBe("open");
    expect(nextQuestion(s, situation)).toBeNull();
  });
  it("a gift: who it is for and what they like; the dish is not asked", () => {
    const s = talk("Can you help me find a bottle?", [
      "It's a present for my father who loves Bordeaux, around €40.",
      { wineKeys: ["bordeaux"] },
    ]);
    expect(s).toMatchObject({
      intent: "gift",
      recipient: "father",
      recipientLikes: ["bordeaux"],
      budgetMaxEuros: 40,
    });
    expect(nextQuestion(s, { ...situation, dishKnown: false })).toBeNull();
    const vague = say(EMPTY_STATE, "I need a gift for a colleague");
    expect(nextQuestion(vague, { ...situation, dishKnown: false })).toBe("budget");
    expect(
      nextQuestion(withAsked({ ...vague, budgetMaxEuros: 30 }, "budget"), {
        ...situation,
        dishKnown: false,
      }),
    ).toBe("recipient-taste");
  });
  it("a budget chosen on the screen counts like one that was typed", () => {
    const s = say(EMPTY_STATE, "What should I buy to go with a Thai green curry?", {
      budgetEuros: 20,
      dish: "Thai green curry",
    });
    expect(s).toMatchObject({ intent: "buy", budgetMaxEuros: 20 });
  });
  it("'not that one' sets the first offered wine aside", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    const s = say(EMPTY_STATE, "Not that one, give me another.", { lastOffered: [id] });
    expect(s.rejected).toEqual([id]);
  });
  it("a shop word alone is not a wish to buy", () => {
    expect(say(EMPTY_STATE, "Hoe laat gaat de supermarkt dicht?").intent).toBeNull();
    expect(say(EMPTY_STATE, "Is there a shop nearby?").intent).toBeNull();
    // In a conversation about a dish it is.
    expect(
      talk(
        ["What goes with oysters?", { dish: "oysters" }],
        "I'll get something from a shop nearby",
      ).intent,
    ).toBe("buy");
  });
  it("guests", () => {
    expect(say(EMPTY_STATE, "8 guests, roast lamb. Do I have enough bottles?").guests).toBe(8);
    expect(say(EMPTY_STATE, "We zijn met 6 personen").guests).toBe(6);
  });
});

describe("what is asked", () => {
  it("asks for the dish when nothing was understood, once", () => {
    const s = say(EMPTY_STATE, "Something with the thing we had last time?");
    expect(nextQuestion(s, { ...situation, dishKnown: false })).toBe("dish");
    expect(nextQuestion(withAsked(s, "dish"), { ...situation, dishKnown: false })).toBeNull();
  });
  it("asks nothing about a question that is not about wine", () => {
    expect(
      nextQuestion(EMPTY_STATE, { dishKnown: false, ownedSuits: false, onTopic: false }),
    ).toBeNull();
  });
  it("never asks what was already said or already asked", () => {
    let s = talk(["What should I buy for sea bass?", { dish: "sea bass" }]);
    const seen: string[] = [];
    for (let i = 0; i < 6; i++) {
      const q = nextQuestion(s, situation);
      if (q === null) break;
      expect(seen).not.toContain(q);
      seen.push(q);
      s = withAsked(s, q);
      // The person ignores the question and says something unrelated.
      s = say(s, "hmm");
    }
    // One ignored question is enough: it stops asking rather than moving on to the next one.
    expect(seen).toEqual(["budget"]);
  });
  it("does not ask the budget when price does not matter", () => {
    const s = say(
      EMPTY_STATE,
      "Roast lamb for a special dinner. What should I buy? Money is no object.",
      { dish: "roast lamb" },
    );
    expect(s).toMatchObject({ intent: "buy", budgetOpen: true, budgetMaxEuros: null });
    expect(nextQuestion(s, situation)).toBe("channel");
  });
});

describe("a state sent back by a screen", () => {
  it("is used when well-formed", () => {
    const s = say(EMPTY_STATE, "buy something under €20");
    expect(readState(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });
  it("is dropped when it is anything else", () => {
    for (const bad of [
      null,
      "x",
      3,
      {},
      { ...EMPTY_STATE, v: 2 },
      { ...EMPTY_STATE, intent: "steal" },
      { ...EMPTY_STATE, budgetMaxEuros: -5 },
      { ...EMPTY_STATE, rejected: ["not-a-uuid"] },
      { ...EMPTY_STATE, dish: "x".repeat(500) },
    ])
      expect(readState(bad)).toEqual(EMPTY_STATE);
  });
});
