import { normalizeText, type WineSummary, type WineType } from "./cellar";
import { ESTATE_WORDS, type LabelFacts } from "./scan";

/**
 * WHERE EACH FIELD OF A SCAN'S REVIEW COMES FROM (Sprint "Unified Scan", verified autofill).
 *
 * The review shows a wine's identity (producer, name, kind, country, region) and the bottles' vintage, filled in from
 * several places. Each field says, subtly, which one, in this order of trust:
 *
 * 1. `label`      — read off this label (the vision model or the phone's text reader), and it agrees with what is
 *                   shown;
 * 2. `catalog`    — CELLR's curated catalogue: the wine chosen is a verified canonical wine;
 * 3. `cellar`     — the household's own wine record (what they entered or confirmed before);
 * 4. `remembered` — this exact photo was confirmed before in this household (no label was read this time);
 * 5. `record`     — an external source's record the person chose to start from: a suggestion to check, never a fact;
 * 6. `typed`      — what the person typed or changed here;
 * 7. `unknown`    — nothing says it. It stays empty: nothing is guessed.
 *
 * Never: a database value shown as read off the label; a vintage taken from the vintages a wine has (a missing year
 * stays missing); a record's value shown as verified. A label reading that disagrees with the chosen wine's record is
 * shown as a `conflict` beside it (the record is not changed from a scan: the person chooses another wine instead).
 */
export const FIELD_SOURCES = [
  "label",
  "catalog",
  "cellar",
  "remembered",
  "record",
  "typed",
  "unknown",
] as const;
export type FieldSource = (typeof FIELD_SOURCES)[number];

export const WINE_FIELDS = ["producer", "name", "type", "countryCode", "region"] as const;
export type WineField = (typeof WINE_FIELDS)[number];

export interface FieldOrigin {
  source: FieldSource;
  /** What the label says instead, when it disagrees with the wine chosen (shown beside the field, never applied). */
  conflict?: string;
}

/** How the scan reached its answer: the same flags as `ScanResult`. */
export interface ScanPath {
  /** This exact photo was confirmed before: `facts` are that confirmation, not a reading of the label. */
  remembered?: boolean | undefined;
  /** The phone's text reader named the catalogue wine: the identity is the database's, the year the label's. */
  fromText?: boolean | undefined;
}

const tokens = (text: string) => normalizeText(text).split(" ").filter(Boolean);

/** Little words a label adds around a name ("Pavillon Rouge du Château Margaux"): they never make another wine. */
const LINK_WORDS: ReadonlySet<string> = new Set([
  "du",
  "de",
  "des",
  "la",
  "le",
  "les",
  "l",
  "d",
  "di",
  "del",
  "della",
  "the",
  "of",
  "von",
  "van",
  "und",
  "et",
  "and",
  "y",
  "e",
]);

/**
 * Two names that say the same: equal once accents, case and punctuation are folded, or one inside the other with
 * nothing but estate words, little words, or the producer's own name around it ("Pavillon Rouge" and "Pavillon Rouge
 * du Château Margaux"; "Margaux" and "Château Margaux"). Any other word decides: "Grand Vin" and "Grand Vin Blanc",
 * "Cuvée Alpha" and "Cuvée Alpha Réserve" are two wines.
 */
export function sameName(a: string, b: string, around: readonly string[] = []): boolean {
  const x = tokens(a);
  const y = tokens(b);
  if (x.length === 0 || y.length === 0) return false;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  const shortSet = new Set(short);
  if (!short.every((t) => long.includes(t))) return false;
  const allowed = new Set(around.flatMap(tokens));
  return long.every(
    (t) => shortSet.has(t) || ESTATE_WORDS.has(t) || LINK_WORDS.has(t) || allowed.has(t),
  );
}

/**
 * Where the identity of a wine that EXISTS (the household's or the catalogue's) comes from, as the review shows it:
 * its own record, confirmed by the label where the label read the same. Its values are the record's, always.
 */
export function existingWineOrigins(
  wine: WineSummary,
  facts: LabelFacts | null,
  path: ScanPath = {},
): Record<WineField, FieldOrigin> {
  const base: FieldSource = wine.catalog ? "catalog" : "cellar";
  // a remembered answer read nothing: its facts are the earlier confirmation, so nothing is "from the label"
  const read = facts && !path.remembered ? facts : null;
  const text = (field: "producer" | "name", value: string): FieldOrigin => {
    // a catalogue wine named on the label by its text: the label's printed text agreed with the record
    if (path.fromText && wine.catalog) return { source: "label" };
    const seen = read?.[field];
    if (!seen) return { source: base };
    const names = field === "name" ? [value, ...(wine.aliases ?? [])] : [value];
    // around a name, the producer's own name is no other wine; around a producer, nothing but estate words
    const around = field === "name" ? [wine.producer, read?.producer ?? ""] : [];
    return names.some((n) => sameName(seen, n, around))
      ? { source: "label" }
      : { source: base, conflict: seen };
  };
  const kind = (): FieldOrigin => {
    const seen = read?.type;
    if (!seen) return { source: base };
    return seen === wine.type ? { source: "label" } : { source: base, conflict: seen };
  };
  const country = (): FieldOrigin => {
    if (!wine.countryCode) return { source: "unknown" };
    const seen = read?.countryCode;
    if (!seen) return { source: base };
    return seen === wine.countryCode ? { source: "label" } : { source: base, conflict: seen };
  };
  const region = (): FieldOrigin => {
    if (!wine.region) return { source: "unknown" };
    // a region is said at many levels (Margaux is in Bordeaux): agreement is shown, a difference is not a conflict
    const seen = [read?.region, read?.appellation].filter((v): v is string => !!v);
    return seen.some((v) => sameName(v, wine.region!)) ? { source: "label" } : { source: base };
  };
  return {
    producer: text("producer", wine.producer),
    name: text("name", wine.name),
    type: kind(),
    countryCode: country(),
    region: region(),
  };
}

/** The new-wine fields as the review holds them. */
export interface DraftFields {
  producer: string;
  name: string;
  type: WineType | null;
  countryCode: string;
  region: string;
}

/**
 * Where each field of a NEW wine comes from: what it was started with (the label's reading, or a record the person
 * chose), unless the person changed it since. An empty field is unknown, whatever it was started from.
 */
export function draftOrigins(
  value: DraftFields,
  start: DraftFields,
  startedFrom: "label" | "record" | "none",
): Record<WineField, FieldOrigin> {
  const one = (field: WineField): FieldOrigin => {
    const now = value[field];
    if (now === null || String(now).trim() === "") return { source: "unknown" };
    if (startedFrom !== "none" && String(start[field] ?? "").trim() === String(now).trim())
      return { source: startedFrom };
    return { source: "typed" };
  };
  return {
    producer: one("producer"),
    name: one("name"),
    type: one("type"),
    countryCode: one("countryCode"),
    region: one("region"),
  };
}

/**
 * Where the vintage the review starts with comes from: the label (read now, by the model or the phone), an earlier
 * confirmation of this exact photo, or nowhere (empty: the person fills it in or chooses NV). Never the vintages the
 * wine has in the database. `check`: the label was hard to read there.
 */
export function vintageOrigin(
  facts: LabelFacts | null,
  path: ScanPath = {},
): { source: "label" | "remembered" | "unknown"; check: boolean } {
  if (!facts || (facts.year === null && !facts.nonVintage))
    return { source: "unknown", check: false };
  if (path.remembered) return { source: "remembered", check: false };
  return { source: "label", check: facts.confidence.year === "low" };
}
