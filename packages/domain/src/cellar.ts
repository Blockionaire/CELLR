import { z } from "zod";

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
}

export interface CellarView {
  items: CellarItem[];
  /** Total bottles currently in the cellar (the sum of every item's count). */
  bottleCount: number;
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
