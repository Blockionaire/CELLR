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

/** Words on many labels that do not pick out one wine. */
const GENERIC = new Set(
  normalizeText(
    "chateau domaine domaines bodega bodegas cantina cantine tenuta weingut quinta clos mas cave caves maison " +
      "cuvee cuvees reserve reserva riserva gran grand grande grands premier cru crus classe classico superiore " +
      "blanc blanche rouge rose rosso bianco tinto blanco brut extra vieilles vignes vigne estate winery wines " +
      "wine cellars vineyards vineyard family selection selected special collection les des del della di de du la le " +
      "the and van von und old vintage red white sparkling dessert fortified orange sweet dry " +
      // The words of the questions themselves: "how long" is not the producer Long Shadows.
      "long keep kept store serve served serving should would could what which when where ready still cold " +
      "warm cool chill chilled decant decanted decanting carafe glass glasses breathe temperature bottle bottles " +
      "drink open opened lang bewaren bewaar serveer serveren schenk schenken koud koel koelen warm decanteren " +
      "decanteer karaf glas glazen temperatuur ademen dronk drinken wanneer welke welk fles flessen nog moet " +
      "kunnen this that with your have mijn onze deze from them they these those",
  ).split(" "),
);

/** The words of a label that can name it: long enough, and not on every other label. */
const nameWords = (text: string) =>
  normalizeText(text)
    .split(" ")
    .filter((w) => w.length >= 4 && !GENERIC.has(w) && !/^\d+$/.test(w));

/**
 * The cellar wines a text names: by a word of the producer or the wine's name ("the Musar", "my Vajra"), else by an
 * appellation, region or grape the knowledge knows and the wine is read as ("the Barolo"). A year in the text
 * narrows to that vintage when one fits. Too many fits (more than `max`) is not an answer: none.
 */
function namedIn(
  text: string,
  read: ReadonlyArray<{ item: CellarItem; reading: WineReading }>,
  max: number,
): CellarItem[] {
  const words = ` ${normalizeText(text.slice(0, 800))} `;
  if (words.trim() === "") return [];
  const byName = read.filter((r) =>
    nameWords(`${r.item.producer} ${r.item.wineName}`).some((w) => words.includes(` ${w} `)),
  );
  const keys = mentionedWines(text, WINE_KNOWLEDGE).map((w) => w.id);
  const byKind =
    byName.length > 0 || keys.length === 0
      ? []
      : read.filter((r) => keys.some((k) => r.reading.keys.includes(k)));
  let found = (byName.length > 0 ? byName : byKind).map((r) => r.item);
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
  sediment:
    "do not air it: stand it upright and pour it gently off its sediment just before serving",
  optional: (m: number) => `a carafe for about ${m} minutes is optional`,
} as const;

function servingText(s: NonNullable<BottleAnnotation["serving"]>): string {
  const temp =
    s.tempC.min === s.tempC.max ? `${s.tempC.min} °C` : `${s.tempC.min}–${s.tempC.max} °C`;
  const decant =
    s.decant === null
      ? "say nothing about decanting (too little is known about this wine)"
      : s.decant.kind === "air" || s.decant.kind === "optional"
        ? DECANT_TEXT[s.decant.kind](s.decant.minutes)
        : DECANT_TEXT[s.decant.kind];
  const fridge =
    s.fridgeMinutes > 0
      ? `, about ${s.fridgeMinutes} minutes in a fridge from room temperature`
      : "";
  const basis =
    s.basis === "profile"
      ? "from what is known about this exact wine"
      : 'a rule of thumb for wines like this, not known for this bottle: say "about"';
  return `serve at ${temp}${fridge}; ${decant}; glass: ${s.glass.replace(/-/g, " ")} (${basis})`;
}

const PHASE_TEXT: Record<BottleAnnotation["drink"]["advice"], string> = {
  "drink-now": "in its window now",
  "drink-soon": "late in its window: drink it soon",
  keep: "still young: it can be kept",
  "past-window": "past its window",
  unknown: "too little is known to say when to drink it: say so, give no years",
};
const BASIS_TEXT: Record<BottleAnnotation["drink"]["basis"], string> = {
  own: "the window the household set itself",
  profile: "an estimate from this wine's profile, not a promise",
  style: "an estimate for wines like this, not known for this bottle",
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
  return `drinking window ${years}, ${phase} (${BASIS_TEXT[d.basis]})`;
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
  const read = items.map((item) => ({
    item,
    ...annotate(item, ctx.profiles.get(item.vintageId), thisYear),
  }));
  let wines = namedIn(last.text, read, FACTS_WINES_MAX);
  if (wines.length === 0) {
    // "How should I serve it?" right after the sommelier named a wine: that wine.
    const before = messages.slice(0, -1).findLast((m) => m.role === "assistant");
    if (before) wines = namedIn(before.text, read, FACTS_WINES_MAX);
  }
  if (wines.length === 0) return null;
  const lines = wines.map((item) => {
    const { annotation } = read.find((r) => r.item.vintageId === item.vintageId)!;
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
  const text = [
    `Serving facts (worked out by the app from the cellar and its serving and drinking-window tables; state them as written, keep "about" and "estimate" where they are, and give no other temperature, decanting time or drinking years for these wines):`,
    ...lines,
  ]
    .join("\n")
    .slice(0, TEXT_MAX);
  return { text, vintageIds: wines.map((w) => w.vintageId) };
}
