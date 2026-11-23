/**
 * THE ANNOTATION SAMPLE FOR A PERSON TO REVIEW (V1+ gate, closeout §5: "a checked sample of 50, reviewed by a
 * person"). Fifty wines, the facts the `annotate` part puts under each card, in the screen's English words.
 *
 *   pnpm --filter @cellr/sommelier-eval run annotation-sample --write    (re)write docs/sprints/sommelier-3-mega/results/p4-annotation-sample.md
 *   pnpm prettier --write docs/sprints/sommelier-3-mega/results/p4-annotation-sample.md      then format it (the test ignores cell padding)
 *   pnpm --filter @cellr/sommelier-eval run annotation-sample            print it
 *
 * Deterministic: the 30 wines of the eval cellar (wines.ts, two bottles each, as fixtures.ts builds them) and 20
 * more, chosen to reach the rules that matter (a researched profile, a window from the AI, an old red with
 * sediment, a sweet wine, a fortified wine of unknown style, a wine known only by its colour, NV, reservations,
 * several places). Each is read by the app's own `aggregateInventory` (the drinking window) and `annotateBottles`
 * (the annotation), and worded by the screen's own `annotationLines` with the app's English messages
 * (apps/web/messages/en.json) through a small ICU formatter (tested against the screen's own expected lines).
 *
 * Nothing here judges a wine. The only marks are the code's own lowest-confidence bases: a serving advice by rule
 * of thumb for the style or the colour, and a window that is an estimate for the style.
 */
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import {
  PROFILE_VERSION,
  type BottleAnnotation,
  type CellarItem,
  type InsightOutput,
  type Reservation,
  type WineType,
} from "@cellr/domain";
import { annotateBottles } from "@cellr/domain/intelligence";
import { aggregateInventory } from "@/server/cellar/service";
import type { InventoryRow } from "@/server/cellar/types";
import { annotationLines } from "@/features/sommelier/annotation-lines";
import { buildFixture, NOW } from "./fixtures";
import { CELLARS } from "./wines";

const MESSAGES = JSON.parse(
  readFileSync(new URL("../../apps/web/messages/en.json", import.meta.url), "utf8"),
) as { sommelier: Record<string, unknown> };

/**
 * The app's English messages of the sommelier namespace, formatted as next-intl does for the forms these keys use:
 * `{name}` and `{n, plural, one {…} other {…}}` with `#`.
 */
export function translate(key: string, values: Record<string, unknown> = {}): string {
  let node: unknown = MESSAGES.sommelier;
  for (const part of key.split(".")) node = (node as Record<string, unknown> | undefined)?.[part];
  if (typeof node !== "string") throw new Error(`no English message for sommelier.${key}`);
  const plural = /\{(\w+), plural, one \{([^{}]*)\} other \{([^{}]*)\}\}/g;
  return node
    .replace(plural, (_, name: string, one: string, other: string) => {
      const n = Number(values[name]);
      return (n === 1 ? one : other).replace(/#/g, String(n));
    })
    .replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? `{${name}}`));
}
const t = translate as never;

interface Extra {
  producer: string;
  name: string;
  type: WineType;
  year: number | null;
  region: string | null;
  appellation: string | null;
  countryCode: string | null;
  count: number;
  /** The AI's drinking window for this vintage. */
  aiWindow?: { from: number; until: number };
  /** A researched profile: serving range and decanting minutes. */
  profile?: { minC: number; maxC: number; decant: number | null };
  reserved?: Reservation;
  /** Places of the bottles, in order; null: no place. */
  places?: ReadonlyArray<string | null>;
}

// prettier-ignore
const EXTRAS: readonly Extra[] = [
  { producer: "Cantina Valmora", name: "Barolo", type: "red", year: 2016, region: "Piedmont", appellation: "Barolo", countryCode: "IT", count: 3, profile: { minC: 16, maxC: 18, decant: 90 } },
  { producer: "Cantina Valmora", name: "Barolo", type: "red", year: 2021, region: "Piedmont", appellation: "Barolo", countryCode: "IT", count: 6 },
  { producer: "Château Lestrade", name: "Pauillac", type: "red", year: 1990, region: "Bordeaux", appellation: "Pauillac", countryCode: "FR", count: 1, profile: { minC: 17, maxC: 18, decant: 120 } },
  { producer: "Quinta da Serra Alta", name: "Vintage Port", type: "fortified", year: 1985, region: "Douro", appellation: "Porto", countryCode: "PT", count: 2 },
  { producer: "Bodega Ignota", name: "Vino Generoso", type: "fortified", year: null, region: null, appellation: null, countryCode: null, count: 1 },
  { producer: "Cave Inconnue", name: "Cuvée Rouge", type: "red", year: 2019, region: null, appellation: null, countryCode: null, count: 4 },
  { producer: "Cave Inconnue", name: "Cuvée Blanche", type: "white", year: 2022, region: null, appellation: null, countryCode: null, count: 2 },
  { producer: "Maison Delorme", name: "Champagne Brut", type: "sparkling", year: null, region: "Champagne", appellation: "Champagne", countryCode: "FR", count: 6, profile: { minC: 8, maxC: 10, decant: 0 } },
  { producer: "Maison Delorme", name: "Champagne Millésimé", type: "sparkling", year: 2008, region: "Champagne", appellation: "Champagne", countryCode: "FR", count: 2 },
  { producer: "Domaine des Pins", name: "Côtes de Provence Rosé", type: "rose", year: 2019, region: "Provence", appellation: "Côtes de Provence", countryCode: "FR", count: 3 },
  { producer: "Weingut Brenner", name: "Riesling Auslese", type: "white", year: 2005, region: "Mosel", appellation: "Mosel", countryCode: "DE", count: 2 },
  { producer: "Hillside Estate", name: "Cabernet Sauvignon", type: "red", year: 2023, region: "Napa Valley", appellation: "Napa Valley", countryCode: "US", count: 6 },
  { producer: "Domaine Charvet", name: "Fleurie", type: "red", year: 2015, region: "Beaujolais", appellation: "Fleurie", countryCode: "FR", count: 2 },
  { producer: "Tenuta Corvara", name: "Amarone della Valpolicella", type: "red", year: 2015, region: "Veneto", appellation: "Amarone della Valpolicella", countryCode: "IT", count: 3, aiWindow: { from: 2022, until: 2035 } },
  { producer: "Château Peyraguey-Bas", name: "Sauternes", type: "dessert", year: 1997, region: "Bordeaux", appellation: "Sauternes", countryCode: "FR", count: 1, profile: { minC: 9, maxC: 11, decant: 60 } },
  { producer: "Kmetija Brda", name: "Rebula Macerated", type: "orange", year: 2020, region: null, appellation: null, countryCode: null, count: 2 },
  { producer: "Weingut Prandtauer", name: "Grüner Veltliner Smaragd", type: "white", year: 2019, region: "Wachau", appellation: "Wachau", countryCode: "AT", count: 4, aiWindow: { from: 2021, until: 2029 } },
  { producer: "Bodegas Hidalgo-Ruiz", name: "Fino Sherry", type: "fortified", year: null, region: "Jerez", appellation: "Jerez-Xérès-Sherry", countryCode: "ES", count: 2, profile: { minC: 7, maxC: 9, decant: null } },
  { producer: "Bodegas Lanzán", name: "Rioja Gran Reserva", type: "red", year: 2010, region: "Rioja", appellation: "Rioja", countryCode: "ES", count: 6, reserved: { count: 2, title: "Anniversary", on: "2026-12-12" }, places: ["Wine fridge", "Wine fridge", "Rack A", "Rack A", null, null] },
  { producer: "Domaine Morin", name: "Meursault", type: "white", year: 2018, region: "Burgundy", appellation: "Meursault", countryCode: "FR", count: 2, reserved: { count: 2, title: "Christmas dinner", on: null }, places: ["Cellar, shelf 2", "Cellar, shelf 2"] },
];

const id = (n: number) => `00000000-0000-4000-8a00-${n.toString(16).padStart(12, "0")}`;

function profileOf(p: NonNullable<Extra["profile"]>): InsightOutput {
  return {
    summary: "Sample profile.",
    style: "",
    grapes: [],
    tasting: "",
    serving: { minC: p.minC, maxC: p.maxC },
    decantMinutes: p.decant,
    abvPercent: null,
    drinkWindow: null,
    pairings: [],
    aging: "",
    structure: null,
    flavors: [],
    pairingKinds: [],
    version: PROFILE_VERSION,
    value: null,
    confidence: "high",
    evidence: "exact_wine",
    researched: true,
    sources: [{ name: "Sample", url: "https://www.example.com/wine" }],
  };
}

/** The 50 wines, in table order: the eval cellar's 30, then the 20 extras. */
export function sampleWines(): { items: CellarItem[]; profiles: Map<string, InsightOutput> } {
  const fixture = buildFixture({ cellar: "all" });
  const rows: InventoryRow[] = [...fixture.rows];
  const profiles = new Map<string, InsightOutput>();
  const reserved = new Map<string, Reservation>();
  EXTRAS.forEach((x, n) => {
    const vintageId = id(1000 + n);
    for (let b = 0; b < x.count; b++) {
      const place = x.places ? (x.places[b] ?? null) : "Rack B";
      rows.push({
        bottleId: id(2000 + n * 20 + b),
        vintageId,
        wineId: id(3000 + n),
        producer: x.producer,
        wineName: x.name,
        type: x.type,
        year: x.year,
        region: x.region,
        appellation: x.appellation,
        countryCode: x.countryCode,
        locationId: place === null ? null : id(4000 + place.length),
        locationLabel: place,
        row: null,
        col: null,
        priceCents: null,
        currency: null,
        addedAt: "2026-01-01T00:00:00Z",
        image: null,
        aiWindow: x.aiWindow ?? null,
      });
    }
    if (x.profile) profiles.set(vintageId, profileOf(x.profile));
    if (x.reserved) reserved.set(vintageId, x.reserved);
  });
  const view = aggregateInventory(rows, new Set(), [], NOW);
  const byId = new Map(view.items.map((i) => [i.vintageId, i]));
  const order = [...fixture.wines.map((w) => w.vintageId), ...EXTRAS.map((_, n) => id(1000 + n))];
  return {
    items: order.map((v) => ({ ...byId.get(v)!, reserved: reserved.get(v) ?? null })),
    profiles,
  };
}

export interface SampleRow {
  n: number;
  wine: string;
  vintage: string;
  type: string;
  origin: string;
  drinkAdvice: string;
  window: string;
  temperature: string;
  fridge: string;
  decanting: string;
  glass: string;
  servingBasis: string;
  stock: string;
  /** The code's own bases, as codes. */
  codes: string;
  /** Lowest-confidence bases, as the code states them (empty: none). */
  flag: string;
}

export function sampleRows(): SampleRow[] {
  const { items, profiles } = sampleWines();
  const annotations = items.flatMap((item) => annotateBottles([item], { profiles, now: NOW }));
  if (annotations.length !== 50 || CELLARS.all!.length !== 30)
    throw new Error(`expected 50 annotations, got ${annotations.length}`);
  return annotations.map((a: BottleAnnotation, k) => {
    const item = items[k]!;
    const [keeping] = annotationLines(a, "keeping", t);
    const [drinkAdvice, window] = (keeping ?? "").split(" · ");
    const [servingLine] = annotationLines(a, "serving", t);
    const serving = (servingLine ?? "").split(" · ");
    const known = a.serving !== null;
    // The serving line in full: temperature · fridge · decanting (absent when only the colour is known) · glass · basis.
    const [temperature, fridge, ...rest] = known ? serving : [servingLine ?? "", ""];
    const decanting =
      known && a.serving!.decant !== null ? rest[0]! : known ? "(nothing said)" : "";
    const glass = known ? rest.at(-2)! : "";
    const servingBasis = known ? rest.at(-1)! : "";
    const byDefault = annotationLines(a, null, t);
    const stock = byDefault.length > 1 ? byDefault[1]! : "";
    const servingCode =
      a.serving === null ? "none" : a.serving.decant === null ? "colour" : a.serving.basis;
    const flags = [
      a.serving !== null && a.serving.decant === null ? "serving: colour only" : null,
      a.serving?.basis === "style" && a.serving.decant !== null ? "serving: rule of thumb" : null,
      a.drink.basis === "style" && a.drink.advice !== "unknown" ? "window: style estimate" : null,
    ].filter((f): f is string => f !== null);
    return {
      n: k + 1,
      wine: `${item.producer} — ${item.wineName}`,
      vintage: item.year === null ? "NV" : String(item.year),
      type: item.type,
      origin:
        [item.appellation, item.region, item.countryCode].filter(Boolean).join(", ") || "unknown",
      drinkAdvice: drinkAdvice ?? "",
      window: window ?? "",
      temperature: temperature ?? "",
      fridge: fridge ?? "",
      decanting,
      glass,
      servingBasis,
      stock,
      codes: `window ${a.drink.basis}/${a.drink.advice}; serving ${servingCode}${a.serving ? `/${a.serving.tier}` : ""}`,
      flag: flags.join("; "),
    };
  });
}

const cell = (s: string) => s.replace(/\|/g, "\\|") || " ";

export function sampleMarkdown(): string {
  const rows = sampleRows();
  const flagged = rows.filter((r) => r.flag !== "").length;
  return [
    "# Sommelier V1+ — annotation sample for human review (50 wines)",
    "",
    "> **NOT REVIEWED. No person has checked this sample yet.** It is the input for the closeout's gate line",
    '> "Annotation correctness: … a checked sample of 50, reviewed by a person" (`SOMMELIER_CLOSEOUT.md` §5). Until a',
    "> wine professional has ticked every row, the gate line is open.",
    "",
    "Generated by the app's own code, with no model: `pnpm --filter @cellr/sommelier-eval run annotation-sample --write`",
    "and then `pnpm prettier --write` on this file (`scripts/sommelier-eval/annotation-sample.ts`; a test fails when this",
    "file and the code disagree). The day is",
    `${NOW.toISOString().slice(0, 10)}, as in the eval (\`fixtures.ts\`). Rows 1–30 are the eval cellar's 30 wines`,
    "(`wines.ts`, invented producer, two bottles each, no profile); rows 31–50 are 20 more, chosen to reach the rules",
    "(a researched profile, the AI's window, old reds, sweet and fortified wines, a wine known only by its colour, NV,",
    "reservations and places). Producers are invented.",
    "",
    "**What each column is** (the screen's English words, `apps/web/messages/en.json`, split at each `·`):",
    "",
    "- _Drink advice_ and _Window_: the card's keeping line (`annotate.drink.*`, `annotate.window.*`,",
    "  `annotate.windowBasis.*`). The window is the one the app already shows; the part makes no new estimate.",
    "- _Temperature_, _Fridge_, _Decanting_, _Glass_, _Serving basis_: the card's serving line in full (as for a",
    '  "how do I serve it" question). "(nothing said)" under Decanting: the code makes no decanting claim (only the',
    "  colour is known).",
    "- _Stock and places_: the card's second line (bottles free to open when some are reserved; every place when",
    "  there is more than one). Empty: nothing beyond what the card itself shows.",
    "- _Code basis_: what the advice rests on, as the code records it (`window own|profile|style / advice`;",
    "  `serving profile|style|colour|none / evidence tier`).",
    `- _Flag_: the code's own lowest-confidence bases (a rule of thumb for the style or the colour, a window`,
    `  estimated for the style). ${flagged} of 50 rows carry one. The flag is not a judgement of the wine.`,
    "",
    "**For the reviewer:** put ✓ in _OK_ when every statement in the row is right for that wine and vintage on",
    `${NOW.toISOString().slice(0, 10)}, ✗ when one is not, and write what it should say in _Correction_. Judge the words as`,
    'a guest would read them on the card ("about" and "rule of thumb" are meant as such).',
    "",
    "| # | Wine | Vintage | Type | Appellation, region | Drink advice | Window | Temperature | Fridge | Decanting | Glass | Serving basis | Stock and places | Code basis | Flag | OK | Correction |",
    "| --: | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | :-: | --- |",
    ...rows.map(
      (r) =>
        `| ${r.n} | ${cell(r.wine)} | ${r.vintage} | ${r.type} | ${cell(r.origin)} | ${cell(r.drinkAdvice)} | ${cell(r.window)} | ${cell(r.temperature)} | ${cell(r.fridge)} | ${cell(r.decanting)} | ${cell(r.glass)} | ${cell(r.servingBasis)} | ${cell(r.stock)} | ${cell(r.codes)} | ${cell(r.flag)} | ☐ |   |`,
    ),
    "",
    "Reviewed by: _(name, role)_ · Date: _(date)_ · Rows ✓: _ / 50",
    "",
  ].join("\n");
}

/**
 * The file as compared by the test: prettier pads the table's cells and lengthens its delimiter row, which says
 * nothing; every cell's text, and every other line, must be the same.
 */
export function normalizeMarkdown(md: string): string {
  return md
    .split("\n")
    .map((line) =>
      line.startsWith("|")
        ? line
            .split(/(?<!\\)\|/)
            .map((c) => c.trim().replace(/^(:?)-+(:?)$/, "$1-$2"))
            .join("|")
        : line,
    )
    .join("\n")
    .trim();
}

export const SAMPLE_PATH = new URL(
  "../../docs/sprints/sommelier-3-mega/results/p4-annotation-sample.md",
  import.meta.url,
);

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values: args } = parseArgs({ options: { write: { type: "boolean", default: false } } });
  const md = sampleMarkdown();
  if (args.write) await writeFile(SAMPLE_PATH, md);
  else console.log(md);
}
