/**
 * THE HUMAN REVIEW FORMS (P8): CSV files that open in Excel or Google Sheets, generated from the current code into
 * docs/sprints/sommelier-3-mega/review/, for people who do not read code. Instructions per form are the .md files
 * next to them (English and Dutch), written by hand.
 *
 *   pnpm --filter @cellr/sommelier-eval run review-forms --write     (re)write the forms from the code
 *   pnpm --filter @cellr/sommelier-eval run review-forms             say which forms differ from the code (exit 1)
 *
 * Every form starts with who filled it in and when (blank) and the rule that nothing counts as approved until a named
 * person signs it. Every verdict column is EMPTY: no verdict is pre-filled, by code or by an AI. Where a form shows
 * a label the benchmark uses, the column header says the label was written by an AI.
 */
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { estimateDrinkWindow, styleOf, type WineType } from "@cellr/domain";
import {
  assessPairing,
  FOOD,
  parseFood,
  readWine,
  servingAdvice,
  WINE_KNOWLEDGE,
  type PairingCon,
  type PairingPro,
  type WineStructure,
} from "@cellr/domain/intelligence";
import { sampleRows } from "./annotation-sample";
import { SERIES, type Series } from "./human-holdout-series";
import { rng } from "./bench-cellar";
import { DISHES } from "./dishes";
import { ENGINES } from "./engines";
import { buildFixture } from "./fixtures";
import { csv } from "./review-sheet";
import { cardsOf, scenariosOf } from "./sets";
import { CELLARS, WINES } from "./wines";

export const REVIEW_DIR = new URL("../../docs/sprints/sommelier-3-mega/review/", import.meta.url);

/** The first rows of every form. */
export const FORM_PREAMBLE = (title: string) => [
  [title],
  ["Filled in by (name, role):", ""],
  ["Date:", ""],
  [
    "Nothing in this form counts as reviewed or approved until the person named above has signed it. Every verdict column starts empty; nothing in it was written by an AI or by code.",
  ],
  [],
];

/** Verdict columns start with this, so a test can find them and check that they are empty. */
export const VERDICT = "YOUR VERDICT: ";

// ---- 1. The independent holdout: a template per series (40, then 60; 100 in all) ---------------------------------

/** Rows per series' template (human-holdout-series.ts: 40 and 60, the owner's provisional target of 100). */
export const HOLDOUT_ROWS = { 1: SERIES[1].dishes, 2: SERIES[2].dishes } as const;
export const HOLDOUT_HEADER = [
  "id",
  "dish (English)",
  "dish (Dutch)",
  "question as a person asks it (English)",
  "question as a person asks it (Dutch)",
  "main (one of: red-meat game pork poultry white-fish oily-fish shellfish vegetable mushroom pasta-grain egg cheese dessert snack pulse)",
  "weight (1 delicate - 5 very rich)",
  "fat (0-3)",
  "acid (0-3)",
  "sweet (0-3)",
  "heat / chili (0-3)",
  "umami (0-3)",
  "right wines (keys from holdout-wines.csv, separated by spaces)",
  "acceptable wines (keys from holdout-wines.csv, separated by spaces)",
  "nothing suits (yes / leave empty)",
  "why (one line)",
  "written by (initials or role)",
];

export function holdoutTemplate(series: Series): string {
  const { dishes, prefix } = SERIES[series];
  const rows = Array.from({ length: dishes }, (_, i) => [
    `${prefix}${String(i + 1).padStart(2, "0")}`,
    ...HOLDOUT_HEADER.slice(1).map(() => ""),
  ]);
  return csv([
    ...FORM_PREAMBLE(
      `CELLR sommelier: independent holdout of wine-and-food pairings, series ${series} of 2 (${dishes} dishes; 100 in all)`,
    ),
    HOLDOUT_HEADER,
    ...rows,
  ]);
}

/** The pick-list: the 30 wines of the eval cellar, by key. */
export function holdoutWines(): string {
  return csv([
    ["key", "wine", "type", "vintage", "appellation", "region", "country", "grapes"],
    ...WINES.map((w) => [
      w.key,
      w.name,
      w.type,
      w.year ?? "NV",
      w.appellation,
      w.region,
      w.countryCode,
      w.grapes.join(" / "),
    ]),
  ]);
}

// ---- 2. The 50 annotations ----------------------------------------------------------------------------------

export function annotationForm(): string {
  const header = [
    "#",
    "wine",
    "vintage",
    "type",
    "appellation, region",
    "drink advice (as the card says it)",
    "window and what it rests on",
    "temperature",
    "fridge",
    "decanting",
    "glass",
    "serving basis",
    "stock and places",
    "the code's own lowest-confidence mark (not a judgement)",
    `${VERDICT}factually right? (yes / no / partly)`,
    `${VERDICT}over-confident? (yes / no)`,
    `${VERDICT}missed nuance (free text)`,
    `${VERDICT}what it should say`,
  ];
  return csv([
    ...FORM_PREAMBLE("CELLR sommelier: the facts under the cards, 50 wines"),
    header,
    ...sampleRows().map((r) => [
      r.n,
      r.wine,
      r.vintage,
      r.type,
      r.origin,
      r.drinkAdvice,
      r.window,
      r.temperature,
      r.fridge,
      r.decanting,
      r.glass,
      r.servingBasis,
      r.stock,
      r.flag,
      "",
      "",
      "",
      "",
    ]),
  ]);
}

// ---- 3. The knowledge behind the fallback -------------------------------------------------------------------

const DECANT_WORDS = {
  no: "no need to decant",
  air: (m: number) => `decant about ${m} minutes (air)`,
  sediment: "stand upright, pour gently off the sediment just before serving (no airing)",
  optional: (m: number) => `a carafe for about ${m} minutes is optional`,
} as const;
const GLASS_WORDS: Record<string, string> = {
  "flute-or-tulip": "tulip glass or flute",
  white: "white-wine glass",
  "large-white": "large white-wine glass",
  red: "red-wine glass",
  "large-red": "large red-wine glass",
  small: "small glass",
};

const s = (o: Partial<WineStructure>): WineStructure => ({
  body: 3,
  tannin: 0,
  acidity: 3,
  sweetness: 1,
  intensity: 3,
  oak: 0,
  alcohol: 2,
  fizz: false,
  ...o,
});

/** A grid that reaches every branch of the serving rules (experiences/serving.ts), in words. */
// prettier-ignore
const SERVING_GRID: ReadonlyArray<[WineType, string, WineStructure, number | null]> = [
  ["red", "light, soft (Beaujolais-like)", s({ body: 2, tannin: 2 }), 3],
  ["red", "light-medium, soft (Bourgogne-like)", s({ body: 3, tannin: 2 }), 3],
  ["red", "medium (Chianti-like)", s({ body: 3, tannin: 3 }), 3],
  ["red", "medium, aged", s({ body: 3, tannin: 3 }), 16],
  ["red", "fuller, medium tannin (Rioja-like)", s({ body: 4, tannin: 3 }), 6],
  ["red", "full, firm (young Barolo, Bordeaux)", s({ body: 4, tannin: 4 }), 4],
  ["red", "full, firm, 10 years", s({ body: 4, tannin: 4 }), 10],
  ["red", "full, firm, 22 years", s({ body: 4, tannin: 4 }), 22],
  ["red", "full, firm, age unknown (NV)", s({ body: 4, tannin: 4 }), null],
  ["red", "very full, very firm", s({ body: 5, tannin: 5 }), 3],
  ["red", "full, soft tannin (Barossa Shiraz-like)", s({ body: 4.5, tannin: 3 }), 5],
  ["white", "very light, dry (Muscadet-like)", s({ body: 1, sweetness: 1 }), 2],
  ["white", "light-medium, dry (Sancerre-like)", s({ body: 2, sweetness: 1 }), 2],
  ["white", "full, dry, no oak", s({ body: 4, sweetness: 1 }), 4],
  ["white", "full, dry, oaked (Meursault-like)", s({ body: 4, sweetness: 1, oak: 2 }), 5],
  ["white", "off-dry (Riesling Kabinett-like)", s({ body: 2, sweetness: 2 }), 3],
  ["sparkling", "light, dry (Cava-like)", s({ body: 2, sweetness: 1, fizz: true }), null],
  ["sparkling", "fuller, dry (vintage Champagne-like)", s({ body: 3, sweetness: 1, fizz: true }), 10],
  ["sparkling", "sweet (Moscato d'Asti-like)", s({ body: 1, sweetness: 4, fizz: true }), 2],
  ["rose", "dry rosé", s({ body: 2, sweetness: 1 }), 2],
  ["orange", "skin-contact white", s({ body: 3, tannin: 2 }), 4],
  ["dessert", "sweet white (Sauternes-like)", s({ body: 5, sweetness: 5 }), 10],
  ["fortified", "dry (fino, manzanilla)", s({ body: 2, sweetness: 0 }), null],
  ["fortified", "sweet, soft tannin (tawny)", s({ body: 5, sweetness: 5, tannin: 2 }), null],
  ["fortified", "sweet, firm tannin, 5 years (young vintage port)", s({ body: 5, sweetness: 5, tannin: 4 }), 5],
  ["fortified", "sweet, firm tannin, 15 years (vintage port)", s({ body: 5, sweetness: 5, tannin: 4 }), 15],
];

const NOW_YEAR = 2026;

export function servingForm(): string {
  const header = [
    "wine type",
    "what the wine is like (structure the rule reads)",
    "body 1-5",
    "tannin 0-5",
    "sweetness 0-5",
    "oak 0-3",
    "age in years",
    "serving temperature (rule of thumb)",
    "minutes in a fridge from room temperature",
    "decanting",
    "glass",
    `${VERDICT}agree / disagree / unsure`,
    `${VERDICT}why, and what it should be`,
  ];
  const rows = SERVING_GRID.map(([type, like, structure, age]) => {
    const a = servingAdvice(
      { type, structure, tier: "appellation", year: age === null ? null : NOW_YEAR - age },
      NOW_YEAR,
    );
    const d = a.decant;
    const decant =
      d.kind === "air" || d.kind === "optional"
        ? DECANT_WORDS[d.kind](d.minutes)
        : DECANT_WORDS[d.kind];
    return [
      type,
      like,
      structure.body,
      structure.tannin,
      structure.sweetness,
      structure.oak,
      age ?? "unknown",
      `${a.tempC.min}-${a.tempC.max} °C`,
      a.fridgeMinutes,
      decant,
      GLASS_WORDS[a.glass] ?? a.glass,
      "",
      "",
    ];
  });
  return csv([
    ...FORM_PREAMBLE("CELLR sommelier knowledge: serving and decanting rules of thumb"),
    header,
    ...rows,
  ]);
}

/** Representative wines for the drinking-window table: the eval cellar's 30 and more regions. */
// prettier-ignore
const WINDOW_EXTRAS: ReadonlyArray<[WineType, string, string, string]> = [
  ["red", "Saint-Émilion Grand Cru", "Bordeaux", "FR"],
  ["white", "Pessac-Léognan Blanc", "Bordeaux", "FR"],
  ["red", "Côte-Rôtie", "Rhône", "FR"],
  ["red", "Côtes du Rhône", "Rhône", "FR"],
  ["white", "Vouvray", "Loire", "FR"],
  ["red", "Chinon", "Loire", "FR"],
  ["white", "Riesling Grand Cru", "Alsace", "FR"],
  ["red", "Minervois", "Languedoc", "FR"],
  ["red", "Madiran", "Southwest", "FR"],
  ["white", "Vin Jaune", "Jura", "FR"],
  ["red", "Brunello di Montalcino", "Tuscany", "IT"],
  ["white", "Soave Classico", "Veneto", "IT"],
  ["red", "Etna Rosso", "Sicilia", "IT"],
  ["red", "Ribera del Duero Reserva", "Ribera del Duero", "ES"],
  ["red", "Priorat", "Catalonia", "ES"],
  ["red", "Douro Tinto", "Douro", "PT"],
  ["white", "Assyrtiko", "Santorini", "GR"],
  ["dessert", "Tokaji Aszú", "Tokaj", "HU"],
  ["red", "Pinot Noir", "Central Otago", "NZ"],
  ["red", "Shiraz", "Barossa Valley", "AU"],
  ["red", "Cabernet Sauvignon", "Maipo", "CL"],
  ["red", "Pinotage", "Stellenbosch", "ZA"],
  ["red", "Bekaa Valley Red", "Bekaa Valley", "LB"],
  ["sparkling", "English Sparkling Wine", "Sussex", "GB"],
];

export function windowsForm(): string {
  const header = [
    "wine type",
    "wine",
    "appellation or region",
    "country",
    "style table the code reads it as",
    "good to drink from (years after the harvest)",
    "good to drink until (years after the harvest)",
    "the same bottle at €60: from",
    "the same bottle at €60: until",
    `${VERDICT}agree / disagree / unsure`,
    `${VERDICT}why, and what it should be`,
  ];
  const wines: Array<[WineType, string, string, string]> = [
    ...WINES.map((w): [WineType, string, string, string] => [
      w.type,
      w.name,
      w.appellation,
      w.countryCode,
    ]),
    ...WINDOW_EXTRAS,
  ];
  const harvest = 2020;
  const rows = wines.map(([type, name, where, country]) => {
    const input = {
      type,
      name,
      region: where,
      appellation: where,
      countryCode: country,
      year: harvest,
    };
    const plain = estimateDrinkWindow({ ...input, pricePerBottleCents: null });
    const dear = estimateDrinkWindow({ ...input, pricePerBottleCents: 6000 });
    return [
      type,
      name,
      where,
      country,
      styleOf(input),
      plain ? plain.from - harvest : "-",
      plain ? plain.until - harvest : "-",
      dear ? dear.from - harvest : "-",
      dear ? dear.until - harvest : "-",
      "",
      "",
    ];
  });
  return csv([
    ...FORM_PREAMBLE(
      "CELLR sommelier knowledge: estimated drinking windows by style (a 2020 vintage; no price known, and at €60)",
    ),
    header,
    ...rows,
  ]);
}

const PRO_WORDS: Record<PairingPro, string> = {
  classic: "a known classic pairing",
  affinity: "a long-standing partner of something in the dish",
  "weight-matches": "the weights match",
  "acidity-cuts-richness": "its acidity cuts the richness",
  "acidity-meets-acidity": "its acidity meets the dish's acidity",
  "bubbles-refresh": "the bubbles refresh",
  "tannin-meets-meat": "its tannin meets the meat",
  "sweetness-tames-heat": "a touch of sweetness tames the heat",
  "sweetness-meets-sweetness": "as sweet as the dessert, or sweeter",
  "sweet-with-salt": "sweet wine with a salty dish",
  "aromatics-meet-spice": "its aromas meet the spices",
  "oak-meets-richness": "its oak meets a rich dish",
  "fruit-meets-char": "its fruit meets the char of the grill",
  "red-for-red-wine-sauce": "a red for a red-wine sauce",
  "fresh-with-seafood": "fresh with seafood",
};
const CON_WORDS: Record<PairingCon, string> = {
  "too-heavy": "too heavy for the dish",
  "too-light": "too light for the dish",
  "tannin-too-firm": "its tannin is too firm",
  "needs-more-acidity": "it needs more acidity",
  "not-sweet-enough": "not sweet enough",
  "too-sweet": "too sweet",
  "alcohol-fans-heat": "its alcohol fans the chili heat",
  "oak-overwhelms": "its oak overwhelms the dish",
  overpowers: "it overpowers the dish",
  underpowered: "the dish overpowers it",
  "red-with-delicate-fish": "a red with delicate fish",
  "white-for-red-wine-sauce": "a white for a red-wine sauce",
  "little-known": "too little is known about the wine",
  "tannin-with-fish": "tannin with fish (a clash)",
  "tannin-with-heat": "tannin with chili heat (a clash)",
  "tannin-with-sweet": "tannin with a sweet dish (a clash)",
  "dry-with-dessert": "a dry wine with dessert (a clash)",
  "sweet-with-savoury": "a sweet wine with a savoury dish (a clash)",
};
const LEVEL_WORDS = {
  good: "good",
  acceptable: "acceptable",
  neutral: "neither good nor poor",
  poor: "poor",
} as const;

export const PAIRING_SAMPLE = 60;

/** 60 dish × wine judgements of the pairing engine, drawn with a fixed seed from the eval dishes and wines. */
export function pairingsForm(): string {
  const pick = rng(0x9a1e);
  const seen = new Set<string>();
  const rows: Array<Array<string | number>> = [];
  while (rows.length < PAIRING_SAMPLE) {
    const dish = DISHES[Math.floor(pick() * DISHES.length)]!;
    const wine = WINES[Math.floor(pick() * WINES.length)]!;
    const key = `${dish.id}|${wine.key}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const food = parseFood(dish.en, FOOD);
    if (food.main === null) continue;
    const reading = readWine(
      {
        type: wine.type,
        name: wine.name,
        region: wine.region,
        appellation: wine.appellation,
        countryCode: wine.countryCode,
      },
      WINE_KNOWLEDGE,
    );
    const a = assessPairing(food, { ...reading, type: wine.type });
    rows.push([
      rows.length + 1,
      dish.en,
      `${wine.name} (${wine.type}, ${wine.appellation}, ${wine.year ?? "NV"})`,
      LEVEL_WORDS[a.level],
      a.pros.map((p) => PRO_WORDS[p]).join("; "),
      a.cons.map((c) => CON_WORDS[c]).join("; "),
      "",
      "",
    ]);
  }
  const header = [
    "#",
    "dish",
    "wine",
    "the engine's judgement",
    "for it (the engine's reasons)",
    "against it (the engine's reasons)",
    `${VERDICT}agree / disagree / unsure`,
    `${VERDICT}why, and what it should be`,
  ];
  return csv([
    ...FORM_PREAMBLE(
      "CELLR sommelier knowledge: 60 wine-and-dish judgements of the pairing engine",
    ),
    header,
    ...rows,
  ]);
}

export const FALLBACK_SAMPLE = 20;

/**
 * The 20 answers of the fallback (engine `v1-fallback`) that disagree most with the benchmark's labels, on the two
 * readable sets (main, holdout-dev; never the blind holdout-test). Disagreement: 2 when the first wine offered is
 * labelled poor, 1 per further poor wine offered, 1 when a wine labelled good was in the cellar and none was offered.
 */
export async function fallbackRows() {
  const engine = ENGINES.find((e) => e.name === "v1-fallback")!;
  const found = [];
  for (const set of ["main", "holdout-dev"]) {
    const cards = cardsOf(set);
    for (const sc of scenariosOf(set)) {
      if (!sc.dish) continue;
      const card = cards.get(sc.dish);
      if (!card) continue;
      const { answer } = await engine.run(sc);
      if (answer.bottles.length === 0) continue;
      const label = (k: string) =>
        card.good.includes(k) ? "good" : card.ok.includes(k) ? "ok" : "poor";
      const labels = answer.bottles.map(label);
      const owned = buildFixture(sc).wines.map((w) => w.key);
      const goodOwned = owned.filter((k) => card.good.includes(k));
      const score =
        (labels[0] === "poor" ? 2 : 0) +
        labels.slice(1).filter((l) => l === "poor").length +
        (goodOwned.length > 0 && !labels.includes("good") ? 1 : 0);
      found.push({ set, sc, card, answer, labels, goodOwned, score });
    }
  }
  return found
    .sort(
      (x, y) => y.score - x.score || x.set.localeCompare(y.set) || x.sc.id.localeCompare(y.sc.id),
    )
    .slice(0, FALLBACK_SAMPLE);
}

export async function fallbackForm(): Promise<string> {
  const name = (k: string) => WINES.find((w) => w.key === k)?.name ?? k;
  const header = [
    "#",
    "set",
    "scenario",
    "question",
    "the cellar (named cellar of the eval)",
    "the fallback offered, best first",
    "the fallback's verdict",
    "benchmark label of each wine offered (AI-WRITTEN, not reviewed)",
    "wines in the cellar the benchmark labels good (AI-WRITTEN, not reviewed)",
    "disagreement score (code)",
    `${VERDICT}the fallback's choice: agree / disagree / unsure`,
    `${VERDICT}the AI-written label: right / wrong / unsure`,
    `${VERDICT}why`,
  ];
  const rows = (await fallbackRows()).map((r, i) => [
    i + 1,
    r.set,
    r.sc.id,
    r.sc.turns.map((t) => t.user).join(" / "),
    `${r.sc.cellar} (${(CELLARS[r.sc.cellar] ?? []).length} wines)`,
    r.answer.bottles.map(name).join("; "),
    r.answer.verdict ?? "-",
    r.labels.join("; "),
    r.goodOwned.map(name).join("; ") || "(none)",
    r.score,
    "",
    "",
    "",
  ]);
  return csv([
    ...FORM_PREAMBLE(
      "CELLR sommelier knowledge: 20 fallback answers that disagree most with the benchmark's AI-written labels",
    ),
    header,
    ...rows,
  ]);
}

// ---- 4. The user-experience sessions (three to five real users) ------------------------------------------------

/** The journey, task by task, as the facilitator says it (the same on a phone and on a desktop). */
export const UX_TASKS: ReadonlyArray<[string, string, string]> = [
  [
    "Ask for advice",
    '"You are cooking roast lamb tonight. Ask the sommelier what to open."',
    "An answer with one or more bottles from the cellar is on screen",
  ],
  [
    "Read the cards",
    '"Look at the bottles it suggests. Tell me what the lines under each card tell you."',
    "The participant can say whether to drink it now, and where it lies",
  ],
  [
    "Ask how to serve",
    '"Ask how warm to serve the first wine and whether to decant it."',
    "A temperature and a decanting advice are on screen",
  ],
  [
    "Plan a menu",
    '"For Saturday: oysters, then roast lamb, then chocolate fondant. Ask for a wine per course."',
    "One wine (or 'nothing suits') per course is on screen",
  ],
  [
    "Bottles for guests",
    '"You will be eight people. Ask how many bottles you need."',
    "A number of bottles and what is free to open is on screen",
  ],
  [
    "A follow-up",
    '"Ask for something lighter than the first suggestion."',
    "A new answer that follows on from the previous one",
  ],
  [
    "When the AI is unavailable",
    "(The facilitator switches the test server to 'AI unavailable' first.) \"Ask again what to open with the lamb.\"",
    "The participant notices that this answer is the app's own, not the AI's",
  ],
];

export function uxTasksForm(): string {
  const header = [
    "participant code (e.g. P1; never a name)",
    "device (phone / desktop)",
    "task #",
    "task",
    "what the facilitator says",
    "what counts as done",
    `${VERDICT}could they do it? (yes / with help / no)`,
    `${VERDICT}time (mm:ss)`,
    `${VERDICT}what confused them`,
    `${VERDICT}would they trust it? (1 not at all - 5 fully)`,
    `${VERDICT}remarks`,
  ];
  const rows = (["phone", "desktop"] as const).flatMap((device) =>
    UX_TASKS.map(([task, say, done], i) => [
      "",
      device,
      i + 1,
      task,
      say,
      done,
      "",
      "",
      "",
      "",
      "",
    ]),
  );
  return csv([
    ...FORM_PREAMBLE(
      "CELLR sommelier: user session, tasks (one copy per participant; facilitator fills it in)",
    ),
    header,
    ...rows,
  ]);
}

export const UX_CLOSING: readonly string[] = [
  "Overall, how useful was the sommelier to you? (1 not at all - 5 very)",
  "Could you tell which facts came from the app and which from the AI? (yes / partly / no)",
  "Did it say anything as certain that you doubted? What?",
  "Would you trust it for a dinner with guests? (1 not at all - 5 fully)",
  "Phone or desktop: which did you prefer, and why?",
  "What was the most confusing moment?",
  "What would you change first?",
  "Anything else you want to tell us?",
];

export function uxClosingForm(): string {
  return csv([
    ...FORM_PREAMBLE("CELLR sommelier: user session, closing questions (one copy per participant)"),
    [
      "participant code (e.g. P1; never a name)",
      "#",
      "question",
      `${VERDICT}answer (the participant's words)`,
    ],
    ...UX_CLOSING.map((q, i) => ["", i + 1, q, ""]),
  ]);
}

/** Every generated form: file name → content. */
export async function allForms(): Promise<Record<string, string>> {
  return {
    "holdout-template-series1.csv": holdoutTemplate(1),
    "holdout-template-series2.csv": holdoutTemplate(2),
    "holdout-wines.csv": holdoutWines(),
    "annotation-review.csv": annotationForm(),
    "knowledge-serving.csv": servingForm(),
    "knowledge-windows.csv": windowsForm(),
    "knowledge-pairings.csv": pairingsForm(),
    "knowledge-fallback.csv": await fallbackForm(),
    "ux-tasks.csv": uxTasksForm(),
    "ux-closing.csv": uxClosingForm(),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values: args } = parseArgs({ options: { write: { type: "boolean", default: false } } });
  const forms = await allForms();
  let stale = 0;
  for (const [file, text] of Object.entries(forms)) {
    const url = new URL(file, REVIEW_DIR);
    if (args.write) await writeFile(url, text);
    else {
      let now = "";
      try {
        now = readFileSync(url, "utf8");
      } catch {
        // missing
      }
      if (now !== text) {
        stale += 1;
        console.log(`differs from the code: ${file}`);
      }
    }
  }
  if (!args.write && stale > 0) process.exit(1);
}
