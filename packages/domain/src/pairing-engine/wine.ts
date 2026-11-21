import { normalizeText, type WineType } from "../cellar";

/**
 * WHAT A WINE IS LIKE AT TABLE, and how sure we are. A wine's structure comes from the best evidence there is:
 * a researched profile of the exact wine, else the rules of its appellation, else its grape and region, else its
 * colour. The tier of that evidence travels with the structure, so an answer can never present a regional guess
 * as a fact about the bottle.
 *
 * Deterministic and without I/O. The knowledge (appellations, regions, grapes) is typed data in ./knowledge.
 */

/** Everything on a 0–5 scale unless said otherwise. Judgements on a coarse scale, not measurements. */
export interface WineStructure {
  /** 1 light … 5 full. */
  body: number;
  /** 0 none … 5 very firm. */
  tannin: number;
  /** 1 soft … 5 very fresh. */
  acidity: number;
  /** 0 bone dry, 1 dry, 2 off-dry, 3 medium sweet, 4 sweet, 5 luscious. */
  sweetness: number;
  /** How strongly it smells and tastes: 1 neutral … 5 very aromatic or concentrated. */
  intensity: number;
  /** New-oak character: 0 none … 3 marked. */
  oak: number;
  /** 1 low (under about 11.5%), 2 moderate, 3 high (14% and up), 4 fortified. */
  alcohol: number;
  fizz: boolean;
}

/** What a structure rests on, strongest first. */
export const EVIDENCE_TIERS = ["exact", "appellation", "estimate", "unknown"] as const;
export type EvidenceTier = (typeof EVIDENCE_TIERS)[number];

/**
 * A rule of thumb about a kind of wine: wines of this appellation, region or grape, in this colour, are usually
 * like this. `names` are matched as whole words against the normalised text of the field the rule is about.
 */
export interface WineStyleRule {
  id: string;
  kind: "appellation" | "region" | "grape";
  /** How it is written, lower case without accents ("cotes du rhone", "gruner veltliner"). */
  names: readonly string[];
  /** The colour this rule describes. A place that makes two colours has two rules. */
  type: WineType;
  /** Where the place is, when the name alone could mean another country's wine. */
  country?: string;
  s: Partial<WineStructure>;
  /** Names a dish may call this wine by when it lists its classics ("loire", "sauvignon blanc", "chablis"). */
  keys: readonly string[];
}

export interface WineKnowledge {
  rules: readonly WineStyleRule[];
}

/** The part of a researched profile that matters here (see insights.ts). */
export interface WineProfileFacts {
  structure: {
    body: number | null;
    tannin: number | null;
    sweetness: number | null;
    acidity: number | null;
  } | null;
  grapes: readonly string[];
  /** True only for a profile that passes the bar for facts about the exact wine (`shareableInsight`'s rule). */
  exact: boolean;
  /** The profile's own evidence when it is not exact. */
  evidence: "exact_wine" | "producer" | "appellation_rules" | "style_estimate" | null;
}

export interface WineInput {
  type: WineType;
  name: string | null;
  region: string | null;
  appellation: string | null;
  countryCode: string | null;
  profile?: WineProfileFacts | null;
}

export interface WineReading {
  structure: WineStructure;
  tier: EvidenceTier;
  /**
   * True when part of the structure was read from the wine's name because its origin is not recorded. The tier
   * does not rise for it: a name is a hint, not a record.
   */
  fromName: boolean;
  /** True when nothing but the colour was known. */
  colourOnly: boolean;
  /** What this wine answers to in a dish's list of classics: its colour, and the keys of every rule that matched. */
  keys: string[];
  /** The rules that shaped the structure, weakest first. */
  rules: string[];
}

const BASE: Record<WineType, WineStructure> = {
  red: {
    body: 3.5,
    tannin: 3.2,
    acidity: 3.2,
    sweetness: 0.5,
    intensity: 3,
    oak: 1,
    alcohol: 2.5,
    fizz: false,
  },
  white: {
    body: 2.5,
    tannin: 0,
    acidity: 3.7,
    sweetness: 0.5,
    intensity: 2.5,
    oak: 0.5,
    alcohol: 2,
    fizz: false,
  },
  rose: {
    body: 2,
    tannin: 0.5,
    acidity: 3.7,
    sweetness: 0.5,
    intensity: 2,
    oak: 0,
    alcohol: 2,
    fizz: false,
  },
  sparkling: {
    body: 2,
    tannin: 0,
    acidity: 4.3,
    sweetness: 0.8,
    intensity: 2.5,
    oak: 0,
    alcohol: 2,
    fizz: true,
  },
  dessert: {
    body: 4,
    tannin: 0,
    acidity: 3.5,
    sweetness: 4.5,
    intensity: 4,
    oak: 0.5,
    alcohol: 2,
    fizz: false,
  },
  fortified: {
    body: 4.5,
    tannin: 2,
    acidity: 3,
    sweetness: 3.5,
    intensity: 4.5,
    oak: 1,
    alcohol: 4,
    fizz: false,
  },
  orange: {
    body: 3,
    tannin: 2.2,
    acidity: 3.5,
    sweetness: 0,
    intensity: 3.5,
    oak: 0,
    alcohol: 2,
    fizz: false,
  },
};

const AXES = ["body", "tannin", "acidity", "sweetness", "intensity", "oak", "alcohol"] as const;
const LIMITS: Record<(typeof AXES)[number], readonly [number, number]> = {
  body: [1, 5],
  tannin: [0, 5],
  acidity: [1, 5],
  sweetness: [0, 5],
  intensity: [1, 5],
  oak: [0, 3],
  alcohol: [1, 4],
};
const clamp = (n: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, n));

/** How many of the four scales a profile must state before a reading counts as knowledge of the exact wine. */
export const EXACT_MIN_AXES = 3;

/** A profile states sweetness as 1 (dry) to 5 (sweet); the engine counts from 0 (bone dry). */
const PROFILE_SWEETNESS = [0, 0.5, 2, 3, 4, 5] as const;
/** A profile states tannin as 1 (low) to 5; a white with "1" has none to speak of. */
const PROFILE_TANNIN = [0, 0.5, 1.8, 3, 4, 5] as const;

const words = (text: string | null | undefined) => {
  const n = normalizeText(text ?? "");
  return n === "" ? "" : ` ${n} `;
};
const mentions = (text: string, rule: WineStyleRule) =>
  text !== "" && rule.names.some((name) => text.includes(` ${name} `));

interface Index {
  appellation: WineStyleRule[];
  region: WineStyleRule[];
  grape: WineStyleRule[];
  grapeIds: ReadonlySet<string>;
  regionIds: ReadonlySet<string>;
}
const INDEX = new WeakMap<WineKnowledge, Index>();
function indexOf(k: WineKnowledge): Index {
  let index = INDEX.get(k);
  if (!index) {
    const of = (kind: WineStyleRule["kind"]) => k.rules.filter((r) => r.kind === kind);
    const grape = of("grape");
    index = {
      appellation: of("appellation"),
      region: of("region"),
      grape,
      grapeIds: new Set(grape.map((r) => r.id)),
      regionIds: new Set(of("region").map((r) => r.id)),
    };
    INDEX.set(k, index);
  }
  return index;
}

/**
 * The rule of a kind, for this colour, whose name the text mentions (and whose country does not contradict). The
 * longest name mentioned wins, so "pouilly fuisse" beats "pouilly" and "cabernet franc" beats "cabernet" even when
 * the shorter name belongs to a rule that also has longer ones. On a tie the earlier rule wins.
 */
function find(
  rules: readonly WineStyleRule[],
  text: string,
  wine: Pick<WineInput, "type" | "countryCode">,
): WineStyleRule | null {
  if (text === "") return null;
  let best: WineStyleRule | null = null;
  let bestLength = 0;
  for (const rule of rules) {
    if (rule.type !== wine.type) continue;
    if (rule.country && wine.countryCode && rule.country !== wine.countryCode) continue;
    for (const name of rule.names) {
      if (name.length > bestLength && text.includes(` ${name} `)) {
        best = rule;
        bestLength = name.length;
      }
    }
  }
  return best;
}

/**
 * The wines a text names: every appellation, region and grape rule it mentions, the longest names first ("a Rioja
 * Reserva for my father who loves Bordeaux" → rioja reserva, bordeaux). `id` is the rule (what a wine answers
 * to); `name` is the word as it was written, which is what a shop would be asked for. For reading what someone
 * asks for; it says nothing about any bottle.
 */
export function mentionedWines(
  text: string,
  k: WineKnowledge,
  limit = 6,
): Array<{ id: string; name: string }> {
  const haystack = words(text.slice(0, 800));
  if (haystack === "") return [];
  const hits = new Map<string, string>();
  for (const rule of k.rules)
    for (const name of rule.names)
      if (name.length >= 4 && haystack.includes(` ${name} `)) {
        const known = hits.get(rule.id);
        if (known === undefined || name.length > known.length) hits.set(rule.id, name);
      }
  return [...hits.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([id, name]) => ({ id, name }));
}

/** The ids of `mentionedWines`. */
export const mentionedWineKeys = (text: string, k: WineKnowledge, limit = 6): string[] =>
  mentionedWines(text, k, limit).map((w) => w.id);

/** Sparkling, sweet and fortified wines are named by what they are, not by the grape they are made of. */
const NOT_BY_GRAPE: ReadonlySet<WineType> = new Set<WineType>([
  "sparkling",
  "dessert",
  "fortified",
]);

/**
 * What a wine answers to in a dish's list of classics: its colour, the rules that matched and what those stand
 * for. A Champagne is made of chardonnay and a Sauternes comes from Bordeaux, but "classic with chardonnay" and
 * "classic with Bordeaux" mean the still, dry wines. So a sparkling, sweet or fortified wine does not answer to
 * the grapes and the wider region behind its place; what its own label names (its appellation, a grape) stays.
 */
function keysOf(type: WineType, applied: readonly WineStyleRule[], index: Index): string[] {
  const special = NOT_BY_GRAPE.has(type);
  const named = applied.some((r) => r.kind === "grape");
  const keys = new Set<string>([type]);
  for (const rule of applied) {
    if (!(special && rule.kind === "region")) keys.add(rule.id);
    for (const key of rule.keys) {
      // The grapes of a place: a region grows too many to answer to all of them, and a grape named on the
      // label settles which one this wine is.
      if (
        index.grapeIds.has(key) &&
        rule.kind !== "grape" &&
        (special || named || rule.kind === "region")
      )
        continue;
      if (special && rule.kind !== "grape" && index.regionIds.has(key)) continue;
      keys.add(key);
    }
  }
  return [...keys];
}

/**
 * Reads a wine. The structure starts from its colour and is refined by every rule that applies, weakest first:
 * region, grape, appellation, and at last the researched profile. The tier is the strongest *recorded* evidence:
 * - "exact": a profile that qualifies as fact about this exact wine;
 * - "appellation": its recorded appellation (or a region recorded with the precision of one) has a rule, or a
 *   profile rests on the producer's or the appellation's rules;
 * - "estimate": only its region, country or grape is known;
 * - "unknown": no origin is recorded. Its name may still shape the guess (`fromName`), but the tier stays here.
 */
export function readWine(input: WineInput, k: WineKnowledge): WineReading {
  // Country codes are compared as written in the knowledge (upper case), however the caller spells them.
  const wine: WineInput = {
    ...input,
    countryCode: input.countryCode?.trim().toUpperCase() || null,
  };
  const index = indexOf(k);
  const recorded = words(`${wine.appellation ?? ""} ${wine.region ?? ""}`);
  const name = words(wine.name);
  const profile = wine.profile ?? null;
  const grapeText = words(profile?.grapes.join(" , "));

  const applied: WineStyleRule[] = [];
  let tier: EvidenceTier = wine.countryCode || recorded !== "" ? "estimate" : "unknown";
  let fromName = false;

  const region = find(index.region, recorded, wine);
  const regionByName = region ? null : find(index.region, name, wine);
  if (region ?? regionByName) applied.push((region ?? regionByName)!);

  const grape = find(index.grape, grapeText, wine) ?? find(index.grape, name, wine);
  if (grape) applied.push(grape);

  // A recorded appellation comes first. A label word in the name that the record does not already say (a
  // "Kabinett" on a recorded Mosel, a "Fino" on a recorded Jerez, a "Gran Reserva" on a recorded Rioja) is more
  // specific about the bottle, so it applies on top, unless it belongs to another country than the recorded one
  // (the "Toro" in "Concha y Toro" says nothing about a Maipo wine). It does not raise the tier.
  // The appellation field is asked first and alone: with "Pauillac" there and "Bordeaux" as the region, the
  // wine is a Pauillac, not a generic Bordeaux. Only when it says nothing is the region read as an appellation.
  const appellation =
    find(index.appellation, words(wine.appellation), wine) ??
    find(index.appellation, words(wine.region), wine);
  const appellationByName = find(index.appellation, name, wine);
  if (appellation) applied.push(appellation);
  const refines =
    appellationByName !== null &&
    appellationByName !== appellation &&
    !mentions(recorded, appellationByName) &&
    (!appellation?.country ||
      !appellationByName.country ||
      appellation.country === appellationByName.country);
  if (refines) applied.push(appellationByName);
  if (appellation) tier = "appellation";
  if (!appellation && !region && (appellationByName || regionByName || (grape && grapeText === "")))
    fromName = true;

  const structure: WineStructure = { ...BASE[wine.type] };
  for (const rule of applied) {
    for (const axis of AXES) if (rule.s[axis] !== undefined) structure[axis] = rule.s[axis];
    if (rule.s.fizz !== undefined) structure.fizz = rule.s.fizz;
  }

  // A researched profile. Only facts about the exact wine may overrule what its appellation says, and a reading
  // is only "exact" when the profile states most of the structure: one stated number beside three defaults is
  // not knowledge of the wine. What a profile says about its own evidence never raises the tier; only what is
  // recorded about the wine does. A weaker profile is used where nothing else is known, as the estimate it is.
  const stated = profile?.structure ?? null;
  const axes = stated === null ? 0 : Object.values(stated).filter((v) => v !== null).length;
  const exact = profile?.exact === true && axes > 0;
  const profiled = stated !== null && axes > 0 && (exact || applied.length === 0);
  if (stated && profiled) {
    if (stated.body !== null) structure.body = stated.body;
    if (stated.acidity !== null) structure.acidity = stated.acidity;
    if (stated.sweetness !== null) structure.sweetness = PROFILE_SWEETNESS[stated.sweetness] ?? 0;
    if (stated.tannin !== null) structure.tannin = PROFILE_TANNIN[stated.tannin] ?? 0;
    if (exact && axes >= EXACT_MIN_AXES) tier = "exact";
  }
  for (const axis of AXES) structure[axis] = clamp(structure[axis], LIMITS[axis]);

  return {
    structure,
    tier,
    fromName,
    colourOnly: applied.length === 0 && !profiled,
    keys: keysOf(wine.type, applied, index),
    rules: applied.map((r) => r.id),
  };
}
