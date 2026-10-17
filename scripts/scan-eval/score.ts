import { normalizeText } from "@cellr/domain";

/**
 * Scoring for the scan eval. Pure functions only: no files, no network, no clock. The runner reads photos and
 * calls the model; everything that decides "was that right?" lives here so it can be tested.
 */

// ---- What you write down for each photo --------------------------------------------------------------

/** Every field is optional: only the fields you give are scored. `null` has a meaning, see each field. */
export interface Expected {
  /** The estate or house. `null` = nothing should be read. */
  producer?: string | null;
  /** The wine or cuvée name as printed. `null` = the label shows none, so none should be read. */
  wine?: string | null;
  /** The year, or `null` for a non-vintage wine (NV). */
  vintage?: number | null;
  /** red, white, rose, sparkling, orange, dessert or fortified (common words in other languages work too). */
  type?: string | null;
  /** A two-letter code (FR) or a name (France, Frankrijk, Italia ...). */
  country?: string | null;
  /** Region or appellation: it counts if either of the two the model read matches. */
  region?: string | null;
  /** Grape varieties printed on the label. All of them must be found. */
  grapes?: string[];
}

export const FIELDS = [
  "producer",
  "wine",
  "vintage",
  "type",
  "country",
  "region",
  "grapes",
] as const;
export type Field = (typeof FIELDS)[number];

/** The identity of a wine: if all of the ones you wrote down are right, the right wine was found. */
export const IDENTITY_FIELDS = ["producer", "wine", "vintage"] as const satisfies readonly Field[];

/** What the label reader came back with (the app's own `LabelFacts`, reduced to what is scored). */
export interface Got {
  producer: string | null;
  name: string | null;
  year: number | null;
  type: string | null;
  countryCode: string | null;
  region: string | null;
  appellation: string | null;
  grapes: string[];
}

export interface FieldResult {
  field: Field;
  ok: boolean;
  expected: string;
  got: string;
  /** How it matched: exactly, loosely (shared words), or not at all. */
  how: "exact" | "fuzzy" | "none";
}

// ---- Names -------------------------------------------------------------------------------------------

/** House words that mean "estate" and are written inconsistently ("Ch.", "Château", nothing): dropped anywhere. */
const HOUSE_WORDS = new Set([
  "chateau",
  "ch",
  "domaine",
  "domaines",
  "dom",
  "maison",
  "champagne",
  "weingut",
  "bodega",
  "bodegas",
  "cantina",
  "cantine",
  "tenuta",
  "azienda",
  "agricola",
  "quinta",
]);

/** Words that can be part of a name, so they are dropped only at the very front ("Clos de Vougeot" = "Vougeot"). */
const LEADING_WORDS = new Set(["casa", "cave", "caves", "clos"]);

/** Little words that carry no meaning for matching. */
const STOP = new Set([
  "de",
  "du",
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
  "et",
  "and",
]);

/** The words of a name: no case, accents or punctuation, no leading "Château/Domaine", no little words. */
export function nameTokens(input: string): string[] {
  const all = normalizeText(input).split(" ").filter(Boolean);
  const named = all.filter((w) => !HOUSE_WORDS.has(w));
  const base = named.length > 0 ? named : all; // "Château" alone stays "chateau"
  let start = 0;
  while (start < base.length - 1 && LEADING_WORDS.has(base[start] as string)) start++;
  const words = base.slice(start).filter((w) => !STOP.has(w));
  // A name made only of little words ("Le Du") keeps them rather than vanishing.
  return words.length > 0 ? words : base.slice(start);
}

const canonical = (input: string) => nameTokens(input).join(" ");

/** One letter wrong, added or missing: a misread letter on a long word is still that word. */
function nearlyEqual(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 6 || Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    let diff = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && ++diff > 1) return false;
    return true;
  }
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  let i = 0;
  while (i < short.length && short[i] === long[i]) i++;
  return short.slice(i) === long.slice(i + 1);
}

export type Overlap = "jaccard" | "contained";

/** How alike two names are, 0 to 1, by the words they share. "contained" = all of the shorter one's words. */
export function overlapScore(a: string, b: string, measure: Overlap = "jaccard"): number {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (ta.length === 0 || tb.length === 0) return 0;
  const used = new Set<number>();
  let shared = 0;
  for (const word of ta) {
    const at = tb.findIndex((other, i) => !used.has(i) && nearlyEqual(word, other));
    if (at >= 0) {
      used.add(at);
      shared++;
    }
  }
  const denominator =
    measure === "jaccard" ? ta.length + tb.length - shared : Math.min(ta.length, tb.length);
  return shared / denominator;
}

export const DEFAULT_THRESHOLD = 0.6;

export interface NameMatch {
  ok: boolean;
  how: FieldResult["how"];
  score: number;
}

/** Same name (exactly once normalised) or close enough (shared words at or above the threshold). */
export function matchName(
  expected: string,
  got: string | null,
  threshold = DEFAULT_THRESHOLD,
  measure: Overlap = "jaccard",
): NameMatch {
  if (got === null) return { ok: false, how: "none", score: 0 };
  const a = canonical(expected);
  if (a !== "" && a === canonical(got)) return { ok: true, how: "exact", score: 1 };
  const score = overlapScore(expected, got, measure);
  return score >= threshold ? { ok: true, how: "fuzzy", score } : { ok: false, how: "none", score };
}

// ---- Type and country --------------------------------------------------------------------------------

const TYPE_WORDS: Record<string, string> = {
  red: "red",
  rouge: "red",
  rosso: "red",
  tinto: "red",
  rood: "red",
  white: "white",
  blanc: "white",
  bianco: "white",
  blanco: "white",
  wit: "white",
  rose: "rose",
  rosado: "rose",
  rosato: "rose",
  sparkling: "sparkling",
  champagne: "sparkling",
  mousseux: "sparkling",
  spumante: "sparkling",
  cava: "sparkling",
  bubbly: "sparkling",
  orange: "orange",
  dessert: "dessert",
  sweet: "dessert",
  fortified: "fortified",
  port: "fortified",
  porto: "fortified",
  sherry: "fortified",
};

export function canonicalType(input: string): string {
  const key = normalizeText(input);
  return TYPE_WORDS[key] ?? key;
}

const COUNTRY_NAMES: Record<string, string> = {
  france: "FR",
  frankrijk: "FR",
  frankreich: "FR",
  italy: "IT",
  italie: "IT",
  italia: "IT",
  italien: "IT",
  spain: "ES",
  spanje: "ES",
  espana: "ES",
  spanien: "ES",
  portugal: "PT",
  germany: "DE",
  duitsland: "DE",
  deutschland: "DE",
  austria: "AT",
  oostenrijk: "AT",
  osterreich: "AT",
  switzerland: "CH",
  zwitserland: "CH",
  schweiz: "CH",
  suisse: "CH",
  "united states": "US",
  usa: "US",
  "united states of america": "US",
  america: "US",
  argentina: "AR",
  chile: "CL",
  australia: "AU",
  australie: "AU",
  "new zealand": "NZ",
  "nieuw zeeland": "NZ",
  "south africa": "ZA",
  "zuid afrika": "ZA",
  greece: "GR",
  griekenland: "GR",
  hungary: "HU",
  hongarije: "HU",
  slovenia: "SI",
  croatia: "HR",
  romania: "RO",
  georgia: "GE",
  lebanon: "LB",
  libanon: "LB",
  uruguay: "UY",
  brazil: "BR",
  canada: "CA",
  bulgaria: "BG",
  israel: "IL",
  turkey: "TR",
  moldova: "MD",
  china: "CN",
  japan: "JP",
  "united kingdom": "GB",
  england: "GB",
  netherlands: "NL",
  nederland: "NL",
  belgium: "BE",
  belgie: "BE",
  luxembourg: "LU",
  mexico: "MX",
  peru: "PE",
};

/** A two-letter code or a country name (English, Dutch, local) to a code; null when it is not recognised. */
export function countryCode(input: string): string | null {
  const text = input.trim();
  if (/^[A-Za-z]{2}$/.test(text)) return text.toUpperCase();
  return COUNTRY_NAMES[normalizeText(text)] ?? null;
}

// ---- Scoring one photo -------------------------------------------------------------------------------

const show = (value: string | number | null | undefined) =>
  value === null || value === undefined ? "(nothing)" : String(value);

/** Scores only the fields present in `expected`. `got` is null when nothing could be read from the photo. */
export function scorePhoto(
  expected: Expected,
  got: Got | null,
  threshold = DEFAULT_THRESHOLD,
): FieldResult[] {
  const results: FieldResult[] = [];
  const push = (field: Field, ok: boolean, exp: unknown, seen: unknown, how: FieldResult["how"]) =>
    results.push({
      field,
      ok,
      expected: show(exp as string | number | null),
      got: show(seen as string | number | null),
      how: ok ? how : "none",
    });

  const text = (field: Field, want: string | null, seen: string | null) => {
    if (want === null) return push(field, seen === null, want, seen, "exact");
    const m = matchName(want, seen, threshold);
    push(field, m.ok, want, seen, m.how);
  };

  if (expected.producer !== undefined) text("producer", expected.producer, got?.producer ?? null);
  if (expected.wine !== undefined) text("wine", expected.wine, got?.name ?? null);
  if (expected.vintage !== undefined)
    push(
      "vintage",
      (got?.year ?? null) === expected.vintage,
      expected.vintage ?? "NV",
      got ? (got.year ?? "NV") : null,
      "exact",
    );
  if (expected.type !== undefined) {
    const want = expected.type === null ? null : canonicalType(expected.type);
    const seen = got?.type ? canonicalType(got.type) : null;
    push("type", want === seen, want, seen, "exact");
  }
  if (expected.country !== undefined) {
    const want =
      expected.country === null ? null : (countryCode(expected.country) ?? expected.country);
    const seen = got?.countryCode ? got.countryCode.toUpperCase() : null;
    push("country", want === seen, want, seen, "exact");
  }
  if (expected.region !== undefined) {
    if (expected.region === null) {
      push(
        "region",
        !got?.region && !got?.appellation,
        null,
        got?.region ?? got?.appellation ?? null,
        "exact",
      );
    } else {
      const a = matchName(expected.region, got?.region ?? null, threshold, "contained");
      const b = matchName(expected.region, got?.appellation ?? null, threshold, "contained");
      const best = a.ok ? a : b;
      push("region", best.ok, expected.region, got?.region ?? got?.appellation ?? null, best.how);
    }
  }
  if (expected.grapes !== undefined) {
    const seen = got?.grapes ?? [];
    const found = expected.grapes.every((grape) =>
      seen.some((s) => matchName(grape, s, threshold, "contained").ok),
    );
    push(
      "grapes",
      found,
      expected.grapes.join(", ") || "(none)",
      seen.join(", ") || "(none)",
      "exact",
    );
  }
  return results;
}

/** The right wine was found: every identity field you wrote down (producer, wine, vintage) is right. */
export function identifiedRightWine(results: readonly FieldResult[]): boolean | null {
  const identity = results.filter((r) => (IDENTITY_FIELDS as readonly string[]).includes(r.field));
  return identity.length === 0 ? null : identity.every((r) => r.ok);
}

// ---- The expected-values file ------------------------------------------------------------------------

export class ExpectedFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExpectedFileError";
  }
}

const KNOWN_KEYS = new Set<string>(FIELDS);

function checkEntry(file: string, entry: unknown): Expected {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry))
    throw new ExpectedFileError(`"${file}": expected an object like { "producer": "..." }.`);
  const source = entry as Record<string, unknown>;
  const out: Expected = {};
  for (const key of Object.keys(source)) {
    if (!KNOWN_KEYS.has(key))
      throw new ExpectedFileError(
        `"${file}": unknown field "${key}". Fields: ${FIELDS.join(", ")}.`,
      );
  }
  const str = (key: "producer" | "wine" | "type" | "country" | "region") => {
    const v = source[key];
    if (v === undefined) return;
    if (v !== null && typeof v !== "string")
      throw new ExpectedFileError(`"${file}": "${key}" must be text or null.`);
    out[key] = v;
  };
  str("producer");
  str("wine");
  str("type");
  str("country");
  str("region");
  const vintage = source.vintage;
  if (vintage !== undefined) {
    if (vintage !== null && (typeof vintage !== "number" || !Number.isInteger(vintage)))
      throw new ExpectedFileError(
        `"${file}": "vintage" must be a year (like 2015) or null for NV.`,
      );
    out.vintage = vintage;
  }
  const grapes = source.grapes;
  if (grapes !== undefined) {
    if (!Array.isArray(grapes) || grapes.some((g) => typeof g !== "string"))
      throw new ExpectedFileError(`"${file}": "grapes" must be a list of names.`);
    out.grapes = grapes as string[];
  }
  if (typeof out.country === "string" && countryCode(out.country) === null)
    throw new ExpectedFileError(
      `"${file}": country "${out.country}" is not recognised. Use a two-letter code like FR.`,
    );
  return out;
}

/** The parsed JSON file: `{ "photo.jpg": { ... } }`. */
export function parseExpectedJson(json: unknown): Map<string, Expected> {
  if (typeof json !== "object" || json === null || Array.isArray(json))
    throw new ExpectedFileError(
      'The file must be an object: { "photo.jpg": { "producer": "..." } }.',
    );
  const map = new Map<string, Expected>();
  for (const [file, entry] of Object.entries(json as Record<string, unknown>)) {
    if (file.startsWith("_")) continue; // "_comment" and friends
    map.set(file, checkEntry(file, entry));
  }
  return map;
}

/** Splits one CSV line: commas, "double quotes" around text that contains commas, "" for a quote. */
function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i] as string;
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      cells.push(cell);
      cell = "";
    } else cell += c;
  }
  cells.push(cell);
  return cells.map((s) => s.trim());
}

/**
 * The same thing as a spreadsheet export: a header line `file,producer,wine,vintage,type,country,region,grapes`
 * (any order, any subset). An empty cell means "do not score this"; `NV` in vintage means non-vintage; grapes are
 * separated by `;`.
 */
export function parseExpectedCsv(csv: string): Map<string, Expected> {
  const lines = csv
    .replace(/^\u{FEFF}/u, "")
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "");
  const header = splitCsvLine(lines[0] ?? "").map((h) => h.toLowerCase());
  if (!header.includes("file"))
    throw new ExpectedFileError(
      'The first line of the CSV must name the columns, starting with "file".',
    );
  const entries: Record<string, unknown> = {};
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const row: Record<string, unknown> = {};
    let file = "";
    header.forEach((name, i) => {
      const value = cells[i] ?? "";
      if (name === "file") file = value;
      else if (value === "") return;
      else if (name === "vintage")
        row.vintage = /^nv$/i.test(value) ? null : /^\d+$/.test(value) ? Number(value) : value;
      else if (name === "grapes")
        row.grapes = value
          .split(";")
          .map((g) => g.trim())
          .filter(Boolean);
      else row[name] = value;
    });
    if (file !== "") entries[file] = row;
  }
  return parseExpectedJson(entries);
}

/** Finds the entry for a photo: by its exact file name, ignoring case, or by the name without its extension. */
export function lookupExpected(
  expected: Map<string, Expected>,
  file: string,
): Expected | undefined {
  const wanted = file.toLowerCase();
  const bare = wanted.replace(/\.[^.]+$/, "");
  for (const [key, value] of expected) {
    const k = key.toLowerCase();
    if (k === wanted || k === bare) return value;
  }
  return undefined;
}
