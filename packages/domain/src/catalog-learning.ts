import { z } from "zod";
import { normalizeText } from "./cellar";
import { nameSimilarity } from "./scan";

/**
 * CATALOGUE LEARNING: confirmed household wines become candidates for the shared catalogue; the owner reviews and
 * publishes them. These are the rules that turn the counts into a state, a priority and an (advisory) automation
 * verdict. Pure and deterministic: no AI is asked about a candidate.
 */

/** Change here, nowhere else. */
export const CATALOG_REVIEW = {
  /** Independent households that scanned and confirmed the wine before it asks for review. */
  ready: 5,
  /** ...and before it becomes a high priority (and could one day be considered for automation). */
  high: 10,
} as const;

/**
 * Publishing without the owner's explicit approval. OFF: approval is always a person's decision in this beta. The
 * automation verdict below is shown as advice only, to learn whether it would have been right.
 */
export const AUTO_PUBLISH_ENABLED = false;

export const LEARNING_MODES = ["off", "opt_out", "opt_in"] as const;
export type LearningMode = (typeof LEARNING_MODES)[number];

/** A person's own choice about helping the shared catalogue. */
export const CatalogContributionSchema = z.object({ contribute: z.boolean() });

export const CANDIDATE_STATES = [
  "collecting",
  "review_ready",
  "conflict",
  "approved",
  "rejected",
  "merged",
] as const;
export type CandidateState = (typeof CANDIDATE_STATES)[number];

const Count = z.coerce.number().int().min(0);

export const CandidateRowSchema = z.object({
  id: z.string(),
  producer: z.string(),
  name: z.string(),
  type: z.string(),
  country: z.string().nullable(),
  region: z.string().nullable(),
  appellation: z.string().nullable(),
  status: z.enum(["open", "approved", "rejected", "merged"]),
  mergedInto: z.string().nullable(),
  canonicalWineId: z.string().nullable(),
  /** Households that confirmed it after scanning its label (strong, independent). */
  scanHouseholds: Count,
  /** Households that only typed it (weak; never counted as a label confirmation). */
  manualHouseholds: Count,
  vintages: z.array(z.number().int().nullable()),
  /** How many different appellations households gave (more than one disagrees). */
  appellationVariants: Count,
  /** Open candidates with the same producer and name in another colour or country. */
  rivals: Count,
  /** The catalogue already has a wine of this producer and name. */
  inCatalog: z.boolean(),
  sources: Count,
  verifiedSources: Count,
  lastConfirmedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type CandidateRow = z.infer<typeof CandidateRowSchema>;

export const CandidateDetailSchema = z.object({
  id: z.string(),
  identityKey: z.string(),
  producer: z.string(),
  name: z.string(),
  type: z.string(),
  country: z.string().nullable(),
  region: z.string().nullable(),
  appellation: z.string().nullable(),
  classification: z.string().nullable(),
  aliases: z.array(z.string()),
  status: z.enum(["open", "approved", "rejected", "merged"]),
  mergedInto: z.string().nullable(),
  canonicalWineId: z.string().nullable(),
  reviewNote: z.string().nullable(),
  createdAt: z.string(),
  variations: z.array(
    z.object({
      producer: z.string(),
      name: z.string(),
      region: z.string().nullable(),
      appellation: z.string().nullable(),
      households: Count,
    }),
  ),
  vintages: z.array(
    z.object({ year: z.number().int().nullable(), scanHouseholds: Count, manualHouseholds: Count }),
  ),
  scanHouseholds: Count,
  manualHouseholds: Count,
  sources: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      url: z.string(),
      license: z.string().nullable(),
      verified: z.boolean(),
    }),
  ),
  catalogWines: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      type: z.string(),
      country: z.string().nullable(),
    }),
  ),
  siblings: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      type: z.string(),
      country: z.string().nullable(),
      status: z.string(),
    }),
  ),
  audit: z.array(z.object({ action: z.string(), detail: z.unknown(), at: z.string() })),
});
export type CandidateDetail = z.infer<typeof CandidateDetailSchema>;

type Counts = Pick<
  CandidateRow,
  "status" | "scanHouseholds" | "appellationVariants" | "rivals" | "inCatalog"
>;

/** Where a candidate stands. Reaching a threshold only asks for review; it never publishes. */
export function candidateState(c: Counts): CandidateState {
  if (c.status !== "open") return c.status;
  if (c.rivals > 0 || c.appellationVariants > 1 || c.inCatalog) return "conflict";
  return c.scanHouseholds >= CATALOG_REVIEW.ready ? "review_ready" : "collecting";
}

export const candidatePriority = (c: Counts): "high" | "normal" | "low" =>
  c.status !== "open"
    ? "low"
    : c.scanHouseholds >= CATALOG_REVIEW.high
      ? "high"
      : c.scanHouseholds >= CATALOG_REVIEW.ready
        ? "normal"
        : "low";

/**
 * Would this candidate qualify for automatic publication, if that were ever switched on? Advice only: households
 * agreeing with the same AI reading are not independent proof, so a verified public source is always required too.
 */
export function automationVerdict(
  c: Counts & Pick<CandidateRow, "verifiedSources" | "name">,
  siblings: ReadonlyArray<{ name: string; status: string }> = [],
): { eligible: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (c.status !== "open") reasons.push("not open");
  if (c.scanHouseholds < CATALOG_REVIEW.ready)
    reasons.push(`fewer than ${CATALOG_REVIEW.ready} households confirmed it from a label`);
  if (c.rivals > 0) reasons.push("the same name exists in another colour or country");
  if (c.appellationVariants > 1) reasons.push("households disagree on the appellation");
  if (c.inCatalog) reasons.push("the catalogue already has a wine of this producer and name");
  if (c.verifiedSources === 0) reasons.push("no verified public source");
  const close = siblings.filter(
    (s) => s.status !== "merged" && s.status !== "rejected" && namesClose(s.name, c.name),
  );
  if (close.length > 0)
    reasons.push(`close to another wine of the producer (${close.map((s) => s.name).join(", ")})`);
  return { eligible: reasons.length === 0, reasons };
}

/** Two names one could mistake for each other: very similar, or one is the other plus words ("… Réserve"). */
function namesClose(a: string, b: string): boolean {
  if (nameSimilarity(a, b) >= 0.8) return true;
  const [x, y] = [normalizeText(a).split(" "), normalizeText(b).split(" ")];
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length > 0 && short.every((w) => long.includes(w));
}

export const CANDIDATE_SORTS = ["households", "recent", "producer"] as const;
export type CandidateSort = (typeof CANDIDATE_SORTS)[number];

/** The admin list: one state (or all open ones), sorted, most useful first. */
export function listCandidates(
  rows: readonly CandidateRow[],
  state: CandidateState | "open" | "all",
  sort: CandidateSort,
): CandidateRow[] {
  const keep = rows.filter((r) => {
    const s = candidateState(r);
    if (state === "all") return true;
    if (state === "open") return r.status === "open";
    return s === state;
  });
  const by: Record<CandidateSort, (a: CandidateRow, b: CandidateRow) => number> = {
    households: (a, b) =>
      b.scanHouseholds - a.scanHouseholds ||
      b.manualHouseholds - a.manualHouseholds ||
      a.producer.localeCompare(b.producer),
    recent: (a, b) => (b.lastConfirmedAt ?? "").localeCompare(a.lastConfirmedAt ?? ""),
    producer: (a, b) => a.producer.localeCompare(b.producer) || a.name.localeCompare(b.name),
  };
  return [...keep].sort(by[sort]);
}

/** Counts per state, for the overview. */
export function candidateCounts(rows: readonly CandidateRow[]): Record<CandidateState, number> {
  const counts = Object.fromEntries(CANDIDATE_STATES.map((s) => [s, 0])) as Record<
    CandidateState,
    number
  >;
  for (const r of rows) counts[candidateState(r)] += 1;
  return counts;
}

export const parseCandidateState = (v: unknown): CandidateState | "open" | "all" =>
  v === "all" || v === "open" || (CANDIDATE_STATES as readonly unknown[]).includes(v)
    ? (v as CandidateState | "open" | "all")
    : "open";
export const parseCandidateSort = (v: unknown): CandidateSort =>
  (CANDIDATE_SORTS as readonly unknown[]).includes(v) ? (v as CandidateSort) : "households";

// ---- What the admin may send (validated before any privileged call) ------------------------------------------

const optionalLine = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v));

/** Corrections to a candidate's proposed identity. */
export const CandidateEditSchema = z.object({
  producer: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(160),
  type: z.enum(["red", "white", "rose", "sparkling", "orange", "dessert", "fortified"]),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^([A-Z]{2})?$/)
    .transform((v) => (v === "" ? null : v)),
  region: optionalLine(120),
  appellation: optionalLine(160),
  classification: optionalLine(120),
  aliases: z
    .string()
    .max(1700)
    .transform((v) =>
      [
        ...new Set(
          v
            .split("\n")
            .map((a) => a.trim())
            .filter((a) => a.length > 0),
        ),
      ].slice(0, 10),
    )
    .pipe(z.array(z.string().max(160))),
});
export type CandidateEdit = z.output<typeof CandidateEditSchema>;

/** A public source the owner checked: an https page that names this exact wine. */
export const CandidateSourceSchema = z.object({
  name: z.string().trim().min(1).max(120),
  url: z
    .string()
    .trim()
    .max(500)
    .regex(/^https:\/\/\S{4,}$/),
  license: optionalLine(80),
  verified: z.boolean(),
});

/** The vintages to publish: only years (or the non-vintage) the candidate's households confirmed. */
export const ApproveVintagesSchema = z
  .array(z.number().int().min(1800).max(2100).nullable())
  .max(80);
