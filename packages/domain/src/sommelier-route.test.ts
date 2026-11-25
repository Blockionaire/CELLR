import { describe, expect, it } from "vitest";
import { aboutWine, askedFor, isSmallTalk, offersChoice } from "./sommelier-route";

describe("what a question's wording asks for", () => {
  it.each([
    ["At what temperature should I serve my Chablis?", "serving"],
    ["Should I decant the Barolo and the old Gevrey-Chambertin for Saturday?", "serving"],
    ["Hoe koud moet de champagne en welk glas gebruik ik?", "serving"],
    ["Moet ik de Barolo decanteren?", "serving"],
    ["Hoe lang kan ik mijn Amarone nog bewaren?", "keeping"],
    ["How long can I keep the Sauternes?", "keeping"],
    ["8 guests, roast lamb. Do I have enough bottles?", "quantity"],
    ["Hoeveel flessen heb ik nodig voor 12 personen?", "quantity"],
    ["What should I cook with my Barolo?", "wine-to-food"],
    ["Wat kook ik bij de Meursault?", "wine-to-food"],
  ] as const)("%s", (question, kind) => {
    expect(askedFor(question)).toBe(kind);
  });
  it("says nothing about an ordinary pairing or buying question", () => {
    for (const q of [
      "What should I open with roast lamb?",
      "Welke fles past bij zeebaars met citroenboter?",
      "What should I buy for sea bass, under €25?",
      "Chilli con carne tonight, which red?",
      "How many bottles do I have?".replace("How many bottles", "Which reds"),
    ])
      expect(askedFor(q)).toBeNull();
  });
  it("an amount that is needed is a quantity question; an amount that is owned is not", () => {
    for (const q of [
      "How many bottles do I need for 12 people?",
      "How much wine will we need for a dinner of eight?",
      "Hoeveel wijn heb ik nodig voor 8 gasten?",
      "Do I have enough of the Rioja for six?",
      "Heb ik voldoende flessen voor zaterdag?",
      "Kom ik uit met de Barolo voor 10 man?",
    ])
      expect(askedFor(q), q).toBe("quantity");
    for (const q of [
      "How many bottles do I have?",
      "How many bottles of Barolo are left?",
      "Hoeveel flessen heb ik nog?",
      "Hoeveel wijn ligt er in de kelder?",
      // "need" far beyond the amount is not about it.
      `How many bottles ${"of the old Barolo from my father ".repeat(3)}do I need?`,
    ])
      expect(askedFor(q), q).toBeNull();
  });
  it("a bottle that is already open is not a question about its drinking window", () => {
    for (const q of [
      "How long can I keep an opened bottle of Barolo?",
      "How long does it keep once open?",
      "Hoe lang kan ik een geopende fles nog bewaren?",
      "Hoe lang kan ik een aangebroken fles bewaren?",
      "Hoe lang kan ik hem na het openen nog bewaren?",
    ])
      expect(askedFor(q), q).toBeNull();
    expect(askedFor("How long can I keep the Barolo?")).toBe("keeping");
    expect(askedFor("Hoe lang kan ik de Barolo nog bewaren?")).toBe("keeping");
    // Opening is not the same as being open: a serving question stays one.
    expect(askedFor("How long before opening should I decant it?")).toBe("serving");
  });
  it("sees a choice between two", () => {
    expect(offersChoice("Rioja of Chianti bij de pizza?")).toBe(true);
    expect(offersChoice("Barolo or Pauillac with the lamb?")).toBe(true);
    expect(offersChoice("What goes with roast lamb?")).toBe(false);
  });
  it("knows when a question is about wine or a meal at all", () => {
    expect(aboutWine("Which wine tonight?")).toBe(true);
    expect(aboutWine("Wat schenk ik vanavond?")).toBe(true);
    expect(aboutWine("What's the weather like tomorrow?")).toBe(false);
    expect(aboutWine("Hoe laat gaat de supermarkt dicht?")).toBe(false);
    expect(aboutWine("asdf qwerty")).toBe(false);
  });
});

describe("small talk and questions with a subject", () => {
  it.each(["Thanks!", "ok", "Dank je wel", "Prima", "hello"])("%s is small talk", (text) => {
    expect(isSmallTalk(text)).toBe(true);
  });
  it("a question is not small talk", () => {
    expect(isSmallTalk("Thanks, and what goes with lamb?")).toBe(false);
  });
  it.each([
    "Which bottles are in the fridge?",
    "Which of my wines are the most valuable?",
    "What temperature should I serve my reds at?",
    "Tell me about decanting",
    "What should I serve at my birthday party?",
  ])("%s is about wine", (text) => {
    expect(aboutWine(text)).toBe(true);
  });
});
