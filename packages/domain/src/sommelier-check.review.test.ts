import { describe, expect, it } from "vitest";
import { cellarDigest } from "./sommelier";
import { checkAnswerClaims, prepareAnswerCheck, wineLabel as fromCheck } from "./sommelier-check";
import { wineLabel } from "./wine-label";
import {
  CELLAR,
  DIGEST,
  NOW,
  albe,
  cellarItem,
  check,
  musar18,
  pavillon,
  ref,
} from "./sommelier-check.fixtures";

// Regressions from the end review of the check (round 2): each fix flagged AND its must-survive twin, EN and NL.
const codes = (text: string) => check(text).check.codes;
const M = ref(musar18);
const A = ref(albe);

describe("a name alone that the cellar lacks loses its sentence, not the answer", () => {
  it("trims the sentence and keeps the rest (EN and NL)", () => {
    const en = check(`${M} suits the lamb. Or pour your Pétrus instead. Decant it first.`);
    expect(en.check).toEqual({ v: 1, text: "trimmed", codes: ["not-in-cellar"] });
    expect(en.text).toBe("Château Musar Rouge 2018 suits the lamb. Decant it first.");
    const nl = check(`${M} past bij het lam. Of schenk je Pétrus. Decanteer hem eerst.`);
    expect(nl.check).toEqual({ v: 1, text: "trimmed", codes: ["not-in-cellar"] });
    expect(nl.text).toBe("Château Musar Rouge 2018 past bij het lam. Decanteer hem eerst.");
  });

  it("with a vintage or a count it is an invented cellar fact: the whole text goes", () => {
    expect(check(`${M} suits the lamb. Your Pétrus 1990 is grander.`).check.text).toBe("replaced");
    expect(check(`${M} past bij het lam. Je Pétrus uit 1990 is mooier.`).check.text).toBe(
      "replaced",
    );
    expect(
      check(`${M} suits the lamb. You have 3 bottles of Pétrus in your cellar.`).check.text,
    ).toBe("replaced");
  });

  it("replaces when that sentence was all there was", () => {
    expect(check("Your Pétrus is ready to drink.").check).toEqual({
      v: 1,
      text: "replaced",
      codes: ["not-in-cellar"],
    });
  });
});

describe("equipment, dishes and places after 'your' are not wines", () => {
  it("a capitalised word before a noun that is not a wine word describes the noun", () => {
    for (const text of [
      `Pour ${M} into your Riedel Burgundy glasses.`,
      "Your Tuscany trip will come back to you.",
      "Your Indonesian rijsttafel calls for a white.",
      "Je Surinaamse roti past bij een frisse wijn.",
      "Your Weber is perfect for the steak.",
    ])
      expect({ text, codes: codes(text) }).toEqual({ text, codes: [] });
  });

  it("the same words before a wine word, a vintage or a drinking verb are a wine", () => {
    expect(codes("Your Tignanello wine is lovely.")).toEqual(["not-in-cellar"]);
    expect(codes("Je Tignanello fles is open.")).toEqual(["not-in-cellar"]);
    expect(codes("Your Tignanello 2019 is lovely.")).toEqual(["not-in-cellar"]);
    expect(codes("Your Tignanello is drinking well.")).toEqual(["not-in-cellar"]);
    expect(codes("Jouw Tignanello is nu op dronk.")).toEqual(["not-in-cellar"]);
  });
});

describe("instructions that presume the bottle is there", () => {
  it("pour, serve, grab, take, try, go for, pick, choose, schenk, neem, pak, kies, probeer", () => {
    for (const text of [
      "Pour the Tignanello with the steak.",
      "Serve the Sassicaia 2015 with the lamb.",
      "Grab the Tignanello.",
      "Try the Tignanello tonight.",
      "Pick the Sassicaia for the steak.",
      "Choose the Tignanello.",
      "Go for the Tignanello tonight.",
      "Schenk de Tignanello bij het vlees.",
      "Neem de Sassicaia vanavond.",
      "Pak de Tignanello.",
      "Kies de Sassicaia.",
      "Probeer de Tignanello.",
      "Ontkurk de Sassicaia een uur van tevoren.",
    ])
      expect({ text, codes: codes(text) }).toEqual({ text, codes: ["not-in-cellar"] });
  });

  it("the same instructions about a wine the cellar has, or about food, survive", () => {
    for (const text of [
      "Pour the Musar with the steak.",
      "Grab the Pavillon Rouge.",
      "Go for the Albe tonight.",
      "Schenk de Langhe Nebbiolo bij het vlees.",
      "Neem de Bollinger vanavond.",
      "Serve the Osso Buco with the Albe.",
      "Take the Beef Wellington out of the oven, then pour the Musar.",
      "Serve the Coq au Vin with the Pavillon Rouge.",
    ])
      expect({ text, codes: codes(text) }).toEqual({ text, codes: [] });
  });

  it("'from the rack', 'uit je rek', 'from your cellar' say where a bottle lies", () => {
    expect(codes("Grab the Sassicaia from the rack.")).toEqual(["not-in-cellar"]);
    expect(codes("Neem de Sassicaia uit je rek.")).toEqual(["not-in-cellar"]);
    expect(codes("Take the Tignanello from your cellar.")).toEqual(["not-in-cellar"]);
    expect(codes("Take the Musar from the rack.")).toEqual([]);
    expect(codes("Pak de Albe uit de Wine fridge.")).toEqual([]);
    expect(codes("A Chablis in the fridge for an hour would be perfect.")).toEqual([]);
  });
});

describe("actions with words between the verb and its particle", () => {
  it("are caught (EN and NL)", () => {
    for (const text of [
      "I've set the Barolo aside for Saturday.",
      "I put the Musar aside for you.",
      "I will put the Musar in the fridge tonight.",
      "Let me put the Albe in the fridge.",
      "Done: the Musar is now reserved for Saturday.",
      "The Musar is now reserved for you.",
      "Ik zet de Musar voor zaterdag apart.",
      "Ik heb de Musar in de koelkast gelegd.",
      "Klaar, de Musar staat nu gereserveerd.",
    ])
      expect({ text, codes: codes(text) }).toEqual({ text, codes: ["action"] });
  });

  it("advice to do it yourself, and what the digest says, survive", () => {
    for (const text of [
      "Set the Musar aside for Saturday.",
      "I would set the Musar aside for a special occasion.",
      "Put the Albe in the fridge for twenty minutes.",
      "Zet de Musar apart voor zaterdag.",
      "Leg de Albe een half uur in de koelkast.",
      `${M} is reserved for the Anniversary.`,
      `${M} is gereserveerd voor Anniversary.`,
      "It is now ready to drink.",
    ])
      expect({ text, codes: codes(text) }).toEqual({ text, codes: [] });
  });
});

describe("grapes count as owned only where a cellar wine says them", () => {
  it("not because the cellar has a wine of that colour", () => {
    expect(codes("Your Pinot Noir is lovely.")).toEqual(["not-in-cellar"]);
    expect(codes("Your Nebbiolo is lovely.")).toEqual([]);
    expect(codes("Jouw Riesling is heerlijk.")).toEqual(["not-in-cellar"]);
    const riesling = cellarItem({
      producer: "Weingut Kühn",
      wineName: "Riesling Trocken",
      type: "white",
    });
    expect(
      check("Jouw Riesling is heerlijk.", { items: [...CELLAR, riesling] }).check.codes,
    ).toEqual([]);
  });
});

describe("Dutch word order: a verb before 'je' and a number is advice", () => {
  it("survives with any number up to what the cellar holds, and is caught beyond it", () => {
    expect(codes(`Voor zes personen open je twee flessen ${A}.`)).toEqual([]);
    expect(codes(`Schenk je drie glazen van ${A} in.`)).toEqual([]);
    expect(codes(`Voor twintig personen open je tien flessen ${A}.`)).toEqual(["wrong-count"]);
    expect(codes(`Je hebt twee flessen ${A}.`)).toEqual(["wrong-count"]);
  });
});

describe("more ways of writing a vintage", () => {
  it("an aside, 'from the … vintage', dashes, markdown", () => {
    for (const text of [
      "Your Musar, the 2008, is lovely.",
      "Your Musar from the 2008 vintage is lovely.",
      "Open the Musar – 2008 – tonight.",
      `Open ${M}, a 2008, tonight.`,
      "Your **Musar** (**2008**) is lovely.",
      "Je Musar, de 2008, is heerlijk.",
    ])
      expect({ text, codes: codes(text) }).toEqual({ text, codes: ["wrong-vintage"] });
  });

  it("the right vintage in the same shapes survives, and markdown is not shown", () => {
    for (const text of [
      "Your Musar, the 2018, is lovely.",
      "Your Musar from the 2015 vintage is lovely.",
      `Open ${M}, a 2018, tonight.`,
      `${M}, 2015 was a hard year in Lebanon.`,
      "Je Musar, de 2015, is heerlijk.",
    ])
      expect({ text, codes: codes(text) }).toEqual({ text, codes: [] });
    expect(check("Your **Musar** (**2018**) is _lovely_.").text).toBe(
      "Your Musar (2018) is lovely.",
    );
  });
});

describe("more ways of writing a count", () => {
  it("inventory notation and 'remain' (the ref holds 6)", () => {
    for (const text of [
      `${A} (×9) is ready.`,
      `${A} x9 is ready.`,
      `9x ${A} in the rack.`,
      `9 × ${A} in the rack.`,
      `With 9 ${A} in the cellar you are fine.`,
      `There are still 9 of ${A}.`,
      `9 bottles of ${A} remain.`,
      `Er liggen nog 9 van ${A} in je kelder.`,
    ])
      expect({ text, codes: codes(text) }).toEqual({ text, codes: ["wrong-count"] });
  });

  it("the right count in the same shapes survives", () => {
    for (const text of [
      `${A} (×6) is ready.`,
      `6x ${A} in the rack.`,
      `With 6 ${A} in the cellar you are fine.`,
      `There are still 6 of ${A}.`,
      `6 bottles of ${A} remain.`,
      `Er liggen nog 6 van ${A} in je kelder.`,
      `${A} (2016) is ready.`,
    ])
      expect({ text, codes: codes(text) }).toEqual({ text, codes: [] });
  });
});

describe("prices without a currency sign, and more shops", () => {
  it("are caught", () => {
    for (const [text, code] of [
      ["A Chianti is around 25-30 per bottle.", "price"],
      ["Reken op zo'n 25 tot 30 per fles.", "price"],
      ["It is usually 25 a bottle.", "price"],
      ["Een goede kost 20 de fles.", "price"],
      ["It is CHF 30 in Zurich.", "price"],
      ["It is 200 kr in Sweden.", "price"],
      ["Get it at Sligro.", "availability"],
      ["Haal hem bij de ah.", "availability"],
      ["Vinatis has it.", "availability"],
      ["Hanos verkoopt hem.", "availability"],
      ["Bestel hem bij Henri Bloem.", "availability"],
      ["Look for it at Wijnhuis Peeters.", "availability"],
    ] as const)
      expect({ text, codes: codes(text) }).toEqual({ text, codes: [code] });
  });

  it("numbers per bottle that are not money, and 'at' a day, survive", () => {
    for (const text of [
      "A bottle gives about 6 glasses, so plan 1 per two people.",
      "Pour 6 glasses per bottle.",
      "Look for a Barolo at Christmas.",
      "Buy a Barolo from Vajra if you see one.",
      "It costs a little more than the Langhe.",
      "Zoek een Barolo bij Kerst.",
    ])
      expect({ text, codes: codes(text) }).toEqual({ text, codes: [] });
  });

  it("in a buy entry, 'at' a capitalised name is a shop", () => {
    const r = check("Nothing fits.", {
      buy: [{ wine: "Tignanello 2019 — at Sligro", why: "Bold, at its best now.", price: "" }],
    });
    expect(r.buy.map((b) => [b.wine, b.why])).toEqual([
      ["Tignanello 2019", "Bold, at its best now."],
    ]);
    expect(r.check.codes).toEqual(["availability"]);
  });
});

describe("refs with extra brackets, and a ref cut off at the end", () => {
  it("extra brackets are noise", () => {
    expect(check(`Open [[[[${A.slice(2, -2)}]]]] now.`)).toMatchObject({
      text: "Open G.D. Vajra Barolo Albe 2016 now.",
      check: { text: "kept", codes: [] },
    });
    expect(check(`Open [[[${A.slice(2, -2)}]]] now.`).text).toBe(
      "Open G.D. Vajra Barolo Albe 2016 now.",
    );
  });

  it("a fragment cut off by the length cap is dropped with its unfinished sentence", () => {
    const r = check(`Open ${A} now. And with the cheese, try [[c0000`);
    expect(r).toMatchObject({
      text: "Open G.D. Vajra Barolo Albe 2016 now.",
      check: { text: "trimmed", codes: [] },
    });
    expect(check(`Open ${A} now.\nAnd [abc0`).text).toBe("Open G.D. Vajra Barolo Albe 2016 now.");
    expect(check("Only [[c0000").check).toEqual({ v: 1, text: "replaced", codes: [] });
  });
});

describe("prepareAnswerCheck", () => {
  const run = prepareAnswerCheck({ digest: DIGEST, items: CELLAR, budget: "mid", now: NOW });
  it("gives the same answer as checkAnswerClaims", () => {
    const text = `${M} suits the lamb. It costs about €30. Your Krug 1996 is grander.`;
    expect(run({ text, bottles: [], buy: [] })).toEqual(
      checkAnswerClaims({
        text,
        bottles: [],
        buy: [],
        digest: DIGEST,
        items: CELLAR,
        budget: "mid",
        now: NOW,
      }),
    );
  });

  it("binds 'of it' to the wine a short text is about (a menu course)", () => {
    expect(
      run({ text: "You have 12 bottles of it.", bottles: [], buy: [], previous: albe }).check.codes,
    ).toEqual(["wrong-count"]);
    expect(
      run({ text: "You have 6 bottles of it.", bottles: [], buy: [], previous: albe }).check.codes,
    ).toEqual([]);
    expect(
      run({ text: "Je hebt er 12 van.", bottles: [], buy: [], previous: albe }).check.codes,
    ).toEqual(["wrong-count"]);
    expect(
      run({ text: "Je hebt er 6 van.", bottles: [], buy: [], previous: albe }).check.codes,
    ).toEqual([]);
    // Without it, a count of nothing named is not checked.
    expect(run({ text: "You have 12 bottles of it.", bottles: [], buy: [] }).check.codes).toEqual(
      [],
    );
    // The text's own wine wins over the course's.
    expect(
      run({ text: `You have 2 bottles of ${ref(pavillon)}.`, bottles: [], buy: [], previous: albe })
        .check.codes,
    ).toEqual([]);
  });

  it("indexes a large cellar once, in time that grows with its size, and checks each text quickly", () => {
    const regions = [
      "Bordeaux",
      "Piedmont",
      "Rioja",
      "Mosel",
      "Champagne",
      "Tuscany",
      "Loire",
      "Rhône",
    ];
    const cellar = (size: number, salt: string) => [
      ...CELLAR,
      ...Array.from({ length: size }, (_, i) =>
        cellarItem({
          producer: `Domaine ${["Alpha", "Beta", "Gamma", "Delta"][i % 4]} ${salt}${i % 700}`,
          wineName: `Cuvée ${["Rouge", "Blanc", "Vieilles Vignes", "Les Clos"][i % 4]} ${salt}${i}`,
          region: regions[i % 8]!,
          year: 1990 + (i % 34),
          places: [`Rack ${i % 5}`],
        }),
      ),
    ];
    /**
     * What one index build of a cellar of this size costs, from `times` builds timed together, each on a cellar
     * not seen before (no cached words).
     */
    const indexTime = (size: number, salt: string, times = 1) => {
      const cellars = Array.from({ length: times }, (_, n) => {
        const items = cellar(size, `${size}${salt}${n}`);
        return { items, digest: cellarDigest(items, "lamb") };
      });
      const started = performance.now();
      for (const { items, digest } of cellars)
        prepareAnswerCheck({ digest, items, budget: null, now: NOW });
      return (performance.now() - started) / times;
    };
    indexTime(300, "w", 3); // warm up the code itself
    // The small cellar is timed as ten builds in one go, so both measurements last about as long: on a busy
    // machine a single short build could slip in between two interruptions where the long one cannot, and the
    // ratio would measure the machine. The fastest of three of each, small and large in turns.
    let small = Infinity;
    let large = Infinity;
    for (const salt of ["a", "b", "c"]) {
      small = Math.min(small, indexTime(300, salt, 10));
      large = Math.min(large, indexTime(3000, salt));
    }
    // Ten times the wines may take about ten times as long, never a hundred (the old index grew with groups ×
    // groups: about 280 ms at 3,000 wines here). Measured on the development machine (4 shared cores): about 25–55
    // ms at 3,000 wines, and the ratio about 8–12. The absolute bound only catches the gross case on a busy machine.
    expect(large / Math.max(small, 0.5)).toBeLessThan(40);
    expect(large).toBeLessThan(1500);

    const items = cellar(3000, "q");
    const big = prepareAnswerCheck({
      digest: cellarDigest(items, "lamb"),
      items,
      budget: null,
      now: NOW,
    });
    big({ text: "Lovely with lamb.", bottles: [], buy: [] });
    const t = performance.now();
    for (let k = 0; k < 20; k += 1) big({ text: "Lovely with lamb.", bottles: [], buy: [] });
    expect((performance.now() - t) / 20).toBeLessThan(5);
    expect(
      big({ text: "You have 5 bottles of the Albe.", bottles: [], buy: [] }).check.codes,
    ).toEqual(["wrong-count"]);
  });
});

describe("wineLabel lives in its own small module", () => {
  it("is the same function from both places", () => {
    expect(fromCheck).toBe(wineLabel);
    expect(wineLabel(musar18)).toBe("Château Musar Rouge 2018");
  });
});
