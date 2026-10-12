import { z } from "zod";
import type { DrinkPhase } from "./drink-window";
import type { ImageRef } from "./image";
import type { RatingSummary, TastingView } from "./tasting";

// ---- Vocabulary ---------------------------------------------------------------------------------
// These mirror the database enums (public.wine_type, public.location_kind). Add-only evolution.

export const WINE_TYPES = [
  "red",
  "white",
  "rose",
  "sparkling",
  "orange",
  "dessert",
  "fortified",
] as const;
export type WineType = (typeof WINE_TYPES)[number];

export const STORAGE_KINDS = ["fridge", "rack", "cabinet", "shelving", "wall", "other"] as const;
export type StorageKind = (typeof STORAGE_KINDS)[number];

/** Countries offered in the "new wine" form (ISO 3166-1 alpha-2), the big wine nations first. */
export const WINE_COUNTRIES = [
  "FR",
  "IT",
  "ES",
  "PT",
  "DE",
  "AT",
  "CH",
  "US",
  "AR",
  "CL",
  "AU",
  "NZ",
  "ZA",
  "GR",
  "HU",
  "SI",
  "HR",
  "RO",
  "GE",
  "LB",
  "UY",
  "BR",
  "CA",
  "BG",
  "CZ",
  "SK",
  "IL",
  "TR",
  "MD",
  "CN",
  "JP",
  "GB",
  "NL",
  "BE",
  "LU",
  "MX",
  "PE",
] as const;

/** One add-bottle action creates at most this many physical bottles (a case of 12, a few of those). */
export const MAX_BOTTLES_PER_ADD = 36;

// ---- Text normalisation ---------------------------------------------------------------------------

/** Letters that Unicode decomposition does not split but PostgreSQL's `unaccent` still folds. */
const FOLDS: Record<string, string> = {
  ß: "ss",
  æ: "ae",
  œ: "oe",
  ø: "o",
  đ: "d",
  ð: "d",
  ł: "l",
  þ: "th",
  ħ: "h",
  ı: "i",
};

/**
 * Same result as the database's `private.normalize_text`: lower-case, accents stripped, every run of
 * non-letters/digits collapsed to one space. ("Marqués de Riscal – Reserva" → "marques de riscal reserva")
 * Used to recognise "the same wine" when typed slightly differently. A SQL test pins the two together.
 */
export function normalizeText(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[ßæœøđðłþħı]/g, (c) => FOLDS[c] ?? c)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

// ---- Money ----------------------------------------------------------------------------------------

export const MAX_PRICE_CENTS = 10_000_000; // 100,000.00

/**
 * "24.50", "24,5", "€ 24", "1.234,50", "1,234.50" → whole cents. Blank → null. Anything that is not a
 * plain amount → `undefined`, so a form can tell "left blank" from "mistyped".
 * A lone separator followed by exactly three digits ("1.234") reads as thousands, not decimals.
 */
export function parseMoneyToCents(text: string): number | null | undefined {
  if (text.trim() === "") return null;
  const cleaned = text.replace(/[^\d.,]/g, "");
  if (!/\d/.test(cleaned)) return undefined;

  const lastSep = Math.max(cleaned.lastIndexOf("."), cleaned.lastIndexOf(","));
  let whole = cleaned;
  let fraction = "";
  if (lastSep !== -1) {
    const sep = cleaned.charAt(lastSep);
    const other = sep === "." ? "," : ".";
    const head = cleaned.slice(0, lastSep);
    const tail = cleaned.slice(lastSep + 1);
    const sepCount = cleaned.split(sep).length - 1;
    const thousands = tail.length === 3 && !cleaned.includes(other) && head !== "" && head !== "0";
    if (thousands) {
      whole = cleaned.replace(/[.,]/g, "");
    } else {
      if (tail.length > 2 || (sepCount > 1 && !cleaned.includes(other))) return undefined;
      whole = head.replace(/[.,]/g, "");
      fraction = tail;
    }
  }
  const cents = Number(whole || "0") * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents <= MAX_PRICE_CENTS ? cents : undefined;
}

// ---- Wine ---------------------------------------------------------------------------------------

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? undefined : v))
    .optional();

export const CountryCodeSchema = z.string().regex(/^[A-Z]{2}$/, "Use a 2-letter country code.");

export const CreateWineSchema = z.object({
  producer: z.string().trim().min(1, "Who makes it?").max(120),
  name: z.string().trim().min(1, "What is it called?").max(160),
  type: z.enum(WINE_TYPES),
  countryCode: CountryCodeSchema.optional(),
  region: optionalText(120),
});
export type CreateWine = z.infer<typeof CreateWineSchema>;

// ---- Bottles ------------------------------------------------------------------------------------

/** A calendar year, or null for non-vintage. */
export const VintageYearSchema = z.number().int().min(1800).max(2100).nullable();

export const AddBottlesSchema = z.object({
  wineId: z.uuid(),
  year: VintageYearSchema,
  quantity: z.number().int().min(1).max(MAX_BOTTLES_PER_ADD),
  /** Where they go. null = not placed yet. With a place, bottles take the next free spots in order. */
  locationId: z.uuid().nullable().default(null),
  /** Price paid PER BOTTLE, in the household's currency. */
  priceCents: z.number().int().min(0).max(MAX_PRICE_CENTS).nullable().default(null),
  purchasedAt: z.iso.date().nullable().default(null),
  formatMl: z.number().int().min(100).max(30000).default(750),
  /** A label photo already uploaded (from a scan or the camera); bottles of a known vintage share its photo. */
  imageId: z.uuid().optional(),
});
export type AddBottles = z.infer<typeof AddBottlesSchema>;

// ---- Storage ------------------------------------------------------------------------------------

export const CreateStorageSchema = z.object({
  label: z.string().trim().min(1, "Give it a name.").max(40),
  kind: z.enum(STORAGE_KINDS).default("fridge"),
  /** Shelves (rows). */
  rows: z.number().int().min(1).max(30),
  /** Positions per shelf (columns). */
  cols: z.number().int().min(1).max(30),
});
export type CreateStorage = z.infer<typeof CreateStorageSchema>;

/** Rename, re-kind or resize a place. A place cannot shrink past bottles still standing in it. */
export const UpdateStorageSchema = z
  .object({
    label: z.string().trim().min(1, "Give it a name.").max(40),
    kind: z.enum(STORAGE_KINDS),
    rows: z.number().int().min(1).max(30),
    cols: z.number().int().min(1).max(30),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update.");
export type UpdateStorage = z.infer<typeof UpdateStorageSchema>;

// ---- Read models (what /api/v1 returns) ------------------------------------------------------------

export interface WineSummary {
  id: string;
  producer: string;
  name: string;
  type: WineType;
  countryCode: string | null;
  region: string | null;
}

export interface StorageUnitView {
  id: string;
  label: string;
  kind: StorageKind;
  rows: number;
  cols: number;
  capacity: number;
  used: number;
  free: number;
}

/** Where a wine stands in its (estimated) drinking window. */
export interface DrinkSummary {
  phase: DrinkPhase;
  /** Calendar years of the estimated window, or null when there is none (non-vintage). */
  from: number | null;
  until: number | null;
  /** Lower = more pressing to open. */
  urgency: number;
  /** Years until the window opens (negative once it has) and until it closes. */
  yearsUntilOpen: number | null;
  yearsLeft: number | null;
  /** 0 = start of the window, 1 = end (below/above when not yet / past). */
  position: number | null;
}

/** One card in the cellar: one vintage of one wine, however many bottles of it are in the house. */
export interface CellarItem {
  vintageId: string;
  wineId: string;
  producer: string;
  wineName: string;
  type: WineType;
  year: number | null;
  region: string | null;
  countryCode: string | null;
  /** Bottles of this vintage currently in the cellar. */
  count: number;
  /** Distinct storage places holding them (labels), in order of appearance. */
  places: string[];
  /** Bottles with no place yet. */
  unplaced: number;
  /** The label photo, when there is one. */
  image: ImageRef | null;
  /** Whether the signed-in person has starred this wine (personal, not shared with the household). */
  favorite: boolean;
  /** What the household thought of it, or null while nobody has rated it. */
  rating: RatingSummary | null;
  /** When to drink it (an estimate: see drink-window). */
  drink: DrinkSummary;
}

export interface CellarView {
  items: CellarItem[];
  /** Total bottles currently in the cellar (the sum of every item's count). */
  bottleCount: number;
}

/** A bottle that was opened: what it was and when. */
export interface OpenedEntry {
  bottleId: string;
  vintageId: string;
  producer: string;
  wineName: string;
  type: WineType;
  year: number | null;
  openedAt: string;
  /** The signed-in person's stars for it (1..10), or null if they have not rated it. */
  myScore: number | null;
  /** The signed-in person has said something about it (stars, words or a note). */
  rated: boolean;
}

/** Everything the Home screen shows, in one go. */
export interface HomeView {
  /** When this was put together (ISO), so "3 days ago" is measured against the same clock everywhere. */
  generatedAt: string;
  bottleCount: number;
  wineCount: number;
  /** Sum of the known purchase prices of the bottles in the cellar, or null when none is known. */
  valueCents: number | null;
  /** How many bottles that sum is built from (the rest have no price recorded). */
  pricedCount: number;
  currency: string | null;
  /** Spots across all storage places, and how many are taken. */
  capacity: number;
  used: number;
  /** Bottles in the cellar that have no place yet. */
  unplaced: number;
  /** Newest additions first. */
  recentlyAdded: CellarItem[];
  /** The ones to open first: at the end of their window or past it, most pressing first (at most three). */
  drinkSoon: CellarItem[];
  /** Newest first. */
  recentlyOpened: OpenedEntry[];
}

export interface AddBottlesResult {
  wine: WineSummary;
  year: number | null;
  bottleIds: string[];
  placed: number;
  unplaced: number;
  /** Label of the storage unit they were placed in, if any. */
  placeLabel: string | null;
}

// ---- Presentation helpers (pure) --------------------------------------------------------------------

/** "2019", or "NV" for non-vintage. */
export const formatVintage = (year: number | null): string => (year === null ? "NV" : String(year));

/** Case-insensitive, accent-insensitive "does every word typed appear in the card's text?" */
export function matchesSearch(haystack: readonly string[], query: string): boolean {
  const words = normalizeText(query).split(" ").filter(Boolean);
  if (words.length === 0) return true;
  const text = normalizeText(haystack.join(" "));
  return words.every((w) => text.includes(w));
}

// ---- Bottle actions: open, move, restore, remove -----------------------------------------------------

export const BOTTLE_STATUSES = ["in_cellar", "opened", "gifted", "removed"] as const;
export type BottleStatus = (typeof BOTTLE_STATUSES)[number];

const SlotNumberSchema = z.number().int().min(1).max(30);

/** A place and a spot in it — or nothing at all ("not placed"). All three move together. */
const PlacementSchema = z
  .object({
    locationId: z.uuid().nullable().default(null),
    row: SlotNumberSchema.nullable().default(null),
    col: SlotNumberSchema.nullable().default(null),
  })
  .refine(
    (p) => (p.locationId === null) === (p.row === null) && (p.row === null) === (p.col === null),
    "A place needs a shelf and a position.",
  );

export const BottleActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("open") }),
  z.object({ action: z.literal("remove") }),
  z.object({ action: z.literal("move"), to: PlacementSchema }),
  /** Undo for "open" / "remove": back in the cellar, in `to` if it is still free. */
  z.object({
    action: z.literal("restore"),
    to: PlacementSchema.default({ locationId: null, row: null, col: null }),
  }),
]);
export type BottleAction = z.infer<typeof BottleActionSchema>;

const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable();

/** Fields a person can correct on a wine they added themselves. Producer and colour are fixed. */
export const UpdateWineSchema = z
  .object({
    name: z.string().trim().min(1, "What is it called?").max(160),
    region: nullableText(120),
    countryCode: CountryCodeSchema.nullable(),
    appellation: nullableText(160),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update.");
export type UpdateWine = z.infer<typeof UpdateWineSchema>;

/** What was paid and where: applies to every bottle of the vintage that is still in the cellar. */
export const UpdatePurchaseSchema = z
  .object({
    priceCents: z.number().int().min(0).max(MAX_PRICE_CENTS).nullable(),
    purchasedAt: z.iso.date().nullable(),
    purchasedFrom: nullableText(120),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update.");
export type UpdatePurchase = z.infer<typeof UpdatePurchaseSchema>;

/** Starring a wine is personal: it is yours alone, even in a shared household. */
export const SetFavoriteSchema = z.object({ favorite: z.boolean() });
export type SetFavorite = z.infer<typeof SetFavoriteSchema>;

export interface BottleView {
  id: string;
  status: BottleStatus;
  locationId: string | null;
  locationLabel: string | null;
  row: number | null;
  col: number | null;
  priceCents: number | null;
  currency: string | null;
  purchasedAt: string | null;
  addedAt: string;
  openedAt: string | null;
}

export interface WineDetail extends WineSummary {
  appellation: string | null;
  /** Whether the signed-in person has starred this wine. */
  favorite: boolean;
}

/** One vintage of one wine: what you own, where it is, what it cost, and what you have already opened. */
export interface VintageDetail {
  vintageId: string;
  /** When to drink it (an estimate), from this wine's region, colour, label words and what it cost. */
  drink: DrinkSummary;
  wine: WineDetail;
  year: number | null;
  /** The label photo, when there is one. */
  image: ImageRef | null;
  /** In the cellar now, in a stable order: placed ones by place, shelf and position, then unplaced. */
  bottles: BottleView[];
  /** The most recently opened ones, newest first. */
  opened: BottleView[];
  /** What people in the household said about it, newest first. */
  tastings: TastingView[];
  /** Mean of the known prices of the bottles in the cellar, or null when none is known. */
  averagePriceCents: number | null;
  currency: string | null;
}

export interface BottleActionResult {
  bottle: BottleView;
  /** Where it was before the action, so the caller can offer Undo. */
  previous: { locationId: string | null; row: number | null; col: number | null };
}

/** Placed bottles by place, shelf and position; bottles without a place last. Never mutates its input. */
export function orderBottles<
  T extends Pick<BottleView, "locationLabel" | "row" | "col" | "addedAt">,
>(bottles: readonly T[]): T[] {
  return [...bottles].sort((a, b) => {
    const placedA = a.locationLabel !== null;
    const placedB = b.locationLabel !== null;
    if (placedA !== placedB) return placedA ? -1 : 1;
    return (
      (a.locationLabel ?? "").localeCompare(b.locationLabel ?? "") ||
      (a.row ?? 0) - (b.row ?? 0) ||
      (a.col ?? 0) - (b.col ?? 0) ||
      a.addedAt.localeCompare(b.addedAt)
    );
  });
}

/** "Wine fridge ×2, Cabinet ×1, Not placed ×1" as data: [{label, count}], placed first. */
export function summarizePlaces(
  bottles: readonly Pick<BottleView, "locationLabel">[],
): Array<{ label: string | null; count: number }> {
  const counts = new Map<string | null, number>();
  for (const b of bottles) counts.set(b.locationLabel, (counts.get(b.locationLabel) ?? 0) + 1);
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) =>
      a.label === null ? 1 : b.label === null ? -1 : a.label.localeCompare(b.label),
    );
}

/** Mean price of the bottles whose price is known, in whole cents; null if none is. */
export function averagePrice(bottles: readonly Pick<BottleView, "priceCents">[]): number | null {
  const known = bottles.flatMap((b) => (b.priceCents === null ? [] : [b.priceCents]));
  return known.length === 0 ? null : Math.round(known.reduce((s, c) => s + c, 0) / known.length);
}

// ---- History (derived from the bottles themselves) ---------------------------------------------------

export interface HistoryEvent {
  kind: "added" | "opened";
  /** The calendar day, YYYY-MM-DD. */
  day: string;
  count: number;
}

/** "3 bottles added on 3 Oct", "1 opened on 12 Oct" — newest first, same-day actions merged. */
export function historyEvents(
  bottles: readonly Pick<BottleView, "addedAt" | "openedAt">[],
  limit = 8,
): HistoryEvent[] {
  const tally = new Map<string, HistoryEvent>();
  const bump = (kind: HistoryEvent["kind"], iso: string) => {
    const day = iso.slice(0, 10);
    const key = `${kind}:${day}`;
    const existing = tally.get(key);
    if (existing) existing.count += 1;
    else tally.set(key, { kind, day, count: 1 });
  };
  for (const b of bottles) {
    bump("added", b.addedAt);
    if (b.openedAt) bump("opened", b.openedAt);
  }
  return [...tally.values()]
    .sort((a, b) => b.day.localeCompare(a.day) || (a.kind === "opened" ? -1 : 1))
    .slice(0, limit);
}

// ---- Racks: every storage unit with what sits in each spot ----------------------------------------------

/** One physical bottle, as the racks view needs it. `row`/`col` are null while it has no place. */
export interface PlacedBottle {
  bottleId: string;
  vintageId: string;
  producer: string;
  wineName: string;
  type: WineType;
  year: number | null;
  region: string | null;
  countryCode: string | null;
  row: number | null;
  col: number | null;
  /** The label photo, when there is one. */
  image: ImageRef | null;
}

export interface RackUnit extends StorageUnitView {
  /** Only bottles that have a spot in this unit. */
  bottles: PlacedBottle[];
}

export interface RackView {
  units: RackUnit[];
  /** In the cellar but without a place yet. */
  unplaced: PlacedBottle[];
}
