import { describe, expect, it } from "vitest";
import { aboutWine, askedFor, offersChoice } from "./sommelier-route";

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
