import "server-only";
import { z } from "zod";
import { assertAdmin, type AdminSession } from "@/server/admin/access";
import { createServiceClient } from "./client";

/**
 * EXTERNAL SOURCES FOR THE ADMIN (Wine Intelligence WI-06): what each source is cleared for, what was imported,
 * which links wait for a decision, and the off switch. Every function takes the admin session that only
 * `verifyAdmin` issues and checks it again; the database functions are service-role only.
 *
 * There is deliberately no function here that switches a source ON or marks its rights verified: clearing a source
 * for people is a human decision made with evidence, outside the dashboard. This module only reads, decides links,
 * and narrows.
 *
 * "missing" = the database step (20261118000041_wi06_admin_sources.sql) is not taken yet; null = no service role.
 */
type Result<T> = Promise<T | "missing" | null>;

const missing = (e: { code?: string }) =>
  e.code === "PGRST202" || e.code === "42883" || e.code === "PGRST205" || e.code === "42P01";

async function rpc<T>(
  session: AdminSession,
  fn: string,
  args: Record<string, unknown>,
  parse: (d: unknown) => T,
): Result<T> {
  assertAdmin(session);
  const db = createServiceClient();
  if (!db) return null;
  const { data, error } = await (
    db.rpc as unknown as (
      f: string,
      a: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>
  )(fn, args);
  if (error) {
    if (missing(error)) return "missing";
    throw error;
  }
  return parse(data);
}

const text = z.string().nullable();
const Step = z.object({ rightsStatus: text, searchScope: text });

export const SourceOverviewSchema = z.object({
  id: z.string(),
  name: z.string(),
  homepage: text,
  license: z.string(),
  licenseUrl: text,
  attribution: text,
  rightsStatus: z.enum(["unverified", "verified", "blocked"]),
  searchScope: z.enum(["off", "pilot", "public"]),
  mayStore: z.boolean(),
  mayDisplay: z.boolean(),
  commercialUse: z.boolean(),
  rightsEvidence: text,
  rightsVerifiedAt: text,
  rightsVerifiedBy: text,
  records: z.object({ active: z.number(), withdrawn: z.number() }),
  links: z.object({ suggested: z.number(), verified: z.number(), rejected: z.number() }),
  lastImport: z
    .object({
      datasetVersion: text,
      finishedAt: text,
      retrievedAt: text,
      pilot: z.boolean(),
      counts: z.record(z.string(), z.unknown()),
    })
    .nullable(),
  openRuns: z.number(),
  abandonedRuns: z.array(z.object({ at: text, datasetVersion: text, reason: text })),
  log: z.array(
    z.object({ at: z.string(), actor: z.string(), reason: z.string(), from: Step, to: Step }),
  ),
});
export type SourceOverview = z.infer<typeof SourceOverviewSchema>;

export const LINK_STATES = ["suggested", "verified", "rejected"] as const;
export type LinkState = (typeof LINK_STATES)[number];

const Facts = z.object({
  producer: z.string(),
  name: z.string(),
  type: text,
  countryCode: text,
  region: text,
  appellation: text,
});
export const LinkRowSchema = z.object({
  recordId: z.uuid(),
  externalId: z.string(),
  recordStatus: z.enum(["active", "withdrawn"]),
  state: z.enum(LINK_STATES),
  reason: text,
  decidedAt: text,
  createdAt: z.string(),
  provider: z.object({
    id: z.string(),
    name: z.string(),
    rightsStatus: z.string(),
    searchScope: z.string(),
  }),
  record: Facts.extend({ vintages: z.array(z.number()), sourceUrl: text }),
  wine: Facts.extend({ id: z.uuid(), aliases: z.array(z.string()) }),
  sameSourceLinks: z.number(),
});
export type LinkRow = z.infer<typeof LinkRowSchema>;
const LinkQueueSchema = z.object({ total: z.number(), rows: z.array(LinkRowSchema) });

const Counts = z.record(z.string(), z.number());
export const IntelligenceMetricsSchema = z.object({
  days: z.number(),
  search: z
    .object({
      sessions: z.number(),
      requests: z.number(),
      withSelection: z.number(),
      abandoned: z.number(),
      zeroResult: z.number(),
      limited: z.number(),
      failed: z.number(),
      bySurface: Counts,
      bySource: Counts,
      byRank: Counts,
      bySlowest: Counts,
    })
    .nullable(),
  purchaseCheck: z
    .object({
      completed: z.number(),
      byKnowledge: Counts,
      byEntry: Counts,
    })
    .nullable(),
  scan: z.object({ completed: z.number(), byResolution: Counts }).nullable(),
});
export type IntelligenceMetrics = z.infer<typeof IntelligenceMetricsSchema>;

export const readSources = (session: AdminSession): Result<SourceOverview[]> =>
  rpc(session, "admin_catalog_sources_overview", {}, (d) => SourceOverviewSchema.array().parse(d));

export const readLinkQueue = (
  session: AdminSession,
  state: LinkState,
  page: number,
  size: number,
  providerId: string | null = null,
): Result<{ total: number; rows: LinkRow[] }> =>
  rpc(
    session,
    "admin_catalog_link_queue",
    { p_state: state, p_limit: size, p_offset: (page - 1) * size, p_provider: providerId },
    (d) => LinkQueueSchema.parse(d),
  );

export const readIntelligenceMetrics = (
  session: AdminSession,
  days: number,
): Result<IntelligenceMetrics> =>
  rpc(session, "admin_wine_intelligence_metrics", { p_days: days }, (d) =>
    IntelligenceMetricsSchema.parse(d),
  );

/** Approve or reject a link (the existing audited function of 20261114000037). */
export const decideLink = (
  session: AdminSession,
  input: { recordId: string; wineId: string; state: "verified" | "rejected"; reason: string },
): Result<string> =>
  rpc(
    session,
    "admin_catalog_record_decide",
    {
      p_record: input.recordId,
      p_wine: input.wineId,
      p_state: input.state,
      p_reason: input.reason,
      p_actor: session.userId,
    },
    (d) => String(d),
  );

/** "Needs investigation": the link stays a suggestion; the note and who wrote it are logged. */
export const flagLink = (
  session: AdminSession,
  input: { recordId: string; reason: string },
): Result<string> =>
  rpc(
    session,
    "admin_catalog_record_flag",
    { p_record: input.recordId, p_reason: input.reason, p_actor: session.userId },
    (d) => String(d),
  );

/** The off switch: out of people's search and credits at once; with `block`, no further import either. */
export const disableSource = (
  session: AdminSession,
  input: { providerId: string; reason: string; block: boolean },
): Result<boolean> =>
  rpc(
    session,
    "admin_catalog_provider_disable",
    {
      p_provider: input.providerId,
      p_reason: input.reason,
      p_actor: `admin:${session.userId}`,
      p_block: input.block,
    },
    () => true,
  );
