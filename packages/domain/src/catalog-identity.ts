import { normalizeText, type WineType } from "./cellar";
import { COLOUR_WORDS, QUALIFIERS, stripStatements } from "./label-text";
import { ESTATE_WORDS } from "./scan";

/**
 * HOW TWO WINE RECORDS RELATE (Wine Intelligence WI-01): is "Chateau Leoville-Poyferre" the same wine as "Château
 * Léoville Poyferré", and is "Reserva" the same wine as "Gran Reserva"? The first is a spelling; the second is another
 * wine. This answers that for two records side by side — a provider record and a canonical wine, or two provider
 * records — so a reviewer sees WHY they are or are not the same, and so the app never groups two different cuvées.
 *
 * It is a classification for people, not a decision: only `same` (the exact identity the import already uses for its
 * link suggestion) may ever be treated as one wine without a person, and even then a link is only SUGGESTED. Nothing
 * here verifies, merges or promotes anything.
 */
export interface IdentityFacts {
  producer: string;
  name: string;
  type?: WineType | null | undefined;
  countryCode?: string | null | undefined;
}

export const IDENTITY_RELATIONS = [
  /** Producer and name are equal after normalising case, accents and punctuation; nothing contradicts. */
  "same",
  /** The same words apart from estate words, articles or word order ("Château Margaux" / "Margaux"). */
  "variant",
  /** Very alike, letter for letter, but not the same words: a typo, or another wine. A person decides. */
  "uncertain",
  /** One has a word that makes it another bottling: Réserve, Gran Reserva, a colour, a second-wine name. */
  "different_cuvee",
  "different_type",
  "different_country",
  "different_producer",
  "different_wine",
] as const;
export type IdentityRelation = (typeof IDENTITY_RELATIONS)[number];

export interface IdentityComparison {
  relation: IdentityRelation;
  /** The words only one of the two names has (normalised), for the reviewer. */
  onlyInA: string[];
  onlyInB: string[];
  /** The words among those that make it another bottling. */
  discriminators: string[];
}

/** The longest text compared: a name is never longer, and nothing here may take long on hostile input. */
const MAX_TEXT = 240;

/**
 * The words of a name. "d'Yquem" and "l'Ermita" lose their elided article first, so that a letter that stands on its
 * own ("L de La Louvière", "Cuvée A") stays a word of the name: it usually names another wine.
 */
const tokens = (s: string) =>
  normalizeText(s.slice(0, MAX_TEXT).replace(/(^|[^\p{L}\p{N}])[dl]['’`´]/giu, "$1"))
    .split(" ")
    .filter(Boolean);

/** Articles and linking words: the only words that never tell two wines apart, wherever they stand. */
const ARTICLES = new Set([
  "de",
  "du",
  "des",
  "di",
  "del",
  "della",
  "dei",
  "do",
  "da",
  "dos",
  "das",
  "van",
  "von",
  "le",
  "la",
  "les",
  "el",
  "los",
  "las",
  "il",
  "lo",
  "the",
  "of",
  "et",
  "and",
  "und",
  "y",
  "e",
]);
/** "Cuvée Alpha" and "Alpha", "Vin de Constance" and "Constance": words that only say "this is a wine". */
const WINE_WORDS = new Set(["cuvee", "vin", "vino", "wein", "vinho", "wine"]);

/**
 * Words that name a second wine or another range of an estate. Deliberately short: only words that, added to a name,
 * are known to make it another wine ("Pavillon Rouge du Château Margaux", "Petit Mouton", "Carruades de Lafite").
 */
const OTHER_BOTTLING = new Set([
  "pavillon",
  "petit",
  "petite",
  "carruades",
  "forts",
  "second",
  "segunda",
  "secondo",
  "junior",
  "old",
  "vines",
  "vignes",
  "vieilles",
  "alte",
  "reben",
  "viejas",
  "vinas",
  "brut",
  "nature",
  "extra",
  "sec",
  "demi",
  "doux",
  "dry",
  "sweet",
  "dolce",
  "secco",
  "trocken",
  "halbtrocken",
  "feinherb",
  "millesime",
  "vintage",
  "nv",
  "tawny",
  "ruby",
  "lbv",
  "colheita",
  "fino",
  "amontillado",
  "oloroso",
  "barrique",
  "oaked",
  "unoaked",
  "magnum",
  "estate",
  "clos",
]);

/** A word that makes a name another bottling: a qualifier, a colour, a number, a single letter ("Cuvée A"). */
const isDiscriminator = (t: string) =>
  QUALIFIERS.has(t) ||
  Boolean(COLOUR_WORDS[t]) ||
  OTHER_BOTTLING.has(t) ||
  /^\d+$/.test(t) ||
  t.length === 1 ||
  /^(i{1,3}|iv|v|vi{1,3}|ix|x)$/.test(t);

const withoutArticles = (ts: string[]) => ts.filter((t) => !ARTICLES.has(t));
const difference = (a: string[], b: string[]) => {
  const have = new Map<string, number>();
  for (const t of b) have.set(t, (have.get(t) ?? 0) + 1);
  const out: string[] = [];
  for (const t of a) {
    const n = have.get(t) ?? 0;
    if (n > 0) have.set(t, n - 1);
    else out.push(t);
  }
  return out;
};
const sameWords = (a: string[], b: string[]) =>
  a.length === b.length && difference(a, b).length === 0;

/** Letters apart (insert, delete, replace), stopping once it is more than `max`. */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let least = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(
        prev[j]! + 1,
        row[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      row[j] = v;
      if (v < least) least = v;
    }
    if (least > max) return max + 1;
    prev = row;
  }
  return prev[b.length]!;
}

/** Two words that may be one word with a slipped letter (one letter from five letters on, two from nine). */
const slip = (a: string, b: string) => {
  const shorter = Math.min(a.length, b.length);
  const max = shorter >= 9 ? 2 : shorter >= 5 ? 1 : 0;
  return max > 0 && editDistance(a, b, max) <= max;
};

/**
 * Signs in a name that are not letters, digits or ordinary punctuation: the stars of "Auslese **", the plus of
 * "Syrah +". Normalising drops them, yet they often tell two bottlings apart, so names that differ in them are
 * never called the same.
 */
const marks = (s: string) =>
  s.slice(0, MAX_TEXT).replace(/[\p{L}\p{N}\p{M}\s'’`´.,\-–—()&/:;"“”«»!?]/gu, "");

const estateWords = (ts: string[]) => ts.filter((t) => ESTATE_WORDS.has(t) && !ARTICLES.has(t));
const producerCore = (ts: string[]) => withoutArticles(ts).filter((t) => !ESTATE_WORDS.has(t));

/**
 * The same producer written another way, and only that: the same words apart from articles and word order, or one
 * side with the estate word left off ("Château Margaux" / "Margaux"). Two DIFFERENT estate words ("Domaine Leroy" /
 * "Maison Leroy") may be two companies: uncertain. An extra word or another initial is another producer.
 */
function sameProducer(a: string, b: string): "same" | "variant" | "uncertain" | "different" {
  const na = normalizeText(a.slice(0, MAX_TEXT));
  const nb = normalizeText(b.slice(0, MAX_TEXT));
  if (na === "" || nb === "") return "different";
  if (na === nb) return "same";
  const ta = tokens(a);
  const tb = tokens(b);
  const ca = producerCore(ta);
  const cb = producerCore(tb);
  if (ca.length > 0 && sameWords(ca, cb)) {
    const ea = estateWords(ta);
    const eb = estateWords(tb);
    return ea.length > 0 && eb.length > 0 && !sameWords(ea, eb) ? "uncertain" : "variant";
  }
  // a producer made of estate words only ("Château") is no producer to compare by
  if (ca.length === 0 || cb.length === 0) return "different";
  if (ca.length !== cb.length) return "different";
  const left = difference(ca, cb);
  const right = difference(cb, ca);
  // one slipped letter in one word of an otherwise identical name: a typo, or another house — a person decides
  return left.length === 1 && right.length === 1 && slip(left[0]!, right[0]!)
    ? "uncertain"
    : "different";
}

/** `run` removed once from `ts` where it stands as consecutive words; `ts` itself when it does not. */
function withoutRun(ts: string[], run: string[]): string[] {
  if (run.length === 0 || run.length > ts.length) return ts;
  outer: for (let i = 0; i + run.length <= ts.length; i++) {
    for (let j = 0; j < run.length; j++) if (ts[i + j] !== run[j]) continue outer;
    return [...ts.slice(0, i), ...ts.slice(i + run.length)];
  }
  return ts;
}

/**
 * How record B relates to record A. Symmetric. The order of checks is the order of certainty: a known contradiction
 * (producer, type, country) first; then exactly the same name; then any word that makes it another bottling; and
 * only then the few harmless differences (articles, "Cuvée", the producer's own name repeated in the wine's name).
 * Whatever is left is another wine, or — a slipped letter — something a person decides.
 */
export function identityRelation(a: IdentityFacts, b: IdentityFacts): IdentityComparison {
  // statements about the estate ("Grand Cru Classé", "Grand Vin") are not part of the wine's name
  const rawA = tokens(a.name);
  const rawB = tokens(b.name);
  const nameA = withoutArticles(stripStatements(rawA));
  const nameB = withoutArticles(stripStatements(rawB));
  const onlyInA = difference(nameA, nameB);
  const onlyInB = difference(nameB, nameA);
  const discriminators = [...new Set([...onlyInA, ...onlyInB].filter(isDiscriminator))];
  const answer = (relation: IdentityRelation): IdentityComparison => ({
    relation,
    onlyInA,
    onlyInB,
    discriminators,
  });

  const producer = sameProducer(a.producer, b.producer);
  if (producer === "different") return answer("different_producer");
  if (a.type && b.type && a.type !== b.type) return answer("different_type");
  if (a.countryCode && b.countryCode && a.countryCode !== b.countryCode)
    return answer("different_country");

  const na = normalizeText(a.name.slice(0, MAX_TEXT));
  const nb = normalizeText(b.name.slice(0, MAX_TEXT));
  // a name with no letters or digits at all identifies nothing
  if (na === "" || nb === "") return answer("uncertain");
  const sameMarks = marks(a.name) === marks(b.name);
  if (na === nb) return answer(!sameMarks ? "uncertain" : producer);
  if (discriminators.length > 0) return answer("different_cuvee");
  // two different statements about the estate ("Cru Bourgeois" / "Cru Artisan"): not for code to wave away
  const statedA = difference(withoutArticles(rawA), nameA);
  const statedB = difference(withoutArticles(rawB), nameB);
  const statementsDiffer = statedA.length > 0 && statedB.length > 0 && !sameWords(statedA, statedB);
  const harmless = (relation: "variant"): IdentityComparison =>
    answer(!sameMarks || statementsDiffer || producer === "uncertain" ? "uncertain" : relation);

  // only articles, word order or "Cuvée" differ
  const plain = (ts: string[]) => ts.filter((t) => !WINE_WORDS.has(t));
  if (sameWords(plain(nameA), plain(nameB)) && plain(nameA).length > 0) return harmless("variant");
  // the producer's own name repeated in the wine's name: "Muga Reserva" / "Reserva", "Château Margaux" / "Margaux"
  // (as one phrase, with or without its estate word; a single word of it elsewhere in the name is not that)
  const full = withoutArticles(
    tokens(a.producer).length >= tokens(b.producer).length
      ? tokens(a.producer)
      : tokens(b.producer),
  );
  const core = full.filter((t) => !ESTATE_WORDS.has(t));
  const strip = (ts: string[]) => {
    const cut = withoutRun(ts, full);
    return plain(cut !== ts ? cut : core.length > 0 ? withoutRun(ts, core) : ts);
  };
  if (sameWords(strip(nameA), strip(nameB))) return harmless("variant");

  // one name has words the other lacks, and none is a known qualifier: it is never "variant". A slipped letter in
  // one word is "uncertain"; anything else is another wine ("Brunello di Montalcino Vigna Nuova").
  if (onlyInA.length === onlyInB.length && onlyInA.every((t, i) => slip(t, onlyInB[i]!)))
    return answer("uncertain");
  return answer("different_wine");
}

/**
 * Records that are exactly the same identity, grouped (the first of each group leads; order is kept). Only records
 * with the same normalised producer and name, the same signs, and the SAME type and country share a group: an
 * unknown type never joins a red and a white into one group, whatever the order they arrive in. A variant spelling,
 * a similar name or another cuvée is always its own candidate.
 */
export function groupSameIdentity<T extends IdentityFacts>(records: readonly T[]): T[][] {
  const groups = new Map<string, T[]>();
  for (const r of records) {
    const key = JSON.stringify([
      normalizeText(r.producer.slice(0, MAX_TEXT)),
      normalizeText(r.name.slice(0, MAX_TEXT)),
      marks(r.name),
      r.type ?? null,
      r.countryCode ?? null,
    ]);
    const group = groups.get(key);
    if (group) group.push(r);
    else groups.set(key, [r]);
  }
  return [...groups.values()];
}

// ---- LWIN codes ---------------------------------------------------------------------------------------------------

/**
 * A Liv-ex LWIN, taken apart. The code is a hierarchy, not one identity: LWIN-7 names the wine; LWIN-11 adds the
 * vintage; LWIN-16 adds the bottle size; LWIN-18 adds the pack size as well. Only what the digits say is returned:
 * nothing is looked up, completed or guessed, and a code of any other length is not an LWIN.
 *
 * Evidence (liv-ex.com/contact-faqs, read 2026-11-13): "LWINs are unique 7, 11, 16 or 18-digit codes. The 7-digit code
 * refers to the wine itself"; examples "LWIN-11: 12345672012", "LWIN-16: 1234567201200750 – … 750ml bottle size",
 * "LWIN-18: 123456720121200750 – … 12 bottles of 750ml", "All bottle sizes are expressed in millilitres in a
 * five-digit format". The field order and the two-digit pack size are read from those examples.
 * NOT documented on Liv-ex's public pages: what stands in the vintage position for a wine without a single vintage.
 * The value 1000 is seen there; until Liv-ex confirms what it means it is reported as `vintagePlaceholder`, and is
 * never turned into "non-vintage" (SOURCE_RIGHTS_REGISTER.md, open question L8).
 */
export interface LwinCode {
  level: 7 | 11 | 16 | 18;
  /** The wine: always the first seven digits. */
  lwin7: string;
  /** The vintage year, when the code carries one. */
  vintage: number | null;
  /** The vintage position holds 1000 instead of a year: no single vintage is stated. Its meaning is unconfirmed. */
  vintagePlaceholder: boolean;
  /** Bottles in the pack (LWIN-18 only). */
  packSize: number | null;
  /** The bottle size in millilitres (LWIN-16 and LWIN-18). */
  bottleMl: number | null;
}

export const LWIN_VINTAGE_PLACEHOLDER = "1000";

export function parseLwin(code: string): LwinCode | null {
  const c = code.trim();
  if (!/^\d+$/.test(c) || ![7, 11, 16, 18].includes(c.length)) return null;
  const lwin7 = c.slice(0, 7);
  if (/^0+$/.test(lwin7)) return null;
  const base: LwinCode = {
    level: c.length as LwinCode["level"],
    lwin7,
    vintage: null,
    vintagePlaceholder: false,
    packSize: null,
    bottleMl: null,
  };
  if (c.length === 7) return base;
  const v = c.slice(7, 11);
  if (v === LWIN_VINTAGE_PLACEHOLDER) base.vintagePlaceholder = true;
  else {
    const year = Number(v);
    if (year < 1800 || year > 2100) return null;
    base.vintage = year;
  }
  if (c.length === 11) return base;
  const size = Number(c.slice(-5));
  if (size < 50 || size > 30000) return null;
  base.bottleMl = size;
  if (c.length === 18) {
    const pack = Number(c.slice(11, 13));
    if (pack < 1) return null;
    base.packSize = pack;
  }
  return base;
}
