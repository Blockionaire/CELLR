import { describe, expect, it } from "vitest";
import type { CellarItem, PlacedBottle, RackView, StorageUnitView } from "./cellar";
import { cellarFacts, cellarFactsText, isCellarQuestion, matchCellarItems } from "./cellar-facts";

let n = 0;
const item = (over: Partial<CellarItem> = {}): CellarItem => {
  n += 1;
  return {
    vintageId: `v${n}`,
    wineId: `w${n}`,
    producer: `Producer ${n}`,
    wineName: `Wine ${n}`,
    type: "red",
    year: 2015,
    region: null,
    countryCode: "FR",
    count: 1,
    places: [],
    unplaced: 0,
    image: null,
    favorite: false,
    rating: null,
    drink: {
      source: "estimate",
      reliable: false,
      uncertain: false,
      phase: "ready",
      from: 2014,
      until: 2030,
      urgency: 5,
      yearsUntilOpen: null,
      yearsLeft: 4,
      position: 0.5,
    },
    ...over,
  };
};
const unit = (label: string, capacity: number, used: number): StorageUnitView => ({
  id: label,
  label,
  kind: label.includes("fridge") ? "fridge" : "rack",
  rows: 1,
  cols: capacity,
  capacity,
  used,
  free: capacity - used,
});
const placed = (i: CellarItem, row: number | null, col: number | null): PlacedBottle => ({
  bottleId: `${i.vintageId}-${row}-${col}`,
  vintageId: i.vintageId,
  producer: i.producer,
  wineName: i.wineName,
  type: i.type,
  year: i.year,
  region: i.region,
  countryCode: i.countryCode,
  row,
  col,
  image: null,
});

// A small cellar: one Musar in two vintages (3 bottles of 2018 in two places, one without a place), a Rioja,
// a white Bordeaux and a red Bordeaux.
const musar18 = item({
  producer: "Château Musar",
  wineName: "Château Musar",
  year: 2018,
  region: "Bekaa Valley",
  count: 3,
});
const musar16 = item({ producer: "Château Musar", wineName: "Château Musar", year: 2016 });
const rioja = item({
  producer: "La Rioja Alta",
  wineName: "Viña Ardanza",
  region: "Rioja",
  count: 2,
});
const blanc = item({
  producer: "Château Carbonnieux",
  wineName: "Blanc",
  type: "white",
  region: "Bordeaux",
  year: 2019,
});
const rouge = item({
  producer: "Château Talbot",
  wineName: "Talbot",
  region: "Bordeaux",
  year: 2019,
});
const items = [musar18, musar16, rioja, blanc, rouge];
const storage = [unit("Wine fridge", 48, 6), unit("Wine rack", 12, 1)];
const racks: RackView = {
  units: [
    {
      ...storage[0]!,
      bottles: [
        placed(musar18, 2, 4),
        placed(musar18, 2, 3),
        placed(musar16, 1, 1),
        placed(rioja, 3, 1),
        placed(rioja, 3, 2),
        placed(blanc, 4, 1),
      ],
    },
    { ...storage[1]!, bottles: [placed(rouge, 1, 6)] },
  ],
  unplaced: [placed(musar18, null, null)],
};

describe("is it a question about the cellar?", () => {
  it.each([
    "Hoeveel flessen heb ik?",
    "Hoeveel verschillende wijnen heb ik?",
    "Waar ligt mijn Château Musar 2018?",
    "Op welke plekken liggen mijn 3 flessen Rioja?",
    "Hoeveel plekken heb ik nog vrij?",
    "Hoeveel ruimte heb ik in mijn wijnklimaatkast?",
    "Welke witte wijnen heb ik?",
    "Heb ik nog een Bordeaux uit 2019?",
    "How many bottles do I have?",
    "Where is my Musar?",
    "Do I still have a Rioja?",
  ])("%s → yes", (q) => expect(isCellarQuestion(q)).toBe(true));

  it.each([
    "Wat past bij biefstuk vanavond?",
    "What should I open tonight?",
    "Which wine goes with lamb?",
    "Is de Musar al op dronk?",
  ])("%s → no (wine advice stays as it was)", (q) => expect(isCellarQuestion(q)).toBe(false));
});

describe("which wines a question names", () => {
  it("producer and year narrow it to one vintage", () => {
    expect(matchCellarItems(items, "Waar ligt mijn Château Musar 2018?").matches).toEqual([
      musar18,
    ]);
  });

  it("the same wine in two vintages, without a year, is both: the question is ambiguous", () => {
    expect(matchCellarItems(items, "Waar ligt mijn Musar?").matches).toEqual([musar18, musar16]);
  });

  it("a word shared by several wines ('Château') names all of them, never one picked at random", () => {
    expect(matchCellarItems(items, "Waar ligt mijn Château?").matches).toHaveLength(4);
  });

  it("a region, a kind of wine and a year combine", () => {
    expect(
      matchCellarItems(items, "Op welke plekken liggen mijn 3 flessen Rioja?").matches,
    ).toEqual([rioja]);
    expect(matchCellarItems(items, "Welke witte wijnen heb ik?").matches).toEqual([blanc]);
    expect(matchCellarItems(items, "Heb ik nog een Bordeaux uit 2019?").matches).toEqual([
      blanc,
      rouge,
    ]);
    expect(matchCellarItems(items, "Heb ik nog een rode Bordeaux uit 2019?").matches).toEqual([
      rouge,
    ]);
  });

  it("a wine that is not there matches nothing; a question naming no wine asks about no wine", () => {
    expect(matchCellarItems(items, "Heb ik nog een Barolo uit 2010?")).toMatchObject({
      matches: [],
    });
    expect(matchCellarItems(items, "Hoeveel flessen heb ik?")).toEqual({
      asked: null,
      matches: [],
    });
  });
});

describe("unknown names are never dropped (regression)", () => {
  it("a wine that isn't there, with a year other wines share, matches nothing (not the other 2019s)", () => {
    const r = matchCellarItems(items, "Heb ik nog een Sassicaia uit 2019?");
    expect(r.matches).toEqual([]);
    expect(r.asked).toMatchObject({ words: [], unknown: ["sassicaia"], year: 2019 });
    const en = matchCellarItems(items, "Do I still have a Sassicaia from 2019?");
    expect(en.matches).toEqual([]);
  });

  it("a known word with an unknown one (a typo, another cuvée) is not found, never the known one alone", () => {
    const r = matchCellarItems(items, "Waar ligt mijn Château Musur 2018?");
    expect(r.matches).toEqual([]);
    expect(r.asked).toMatchObject({ words: ["chateau"], unknown: ["musur"] });
    expect(matchCellarItems(items, "Waar ligt mijn Musar Blanc?").matches).toEqual([]);
  });

  it("partial words still find the wine; producer, name, region, year and kind all still work", () => {
    expect(matchCellarItems(items, "Waar ligt mijn Mus 2018?").matches).toEqual([musar18]);
    expect(matchCellarItems(items, "Waar ligt de Viña Ardanza?").matches).toEqual([rioja]);
    expect(matchCellarItems(items, "Waar liggen mijn Talbot?").matches).toEqual([rouge]);
    // Only the 2018 has its region filled in.
    expect(matchCellarItems(items, "Welke Bekaa Valley wijnen heb ik?").matches).toEqual([musar18]);
    expect(matchCellarItems(items, "Welke wijnen uit 2016 heb ik?").matches).toEqual([musar16]);
    expect(matchCellarItems(items, "Which whites do I have?").matches).toEqual([blanc]);
  });

  it("several vintages of one wine are all returned for the caller to ask which; a year picks one", () => {
    expect(matchCellarItems(items, "Hoeveel flessen Musar heb ik?").matches).toEqual([
      musar18,
      musar16,
    ]);
    expect(matchCellarItems(items, "Hoeveel flessen Musar 2016 heb ik?").matches).toEqual([
      musar16,
    ]);
  });

  it("a place's own name is not taken for a wine", () => {
    const r = matchCellarItems(items, "Hoeveel ruimte heb ik in mijn Eurocave?", ["Eurocave"]);
    expect(r).toEqual({ asked: null, matches: [] });
  });
});

describe("the facts", () => {
  it("counts bottles, different wines and vintages from the items, not from anything said", () => {
    const f = cellarFacts(items, storage, racks, "Hoeveel flessen heb ik?");
    expect(f).toMatchObject({ bottles: 8, wines: 5, vintages: 5, unplaced: 1, asked: null });
    // Two vintages of one wine are one wine.
    const sameWine = cellarFacts(
      [musar18, { ...musar16, wineId: musar18.wineId }],
      storage,
      racks,
      "Hoeveel verschillende wijnen heb ik?",
    );
    expect(sameWine).toMatchObject({ bottles: 4, wines: 1, vintages: 2 });
  });

  it("capacity: free spots per place and in all", () => {
    const f = cellarFacts(items, storage, racks, "Hoeveel plekken heb ik nog vrij?");
    expect(f.places).toEqual([
      { label: "Wine fridge", kind: "fridge", capacity: 48, used: 6, free: 42 },
      { label: "Wine rack", kind: "rack", capacity: 12, used: 1, free: 11 },
    ]);
    expect(f.free).toBe(53);
  });

  it("every bottle's exact spot, in order, across places, with the unplaced one counted apart", () => {
    const f = cellarFacts(items, storage, racks, "Waar ligt mijn Château Musar 2018?");
    expect(f.matches).toEqual([
      {
        item: musar18,
        spots: [
          { place: "Wine fridge", row: 2, col: 3 },
          { place: "Wine fridge", row: 2, col: 4 },
        ],
        unplaced: 1,
      },
    ]);
    const text = cellarFactsText(f, (id) => (id === musar18.vintageId ? "ref18" : null));
    expect(text).toContain(
      "ref18 | Château Musar — Château Musar | 2018 | red | ×3 | Wine fridge shelf 2 position 3; Wine fridge shelf 2 position 4; 1 without a place",
    );
    expect(text).toContain("Free spots in all: 53");
  });

  it("only the wines asked about get their spots: no full inventory in the facts", () => {
    const text = cellarFactsText(
      cellarFacts(items, storage, racks, "Hoeveel flessen heb ik?"),
      () => "r",
    );
    expect(text).not.toMatch(/shelf/);
    expect(text).toContain("8 bottles of 5 different wines");
  });

  it("an empty cellar: zero bottles, the free room still counted", () => {
    const empty = cellarFacts([], storage, { units: [], unplaced: [] }, "Hoeveel flessen heb ik?");
    expect(empty).toMatchObject({ bottles: 0, wines: 0, vintages: 0, free: 53, matches: [] });
    const none = cellarFacts([], [], { units: [], unplaced: [] }, "Waar ligt mijn Musar?");
    // Asked about a wine in an empty cellar: honestly not found (the name is kept, not dropped).
    expect(none).toMatchObject({ bottles: 0, free: 0, asked: { unknown: ["musar"] }, matches: [] });
  });
});
