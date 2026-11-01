import { z } from "zod";
import { WINE_TYPES } from "./cellar";
import { WINE_VISUAL_SCOPES, type WineVisualScope } from "./bottle-library";

/**
 * The Wine Master Database (Sprint R): the admin's one place for every wine, catalogue and household alike. The
 * database decides what a change may do (scope, duplicates, bottles that refer to a vintage); these are the shapes the
 * admin pages read and the checks a form passes before anything is sent.
 */
export const MASTER_PAGE_SIZE = 50;

export const MASTER_FLAGS = [
  "art",
  "no_art",
  "pending",
  "corrections",
  "linked",
  "unlinked",
] as const;
export type MasterFlag = (typeof MASTER_FLAGS)[number];

/** Flags from a query string ("art,pending"); the old visuals filter (?filter=published|wanted) still works. */
export function parseMasterFlags(flags: unknown, legacyFilter?: unknown): MasterFlag[] {
  const raw = typeof flags === "string" ? flags.split(",") : [];
  if (legacyFilter === "published") raw.push("art");
  if (legacyFilter === "wanted") raw.push("pending", "no_art");
  const out = MASTER_FLAGS.filter((f) => raw.includes(f));
  // contradictory pairs cancel out to "either"
  const drop = (a: MasterFlag, b: MasterFlag) =>
    out.includes(a) && out.includes(b) ? [a, b] : ([] as MasterFlag[]);
  const dropped = [...drop("art", "no_art"), ...drop("linked", "unlinked")];
  return out.filter((f) => !dropped.includes(f));
}

export const parseMasterScope = (v: unknown): WineVisualScope =>
  (WINE_VISUAL_SCOPES as readonly unknown[]).includes(v) ? (v as WineVisualScope) : "all";

export const parseMasterPage = (v: unknown): number => {
  const n = typeof v === "string" ? Number.parseInt(v, 10) : NaN;
  return Number.isFinite(n) && n >= 1 && n <= 100_000 ? n : 1;
};

const status = z.enum(["canonical", "provisional"]);

export const WineMasterRowSchema = z.object({
  id: z.uuid(),
  producer: z.string(),
  name: z.string(),
  type: z.enum(WINE_TYPES),
  country: z.string().nullable(),
  region: z.string().nullable(),
  status,
  householdId: z.uuid().nullable(),
  household: z.string().nullable(),
  vintages: z.number().int(),
  published: z.boolean(),
  pending: z.number().int(),
  openCorrections: z.number().int(),
  /** The verified link of a household wine: the catalogue wine, or null (none, or explicitly unlinked). */
  linkedTo: z.uuid().nullable(),
  linkedName: z.string().nullable(),
  /** Household wines verified to be this catalogue wine. */
  linkedFrom: z.number().int(),
});
export type WineMasterRow = z.infer<typeof WineMasterRowSchema>;

export const WineMasterListSchema = z.object({
  total: z.number().int(),
  rows: WineMasterRowSchema.array(),
});
export type WineMasterList = z.infer<typeof WineMasterListSchema>;

export const WineMasterCountsSchema = z.object({
  all: z.number().int(),
  catalogue: z.number().int(),
  household: z.number().int(),
  published: z.number().int(),
  pending: z.number().int(),
  corrections: z.number().int(),
  linked: z.number().int(),
});
export type WineMasterCounts = z.infer<typeof WineMasterCountsSchema>;

const side = z.enum(["front", "back"]);
const year = z.number().int().nullable();

export const WineMasterRecordSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  type: z.enum(WINE_TYPES),
  status,
  country: z.string().nullable(),
  region: z.string().nullable(),
  appellation: z.string().nullable(),
  classification: z.string().nullable(),
  bottleStyle: z.record(z.string(), z.unknown()).nullable(),
  origin: z.string(),
  updatedAt: z.string(),
  createdAt: z.string(),
  householdId: z.uuid().nullable(),
  household: z.string().nullable(),
  producer: z.object({
    id: z.uuid(),
    name: z.string(),
    country: z.string().nullable(),
    status,
    updatedAt: z.string(),
    /** How many wines this producer holds: a rename changes them all. */
    wines: z.number().int(),
  }),
  otherProducers: z
    .object({ id: z.uuid(), name: z.string(), country: z.string().nullable() })
    .array(),
  aliases: z.string().array(),
  grapes: z.object({ grape: z.string(), pct: z.number().nullable() }).array(),
  vintages: z
    .object({
      id: z.uuid(),
      year,
      abv: z.number().nullable(),
      bottles: z.number().int(),
      frontPhotos: z.number().int(),
      backPhotos: z.number().int(),
      sharedProfile: z.boolean(),
      /** Anything refers to this vintage (bottles, tastings, valuations, profiles, labels…): its year is fixed. */
      inUse: z.boolean().default(false),
    })
    .array(),
  link: z
    .object({
      canonicalWineId: z.uuid().nullable(),
      reason: z.string().nullable(),
      linkedAt: z.string(),
      canonicalName: z.string().nullable(),
    })
    .nullable(),
  linkedFrom: z.number().int(),
  linkedSources: z
    .object({
      id: z.uuid(),
      producer: z.string(),
      name: z.string(),
      household: z.string().nullable(),
      linkedAt: z.string(),
      reason: z.string().nullable(),
    })
    .array(),
  householdLabels: z
    .object({
      id: z.uuid(),
      side,
      year,
      createdAt: z.string(),
      household: z.string().nullable(),
    })
    .array(),
  catalogLabels: z
    .object({
      id: z.uuid(),
      side,
      vintageId: z.uuid().nullable(),
      year,
      width: z.number().int(),
      height: z.number().int(),
      source: z.string(),
      publishedAt: z.string().nullable(),
      createdAt: z.string(),
    })
    .array(),
  history: z
    .object({
      entity: z.string(),
      action: z.string(),
      at: z.string(),
      /** The admin who made the change (an admin's user id; null once that account is gone). */
      actor: z.uuid().nullable(),
      before: z.unknown().nullable(),
      after: z.unknown().nullable(),
      reason: z.string().nullable(),
    })
    .array(),
});
export type WineMasterRecord = z.infer<typeof WineMasterRecordSchema>;

// ---- Edits -------------------------------------------------------------------------------------------------------

/** What the database answers to an edit. */
export const MASTER_RESULTS = [
  "ok",
  "stale",
  "conflict",
  "invalid",
  "none",
  "confirm",
  "in_use",
] as const;
export type MasterResult = (typeof MASTER_RESULTS)[number];
export const parseMasterResult = (v: unknown): MasterResult =>
  (MASTER_RESULTS as readonly unknown[]).includes(v) ? (v as MasterResult) : "invalid";

export const MASTER_RESULT_MESSAGE: Record<Exclude<MasterResult, "ok">, string> = {
  stale: "Not saved: someone changed this wine since you opened it. Reload and check again.",
  conflict: "Not saved: that would duplicate an existing wine, producer, vintage or link.",
  invalid: "Not saved: a value is not valid.",
  none: "Not saved: it is no longer there.",
  confirm:
    "Not saved: this producer is shared by several wines. Tick the confirmation to rename them all.",
  in_use:
    "Not saved: bottles, tastings, valuations, profiles, labels or photos refer to this vintage, so its year cannot change and it cannot be removed.",
};

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null);
const reason = z.string().trim().max(500);

export const WineDetailsSchema = z.object({
  name: z.string().trim().min(1).max(160),
  type: z.enum(WINE_TYPES),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^([A-Z]{2})?$/)
    .transform((v) => v || null),
  region: text(120),
  appellation: text(160),
  classification: text(120),
  bottleStyle: z
    .string()
    .trim()
    .max(800)
    .transform((v, ctx) => {
      if (!v) return null;
      try {
        const parsed: unknown = JSON.parse(v);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
          return parsed as Record<string, unknown>;
      } catch {
        // falls through to the issue below
      }
      ctx.addIssue({ code: "custom", message: "bottle style must be a JSON object" });
      return z.NEVER;
    }),
  reason,
});
export type WineDetails = z.infer<typeof WineDetailsSchema>;

export const ProducerEditSchema = z.object({
  name: z.string().trim().min(1).max(160),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^([A-Z]{2})?$/),
  reason,
});

export const VintageInputSchema = z.object({
  /** "" or "NV" = non-vintage */
  year: z
    .string()
    .trim()
    .transform((v, ctx) => {
      if (v === "" || v.toUpperCase() === "NV") return null;
      const n = Number(v);
      if (Number.isInteger(n) && n >= 1800 && n <= 2100) return n;
      ctx.addIssue({ code: "custom", message: "year" });
      return z.NEVER;
    }),
  abv: z
    .string()
    .trim()
    .transform((v, ctx) => {
      if (v === "") return null;
      const n = Number(v.replace(",", "."));
      if (Number.isFinite(n) && n >= 0 && n <= 25) return Math.round(n * 10) / 10;
      ctx.addIssue({ code: "custom", message: "abv" });
      return z.NEVER;
    }),
  reason,
});

/** One alias per line (or separated by ";"), trimmed, without repeats; at most 20 of at most 160 characters. */
export function parseAliases(input: string): string[] | null {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input.split(/[\n;]/)) {
    const a = raw.trim();
    if (!a) continue;
    if (a.length > 160) return null;
    const key = a.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out.length > 20 ? null : out;
}

/**
 * Grapes, one per line or separated by ";": "Merlot 70%", "Cabernet Franc: 30", "Petit Verdot". Shares are optional
 * and must stay within 100% together. Null when something is not readable. Whether a grape exists is the database's
 * call (the reference list).
 */
export function parseGrapes(input: string): { grape: string; pct: number | null }[] | null {
  const out: { grape: string; pct: number | null }[] = [];
  let total = 0;
  for (const raw of input.split(/[\n;]/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^(.+?)[\s:]*(?:(\d{1,3}(?:[.,]\d+)?)\s*%?)?$/.exec(line);
    if (!m) return null;
    const grape = m[1]!.trim().replace(/[:\s]+$/, "");
    if (!grape || grape.length > 80) return null;
    const pct = m[2] === undefined ? null : Number(m[2].replace(",", "."));
    if (pct !== null && (pct < 0 || pct > 100)) return null;
    total += pct ?? 0;
    if (out.some((g) => g.grape.toLocaleLowerCase() === grape.toLocaleLowerCase())) return null;
    out.push({ grape, pct });
  }
  if (total > 100 || out.length > 15) return null;
  return out;
}

export const LinkInputSchema = z.object({
  target: z.uuid(),
  reason: z.string().trim().min(3).max(500),
  confirm: z.literal("yes"),
});

export const CATALOG_LABEL_SOURCE_MAX = 200;

/** A readable line for an audit entry ("Region: Bordeaux → Pauillac"). Values are master data, never people. */
export function auditChanges(before: unknown, after: unknown): string[] {
  const obj = (v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const show = (v: unknown) =>
    v === null || v === undefined || v === ""
      ? "—"
      : typeof v === "object"
        ? JSON.stringify(v)
        : String(v);
  if (Array.isArray(before) || Array.isArray(after))
    return [`${show(before ?? [])} → ${show(after ?? [])}`];
  const b = obj(before);
  const a = obj(after);
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])];
  return keys
    .filter((k) => JSON.stringify(b[k] ?? null) !== JSON.stringify(a[k] ?? null))
    .map((k) => `${k}: ${show(b[k])} → ${show(a[k])}`);
}
