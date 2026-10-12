import { z } from "zod";
import { normalizeText, type StorageKind, type WineType } from "./cellar";
import { nextFreeSlots } from "./placement";

/**
 * MOVING HOUSE: reads a backup of the old Wijnkelder app and works out, without touching anything, what it
 * would become in CELLR — one wine per wine, one bottle per physical bottle (the old app kept a count),
 * racks with spots, bottles you opened, tasting notes, favourites. The plan is shown as a report before a
 * single row is written; what cannot be understood is said so, never guessed in silence.
 */

// ---- Reading the file -----------------------------------------------------------------------------------

const loose = z.record(z.string(), z.unknown());

const BackupSchema = z.object({
  app: z.literal("wijnkelder"),
  versie: z.number().optional(),
  flessen: z.array(loose).default([]),
  notities: z.array(loose).default([]),
  historie: z.array(loose).default([]),
  instellingen: loose.optional(),
});
export type WijnkelderBackup = z.infer<typeof BackupSchema>;

export type ParsedBackup =
  { ok: true; backup: WijnkelderBackup } | { ok: false; error: "not-json" | "not-wijnkelder" };

export function parseWijnkelderBackup(text: string): ParsedBackup {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "not-json" };
  }
  const parsed = BackupSchema.safeParse(raw);
  return parsed.success
    ? { ok: true, backup: parsed.data }
    : { ok: false, error: "not-wijnkelder" };
}

/**
 * Only what the planner reads. The old app kept label photos inside the backup; those are megabytes the
 * server has no use for, so the browser strips them before sending.
 */
const pick = (r: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> =>
  Object.fromEntries(keys.flatMap((k) => (k in r ? [[k, r[k]] as const] : [])));
const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const WINE_KEYS = [
  "naam",
  "producent",
  "land",
  "regio",
  "appellatie",
  "kleur",
  "jaargang",
  "aankoopPrijs",
] as const;
const PLACE_KEYS = ["kelder", "rek", "rij", "vak"] as const;

export function slimWijnkelderBackup(backup: WijnkelderBackup): WijnkelderBackup {
  const snapshot = (v: unknown) =>
    v && typeof v === "object" ? { momentopname: pick(asRecord(v), WINE_KEYS) } : {};
  return {
    app: "wijnkelder",
    flessen: backup.flessen.map((f) => ({
      ...pick(f, [
        ...WINE_KEYS,
        "id",
        "aantal",
        "formaat",
        "aankoopDatum",
        "leverancier",
        "favoriet",
        "notitie",
        "score",
        "aangemaakt",
      ]),
      ...(f.locatie && typeof f.locatie === "object"
        ? { locatie: pick(asRecord(f.locatie), PLACE_KEYS) }
        : {}),
    })),
    notities: backup.notities.map((n) => ({
      ...pick(n, ["flesId", "datum", "score", "tekst", "geur", "smaak"]),
      ...snapshot(n.momentopname),
    })),
    historie: backup.historie.map((h) => ({
      ...pick(h, ["type", "flesId", "aantal", "datum", "score"]),
      ...snapshot(h.momentopname),
    })),
  };
}

// ---- Little readers: tolerant of what an old, hand-edited file may contain ------------------------------

const text = (v: unknown): string =>
  typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.trim().replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
};
const isoDay = (v: unknown): string | null => {
  const s = text(v);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : `${m[1]}-${m[2]}-${m[3]}`;
};

const TYPE_BY_COLOUR: Record<string, WineType> = {
  rood: "red",
  red: "red",
  wit: "white",
  white: "white",
  rose: "rose",
  rosé: "rose",
  mousserend: "sparkling",
  sparkling: "sparkling",
  zoet: "dessert",
  dessert: "dessert",
  versterkt: "fortified",
  fortified: "fortified",
  oranje: "orange",
  orange: "orange",
};

/** Countries by the names people typed, Dutch or English, without accents. */
const COUNTRY_BY_NAME: Record<string, string> = {
  frankrijk: "FR",
  france: "FR",
  italie: "IT",
  italy: "IT",
  spanje: "ES",
  spain: "ES",
  portugal: "PT",
  duitsland: "DE",
  germany: "DE",
  oostenrijk: "AT",
  austria: "AT",
  zwitserland: "CH",
  switzerland: "CH",
  "verenigde staten": "US",
  "verenigde staten van amerika": "US",
  vs: "US",
  usa: "US",
  amerika: "US",
  "united states": "US",
  californie: "US",
  argentinie: "AR",
  argentina: "AR",
  chili: "CL",
  chile: "CL",
  australie: "AU",
  australia: "AU",
  "nieuw zeeland": "NZ",
  "new zealand": "NZ",
  "zuid afrika": "ZA",
  "south africa": "ZA",
  griekenland: "GR",
  greece: "GR",
  hongarije: "HU",
  hungary: "HU",
  slovenie: "SI",
  slovenia: "SI",
  kroatie: "HR",
  croatia: "HR",
  roemenie: "RO",
  romania: "RO",
  georgie: "GE",
  georgia: "GE",
  libanon: "LB",
  lebanon: "LB",
  uruguay: "UY",
  brazilie: "BR",
  brazil: "BR",
  canada: "CA",
  bulgarije: "BG",
  bulgaria: "BG",
  tsjechie: "CZ",
  "czech republic": "CZ",
  slowakije: "SK",
  slovakia: "SK",
  israel: "IL",
  turkije: "TR",
  turkey: "TR",
  moldavie: "MD",
  moldova: "MD",
  china: "CN",
  japan: "JP",
  engeland: "GB",
  "verenigd koninkrijk": "GB",
  "united kingdom": "GB",
  uk: "GB",
  england: "GB",
  nederland: "NL",
  netherlands: "NL",
  belgie: "BE",
  belgium: "BE",
  luxemburg: "LU",
  luxembourg: "LU",
  mexico: "MX",
  peru: "PE",
};

/** Bottle sizes by their old names, in millilitres. */
const FORMAT_ML: Record<string, number> = {
  fles: 750,
  standaard: 750,
  standard: 750,
  bottle: 750,
  halve: 375,
  "halve fles": 375,
  half: 375,
  kwart: 187,
  split: 187,
  piccolo: 187,
  liter: 1000,
  magnum: 1500,
  "dubbele magnum": 3000,
  jeroboam: 3000,
  rehoboam: 4500,
  imperial: 6000,
  methusalem: 6000,
};

const MAX_UNIT = 30; // the biggest rack the app draws, either way
const MAX_PER_WINE = 200;
const FLOOR_YEAR = 1800;
const CEILING_YEAR = 2100;

// ---- The plan ---------------------------------------------------------------------------------------------

export type ScoreScale = 5 | 10 | 100;

export interface PlannedUnit {
  key: string;
  label: string;
  kind: StorageKind;
  rows: number;
  cols: number;
}
export interface PlannedWine {
  key: string;
  producer: string;
  name: string;
  type: WineType;
  countryCode: string | null;
  region: string | null;
  appellation: string | null;
  favorite: boolean;
}
export interface PlannedBottle {
  key: string;
  wineKey: string;
  year: number | null;
  status: "in_cellar" | "opened";
  formatMl: number;
  priceCents: number | null;
  purchasedAt: string | null;
  purchasedFrom: string | null;
  notes: string | null;
  unitKey: string | null;
  row: number | null;
  col: number | null;
  /** ISO timestamp, for opened bottles. */
  openedAt: string | null;
}
export interface PlannedTasting {
  wineKey: string;
  year: number | null;
  /** The opened bottle it is about, when it could be told. */
  bottleKey: string | null;
  /** 1..10 (half stars). */
  score: number | null;
  note: string | null;
  tastedAt: string;
}

export const IMPORT_WARNINGS = [
  "country-unknown",
  "year-invalid",
  "producer-missing",
  "type-unknown",
  "price-invalid",
  "date-invalid",
  "format-unknown",
  "quantity-capped",
  "rack-too-big",
  "spot-taken",
] as const;
export type ImportWarning = (typeof IMPORT_WARNINGS)[number];

export interface ImportReport {
  scoreScale: ScoreScale | null;
  counts: {
    wines: number;
    bottlesInCellar: number;
    bottlesOpened: number;
    units: number;
    tastings: number;
    favorites: number;
    unplaced: number;
  };
  /** What was understood only partly, with how often and one example. */
  warnings: Array<{ code: ImportWarning; count: number; example: string }>;
  /** What could not be used at all, and why. */
  skipped: Array<{
    what: "bottle" | "note" | "history";
    reason: "no-name" | "unknown-bottle" | "no-content";
    example: string;
  }>;
}

export interface ImportPlan {
  units: PlannedUnit[];
  wines: PlannedWine[];
  bottles: PlannedBottle[];
  tastings: PlannedTasting[];
  report: ImportReport;
}

export const ImportRequestSchema = z.object({
  backup: BackupSchema,
  /** true = only work out and report what would happen; nothing is written. */
  dryRun: z.boolean().default(true),
  /** Which scale old scores were on; detected from the file when left out. */
  scoreScale: z.union([z.literal(5), z.literal(10), z.literal(100)]).optional(),
});
export type ImportRequest = z.infer<typeof ImportRequestSchema>;

/** What an import did (or, for a dry run, would do). */
export interface ImportOutcome {
  committed: boolean;
  report: ImportReport;
  /** What was written; null for a dry run. */
  written: {
    units: number;
    wines: number;
    /** Bottles that now stand in the cellar. */
    bottles: number;
    /** Bottles that were already opened. */
    opened: number;
    tastings: number;
    favorites: number;
    /** Ratings are switched off until the database step has been run; the rest still went in. */
    tastingsSkipped: boolean;
  } | null;
}

export function detectScoreScale(scores: readonly number[]): ScoreScale | null {
  const positive = scores.filter((s) => s > 0);
  if (positive.length === 0) return null;
  const max = Math.max(...positive);
  return max <= 5 ? 5 : max <= 10 ? 10 : 100;
}

/** An old score to half stars (1..10), on the scale the old app was used with. */
export function toHalfStars(score: number | null, scale: ScoreScale | null): number | null {
  if (score === null || score <= 0 || scale === null) return null;
  const stars = scale === 5 ? score * 2 : scale === 10 ? score : score / 10;
  return Math.min(10, Math.max(1, Math.round(stars)));
}

interface WineFacts {
  name: string;
  producer: string;
  type: WineType;
  countryCode: string | null;
  region: string | null;
  appellation: string | null;
  year: number | null;
}

export interface PlanOptions {
  /** Which scale old scores were on; detected from the file when left out. */
  scoreScale?: ScoreScale | undefined;
}

export function planWijnkelderImport(
  backup: WijnkelderBackup,
  options: PlanOptions = {},
): ImportPlan {
  const warnings = new Map<ImportWarning, { count: number; example: string }>();
  const warn = (code: ImportWarning, example: string) => {
    const known = warnings.get(code);
    if (known) known.count += 1;
    else warnings.set(code, { count: 1, example });
  };
  const skipped: ImportReport["skipped"] = [];
  const skip = (
    what: "bottle" | "note" | "history",
    reason: ImportReport["skipped"][number]["reason"],
    example: string,
  ) => {
    if (!skipped.some((s) => s.what === what && s.reason === reason))
      skipped.push({ what, reason, example });
  };

  // Scores from everywhere in the file decide the scale (unless it was given).
  const allScores = [
    ...backup.flessen.map((f) => num(f.score)),
    ...backup.notities.map((n) => num(n.score)),
    ...backup.historie.map((h) => num(h.score)),
  ].filter((s): s is number => s !== null);
  const scale = options.scoreScale ?? detectScoreScale(allScores);

  /** Facts about a wine, from a bottle record or from the snapshot an old note or history entry kept. */
  const factsOf = (r: Record<string, unknown>, label: string): WineFacts | null => {
    const name = text(r.naam);
    if (name === "") return null;
    let producer = text(r.producent);
    if (producer === "") {
      producer = "Unknown producer";
      warn("producer-missing", name);
    }
    const colour = normalizeText(text(r.kleur));
    const type = TYPE_BY_COLOUR[colour] ?? TYPE_BY_COLOUR[text(r.kleur).toLowerCase()];
    if (!type) warn("type-unknown", `${label}: “${text(r.kleur) || "(empty)"}”`);
    const countryText = normalizeText(text(r.land));
    const countryCode = countryText === "" ? null : (COUNTRY_BY_NAME[countryText] ?? null);
    if (countryText !== "" && countryCode === null) warn("country-unknown", text(r.land));
    const yearRaw = num(r.jaargang);
    let year: number | null = null;
    if (yearRaw !== null) {
      if (Number.isInteger(yearRaw) && yearRaw >= FLOOR_YEAR && yearRaw <= CEILING_YEAR)
        year = yearRaw;
      else warn("year-invalid", `${name}: ${String(r.jaargang)}`);
    }
    return {
      name,
      producer,
      type: type ?? "red",
      countryCode,
      region: text(r.regio) || null,
      appellation: text(r.appellatie) || null,
      year,
    };
  };

  const wines = new Map<string, PlannedWine>();
  const wineFor = (f: WineFacts, favorite = false): PlannedWine => {
    const key = normalizeText(`${f.producer}|${f.name}|${f.type}`);
    const known = wines.get(key);
    if (known) {
      known.favorite ||= favorite;
      return known;
    }
    const wine: PlannedWine = {
      key,
      producer: f.producer,
      name: f.name,
      type: f.type,
      countryCode: f.countryCode,
      region: f.region,
      appellation: f.appellation,
      favorite,
    };
    wines.set(key, wine);
    return wine;
  };

  // ---- Racks: one unit per (cellar, rack), as big as the spots in use ------------------------------------
  const rackOf = (f: Record<string, unknown>) => {
    const place = (f.locatie && typeof f.locatie === "object" ? f.locatie : {}) as Record<
      string,
      unknown
    >;
    return {
      cellar: text(place.kelder),
      rack: text(place.rek),
      row: num(place.rij),
      col: num(place.vak),
    };
  };
  const rackKeys = new Set<string>();
  const rackSizes = new Map<string, { rows: number; cols: number; count: number }>();
  for (const f of backup.flessen) {
    const p = rackOf(f);
    if (p.row === null || p.col === null || p.row < 1 || p.col < 1 || text(f.naam) === "") continue;
    const key = `${p.cellar}|${p.rack}`;
    rackKeys.add(key);
    const size = rackSizes.get(key) ?? { rows: 1, cols: 1, count: 0 };
    size.rows = Math.max(size.rows, Math.floor(p.row));
    size.cols = Math.max(size.cols, Math.floor(p.col));
    // Every bottle of a count needs a spot of its own, so the rack must be big enough for all of them.
    size.count += Math.min(MAX_PER_WINE, Math.max(0, Math.floor(num(f.aantal) ?? 1)));
    rackSizes.set(key, size);
  }
  for (const size of rackSizes.values()) {
    if (size.rows * size.cols >= size.count) continue;
    size.cols = Math.min(MAX_UNIT, Math.max(size.cols, Math.ceil(size.count / size.rows)));
    if (size.rows * size.cols < size.count)
      size.rows = Math.min(MAX_UNIT, Math.ceil(size.count / size.cols));
  }
  const labels = new Map<string, string>();
  const used = new Set<string>();
  const cellars = new Set([...rackKeys].map((k) => k.split("|")[0]));
  for (const key of [...rackKeys].sort()) {
    const [cellar, rack] = key.split("|") as [string, string];
    let label =
      rackKeys.size === 1 && !rack
        ? cellar || "Rack"
        : rack
          ? [cellars.size > 1 ? cellar : "", `Rack ${rack}`].filter(Boolean).join(" · ")
          : cellar || "Rack";
    for (let n = 2; used.has(label); n++) label = `${label} (${n})`;
    used.add(label.toLowerCase());
    used.add(label);
    labels.set(key, label);
  }
  const units: PlannedUnit[] = [...rackKeys].sort().map((key) => {
    const size = rackSizes.get(key)!;
    if (size.rows > MAX_UNIT || size.cols > MAX_UNIT) warn("rack-too-big", labels.get(key)!);
    return {
      key,
      label: labels.get(key)!,
      kind: "rack",
      rows: Math.min(MAX_UNIT, size.rows),
      cols: Math.min(MAX_UNIT, size.cols),
    };
  });
  const unitByKey = new Map(units.map((u) => [u.key, u]));
  const taken = new Map<string, Array<{ row: number; col: number }>>(units.map((u) => [u.key, []]));

  // ---- Bottles in the cellar: one per unit of the old count ------------------------------------------------
  const bottles: PlannedBottle[] = [];
  const idToWine = new Map<string, { wine: PlannedWine; year: number | null }>();
  let serial = 0;
  for (const f of backup.flessen) {
    const label = text(f.naam) || "(no name)";
    const facts = factsOf(f, label);
    if (!facts) {
      skip("bottle", "no-name", label);
      continue;
    }
    const wine = wineFor(facts, f.favoriet === true);
    if (typeof f.id === "string") idToWine.set(f.id, { wine, year: facts.year });

    let quantity = Math.max(0, Math.floor(num(f.aantal) ?? 1));
    if (quantity > MAX_PER_WINE) {
      warn("quantity-capped", `${facts.name}: ${quantity}`);
      quantity = MAX_PER_WINE;
    }
    const formatText = normalizeText(text(f.formaat));
    const formatMl = formatText === "" ? 750 : (FORMAT_ML[formatText] ?? 750);
    if (formatText !== "" && !(formatText in FORMAT_ML)) warn("format-unknown", text(f.formaat));

    const priceRaw = num(f.aankoopPrijs);
    let priceCents: number | null = null;
    if (priceRaw !== null) {
      if (priceRaw >= 0 && priceRaw <= 1_000_000) priceCents = Math.round(priceRaw * 100);
      else warn("price-invalid", `${facts.name}: ${String(f.aankoopPrijs)}`);
    }
    const purchasedAt = isoDay(f.aankoopDatum);
    if (text(f.aankoopDatum) !== "" && purchasedAt === null)
      warn("date-invalid", `${facts.name}: ${text(f.aankoopDatum)}`);

    const place = rackOf(f);
    const unit = unitByKey.get(`${place.cellar}|${place.rack}`);
    const wanted =
      unit && place.row !== null && place.col !== null && place.row >= 1 && place.col >= 1
        ? { row: Math.floor(place.row), col: Math.floor(place.col) }
        : null;

    for (let i = 0; i < quantity; i++) {
      let spot: { unitKey: string; row: number; col: number } | null = null;
      if (unit) {
        const occupied = taken.get(unit.key)!;
        const free = (r: number, c: number) =>
          r <= unit.rows && c <= unit.cols && !occupied.some((o) => o.row === r && o.col === c);
        if (i === 0 && wanted && free(wanted.row, wanted.col))
          spot = { unitKey: unit.key, ...wanted };
        else {
          if (i === 0 && wanted)
            warn("spot-taken", `${facts.name}: ${unit.label} ${wanted.row}/${wanted.col}`);
          const [next] = nextFreeSlots({ rows: unit.rows, cols: unit.cols }, occupied, 1);
          if (next) spot = { unitKey: unit.key, row: next.row, col: next.col };
        }
        if (spot) occupied.push({ row: spot.row, col: spot.col });
      }
      bottles.push({
        key: `b${++serial}`,
        wineKey: wine.key,
        year: facts.year,
        status: "in_cellar",
        formatMl,
        priceCents,
        purchasedAt,
        purchasedFrom: text(f.leverancier) || null,
        notes: text(f.notitie) || null,
        unitKey: spot?.unitKey ?? null,
        row: spot?.row ?? null,
        col: spot?.col ?? null,
        openedAt: null,
      });
    }
  }

  // ---- What was opened: the history, one bottle per glass of the old count ----------------------------------
  const openedByEntry = new Map<string, string[]>(); // `${flesId}|${day}` → bottle keys
  for (const h of backup.historie) {
    if (text(h.type) !== "gedronken") continue;
    const snapshot = (
      h.momentopname && typeof h.momentopname === "object" ? h.momentopname : {}
    ) as Record<string, unknown>;
    const id = text(h.flesId);
    const known = idToWine.get(id);
    const facts = known ? null : factsOf(snapshot, "history");
    if (!known && !facts) {
      skip("history", "unknown-bottle", text(snapshot.naam) || id || "(unknown)");
      continue;
    }
    const wine = known?.wine ?? wineFor(facts!);
    const year = known ? known.year : facts!.year;
    // A bottle that is only known from the history can still be the subject of a tasting note.
    if (!known && id) idToWine.set(id, { wine, year });
    const day = isoDay(h.datum);
    if (text(h.datum) !== "" && day === null)
      warn("date-invalid", `${wine.name}: ${text(h.datum)}`);
    const count = Math.min(MAX_PER_WINE, Math.max(1, Math.floor(num(h.aantal) ?? 1)));
    const keys: string[] = [];
    for (let i = 0; i < count; i++) {
      const key = `b${++serial}`;
      keys.push(key);
      bottles.push({
        key,
        wineKey: wine.key,
        year,
        status: "opened",
        formatMl: 750,
        priceCents: (() => {
          const p = num(snapshot.aankoopPrijs);
          return p !== null && p >= 0 && p <= 1_000_000 ? Math.round(p * 100) : null;
        })(),
        purchasedAt: null,
        purchasedFrom: null,
        notes: null,
        unitKey: null,
        row: null,
        col: null,
        openedAt: day ? `${day}T12:00:00.000Z` : null,
      });
    }
    openedByEntry.set(`${id}|${day ?? ""}`, [
      ...(openedByEntry.get(`${id}|${day ?? ""}`) ?? []),
      ...keys,
    ]);
  }

  // ---- Tasting notes, and scores given straight on a bottle -------------------------------------------------
  const tastings: PlannedTasting[] = [];
  const linked = new Set<string>();
  for (const n of backup.notities) {
    const snapshot = (
      n.momentopname && typeof n.momentopname === "object" ? n.momentopname : {}
    ) as Record<string, unknown>;
    const id = text(n.flesId);
    const known = idToWine.get(id);
    const facts = known ? null : factsOf(snapshot, "note");
    if (!known && !facts) {
      skip("note", "unknown-bottle", id || "(unknown)");
      continue;
    }
    const wine = known?.wine ?? wineFor(facts!);
    const year = known ? known.year : facts!.year;
    const score = toHalfStars(num(n.score), scale);
    const note = [
      text(n.tekst),
      text(n.geur) && `Nose: ${text(n.geur)}`,
      text(n.smaak) && `Palate: ${text(n.smaak)}`,
    ]
      .filter(Boolean)
      .join("\n");
    if (score === null && note === "") {
      skip("note", "no-content", wine.name);
      continue;
    }
    const day = isoDay(n.datum);
    const candidates = openedByEntry.get(`${id}|${day ?? ""}`) ?? [];
    const bottleKey = candidates.find((k) => !linked.has(k)) ?? null;
    if (bottleKey) linked.add(bottleKey);
    tastings.push({
      wineKey: wine.key,
      year,
      bottleKey,
      score,
      note: note === "" ? null : note.slice(0, 2000),
      tastedAt: `${day ?? "2000-01-01"}T12:00:00.000Z`,
    });
  }
  for (const f of backup.flessen) {
    const score = toHalfStars(num(f.score), scale);
    const known = typeof f.id === "string" ? idToWine.get(f.id) : undefined;
    if (score === null || !known) continue;
    tastings.push({
      wineKey: known.wine.key,
      year: known.year,
      bottleKey: null,
      score,
      note: null,
      tastedAt: `${isoDay(f.aangemaakt) ?? isoDay(new Date(num(f.aangemaakt) ?? 0).toISOString()) ?? "2000-01-01"}T12:00:00.000Z`,
    });
  }

  const inCellar = bottles.filter((b) => b.status === "in_cellar");
  return {
    units,
    wines: [...wines.values()],
    bottles,
    tastings,
    report: {
      scoreScale: scale,
      counts: {
        wines: wines.size,
        bottlesInCellar: inCellar.length,
        bottlesOpened: bottles.length - inCellar.length,
        units: units.length,
        tastings: tastings.length,
        favorites: [...wines.values()].filter((w) => w.favorite).length,
        unplaced: inCellar.filter((b) => b.unitKey === null).length,
      },
      warnings: [...warnings.entries()].map(([code, v]) => ({ code, ...v })),
      skipped,
    },
  };
}
