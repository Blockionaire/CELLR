import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  labelPhrases,
  normalizeExtraction,
  normalizeText,
  RawExtractionSchema,
  recognizeLabelText,
  resolveWine,
  scanOutcomeOf,
  type LabelTextCandidate,
  type WineSummary,
} from "@cellr/domain";

/**
 * The resolver's golden set (eval/scan/golden-resolver.json): hand-written readings and label texts against a small,
 * deliberately confusable catalogue, with the expected answer written by a person. SYNTHETIC: an automated technical
 * pass, not a measurement on real photographs (REAL_LABEL_VALIDATION_PENDING).
 *
 * The one number that must be zero: a wine asserted as "exactly this one" that is not the expected wine.
 */
interface Expect {
  status: "exact_candidate" | "ambiguous" | "not_found" | "not_exact" | "unread";
  wine?: string;
  year?: number | null;
  nonVintage?: boolean;
  never?: string[];
}
interface VisionCase {
  id: string;
  why: string;
  read: unknown;
  own: string[];
  expect: Expect;
}
interface TextCase {
  id: string;
  why: string;
  text: string;
  own: string[];
  expect: { kind: "match" | "none"; wine?: string; year?: number | null };
}
const golden = JSON.parse(
  readFileSync(new URL("../../eval/scan/golden-resolver.json", import.meta.url), "utf8"),
) as {
  now: string;
  catalogue: WineSummary[];
  own: WineSummary[];
  vision: VisionCase[];
  text: TextCase[];
};
const now = new Date(`${golden.now}T12:00:00Z`);
const winesFor = (own: string[]) => [
  ...golden.catalogue,
  ...golden.own.filter((w) => own.includes(w.id)),
];

function resolve(c: VisionCase) {
  const facts = normalizeExtraction(RawExtractionSchema.parse(c.read), now);
  return facts ? resolveWine(facts, winesFor(c.own)) : null;
}

describe("the resolver's golden set: readings of a label", () => {
  it("is big enough to mean something", () => {
    expect(golden.vision.length).toBeGreaterThanOrEqual(35);
    expect(golden.text.length).toBeGreaterThanOrEqual(15);
  });

  for (const c of golden.vision)
    it(`${c.id}: ${c.why}`, () => {
      const out = resolve(c);
      if (c.expect.status === "unread") return expect(out).toBeNull();
      expect(out).not.toBeNull();
      const exact = out!.status === "exact_candidate" ? out!.candidates[0]!.wine.id : null;
      // never the wrong wine, whatever else
      for (const id of c.expect.never ?? []) expect(exact, `asserted ${id}`).not.toBe(id);
      if (c.expect.status === "not_exact") expect(out!.status).not.toBe("exact_candidate");
      else expect(out!.status).toBe(c.expect.status);
      if (c.expect.status === "exact_candidate") {
        expect(exact).toBe(c.expect.wine);
        expect(out!.candidates).toHaveLength(1);
        expect(out!.candidates[0]!.exact).toBe(true);
        // the year is the label's, exactly as read: never changed, never invented
        expect(out!.year).toBe(c.expect.year);
        expect(out!.nonVintage).toBe(c.expect.nonVintage);
      }
      if (c.expect.status === "ambiguous") {
        expect(out!.candidates.length).toBeGreaterThan(0);
        // every candidate that is offered says why
        for (const cand of out!.candidates) expect(cand.reasons.length).toBeGreaterThan(0);
      }
      if (c.expect.status === "not_found") expect(out!.candidates).toEqual([]);
    });

  it("ZERO wrong automatic identities, and the rates as measured on this set", () => {
    let exact = 0;
    let wrong = 0;
    let ambiguous = 0;
    let notFound = 0;
    let unread = 0;
    for (const c of golden.vision) {
      const out = resolve(c);
      if (!out) {
        unread++;
        continue;
      }
      if (out.status === "exact_candidate") {
        exact++;
        if (c.expect.status !== "exact_candidate" || out.candidates[0]!.wine.id !== c.expect.wine)
          wrong++;
      } else if (out.status === "ambiguous") ambiguous++;
      else notFound++;
    }
    const expectedExact = golden.vision.filter((c) => c.expect.status === "exact_candidate").length;
    expect(wrong).toBe(0);
    // every case a person labelled as exactly one wine is found as that wine (no precision bought with recall)
    expect(exact).toBe(expectedExact);
    expect({ cases: golden.vision.length, exact, ambiguous, notFound, unread, wrong }).toEqual({
      cases: 36,
      exact: 20,
      ambiguous: 13,
      notFound: 2,
      unread: 1,
      wrong: 0,
    });
  });

  it("the answer does not depend on the order or the padding of the candidates", () => {
    const padding: WineSummary[] = Array.from({ length: 200 }, (_, i) => ({
      id: `pad-${i}`,
      producer: `Bodega Relleno ${i}`,
      name: `Tinto ${i}`,
      type: "red",
      countryCode: "ES",
      region: null,
      catalog: true,
      aliases: [],
    }));
    for (const c of golden.vision) {
      const facts = normalizeExtraction(RawExtractionSchema.parse(c.read), now);
      if (!facts) continue;
      const base = resolveWine(facts, winesFor(c.own));
      const shuffled = resolveWine(facts, [
        ...padding,
        ...[...winesFor(c.own)].reverse(),
        ...winesFor(c.own),
      ]);
      expect(shuffled.status, c.id).toBe(base.status);
      if (base.status === "exact_candidate")
        expect(shuffled.candidates[0]!.wine.id, c.id).toBe(base.candidates[0]!.wine.id);
    }
  });

  it("the three statuses are the scan's three outcomes", () => {
    expect(scanOutcomeOf("exact_candidate")).toBe("found");
    expect(scanOutcomeOf("ambiguous")).toBe("choose");
    expect(scanOutcomeOf("not_found")).toBe("new");
  });

  it("how legible the label was never changes which wine matches", () => {
    const sure = golden.vision.find((c) => c.id === "V06")!;
    const unsure = golden.vision.find((c) => c.id === "V35")!;
    const a = resolve(sure)!;
    const b = resolve(unsure)!;
    expect(b.status).toBe(a.status);
    expect(b.candidates[0]!.wine.id).toBe(a.candidates[0]!.wine.id);
    expect(b.candidates[0]!.score).toBe(a.candidates[0]!.score);
  });
});

/**
 * What `find_wines_by_label_text` returns for a text, imitated: the wines whose producer is printed, and the
 * household's own wines whose name is printed (the SQL function itself is tested in supabase/tests).
 */
function textCandidates(text: string, own: string[]): LabelTextCandidate[] {
  const phrases = new Set(labelPhrases(text));
  return winesFor(own)
    .filter(
      (w) =>
        phrases.has(normalizeText(w.producer)) ||
        (!w.catalog && phrases.has(normalizeText(w.name))),
    )
    .map((wine) => ({ wine, linkedTo: null }));
}

describe("the resolver's golden set: printed text, without a model", () => {
  for (const c of golden.text)
    it(`${c.id}: ${c.why}`, () => {
      const found = recognizeLabelText(c.text, textCandidates(c.text, c.own), now);
      expect(found.kind).toBe(c.expect.kind);
      if (found.kind === "match") {
        expect(found.wine.id).toBe(c.expect.wine);
        expect(found.facts.year).toBe(c.expect.year);
        // no year read is "unknown", never "non-vintage"
        if (c.expect.year === null) expect(found.facts.nonVintage).toBe(false);
      }
    });

  it("how many of these labels needed no model at all (the saving, on this synthetic set only)", () => {
    const matched = golden.text.filter(
      (c) => recognizeLabelText(c.text, textCandidates(c.text, c.own), now).kind === "match",
    );
    const wrong = matched.filter((c) => c.expect.kind !== "match");
    expect(wrong.map((c) => c.id)).toEqual([]);
    expect({ texts: golden.text.length, withoutModel: matched.length }).toEqual({
      texts: 15,
      withoutModel: 7,
    });
  });
});
