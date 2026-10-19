import { normalizeText, type WineType } from "./cellar";

/**
 * WHEN TO DRINK IT — an estimate, not an oracle. A wine's window comes from where it is from (the style
 * of the region), what it is (colour, quality words on the label) and what was paid for it; the
 * ideas (and the numbers) are carried over from the old Wijnkelder app. Whatever this says, a window
 * a person sets themselves must always win — nothing here pretends to know better.
 */

export const WINE_STYLES = [
  "bordeaux",
  "burgundy",
  "champagne",
  "rhone-north",
  "rhone-south",
  "loire",
  "alsace",
  "beaujolais",
  "languedoc",
  "provence",
  "southwest",
  "jura",
  "piedmont",
  "tuscany",
  "veneto",
  "italy-white",
  "italy-south",
  "rioja",
  "ribera",
  "priorat",
  "spain-white",
  "spain-red",
  "cava",
  "sherry",
  "port",
  "portugal",
  "riesling",
  "austria",
  "greece",
  "tokaji",
  "switzerland",
  "england-sparkling",
  "california",
  "argentina",
  "chile",
  "australia",
  "new-zealand",
  "south-africa",
  "lebanon",
  "standard",
] as const;
export type WineStyle = (typeof WINE_STYLES)[number];

/** [first good year, last good year], counted in years AFTER the harvest. */
type Span = readonly [from: number, until: number];

const SPANS: Record<WineStyle, Partial<Record<WineType, Span>>> = {
  bordeaux: { red: [3, 10], white: [1, 5], dessert: [4, 25], rose: [0, 2], sparkling: [0, 3] },
  burgundy: { red: [2, 8], white: [1, 7], dessert: [3, 12], rose: [0, 2], sparkling: [1, 5] },
  champagne: { sparkling: [1, 7], white: [1, 6], rose: [1, 6], red: [2, 6] },
  "rhone-north": { red: [3, 12], white: [1, 6], rose: [0, 2] },
  "rhone-south": { red: [2, 9], white: [1, 4], rose: [0, 2] },
  loire: { red: [2, 7], white: [1, 8], dessert: [4, 20], sparkling: [1, 4], rose: [0, 2] },
  alsace: { white: [2, 8], red: [1, 5], dessert: [4, 20], sparkling: [1, 4], rose: [0, 2] },
  beaujolais: { red: [1, 5], white: [1, 3], rose: [0, 2] },
  languedoc: { red: [2, 7], white: [1, 3], rose: [0, 2], fortified: [3, 20] },
  provence: { rose: [0, 3], red: [2, 10], white: [1, 4] },
  southwest: { red: [2, 10], white: [1, 5], dessert: [4, 18] },
  jura: { white: [2, 12], red: [2, 7], sparkling: [1, 4] },
  piedmont: { red: [4, 14], white: [1, 4], sparkling: [0, 2], dessert: [0, 3] },
  tuscany: { red: [2, 11], white: [1, 3], rose: [0, 2] },
  veneto: { red: [2, 10], white: [1, 5], sparkling: [0, 3], dessert: [4, 18], rose: [0, 2] },
  "italy-white": { white: [1, 5], red: [2, 7], sparkling: [1, 4], orange: [2, 8] },
  "italy-south": { red: [2, 8], white: [1, 4], dessert: [3, 14], rose: [0, 2], fortified: [3, 20] },
  rioja: { red: [2, 11], white: [2, 8], rose: [0, 2] },
  ribera: { red: [3, 13], white: [1, 4], rose: [0, 2] },
  priorat: { red: [3, 13], white: [1, 5] },
  "spain-white": { white: [1, 5], red: [2, 7], rose: [0, 2] },
  "spain-red": { red: [2, 8], white: [1, 4], rose: [0, 2] },
  cava: { sparkling: [1, 5], white: [1, 3], rose: [1, 4] },
  sherry: { fortified: [0, 10], white: [0, 3] },
  port: { fortified: [3, 25], red: [2, 10], white: [1, 4] },
  portugal: { red: [2, 8], white: [1, 4], fortified: [4, 30], rose: [0, 2], sparkling: [1, 3] },
  riesling: { white: [2, 12], dessert: [4, 25], red: [2, 7], sparkling: [1, 4], rose: [0, 2] },
  austria: { white: [2, 8], red: [2, 8], dessert: [4, 20], rose: [0, 2], sparkling: [1, 4] },
  greece: { white: [1, 5], red: [2, 10], dessert: [4, 20], rose: [0, 2] },
  tokaji: { dessert: [4, 25], white: [2, 8], red: [2, 7] },
  switzerland: { white: [1, 4], red: [2, 7], rose: [0, 2] },
  "england-sparkling": { sparkling: [2, 8], white: [1, 4], rose: [1, 5] },
  california: { red: [2, 11], white: [1, 6], sparkling: [1, 5], rose: [0, 2], dessert: [3, 14] },
  argentina: { red: [2, 9], white: [1, 4], rose: [0, 2] },
  chile: { red: [2, 9], white: [1, 4], rose: [0, 2] },
  australia: { red: [2, 11], white: [2, 8], sparkling: [1, 5], dessert: [3, 14], rose: [0, 2] },
  "new-zealand": { white: [1, 5], red: [2, 7], sparkling: [1, 4], rose: [0, 2] },
  "south-africa": { red: [2, 9], white: [1, 7], sparkling: [1, 5], rose: [0, 2] },
  // Bekaa reds (Musar and its neighbours) are made to age for decades, whites too.
  lebanon: { red: [6, 25], white: [4, 18], rose: [0, 2] },
  standard: {
    red: [2, 8],
    white: [1, 4],
    rose: [0, 2],
    sparkling: [0, 3],
    dessert: [3, 14],
    fortified: [3, 20],
    orange: [1, 6],
  },
};

/** When a style does not list a colour, this is the safety net. */
const FALLBACK: Record<WineType, Span> = SPANS.standard as Record<WineType, Span>;

/** Words in a region, appellation or name that say where a wine is from. The first match wins, so order matters. */
const STYLE_WORDS: ReadonlyArray<readonly [WineStyle, readonly string[]]> = [
  ["champagne", ["champagne"]],
  [
    "italy-south",
    [
      "abruzzo",
      "sicily",
      "sicilia",
      "puglia",
      "apulia",
      "primitivo",
      "salento",
      "campania",
      "taurasi",
      "aglianico",
      "calabria",
      "sardinia",
      "sardegna",
      "etna",
      "nero d avola",
      "basilicata",
    ],
  ],
  [
    "bordeaux",
    [
      "bordeaux",
      "medoc",
      "pauillac",
      "margaux",
      "saint julien",
      "saint estephe",
      "pessac",
      "graves",
      "saint emilion",
      "pomerol",
      "sauternes",
      "fronsac",
      "entre deux mers",
    ],
  ],
  [
    "beaujolais",
    [
      "beaujolais",
      "morgon",
      "fleurie",
      "moulin a vent",
      "brouilly",
      "julienas",
      "chiroubles",
      "chenas",
      "regnie",
      "saint amour",
    ],
  ],
  [
    "burgundy",
    [
      "burgundy",
      "bourgogne",
      "chablis",
      "cote de nuits",
      "cote de beaune",
      "gevrey",
      "chambolle",
      "vosne",
      "nuits saint georges",
      "meursault",
      "puligny",
      "chassagne",
      "pommard",
      "volnay",
      "beaune",
      "macon",
      "pouilly fuisse",
      "mercurey",
      "givry",
      "rully",
    ],
  ],
  [
    "rhone-north",
    ["cote rotie", "hermitage", "crozes", "cornas", "saint joseph", "condrieu", "northern rhone"],
  ],
  [
    "rhone-south",
    [
      "rhone",
      "chateauneuf",
      "gigondas",
      "vacqueyras",
      "cotes du rhone",
      "tavel",
      "lirac",
      "ventoux",
      "vinsobres",
      "rasteau",
    ],
  ],
  [
    "loire",
    [
      "loire",
      "sancerre",
      "pouilly fume",
      "vouvray",
      "muscadet",
      "chinon",
      "bourgueil",
      "saumur",
      "anjou",
      "touraine",
      "coteaux du layon",
      "quincy",
      "menetou",
    ],
  ],
  ["alsace", ["alsace", "elsass"]],
  [
    "languedoc",
    [
      "languedoc",
      "roussillon",
      "corbieres",
      "minervois",
      "faugeres",
      "saint chinian",
      "pic saint loup",
      "banyuls",
      "maury",
      "rivesaltes",
      "fitou",
    ],
  ],
  ["provence", ["provence", "bandol", "cassis", "coteaux d aix"]],
  [
    "southwest",
    [
      "south west",
      "sud ouest",
      "cahors",
      "madiran",
      "bergerac",
      "gaillac",
      "jurancon",
      "monbazillac",
      "buzet",
      "irouleguy",
    ],
  ],
  ["jura", ["jura", "arbois", "vin jaune", "chateau chalon", "savoie", "savoy", "bugey"]],
  [
    "piedmont",
    [
      "piedmont",
      "piemonte",
      "barolo",
      "barbaresco",
      "langhe",
      "roero",
      "barbera d",
      "dolcetto",
      "gavi",
      "moscato d asti",
      "nebbiolo",
    ],
  ],
  [
    "tuscany",
    [
      "tuscany",
      "toscana",
      "chianti",
      "brunello",
      "montalcino",
      "vino nobile",
      "bolgheri",
      "maremma",
      "super tuscan",
      "morellino",
      "tignanello",
    ],
  ],
  [
    "veneto",
    [
      "veneto",
      "amarone",
      "valpolicella",
      "soave",
      "prosecco",
      "bardolino",
      "ripasso",
      "friuli",
      "trentino",
      "alto adige",
    ],
  ],
  ["italy-white", ["franciacorta", "trento doc"]],
  ["rioja", ["rioja"]],
  ["ribera", ["ribera del duero"]],
  ["priorat", ["priorat", "montsant"]],
  ["cava", ["cava", "penedes", "corpinnat"]],
  ["sherry", ["sherry", "jerez", "fino", "amontillado", "oloroso", "manzanilla"]],
  ["spain-white", ["rias baixas", "albarino", "rueda", "verdejo", "godello", "txakoli"]],
  ["port", ["porto", "douro", " port"]],
  ["portugal", ["portugal", "dao", "alentejo", "vinho verde", "madeira", "bairrada"]],
  ["austria", ["wachau", "kamptal", "kremstal", "burgenland", "gruner veltliner"]],
  ["riesling", ["mosel", "rheingau", "pfalz", "nahe", "rheinhessen"]],
  ["tokaji", ["tokaj"]],
  ["england-sparkling", ["sussex", "kent", "hampshire", "nyetimber", "ridgeview"]],
];

/** A country alone says something too (when no region word did). */
const COUNTRY_STYLE: Record<string, WineStyle> = {
  DE: "riesling",
  AT: "austria",
  CH: "switzerland",
  GR: "greece",
  PT: "portugal",
  ES: "spain-red",
  IT: "italy-white",
  GB: "england-sparkling",
  US: "california",
  AR: "argentina",
  CL: "chile",
  AU: "australia",
  NZ: "new-zealand",
  ZA: "south-africa",
  LB: "lebanon",
};

export interface WineFacts {
  type: WineType;
  countryCode: string | null;
  region: string | null;
  appellation?: string | null;
  /** The wine's name, for quality words ("Reserva", "Premier Cru") and place words. */
  name?: string | null;
}

/** Which style of region this wine is from: the words win, then the country, then "standard". */
export function styleOf(
  wine: Pick<WineFacts, "countryCode" | "region" | "appellation" | "name">,
): WineStyle {
  const text = ` ${normalizeText(`${wine.region ?? ""} ${wine.appellation ?? ""} ${wine.name ?? ""}`)} `;
  for (const [style, words] of STYLE_WORDS)
    if (words.some((w) => text.includes(` ${w.trim()} `))) return style;
  return COUNTRY_STYLE[wine.countryCode ?? ""] ?? "standard";
}

/** Words on a label that say how ambitious a bottle is, and so how long it can wait. First match wins. */
const QUALITY_WORDS: ReadonlyArray<readonly [string, number]> = [
  ["gran selezione", 1.45],
  ["gran reserva", 1.45],
  ["grand cru classe", 1.55],
  ["grand cru", 1.5],
  ["premier cru", 1.3],
  ["1er cru", 1.3],
  ["premier grand", 1.6],
  ["gran seleccion", 1.4],
  ["grosses gewachs", 1.35],
  ["grand vin", 1.3],
  ["riserva", 1.3],
  ["reserva", 1.25],
  ["reserve", 1.2],
  ["vieilles vignes", 1.2],
  ["single vineyard", 1.2],
  ["vintage", 1.4],
  ["crianza", 0.95],
  ["primeur", 0.4],
  ["nouveau", 0.35],
  ["joven", 0.7],
];

const qualityFactor = (wine: WineFacts): number => {
  const text = normalizeText(`${wine.appellation ?? ""} ${wine.name ?? ""}`);
  for (const [word, factor] of QUALITY_WORDS) if (text.includes(word)) return factor;
  return 1;
};

/** What was paid per bottle says a lot about concentration, and so about how long it keeps. Rough, and useful. */
export function priceFactor(pricePerBottleCents: number | null | undefined): number {
  const price = (pricePerBottleCents ?? 0) / 100;
  if (!(price > 0)) return 1;
  if (price < 7) return 0.55;
  if (price < 12) return 0.7;
  if (price < 20) return 0.85;
  if (price < 35) return 1.05;
  if (price < 60) return 1.3;
  if (price < 120) return 1.6;
  if (price < 300) return 2.0;
  return 2.4;
}

export interface DrinkWindow {
  /** Calendar years: the first good year and the last good year. */
  from: number;
  until: number;
  /** Always an estimate here; a window someone typed in themselves will say "own" when that exists. */
  source: "estimate" | "ai" | "own";
}

export interface DrinkInput extends WineFacts {
  /** The harvest year; null for non-vintage wines, which have no window to speak of. */
  year: number | null;
  /** What a bottle cost, in cents (when known). */
  pricePerBottleCents?: number | null;
  /** What the AI said about this very wine and vintage (and was sure enough about); it wins over the table. */
  aiWindow?: { from: number; until: number } | null;
}

/**
 * The estimated window for a bottle, in calendar years. Quality and price ADD to the base window rather than
 * multiplying it (multiplying made a pricey "Grand Cru" claim forty years); the lower edge moves half as
 * much as the upper one, because an ambitious wine mostly gets old later, not good much later.
 */
export function estimateDrinkWindow(input: DrinkInput): DrinkWindow | null {
  if (input.year === null) return null;
  if (input.aiWindow)
    return { from: input.aiWindow.from, until: input.aiWindow.until, source: "ai" };
  const spans = SPANS[styleOf(input)];
  const [baseFrom, baseUntil] = spans[input.type] ?? FALLBACK[input.type];
  const raw =
    1 + 0.8 * (qualityFactor(input) - 1) + 1.0 * (priceFactor(input.pricePerBottleCents) - 1);
  const factor = Math.min(2.6, Math.max(0.35, raw));
  const from = Math.round(baseFrom * (1 + (factor - 1) * 0.5));
  const until = Math.round(baseUntil * factor);
  return {
    from: input.year + Math.max(0, from),
    until: input.year + Math.max(from + 1, until),
    source: "estimate",
  };
}

/** Where a bottle stands in its window today. */
export const DRINK_PHASES = ["young", "developing", "peak", "ready", "past", "unknown"] as const;
export type DrinkPhase = (typeof DRINK_PHASES)[number];

export interface DrinkStatus {
  phase: DrinkPhase;
  window: DrinkWindow | null;
  /** 0 at the start of the window, 1 at its end (below 0 = not yet, above 1 = past). Null when unknown. */
  position: number | null;
  /** Years until the window opens (negative once it has). */
  yearsUntilOpen: number | null;
  /** Years until it closes (negative once it has). */
  yearsLeft: number | null;
}

export const fractionalYear = (now: Date): number => now.getUTCFullYear() + now.getUTCMonth() / 12;

export function drinkStatus(window: DrinkWindow | null, now: Date): DrinkStatus {
  if (!window)
    return {
      phase: "unknown",
      window: null,
      position: null,
      yearsUntilOpen: null,
      yearsLeft: null,
    };
  const t = fractionalYear(now);
  const position = (t - window.from) / Math.max(1, window.until - window.from);
  const phase: DrinkPhase =
    position < 0
      ? "young"
      : position < 0.25
        ? "developing"
        : position < 0.7
          ? "peak"
          : position <= 1
            ? "ready"
            : "past";
  const tenth = (n: number) => Math.round(n * 10) / 10;
  return {
    phase,
    window,
    position,
    yearsUntilOpen: tenth(window.from - t),
    yearsLeft: tenth(window.until - t),
  };
}

/** The same thing straight from a wine's facts. */
export const drinkStatusOf = (input: DrinkInput, now: Date): DrinkStatus =>
  drinkStatus(estimateDrinkWindow(input), now);

/**
 * How far a status may be trusted, and what may be said with it.
 *  - `reliable`: the window is about this very wine (the AI's profile of it, or the household's own), not the
 *    rough table of styles. Only a reliable window may raise "drink soon" or "past its best" — on Home, in
 *    reminders, anywhere that tells someone to act.
 *  - `uncertain`: the table puts the wine late in, or past, a window it only guessed. That is the claim most
 *    likely to be wrong (a Château Musar ages for decades; the table cannot know) and the most costly when it
 *    is, so it is not made: the phase becomes "unknown" ("not enough information") and the window is kept only
 *    as a rough sketch.
 */
export interface DrinkAssessment extends DrinkStatus {
  reliable: boolean;
  uncertain: boolean;
}

export function assessDrink(status: DrinkStatus): DrinkAssessment {
  const reliable = status.window !== null && status.window.source !== "estimate";
  const late = status.phase === "ready" || status.phase === "past";
  if (!reliable && late) return { ...status, phase: "unknown", reliable, uncertain: true };
  return { ...status, reliable, uncertain: false };
}

/** What should be opened first: lower = more pressing. Unknown goes last. */
export function drinkUrgency(status: DrinkStatus): number {
  switch (status.phase) {
    case "past":
      return -1; // really hurry
    case "ready":
      return 0 + (1 - (status.position ?? 0));
    case "peak":
      return 1 + (1 - (status.position ?? 0));
    case "developing":
      return 2;
    case "young":
      return 3 + Math.max(0, status.yearsUntilOpen ?? 0);
    default:
      return 999;
  }
}
