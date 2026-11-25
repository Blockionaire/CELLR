import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import type { SommelierBottle } from "@cellr/domain";
import en from "../../../messages/en.json";
import nl from "../../../messages/nl.json";
import { buyPriceLabel, checkNote, checkSentence } from "./check-sentence";

// The card-only sentence for a replaced answer and the price line of a buy entry, in both languages.
const t = {
  en: createTranslator({ locale: "en", messages: en, namespace: "sommelier" }) as never,
  nl: createTranslator({ locale: "nl", messages: nl, namespace: "sommelier" }) as never,
};
const bottle = (over: Partial<SommelierBottle> = {}): SommelierBottle => ({
  vintageId: "v1",
  producer: "Château Musar",
  wineName: "Rouge",
  year: 2018,
  type: "red",
  region: "Bekaa Valley",
  countryCode: "LB",
  count: 3,
  places: [],
  drinkPhase: "ready",
  rating: null,
  ...over,
});

describe("checkSentence", () => {
  it("names the first card by its cellar name and says the verdict", () => {
    expect(checkSentence({ bottles: [bottle()], verdict: "match" }, t.en)).toBe(
      "Château Musar Rouge 2018 from your cellar suits this best.",
    );
    expect(checkSentence({ bottles: [bottle()], verdict: "match" }, t.nl)).toBe(
      "Château Musar Rouge 2018 uit je kelder past hier het best bij.",
    );
    expect(checkSentence({ bottles: [bottle()], verdict: "partial" }, t.en)).toBe(
      "Château Musar Rouge 2018 from your cellar will do, though it is not ideal.",
    );
    expect(checkSentence({ bottles: [bottle()], verdict: "partial" }, t.nl)).toBe(
      "Château Musar Rouge 2018 uit je kelder kan, maar is niet ideaal.",
    );
    expect(checkSentence({ bottles: [bottle()], verdict: null }, t.en)).toBe(
      "Château Musar Rouge 2018 from your cellar is the one to look at.",
    );
    expect(checkSentence({ bottles: [bottle()] }, t.nl)).toBe(
      "Château Musar Rouge 2018 uit je kelder is de fles om naar te kijken.",
    );
  });

  it("says how many more cards follow", () => {
    const two = [
      bottle(),
      bottle({ vintageId: "v2", producer: "Bollinger", wineName: "Special Cuvée", year: null }),
    ];
    expect(checkSentence({ bottles: two, verdict: "match" }, t.en)).toBe(
      "Château Musar Rouge 2018 from your cellar suits this best. One more is shown below.",
    );
    expect(
      checkSentence({ bottles: [...two, bottle({ vintageId: "v3" })], verdict: "match" }, t.nl),
    ).toBe(
      "Château Musar Rouge 2018 uit je kelder past hier het best bij. Er staan er nog 2 hieronder.",
    );
  });

  it("an NV wine and a name that holds its producer read naturally", () => {
    expect(
      checkSentence(
        { bottles: [bottle({ producer: "Bollinger", wineName: "Special Cuvée", year: null })] },
        t.en,
      ),
    ).toBe("Bollinger Special Cuvée from your cellar is the one to look at.");
    expect(
      checkSentence(
        {
          bottles: [
            bottle({ producer: "Château Margaux", wineName: "Château Margaux", year: 2010 }),
          ],
        },
        t.en,
      ),
    ).toBe("Château Margaux 2010 from your cellar is the one to look at.");
  });

  it("with no card it says so honestly, never a made-up wine", () => {
    expect(checkSentence({ bottles: [], verdict: "none" }, t.en)).toBe(
      "Nothing in your cellar is a sure fit for this.",
    );
    expect(checkSentence({ bottles: [], verdict: "none" }, t.nl)).toBe(
      "Niets in je kelder past hier zeker bij.",
    );
    expect(checkSentence({ bottles: [], verdict: null }, t.en)).toBe(
      "There is nothing certain to say about this from your cellar. Try asking it another way.",
    );
    expect(checkSentence({ bottles: [] }, t.nl)).toBe(
      "Hierover valt vanuit je kelder niets zekers te zeggen. Probeer het anders te vragen.",
    );
  });
});

describe("checkNote", () => {
  it("says what was left out, and nothing for a kept answer", () => {
    expect(checkNote(null, t.en)).toBeNull();
    expect(checkNote({ v: 1, text: "kept", codes: [] }, t.en)).toBeNull();
    expect(checkNote({ v: 1, text: "trimmed", codes: ["price"] }, t.en)).toBe(
      "Part of the answer was left out: it could not be checked.",
    );
    expect(checkNote({ v: 1, text: "replaced", codes: ["wrong-count"] }, t.nl)).toBe(
      "De eigen woorden van de sommelier zijn weggelaten: ze zeiden iets over je kelder dat niet kon worden gecontroleerd.",
    );
  });
});

describe("buyPriceLabel", () => {
  it("words the person's own budget band, open at either end", () => {
    expect(buyPriceLabel({ priceBand: [15, 30] }, t.en)).toBe("€15–30, your budget");
    expect(buyPriceLabel({ priceBand: [15, 30] }, t.nl)).toBe("€15–30, je budget");
    expect(buyPriceLabel({ priceBand: [60, null] }, t.en)).toBe("€60 or more, your budget");
    expect(buyPriceLabel({ priceBand: [60, null] }, t.nl)).toBe("€60 of meer, je budget");
    expect(buyPriceLabel({ priceBand: [0, 15] }, t.en)).toBe("Up to €15, your budget");
    expect(buyPriceLabel({ priceBand: [0, 15] }, t.nl)).toBe("Tot €15, je budget");
  });

  it("says the price is not known without a band, never a number", () => {
    expect(buyPriceLabel({ priceBand: null }, t.en)).toBe("Price not known");
    expect(buyPriceLabel({}, t.nl)).toBe("Prijs niet bekend");
  });
});
