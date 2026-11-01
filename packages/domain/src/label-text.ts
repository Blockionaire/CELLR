import { normalizeText, type WineSummary, type WineType } from "./cellar";
import { ESTATE_WORDS, MATCH, scoreWine, type LabelFacts } from "./scan";

/**
 * DATABASE-FIRST RECOGNITION (Sprint S). The phone reads the label's printed text itself (local OCR, no AI call);
 * the server looks only that text up in the catalogue and decides here, in plain code, whether it names exactly
 * one known wine. Only an exact, uncontradicted catalogue identity counts. Anything else (a near match, two
 * possible wines, a household's own wine that fits too, a reserve bottling, another colour or country) is "not
 * sure", and the photo is read by the vision model as before. The person always confirms the proposal.
 *
 * The OCR text is a query, never a record: it is not stored anywhere.
 */

export const LABEL_TEXT_LIMITS = {
  /** What the server accepts from the phone. */
  chars: 2000,
  lines: 60,
  /** Tokens of one line that are considered (fine print beyond this adds nothing). */
  lineTokens: 16,
  /** Longest phrase looked up (a producer or wine name is rarely longer). */
  phraseTokens: 8,
  /** Phrases sent to the database for one photo. */
  phrases: 400,
  /** Candidate wines the database returns; at this many the answer may be cut off, so nothing is decided. */
  candidates: 40,
} as const;

/** A wine the database found because its producer or name is printed on the label. */
export interface LabelTextCandidate {
  /** As the household sees it (catalogue wines carry `catalog: true` and their verified aliases). */
  wine: WineSummary;
  /** The household's own wine: the catalogue wine it is verifiably linked to (wine_links), if any. */
  linkedTo: string | null;
}

export type TextMissReason =
  "no-text" | "too-many" | "no-match" | "ambiguous" | "own-wine" | "contradiction" | "qualifier";

export type TextRecognition =
  | {
      kind: "match";
      /** The wine to propose: the catalogue wine, or the household's own wine verifiably linked to it. */
      wine: WineSummary;
      /** The catalogue identity that was recognised. */
      catalogWineId: string;
      facts: LabelFacts;
    }
  | { kind: "none"; reason: TextMissReason };

type Tokens = readonly string[];

const tokensOf = (text: string): string[] => normalizeText(text).split(" ").filter(Boolean);

/** The label text as normalised lines of words (accents, case and punctuation removed), bounded. */
export function labelLines(text: string): string[][] {
  return text
    .slice(0, LABEL_TEXT_LIMITS.chars)
    .split(/\r?\n/)
    .map(tokensOf)
    .filter((line) => line.length > 0)
    .slice(0, LABEL_TEXT_LIMITS.lines);
}

/** A line and the next one read as one (a name printed over two lines). */
const withJoins = (lines: string[][]): string[][] => [
  ...lines,
  ...lines.slice(1).map((line, i) => [...lines[i]!, ...line]),
];

/**
 * The phrases to look up: every run of 1 to 8 words of every line (and of two lines read as one), shortest lines
 * first (names are short lines; fine print is long), distinct, bounded. Single words of fewer than three letters
 * are left out (they name nothing).
 */
export function labelPhrases(text: string): string[] {
  const lines = withJoins(labelLines(text))
    .map((line) => line.slice(0, LABEL_TEXT_LIMITS.lineTokens))
    .sort((a, b) => a.length - b.length);
  const seen = new Set<string>();
  for (const line of lines)
    for (let size = 1; size <= Math.min(LABEL_TEXT_LIMITS.phraseTokens, line.length); size++)
      for (let start = 0; start + size <= line.length; start++) {
        const phrase = line.slice(start, start + size).join(" ");
        if (size === 1 && phrase.length < 3) continue;
        if (phrase.length > 160) continue;
        seen.add(phrase);
        if (seen.size >= LABEL_TEXT_LIMITS.phrases) return [...seen];
      }
  return [...seen];
}

/** Where `needle` appears as whole consecutive words in `line`, or -1. */
function indexOfRun(line: Tokens, needle: Tokens): number {
  if (needle.length === 0 || needle.length > line.length) return -1;
  outer: for (let i = 0; i + needle.length <= line.length; i++) {
    for (let j = 0; j < needle.length; j++) if (line[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

const removeRun = (line: Tokens, at: number, length: number) => [
  ...line.slice(0, at),
  ...line.slice(at + length),
];

const YEAR = /^(19|20)\d\d$/;

/** Words that may stand next to a wine's name on its line without making it another wine. */
const FILLER = new Set([...ESTATE_WORDS, "cuvee", "vin", "vino", "wein", "vinho"]);
const isFiller = (t: string) => FILLER.has(t) || YEAR.test(t) || (t.length === 1 && !/\d/.test(t));

/**
 * The name is printed as a line of its own: the line holds the name (or a verified alias), and nothing else but
 * the producer, a year, estate words ("Château", "Cuvée") or stray single characters (OCR noise). "Pavillon Rouge
 * du Château Margaux" is therefore never read as "Château Margaux".
 */
function nameOnItsOwnLine(lines: string[][], names: Tokens[], producer: Tokens): boolean {
  return withJoins(lines).some((line) =>
    names.some((name) => {
      const at = indexOfRun(line, name);
      if (at < 0) return false;
      let rest = removeRun(line, at, name.length);
      const p = indexOfRun(rest, producer);
      if (p >= 0) rest = removeRun(rest, p, producer.length);
      return rest.every(isFiller);
    }),
  );
}

const printed = (lines: string[][], words: Tokens) => lines.some((l) => indexOfRun(l, words) >= 0);

/** Exactly this wine is printed: its producer, and its name or a verified alias on a line of its own. */
function namesExactly(lines: string[][], wine: WineSummary): boolean {
  const producer = tokensOf(wine.producer);
  if (producer.length === 0 || !printed(lines, producer)) return false;
  const names = [wine.name, ...(wine.aliases ?? [])].map(tokensOf).filter((n) => n.length > 0);
  return nameOnItsOwnLine(lines, names, producer);
}

// ---- What the rest of the label says about colour, country and bottling --------------------------------------

type Evidence = "red" | "white" | "rose" | "sparkling" | "fortified";

const COLOUR_WORDS: Record<string, Evidence> = {
  rouge: "red",
  rosso: "red",
  tinto: "red",
  red: "red",
  rotwein: "red",
  rood: "red",
  blanc: "white",
  bianco: "white",
  blanco: "white",
  branco: "white",
  white: "white",
  weiss: "white",
  weisswein: "white",
  rose: "rose",
  rosato: "rose",
  rosado: "rose",
  champagne: "sparkling",
  cremant: "sparkling",
  cava: "sparkling",
  spumante: "sparkling",
  sekt: "sparkling",
  prosecco: "sparkling",
  brut: "sparkling",
  mousseux: "sparkling",
  petillant: "sparkling",
  franciacorta: "sparkling",
  sparkling: "sparkling",
  frizzante: "sparkling",
  porto: "fortified",
  port: "fortified",
  sherry: "fortified",
  jerez: "fortified",
  madeira: "fortified",
  marsala: "fortified",
};

/** What printed colour words rule out for each wine type ("Blanc de Blancs" on a Champagne is not a contradiction). */
const RULED_OUT: Record<WineType, ReadonlySet<Evidence>> = {
  red: new Set(["white", "rose", "sparkling", "fortified"]),
  white: new Set(["red", "rose", "sparkling", "fortified"]),
  rose: new Set(["red", "white", "sparkling", "fortified"]),
  sparkling: new Set(["red", "rose", "fortified"]),
  orange: new Set(["red", "rose", "sparkling", "fortified"]),
  dessert: new Set(["red", "rose", "sparkling"]),
  fortified: new Set(["sparkling"]),
};

const COUNTRY_WORDS: ReadonlyArray<[string[], string]> = [
  [["france"], "FR"],
  [["italia"], "IT"],
  [["italy"], "IT"],
  [["espana"], "ES"],
  [["spain"], "ES"],
  [["portugal"], "PT"],
  [["deutschland"], "DE"],
  [["germany"], "DE"],
  [["osterreich"], "AT"],
  [["austria"], "AT"],
  [["south", "africa"], "ZA"],
  [["australia"], "AU"],
  [["new", "zealand"], "NZ"],
  [["chile"], "CL"],
  [["argentina"], "AR"],
  [["usa"], "US"],
  [["united", "states"], "US"],
  [["california"], "US"],
  [["greece"], "GR"],
];

/** A different bottling of the same name: a reserve, a selection, a late harvest, a classified cru. */
const QUALIFIERS = new Set([
  "reserve",
  "reserva",
  "riserva",
  "gran",
  "grand",
  "grande",
  "cru",
  "premier",
  "1er",
  "vieilles",
  "selection",
  "selezione",
  "seleccion",
  "superiore",
  "classico",
  "crianza",
  "spatlese",
  "auslese",
  "kabinett",
  "beerenauslese",
  "trockenbeerenauslese",
  "eiswein",
  "smaragd",
  "federspiel",
  "vendanges",
  "tardives",
  "prestige",
  "special",
  "speciale",
  "limited",
  "single",
  "second",
]);

/** Classification statements about the estate, not another bottling ("Grand Cru Classé", "Grand Vin de …"). */
const STATEMENTS: Tokens[] = [
  ["premier", "grand", "cru", "classe"],
  ["1er", "grand", "cru", "classe"],
  ["grand", "cru", "classe"],
  ["cru", "classe"],
  ["cru", "bourgeois"],
  ["cru", "artisan"],
  ["grand", "vin"],
];

/** Starting words of "since 1855", "fondé en 1902": a year that is not the vintage. */
const FOUNDED = new Set([
  "since",
  "depuis",
  "fonde",
  "fondee",
  "founded",
  "established",
  "est",
  "seit",
  "dal",
  "desde",
  "sinds",
  "anno",
  "gegrundet",
  "fundada",
  "fundado",
  "fondata",
  "fondato",
]);

/** The words of the wine's own identity: printed, they are evidence of nothing else. */
const ownWords = (wine: WineSummary) =>
  new Set([wine.producer, wine.name, ...(wine.aliases ?? []), wine.region ?? ""].flatMap(tokensOf));

const stripStatements = (line: Tokens): string[] => {
  let rest = [...line];
  for (const s of STATEMENTS) {
    let at = indexOfRun(rest, s);
    while (at >= 0) {
      rest = removeRun(rest, at, s.length);
      at = indexOfRun(rest, s);
    }
  }
  return rest;
};

/** Why the rest of the label says this is not (exactly) this wine, or null. */
function contradicts(
  lines: string[][],
  wine: WineSummary,
  country: string | null,
): "contradiction" | "qualifier" | null {
  const own = ownWords(wine);
  const words = lines.flat().filter((t) => !own.has(t));
  const ruledOut = RULED_OUT[wine.type];
  if (words.some((t) => COLOUR_WORDS[t] && ruledOut.has(COLOUR_WORDS[t]))) return "contradiction";
  if (country) {
    const named = new Set(
      COUNTRY_WORDS.filter(([w]) => w.every((t) => !own.has(t)) && printed(lines, w)).map(
        ([, code]) => code,
      ),
    );
    if (named.size > 0 && !named.has(country)) return "contradiction";
  }
  const qualified = lines.some((line) =>
    stripStatements(line).some((t) => QUALIFIERS.has(t) && !own.has(t)),
  );
  return qualified ? "qualifier" : null;
}

/**
 * The vintage, when exactly one plausible year is printed (and it is not a founding year or part of the wine's
 * name). Otherwise unknown: an unreadable year is never taken for "non-vintage".
 */
export function vintageFromLabel(
  lines: string[][],
  wine: WineSummary | null,
  now: Date,
): number | null {
  const own = wine ? ownWords(wine) : new Set<string>();
  const ceiling = now.getUTCFullYear() + 1;
  const years = new Set<number>();
  for (const line of lines)
    line.forEach((t, i) => {
      if (!YEAR.test(t) || own.has(t)) return;
      if (line.slice(0, i).some((w) => FOUNDED.has(w))) return;
      const year = Number(t);
      if (year >= 1900 && year <= ceiling) years.add(year);
    });
  return years.size === 1 ? [...years][0]! : null;
}

/** What the review starts from: the catalogue's own record, and the year only when it was read. */
function factsOf(wine: WineSummary, year: number | null): LabelFacts {
  return {
    producer: wine.producer,
    name: wine.name,
    year,
    // never assumed: no year read means "not known", not "non-vintage"
    nonVintage: false,
    type: wine.type,
    countryCode: wine.countryCode,
    region: wine.region,
    appellation: null,
    grapes: [],
    abv: null,
    volumeMl: null,
    // the identity is the catalogue's; the year is the phone's reading, to be checked (or chosen) by the person
    confidence: { producer: "high", name: "high", year: year === null ? "low" : "medium" },
  };
}

/**
 * Decides, from the label text and the wines the database found for it, whether the label names exactly one
 * catalogue wine. `candidates` must be every wine the household can see whose producer or name is printed on the
 * label (and the household's own wines linked to those): a household wine that fits is never passed over.
 */
export function recognizeLabelText(
  text: string,
  candidates: readonly LabelTextCandidate[],
  now: Date = new Date(),
): TextRecognition {
  const none = (reason: TextMissReason): TextRecognition => ({ kind: "none", reason });
  const lines = labelLines(text);
  if (lines.length === 0) return none("no-text");
  if (candidates.length >= LABEL_TEXT_LIMITS.candidates) return none("too-many");

  const exact = candidates.filter((c) => c.wine.catalog && namesExactly(lines, c.wine));
  if (exact.length === 0) return none("no-match");
  // Two catalogue wines both printed in full (two colours, two countries, a wine and its reserve): not ours to pick.
  if (exact.length > 1) return none("ambiguous");
  const found = exact[0]!.wine;

  const why = contradicts(lines, found, found.countryCode);
  if (why) return none(why);

  const year = vintageFromLabel(lines, found, now);
  const facts = factsOf(found, year);
  // The household's own wines: one verifiably linked to this catalogue wine IS this wine for them; any other that
  // fits as well means the person chooses (with the vision model's reading), never the catalogue silently.
  const own = candidates.filter((c) => !c.wine.catalog);
  const linked = own.filter((c) => c.linkedTo === found.id);
  const rival = own.some(
    (c) =>
      c.linkedTo !== found.id &&
      (namesExactly(lines, c.wine) || scoreWine(facts, c.wine) >= MATCH.strong),
  );
  if (rival) return none("own-wine");
  if (linked.length > 1) return none("ambiguous");
  const wine = linked[0]?.wine ?? found;
  return { kind: "match", wine, catalogWineId: found.id, facts: factsOf(wine, year) };
}
