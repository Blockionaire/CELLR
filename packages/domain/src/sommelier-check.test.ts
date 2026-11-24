import { describe, expect, it } from "vitest";
import {
  AnswerCheckSchema,
  CHECK_CODES,
  CheckedBuySchema,
  PriceBandSchema,
  wineLabel,
} from "./sommelier-check";
import {
  albe,
  bollinger,
  check,
  cuvee1522,
  grandVin,
  langhe,
  musar15,
  musar18,
  pavillon,
  ref,
} from "./sommelier-check.fixtures";

/** The text survives untouched (refs rendered). */
const kept = (text: string, facts?: string) => {
  const r = check(text, { facts: facts ?? null });
  expect({ text, codes: r.check.codes }).toEqual({ text, codes: [] });
  expect(r.check.text).toBe("kept");
  return r.text;
};
/** The text is replaced because of this cellar-fact code. */
const replaced = (text: string, code: string, facts?: string) => {
  const r = check(text, { facts: facts ?? null });
  expect({ text, codes: r.check.codes }).toEqual({ text, codes: [code] });
  expect(r.check.text).toBe("replaced");
  expect(r.text).toBeNull();
};

describe("refs are rendered from the cellar", () => {
  it("a ref becomes the cellar's own producer, name and vintage", () => {
    expect(kept(`Open ${ref(musar18)} tonight; it is ready.`)).toBe(
      "Open Château Musar Rouge 2018 tonight; it is ready.",
    );
    expect(kept(`Schenk ${ref(bollinger)} goed gekoeld.`)).toBe(
      "Schenk Bollinger Special Cuvée goed gekoeld.",
    );
  });

  it("a name that starts with the producer is not written twice; an NV wine has no year", () => {
    expect(wineLabel(grandVin)).toBe("Château Margaux 2010");
    expect(wineLabel(pavillon)).toBe("Château Margaux Pavillon Rouge 2015");
    expect(wineLabel(bollinger)).toBe("Bollinger Special Cuvée");
  });

  it("the model's own copy of the ref's year is not shown twice", () => {
    expect(kept(`Open ${ref(musar18)} 2018 tonight.`)).toBe(
      "Open Château Musar Rouge 2018 tonight.",
    );
    expect(kept(`${ref(musar18)} (2018) is ready.`)).toBe("Château Musar Rouge 2018 is ready.");
  });

  it("a ref glued to punctuation, single brackets or none at all is still the wine", () => {
    expect(kept(`Try ${ref(albe)}, ${ref(langhe)}; or ${ref(musar18)}!`)).toBe(
      "Try G.D. Vajra Barolo Albe 2016, G.D. Vajra Langhe Nebbiolo 2021; or Château Musar Rouge 2018!",
    );
    expect(kept(`Open ${ref(albe).slice(1, -1)} now.`)).toBe(
      "Open G.D. Vajra Barolo Albe 2016 now.",
    );
    expect(kept(`Open ${ref(albe).slice(2, -2)} now.`)).toBe(
      "Open G.D. Vajra Barolo Albe 2016 now.",
    );
  });

  it("an unknown ref replaces the whole text", () => {
    replaced("Open [[zzzzzz]] tonight.", "unknown-ref");
    replaced(`Open ${ref(albe)}. Open [[deadbeef]] too.`, "unknown-ref");
    replaced("Open [[]] now.", "unknown-ref");
    replaced("Open [abcdef99] now.", "unknown-ref");
  });

  it("a year beside a ref that is not the ref's own vintage is wrong", () => {
    replaced(`Open ${ref(musar18)} 2015 tonight.`, "wrong-vintage");
    replaced(`Open the 2015 ${ref(musar18)} tonight.`, "wrong-vintage");
    replaced(`Je ${ref(musar18)} uit 2012 is klaar.`, "wrong-vintage");
  });
});

describe("wrong-vintage", () => {
  it("flags a year said of an owned cellar wine that it does not have (EN)", () => {
    replaced("Your Château Musar 2008 is perfect with lamb.", "wrong-vintage");
    replaced("Your Pavillon Rouge 2012 is ready now.", "wrong-vintage");
    replaced("Open the Château Margaux 2009 tonight.", "wrong-vintage");
    replaced("The 2014 Musar is drinking beautifully now.", "wrong-vintage");
    replaced("The Vajra Barolo Albe 2015 is a classic.", "wrong-vintage");
    replaced("Your 2012 is the one to open.", "wrong-vintage");
  });

  it("flags it in Dutch", () => {
    replaced("Jouw Pavillon Rouge 2012 is nu klaar.", "wrong-vintage");
    replaced("Open de Château Margaux 2009 vanavond.", "wrong-vintage");
    replaced("De Musar uit 2014 is nu prachtig.", "wrong-vintage");
    replaced("Je Musar van 2012 is nu op dronk.", "wrong-vintage");
  });

  it("keeps the vintages the cellar has", () => {
    kept("Your Musar from 2015 is ready, and the 2018 can wait until 2030.");
    kept("Your Château Margaux 2010 is a special bottle; save it for an occasion.");
    kept("De Musar 2018 is kruidiger dan de 2015.");
    kept("Je Musar van 2015 is nu op dronk.");
    kept("The 2015 Musar is drinking beautifully now, more mature than the 2018.");
  });

  it("keeps comparisons with vintages the person does not have", () => {
    kept("Château Musar 2008 would be ideal, but you only have the 2018.");
    kept(`${ref(musar18)} is fresher than a Musar 2008 would be.`);
    kept("Compared to a 2010 Musar, your 2018 is still young.");
    kept("Château Musar's 2008 was a legendary vintage.");
    kept("The 2008 vintage of Château Musar was legendary.");
    kept("Pavillon Rouge from 2016 is not in your cellar, but the 2015 is.");
    kept("Een Musar uit 2008 zou nog mooier zijn, maar die heb je niet.");
  });

  it("does not read a drinking window as a vintage", () => {
    kept(`Keep ${ref(albe)} until 2030; it will drink well from 2027.`);
    kept(`Drink ${ref(albe)} between 2026 and 2032.`);
    kept(`${ref(albe)} is nog jong; naar schatting op zijn best vanaf 2028.`);
    kept("Keep your Vajra until 2030.");
    kept("Drink the Pavillon Rouge 2026–2032.");
  });
});

describe("wrong-count (a stock claim only)", () => {
  it("flags a number of bottles said to be owned or left that the cellar does not hold (EN)", () => {
    replaced("You have 5 bottles of the Vajra Barolo Albe.", "wrong-count");
    replaced("There are 3 bottles of the Pavillon Rouge left.", "wrong-count");
    replaced("You still have twelve bottles of the Albe.", "wrong-count");
    replaced(`For the lamb, ${ref(musar18)} is the one. You have 4 bottles of it.`, "wrong-count");
  });

  it("flags it in Dutch", () => {
    replaced(`Je hebt nog 4 flessen ${ref(albe)}.`, "wrong-count");
    replaced(`Je hebt vier flessen van ${ref(musar18)}.`, "wrong-count");
    replaced("Er liggen nog 3 flessen Pavillon Rouge.", "wrong-count");
    replaced("Je hebt nog twaalf flessen Albe.", "wrong-count");
  });

  it("accepts the vintage's count, reserved and free counts, and the wine's total over vintages", () => {
    kept("You have 6 bottles of the Vajra Barolo Albe.");
    kept(`You have 3 bottles of ${ref(musar18)}, one of them reserved.`);
    kept(`You have 2 free bottles of ${ref(musar18)}.`);
    kept("You have five bottles of Château Musar.");
    kept("Je hebt 5 flessen Château Musar Rouge, verdeeld over twee jaargangen.");
    kept(`Van de 3 flessen ${ref(musar18)} is er 1 gereserveerd; 2 zijn vrij.`);
    kept(`Je hebt nog 6 flessen ${ref(albe)}.`);
    kept("Er liggen nog 2 flessen van de Musar in je kelder.");
  });

  it("does not read a suggestion of how many to open or to need as stock", () => {
    kept(`Open two bottles of ${ref(albe)} for eight guests.`);
    kept(`Trek er twee open van ${ref(albe)}.`);
    kept(`For 8 guests you need 4 bottles; you have 3 of ${ref(musar18)}.`);
    kept(`Voor 8 gasten heb je 4 flessen nodig; je hebt er 3 van ${ref(musar18)}.`);
    kept(`For 8 guests, plan on 4 bottles. You have 6 of ${ref(albe)}, so that is plenty.`);
  });

  it("flags a suggestion to open more than the cellar holds of that wine", () => {
    replaced(`Open ten bottles of ${ref(albe)} for twenty guests.`, "wrong-count");
    replaced(`Open seven bottles of ${ref(albe)} for the party.`, "wrong-count");
    replaced(`Schenk zeven flessen van ${ref(albe)} op het feest.`, "wrong-count");
  });

  it("accepts any number the counted facts block stated (EN and NL)", () => {
    const facts =
      'Cellar facts (counted from the database just now; these are the only numbers and places to state):\n- Wines matching "margaux": 2 (14 bottles):';
    kept("You have 14 bottles of Château Margaux across two vintages.", facts);
    kept("Je hebt 14 flessen Château Margaux, verdeeld over twee jaargangen.", facts);
    kept("You have 3 free spots in the Wine fridge.", '- Places: "Wine fridge" (fridge): 3 free.');
    // Without the facts, 14 is not what the cellar holds of it.
    replaced("You have 14 bottles of Château Margaux across two vintages.", "wrong-count");
  });

  it("does not read numbers that are not bottles of a wine", () => {
    kept("Serve it at 16 °C, give it 30 minutes in the decanter, and pour 6 glasses.");
    kept("Your cellar holds 21 bottles, so there is plenty of choice.");
    kept("Les 7 Cépages is a blend of seven grapes, and your 4 bottles are ready.");
  });
});

describe("not-in-cellar", () => {
  it("flags a wine presented as owned that the cellar does not hold (EN)", () => {
    replaced("Your Krug is ready to open.", "not-in-cellar");
    replaced("Your Sassicaia 2015 is the obvious choice.", "not-in-cellar");
    replaced("You have a lovely Opus One in your cellar.", "not-in-cellar");
    replaced("There is a Sassicaia in your cellar.", "not-in-cellar");
    replaced("You have a Sassicaia, open it.", "not-in-cellar");
    replaced("Open the Château Musard tonight.", "not-in-cellar");
    replaced("Your rosé is perfect for the terrace.", "not-in-cellar");
    replaced("Your Barbaresco is a great match.", "not-in-cellar");
  });

  it("flags it in Dutch", () => {
    replaced("Jouw Tignanello is nu op dronk.", "not-in-cellar");
    replaced("Je hebt een mooie Opus One in je kelder.", "not-in-cellar");
    replaced("In je kelder ligt een Sassicaia.", "not-in-cellar");
    replaced("Je Krug is klaar om te drinken.", "not-in-cellar");
    replaced("Je rosé is perfect voor het terras.", "not-in-cellar");
  });

  it("keeps wines the person does not own when they are not presented as owned", () => {
    kept(`A Barolo would be ideal, but you have none. ${ref(musar18)} will do.`);
    kept(
      `Een Barolo zou de klassieke keuze zijn, maar die heb je niet; ${ref(langhe)} komt dichtbij.`,
    );
    kept(`Compared with a Barolo, ${ref(langhe)} is lighter and fruitier.`);
    kept("Worth buying: a Barolo from a good vintage like 2016, for example from Vajra.");
    kept("There is no Sassicaia in your cellar.");
    kept("You have no rosé, so open the Bollinger as an aperitif instead.");
    kept("Je hebt geen Barolo, maar de Langhe Nebbiolo komt dichtbij.");
    kept("A Côtes du Rhône or a Grenache would suit too, but your Musar is closer.");
  });

  it("does not read a question or a condition as a claim", () => {
    kept("Is there a Sassicaia in your cellar?");
    kept("Do you have a Sassicaia?");
    kept("If you have a Sassicaia, open it.");
    kept("Heb je een Sassicaia? Dan is dat ideaal.");
    kept("Als je Krug hebt, open die.");
  });

  it("keeps the person's wines named by producer, name, region, appellation or type", () => {
    kept("Your Bollinger is ready to open.");
    kept("Your Barolo is a great match.");
    kept("Jouw Barolo past perfect.");
    kept("Your Langhe is fresh.");
    kept("Your sparkling is perfect.");
    kept("Champagne loves salty food, and your Bollinger is a classic example.");
    kept("If you want a white, your Cuvée 1522 is the only one in your cellar.");
    kept(
      "Margaux is a commune in Bordeaux; your Pavillon Rouge comes from Château Margaux itself.",
    );
  });

  it("does not read food, days or the person's taste after 'your' as a wine", () => {
    kept(`With your Beef Wellington, open ${ref(pavillon)}.`);
    kept(`Your Sunday roast loves ${ref(pavillon)}.`);
    kept(`Pair your Coq au Vin with ${ref(pavillon)}.`);
    kept("Pair it with your Thai curry.");
    kept(`Based on your taste for Rioja, you might enjoy ${ref(musar18)}.`);
    kept(`Op basis van je smaak voor Rioja kan ${ref(musar18)} je bevallen.`);
    kept("Your red meat dish needs a firm red.");
  });
});

describe("price", () => {
  it("removes a sentence with an amount of money (EN and NL)", () => {
    for (const money of [
      "It costs about €30.",
      "Expect to pay 25 dollars.",
      "Around 20 euros a bottle.",
      "Approx. £18.",
      "Prijs: 19,95 euro.",
      "Een fles kost zo'n 12,-.",
      "Dit kost ongeveer 20 euro.",
      "It retails for 45 at most.",
      "Only 99 cents more.",
    ]) {
      const r = check(`${money} ${ref(albe)} is great.`);
      expect({ money, codes: r.check.codes, text: r.check.text }).toEqual({
        money,
        codes: ["price"],
        text: "trimmed",
      });
      expect(r.text).toBe("G.D. Vajra Barolo Albe 2016 is great.");
    }
  });

  it("replaces the text when the price was all it said", () => {
    expect(check("A Chianti around €25 suits.").check).toEqual({
      v: 1,
      text: "replaced",
      codes: ["price"],
    });
  });

  it("allows the person's own budget band, said back with its own numbers", () => {
    const say = (text: string, budget: "value" | "mid" | "premium" | "splurge") =>
      check(text, { budget }).check.codes;
    expect(say("Within your budget of €15–30, a Chianti Classico suits.", "mid")).toEqual([]);
    expect(say("Binnen je budget van €15 tot €30 past een Chianti.", "mid")).toEqual([]);
    expect(say("Up to €15, a Côtes du Rhône is the safe choice.", "value")).toEqual([]);
    expect(say("From €60 or more, look at a Barolo.", "splurge")).toEqual([]);
    // Any other amount, half the band, or no band at all is a price.
    expect(say("A bottle around €25 fits your €15–30 budget.", "mid")).toEqual(["price"]);
    expect(say("Reken op zo'n €15 per fles.", "mid")).toEqual(["price"]);
    expect(say("Within your budget of €30–60, a Barolo suits.", "mid")).toEqual(["price"]);
    expect(check("Within your budget of €15–30, a Chianti suits.").check.codes).toEqual(["price"]);
  });

  it("does not read words that only sound like money", () => {
    kept("Beaune Les Cents Vignes would be lovely, but your Pavillon Rouge suits too.");
    kept("A pricier bottle is not needed: your Musar is great value.");
    kept("It is cheaper to open the Langhe Nebbiolo tonight.");
  });
});

describe("availability", () => {
  it("removes a shop, stock or availability claim (EN and NL)", () => {
    for (const claim of [
      "In stock at Gall & Gall.",
      "It is widely available.",
      "You can find it at most supermarkets.",
      "Available at your local wine shop.",
      "Easy to find online.",
      "Op voorraad bij de slijter.",
      "Verkrijgbaar bij Albert Heijn.",
      "Overal verkrijgbaar.",
      "Ask for it at the wine merchant.",
    ]) {
      const r = check(`${claim} ${ref(albe)} is great.`);
      expect({ claim, codes: r.check.codes, text: r.check.text }).toEqual({
        claim,
        codes: ["availability"],
        text: "trimmed",
      });
    }
  });

  it("keeps words that are not about shops", () => {
    kept("A jumbo prawn loves a crisp white like your Cuvée 1522.");
    kept("Is a Barolo available to you? If not, the Langhe Nebbiolo is close.");
    kept(`${ref(albe)} is ready; its fruit is still in full supply.`);
  });
});

describe("action", () => {
  it("removes a claim to have done or to be going to do something (EN and NL)", () => {
    for (const claim of [
      "I have reserved it for you.",
      "I've moved it to the fridge.",
      "I've added it to your wishlist.",
      "I have ordered a case for you.",
      "I'll reserve the Musar for Saturday.",
      "Let me move it to the rack.",
      "Ik heb de Musar voor je gereserveerd.",
      "Ik heb hem in de koelkast koud gezet.",
      "Ik ga de Musar voor je reserveren.",
      "Ik bestel er nog twee.",
    ]) {
      const r = check(`${claim} ${ref(albe)} is great.`);
      expect({ claim, codes: r.check.codes, text: r.check.text }).toEqual({
        claim,
        codes: ["action"],
        text: "trimmed",
      });
    }
  });

  it("keeps advice and the sommelier's own reasoning", () => {
    kept(`I would open ${ref(musar18)}.`);
    kept(`Ik zou ${ref(musar18)} openen.`);
    kept(`Let me add that ${ref(musar18)} needs air.`);
    kept(`I have picked ${ref(musar18)} because it suits the lamb.`);
    kept("Ik ga ervan uit dat je de Musar wilt openen.");
    kept(`${ref(musar18)} is reserved for the Anniversary, so open ${ref(musar15)} instead.`);
  });
});

describe("the outcome", () => {
  it("a cellar-fact failure anywhere replaces everything, and every finding is reported once, in order", () => {
    const r = check(
      `It costs €30. Your Krug 1996 is ready. I have reserved ${ref(albe)}. It costs €20.`,
    );
    expect(r).toEqual({
      text: null,
      buy: [],
      check: { v: 1, text: "replaced", codes: ["not-in-cellar", "price", "action"] },
    });
  });

  it("trimming keeps the other sentences and paragraphs as written", () => {
    const r = check(
      `${ref(musar18)} suits the lamb. It costs about €30.\n\nIf you want something fresher, ${ref(langhe)} works too.`,
    );
    expect(r.text).toBe(
      "Château Musar Rouge 2018 suits the lamb.\n\nIf you want something fresher, G.D. Vajra Langhe Nebbiolo 2021 works too.",
    );
    expect(r.check).toEqual({ v: 1, text: "trimmed", codes: ["price"] });
  });

  it("an empty text is replaced", () => {
    expect(check("").check).toEqual({ v: 1, text: "replaced", codes: [] });
  });
});

describe("buying", () => {
  it("drops the model's price and shows the person's budget band, or none", () => {
    const buy = [
      { wine: "Barolo, e.g. Bartolo Mascarello", why: "Firm and fragrant.", price: "about €40" },
    ];
    expect(check("Nothing fits.", { buy, budget: "premium" }).buy).toEqual([
      {
        wine: "Barolo, e.g. Bartolo Mascarello",
        why: "Firm and fragrant.",
        price: "",
        priceBand: [30, 60],
      },
    ]);
    expect(check("Nothing fits.", { buy }).buy[0]?.priceBand).toBeNull();
    expect(check("Nothing fits.", { buy }).check.codes).toEqual(["price"]);
    expect(check("Nothing fits.", { buy: [{ ...buy[0]!, price: "" }] }).check.codes).toEqual([]);
  });

  it("removes money and shop clauses from the words, and an entry with nothing left", () => {
    const r = check("Nothing fits.", {
      buy: [
        {
          wine: "Chablis, e.g. William Fèvre (about €25)",
          why: "Crisp and saline, it loves oysters; about €20 at Gall & Gall.",
          price: "",
        },
        { wine: "€15", why: "Cheap.", price: "" },
        { wine: "Muscadet", why: "Op voorraad bij de slijter.", price: "" },
      ],
    });
    expect(r.buy).toEqual([
      {
        wine: "Chablis, e.g. William Fèvre",
        why: "Crisp and saline, it loves oysters.",
        price: "",
        priceBand: null,
      },
      { wine: "Muscadet", why: "", price: "", priceBand: null },
    ]);
    expect(r.check.codes).toEqual(["price", "availability"]);
  });

  it("drops a wine to buy that is already in the cellar, and keeps styles and other vintages", () => {
    const r = check("Nothing fits.", {
      buy: [
        { wine: "Barolo, e.g. G.D. Vajra Albe", why: "Classic.", price: "" },
        { wine: "Château Musar Rouge", why: "Spicy.", price: "" },
        { wine: ref(langhe), why: "Fresh.", price: "" },
        { wine: "Barolo, e.g. G.D. Vajra", why: "A style you like.", price: "" },
        { wine: "Château Musar Rouge 2008", why: "An older vintage.", price: "" },
      ],
    });
    expect(r.buy.map((b) => b.wine)).toEqual([
      "Barolo, e.g. G.D. Vajra",
      "Château Musar Rouge 2008",
    ]);
    expect(r.check.codes).toEqual(["owned-buy"]);
  });
});

describe("schemas for kept answers", () => {
  it("reads a check and refuses what is not one", () => {
    expect(AnswerCheckSchema.safeParse({ v: 1, text: "trimmed", codes: ["price"] }).success).toBe(
      true,
    );
    expect(AnswerCheckSchema.safeParse({ v: 1, text: "kept", codes: [] }).success).toBe(true);
    for (const bad of [
      { v: 2, text: "kept", codes: [] },
      { v: 1, text: "maybe", codes: [] },
      { v: 1, text: "kept", codes: ["price", "price"] },
      { v: 1, text: "kept", codes: ["invented"] },
      { v: 1, text: "kept", codes: [...CHECK_CODES, "price"] },
      { v: 1, text: "kept" },
      "kept",
    ])
      expect(AnswerCheckSchema.safeParse(bad).success).toBe(false);
  });

  it("reads a checked buy entry and its band", () => {
    expect(
      CheckedBuySchema.safeParse({ wine: "Barolo", why: "", price: "", priceBand: [15, 30] })
        .success,
    ).toBe(true);
    expect(
      CheckedBuySchema.safeParse({ wine: "Barolo", why: "", price: "", priceBand: null }).success,
    ).toBe(true);
    expect(
      CheckedBuySchema.safeParse({ wine: "Barolo", why: "", price: "€20", priceBand: null })
        .success,
    ).toBe(false);
    expect(PriceBandSchema.safeParse([60, null]).success).toBe(true);
    expect(PriceBandSchema.safeParse([-1, 5]).success).toBe(false);
    expect(PriceBandSchema.safeParse([1, 2, 3]).success).toBe(false);
  });
});

describe("a cellar wine the model was not shown is still real", () => {
  it("names and vintages are checked against the whole cellar, not only the digest", () => {
    const digest = { text: "", refs: new Map([[ref(albe).slice(2, -2), albe]]), total: 9 };
    expect(check("Your Château Margaux 2010 is the star.", { digest }).check.codes).toEqual([]);
    expect(check("Your Château Margaux 2005 is the star.", { digest }).check.codes).toEqual([
      "wrong-vintage",
    ]);
    expect(check(`Open ${ref(cuvee1522)}.`, { digest }).check.codes).toEqual(["unknown-ref"]);
  });
});
