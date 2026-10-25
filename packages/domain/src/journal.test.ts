import { describe, expect, it } from "vitest";
import {
  filterJournal,
  journalEditHref,
  journalTypes,
  summarizeJournal,
  topRated,
  type JournalEntry,
} from "./journal";

let n = 0;
const entry = (over: Partial<JournalEntry> = {}): JournalEntry => {
  n += 1;
  return {
    tastingId: `t${n}`,
    vintageId: `v${n}`,
    wineId: `w${n}`,
    bottleId: `b${n}`,
    producer: `Producer ${n}`,
    wineName: `Wine ${n}`,
    year: 2015,
    type: "red",
    image: null,
    score: null,
    descriptors: [],
    note: null,
    tastedAt: `2026-0${Math.min(n, 9)}-01T12:00:00Z`,
    ...over,
  };
};

const musar = entry({
  producer: "Château Musar",
  wineName: "Rouge",
  score: 9,
  tastedAt: "2026-05-01T00:00:00Z",
});
const musarAgain = entry({
  ...musar,
  tastingId: "t-again",
  bottleId: "b-again",
  score: 7,
  tastedAt: "2026-06-01T00:00:00Z",
});
const blanc = entry({
  producer: "Carbonnieux",
  wineName: "Blanc",
  type: "white",
  score: 6,
  tastedAt: "2026-04-01T00:00:00Z",
});
const words = entry({
  producer: "Rioja Alta",
  wineName: "Ardanza",
  note: "Lovely with lamb.",
  tastedAt: "2026-07-01T00:00:00Z",
});
const all = [musar, musarAgain, blanc, words];

describe("the summary", () => {
  it("counts entries, scored entries and different wines apart; averages stars only", () => {
    const s = summarizeJournal(all);
    expect(s).toMatchObject({ entries: 4, scored: 3, wines: 3 });
    // (9 + 7 + 6) / 3 = 7.33 → 3.7 stars
    expect(s.average).toBe(3.7);
    expect(s.distribution).toEqual([0, 0, 0, 0, 0, 1, 1, 0, 1, 0]);
  });
  it("no stars yet: no average, an empty distribution; nothing at all is zero entries", () => {
    expect(summarizeJournal([words])).toMatchObject({ entries: 1, scored: 0, average: null });
    expect(summarizeJournal([])).toMatchObject({ entries: 0, wines: 0, average: null });
  });
});

describe("the best-rated wines", () => {
  it("one per wine and vintage, at its best score; unrated entries never appear", () => {
    expect(topRated(all).map((e) => [e.vintageId, e.score])).toEqual([
      [musar.vintageId, 9],
      [blanc.vintageId, 6],
    ]);
    expect(topRated([words])).toEqual([]);
  });
});

describe("search, filter and order", () => {
  it("newest first by default; unrated notes stay in", () => {
    expect(filterJournal(all, {}).map((e) => e.tastingId)).toEqual([
      words.tastingId,
      "t-again",
      musar.tastingId,
      blanc.tastingId,
    ]);
  });
  it("highest and lowest rating; unrated entries last either way", () => {
    expect(filterJournal(all, { sort: "best" }).map((e) => e.score)).toEqual([9, 7, 6, null]);
    expect(filterJournal(all, { sort: "worst" }).map((e) => e.score)).toEqual([6, 7, 9, null]);
  });
  it("searches producer and wine name, ignoring accents and case", () => {
    expect(filterJournal(all, { query: "chateau musar" })).toHaveLength(2);
    expect(filterJournal(all, { query: "ARDANZA" })).toEqual([words]);
    expect(filterJournal(all, { query: "lamb" })).toEqual([]); // the note is not searched
  });
  it("filters by kind of wine, and only offers kinds that are there", () => {
    expect(filterJournal(all, { type: "white" })).toEqual([blanc]);
    expect(journalTypes(all).sort()).toEqual(["red", "white"]);
  });
});

describe("editing an entry", () => {
  it("opens the existing rating sheet for that wine and bottle", () => {
    expect(journalEditHref({ vintageId: "v1", bottleId: "b1" })).toBe("/cellar/v1?rate=b1");
  });
  it("an entry whose bottle is gone opens the wine's page", () => {
    expect(journalEditHref({ vintageId: "v1", bottleId: null })).toBe("/cellar/v1");
  });
});
