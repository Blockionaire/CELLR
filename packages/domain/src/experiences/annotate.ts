import { normalizeText, type CellarItem } from "../cellar";
import type { InsightOutput } from "../insights";
import { WINE_KNOWLEDGE } from "../pairing-engine/knowledge";
import {
  mentionedWines,
  readWine,
  type WineProfileFacts,
  type WineReading,
} from "../pairing-engine/wine";
import type { ChatMessage } from "../sommelier";
import {
  ANNOTATIONS_MAX,
  drinkAnnotation,
  isLabelGenericWord,
  labelNameWords,
  reservedAnnotation,
  whereAnnotation,
  type BottleAnnotation,
} from "../sommelier-annotate";
import { askedFor } from "../sommelier-route";
import { servingAdvice } from "./serving";

/**
 * THE FACTS ON V1'S CARDS, computed (Sommelier V1+ part `annotate`, P4; server-only, it reads the wine knowledge).
 * Nothing here is the model's: the drinking window is the one the app already shows, the serving advice is the
 * reviewed rule for the wine's style (or its own researched profile when that is fact about this exact wine), the
 * reservations and places are the cellar's. Where too little is known, less is said: a wine known only by its colour
 * gets a temperature for that colour and no decanting claim, and a fortified wine known only as "fortified" gets
 * nothing (a fino and a vintage port are served ten degrees apart).
 *
 * What it cannot see (known limits):
 *  - the serving rules are rules of thumb per style, not measurements of the bottle; the screen words them so;
 *  - the age of a non-vintage wine is not known, so no rule about age (air, sediment) is applied to it;
 *  - `servingFactsBlock` recognises a wine by its producer or name words, or by an appellation, region or grape
 *    the knowledge knows. A nickname ("the Musar" works; "dad's bottle" does not) or a misspelling is not seen.
 */

/** A profile counts as fact about the exact wine only on the terms shared profiles are held to (D-16). */
function profileFactsOf(output: InsightOutput | undefined): WineProfileFacts | null {
  // The same rule as `profileFacts` in apps/web/src/server/sommelier/intelligence.ts; a change there belongs here.
  if (!output) return null;
  return {
    structure: output.structure,
    grapes: output.grapes,
    exact:
      output.researched &&
      output.evidence === "exact_wine" &&
      output.confidence === "high" &&
      output.sources.length > 0,
    evidence: output.evidence,
  };
}

function readItem(item: CellarItem, profile: InsightOutput | undefined): WineReading {
  return readWine(
    {
      type: item.type,
      name: item.wineName,
      region: item.region,
      appellation: item.appellation ?? null,
      countryCode: item.countryCode,
      profile: profileFactsOf(profile),
    },
    WINE_KNOWLEDGE,
  );
}

/** How to serve it, or null when too little is known to say anything true. */
function servingOf(
  item: CellarItem,
  reading: WineReading,
  profile: InsightOutput | undefined,
  thisYear: number,
): BottleAnnotation["serving"] {
  // A fortified wine of unknown style could be a fino (cold) or a vintage port (cellar-warm): no default is true.
  if (reading.colourOnly && item.type === "fortified") return null;
  // The wine's own profile wins over the rule only when it is fact about this exact wine.
  const facts = profileFactsOf(profile);
  const stated =
    profile && facts?.exact
      ? { serving: profile.serving, decantMinutes: profile.decantMinutes }
      : null;
  const year = item.year !== null && item.year >= 1800 && item.year <= thisYear ? item.year : null;
  const advice = servingAdvice(
    { type: item.type, structure: reading.structure, tier: reading.tier, year, profile: stated },
    thisYear,
  );
  if (reading.colourOnly)
    // Known by its colour only: a temperature for that colour is a fair rule of thumb, a decanting time is not.
    return {
      tempC: advice.tempC,
      fridgeMinutes: Math.min(240, advice.fridgeMinutes),
      decant: null,
      glass: advice.glass,
      basis: "style",
      tier: reading.tier,
    };
  return {
    tempC: advice.tempC,
    fridgeMinutes: Math.min(240, advice.fridgeMinutes),
    decant: { kind: advice.decant.kind, minutes: Math.min(240, advice.decant.minutes) },
    glass: advice.glass,
    basis: advice.basis,
    tier: advice.tier,
  };
}

function annotate(
  item: CellarItem,
  profile: InsightOutput | undefined,
  thisYear: number,
): { annotation: BottleAnnotation; reading: WineReading } {
  const reading = readItem(item, profile);
  return {
    reading,
    annotation: {
      vintageId: item.vintageId,
      drink: drinkAnnotation(item.drink),
      serving: servingOf(item, reading, profile, thisYear),
      reserved: reservedAnnotation(item),
      where: whereAnnotation(item),
    },
  };
}

/** One annotation per card, in card order (at most eight). */
export function annotateBottles(
  items: readonly CellarItem[],
  ctx: { profiles: ReadonlyMap<string, InsightOutput>; now: Date },
): BottleAnnotation[] {
  const thisYear = ctx.now.getUTCFullYear();
  return items
    .slice(0, ANNOTATIONS_MAX)
    .map((item) => annotate(item, ctx.profiles.get(item.vintageId), thisYear).annotation);
}

// ---- Which cellar wines a text is about -----------------------------------------------------------------------

/**
 * A cheap first look, before the exact one: a pattern that finds a normalised word in raw, lower-cased label text
 * whatever accents the label writes it with ("rotie" in "côte-rôtie"). It may find too much (a word inside another
 * word); it never finds too little, so the exact check after it decides. A label with letters the pattern does not
 * fold (ß, æ, œ, combining accents …) always goes on to the exact check.
 */
const FOLDS: Record<string, string> = {
  a: "aàáâãäåāăą",
  c: "cçćčĉ",
  d: "dď",
  e: "eèéêëēĕėęě",
  g: "gğĝ",
  i: "iìíîïīĭį",
  l: "lĺľ",
  n: "nñńňņ",
  o: "oòóôõöøōŏő",
  r: "rŕř",
  s: "sśšşŝș",
  t: "tťţț",
  u: "uùúûüūŭůűų",
  y: "yýÿ",
  z: "zźżž",
};
// Letters folded otherwise, and combining accents (a label stored decomposed: "e" then "\u0301").
const UNFOLDED = /[ßæœđðłþħı]|\p{M}/u;
function looseFinder(words: readonly string[]): RegExp | null {
  if (words.length === 0) return null;
  const loose = (w: string) =>
    [...w].map((ch) => (FOLDS[ch] ? `[${FOLDS[ch]}]` : ch.replace(/[^a-z0-9]/g, ""))).join("");
  return new RegExp([...new Set(words)].map(loose).join("|"));
}
const mayContain = (finder: RegExp, raw: string) => {
  const lower = raw.toLowerCase();
  return finder.test(lower) || UNFOLDED.test(lower);
};

/**
 * The cellar wines a text names: by a word of the producer or the wine's name ("the Musar", "my Vajra"), else by an
 * appellation, region or grape the knowledge knows and the wine is read as ("the Barolo"). A year in the text
 * narrows to that vintage when one fits. Too many fits (more than `max`) is not an answer: none.
 *
 * Fast on a large cellar: no wine is read with the knowledge before the text is known to name one. The names are
 * looked for first (a cheap pattern, then the exact word check, on the few that pass). Only when no name fits are
 * wines read, and only those whose label could make the knowledge read them as what was named.
 */
function namedIn(
  text: string,
  items: readonly CellarItem[],
  readingOf: (item: CellarItem) => WineReading,
  grapesOf: (item: CellarItem) => readonly string[],
  max: number,
): CellarItem[] {
  const said = normalizeText(text.slice(0, 800));
  if (said === "") return [];
  const tokens = new Set(said.split(" "));
  const wanted = [...tokens].filter(
    (w) => w.length >= 4 && !isLabelGenericWord(w) && !/^\d+$/.test(w),
  );
  const finder = looseFinder(wanted);
  let found = finder
    ? items.filter(
        (i) =>
          mayContain(finder, `${i.producer} ${i.wineName}`) &&
          labelNameWords(`${i.producer} ${i.wineName}`).some((w) => tokens.has(w)),
      )
    : [];
  if (found.length === 0) {
    const keys = mentionedWines(text, WINE_KNOWLEDGE).map((m) => m.id);
    if (keys.length === 0) return [];
    // A wine can only be read as a key when its label (or its profile's grapes) carries the name of a rule that
    // gives that key: only those wines are read. The same wines as reading them all, without reading them all.
    const giving = WINE_KNOWLEDGE.rules.filter(
      (r) => keys.includes(r.id) || r.keys.some((k) => keys.includes(k)),
    );
    const labels = looseFinder(
      giving.flatMap((r) =>
        r.names.flatMap((name) => {
          const parts = name.split(" ");
          const long = parts.filter((w) => w.length >= 3);
          return long.length > 0 ? long : parts;
        }),
      ),
    );
    found = labels
      ? items.filter(
          (i) =>
            mayContain(
              labels,
              `${i.appellation ?? ""} ${i.region ?? ""} ${i.wineName} ${i.producer} ${grapesOf(i).join(" ")}`,
            ) && keys.some((k) => readingOf(i).keys.includes(k)),
        )
      : [];
  }
  const year = /\b(1[89]\d\d|20\d\d)\b/.exec(text);
  if (year) {
    const that = found.filter((i) => i.year === Number(year[1]));
    if (that.length > 0) found = that;
  }
  return found.length > max ? [] : found;
}

// ---- The block the model is shown ------------------------------------------------------------------------------

/** At most this many wines in one block. */
const FACTS_WINES_MAX = 3;

const TEXT_MAX = 1400;
const label = (value: string) => value.replace(/["\n\r|]/g, " ").slice(0, 80);

const DECANT_TEXT = {
  no: "no need to decant",
  air: (m: number) => `decant about ${m} minutes before serving (air)`,
  // The age says there will be sediment; whether the wine also wants air is a question about this wine.
  sediment:
    "decant it gently off its sediment shortly before serving; whether it also wants air depends on the wine",
  optional: (m: number) => `a carafe for about ${m} minutes is optional`,
} as const;

/** How the model may use a fact: as written (about this very wine), or as the app's rule of thumb. */
const AS_WRITTEN = "[as written]";
const RULE = "[rule of thumb]";

function servingText(s: NonNullable<BottleAnnotation["serving"]>): string {
  const temp =
    s.tempC.min === s.tempC.max ? `${s.tempC.min} °C` : `${s.tempC.min}–${s.tempC.max} °C`;
  const decant =
    s.decant === null
      ? "nothing known about decanting it"
      : s.decant.kind === "air" || s.decant.kind === "optional"
        ? DECANT_TEXT[s.decant.kind](s.decant.minutes)
        : DECANT_TEXT[s.decant.kind];
  const fridge =
    s.fridgeMinutes > 0
      ? `, about ${s.fridgeMinutes} minutes in a fridge from room temperature`
      : "";
  const basis = s.basis === "profile" ? `from this wine's researched profile ${AS_WRITTEN}` : RULE;
  return `serve at ${temp}${fridge}; ${decant}; glass: ${s.glass.replace(/-/g, " ")} ${basis}`;
}

const PHASE_TEXT: Record<BottleAnnotation["drink"]["advice"], string> = {
  "drink-now": "in its window now",
  "drink-soon": "late in its window: drink it soon",
  keep: "still young: it can be kept",
  "past-window": "past its window",
  unknown: "not known to the app: say so, and give no years as fact",
};
const BASIS_TEXT: Record<BottleAnnotation["drink"]["basis"], string> = {
  own: `the window the household set itself ${AS_WRITTEN}`,
  profile: `an estimate from this wine's researched profile ${AS_WRITTEN}`,
  style: `an estimate for wines like this ${RULE}`,
};

function drinkText(d: BottleAnnotation["drink"]): string {
  if (d.advice === "unknown") return `drinking window: ${PHASE_TEXT.unknown}`;
  const years =
    d.from !== null && d.until !== null
      ? `${d.from}–${d.until}`
      : d.until !== null
        ? `until ${d.until}`
        : d.from !== null
          ? `from ${d.from}`
          : "no years known";
  const phase =
    d.advice === "keep" && d.phase === "developing"
      ? "open now or keep: it will still improve"
      : PHASE_TEXT[d.advice];
  return `drinking window ${years}, ${phase}, ${BASIS_TEXT[d.basis]}`;
}

/**
 * For a question that asks how to serve or how long to keep (askedFor: "serving" | "keeping"): the facts of the
 * wines it is about (named in the question, else in the sommelier's last message), as a block the model must
 * state as written. Null when the question is not such a question or names no cellar wine. At most 3 wines.
 */
export function servingFactsBlock(
  messages: readonly ChatMessage[],
  items: readonly CellarItem[],
  refOf: (vintageId: string) => string | null,
  ctx: { profiles: ReadonlyMap<string, InsightOutput>; now: Date },
): { text: string; vintageIds: string[] } | null {
  const last = messages.at(-1);
  if (!last || last.role !== "user" || items.length === 0) return null;
  const kind = askedFor(last.text);
  if (kind !== "serving" && kind !== "keeping") return null;
  const thisYear = ctx.now.getUTCFullYear();
  // Wines are read with the knowledge only when needed, each at most once.
  const readings = new Map<string, WineReading>();
  const readingOf = (item: CellarItem) => {
    let reading = readings.get(item.vintageId);
    if (!reading) {
      reading = readItem(item, ctx.profiles.get(item.vintageId));
      readings.set(item.vintageId, reading);
    }
    return reading;
  };
  const grapesOf = (item: CellarItem) => ctx.profiles.get(item.vintageId)?.grapes ?? [];
  let wines = namedIn(last.text, items, readingOf, grapesOf, FACTS_WINES_MAX);
  if (wines.length === 0) {
    // "How should I serve it?" right after the sommelier named a wine: that wine.
    const before = messages.slice(0, -1).findLast((m) => m.role === "assistant");
    if (before) wines = namedIn(before.text, items, readingOf, grapesOf, FACTS_WINES_MAX);
  }
  if (wines.length === 0) return null;
  const annotations = wines.map(
    (item) => annotate(item, ctx.profiles.get(item.vintageId), thisYear).annotation,
  );
  const lines = wines.map((item, n) => {
    const annotation = annotations[n]!;
    const serving =
      annotation.serving === null
        ? "serving: too little is known about this wine to give a temperature or a decanting time: say so"
        : servingText(annotation.serving);
    const facts =
      kind === "keeping"
        ? [drinkText(annotation.drink), serving]
        : [serving, drinkText(annotation.drink)];
    const name = `${label(item.producer)} — ${label(item.wineName)} | ${item.year ?? "NV"}`;
    return `- ${refOf(item.vintageId) ?? "(not in the list)"} | ${name}: ${facts.join("; ")}.`;
  });
  const said = lines.join("\n");
  // A fact about this very wine is stated as written. A rule of thumb leaves room for what the model knows of the
  // wine, in words; the numbers stay the app's (they lead: sommelier-serving-claims.ts removes any that differ).
  const text = [
    "Serving facts (worked out by the app from the cellar and its serving and drinking-window tables):",
    ...(said.includes(AS_WRITTEN)
      ? [
          `Facts marked ${AS_WRITTEN} are about this very wine (the household's own window, or its researched profile): state them as written, and give no other temperature, decanting time or drinking years for it.`,
        ]
      : []),
    ...(said.includes(RULE)
      ? [
          `Facts marked ${RULE} are the app's rules for wines like this, not known for this bottle: give them as such ("about", "as a rule"). You may add what you know about this wine in words, but state no other temperature, decanting time or drinking years than these: the app shows them under the wine and leaves out any that differ.`,
        ]
      : []),
    ...lines,
  ]
    .join("\n")
    .slice(0, TEXT_MAX);
  return { text, vintageIds: wines.map((w) => w.vintageId) };
}
