import "server-only";
import {
  AiSignalStatsSchema,
  CorrectionDetailSchema,
  CorrectionRowSchema,
  type AiSignalStats,
  type CorrectionDetail,
  type CorrectionRow,
  type SignalReview,
  CandidateDetailSchema,
  CandidateRowSchema,
  LEARNING_MODES,
  type CandidateDetail,
  type CandidateRow,
  type LearningMode,
} from "@cellr/domain";
import { assertAdmin, type AdminSession } from "@/server/admin/access";
import { createServiceClient } from "./client";

/**
 * Catalogue learning for the admin: read candidates (counts, never households) and act on them. Every function
 * takes the admin session that only `verifyAdmin` issues and checks it again; the database functions are service-
 * role only. "missing" = the step (20261101000024_catalog_learning.sql) is not taken yet; null = no service role.
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

export function readCandidates(session: AdminSession): Result<CandidateRow[]> {
  return rpc(session, "admin_catalog_candidates", {}, (d) => CandidateRowSchema.array().parse(d));
}

export function readCandidate(session: AdminSession, id: string): Result<CandidateDetail | "none"> {
  return rpc(session, "admin_catalog_candidate", { p_id: id }, (d) =>
    d === null ? "none" : CandidateDetailSchema.parse(d),
  );
}

export async function readLearningMode(session: AdminSession): Result<LearningMode> {
  assertAdmin(session);
  const db = createServiceClient();
  if (!db) return null;
  const { data, error } = await db.from("catalog_learning").select("mode").maybeSingle();
  if (error) {
    if (missing(error)) return "missing";
    throw error;
  }
  const mode = data?.mode;
  return (LEARNING_MODES as readonly string[]).includes(mode ?? "")
    ? (mode as LearningMode)
    : "off";
}

export const setLearningMode = (session: AdminSession, mode: LearningMode) =>
  rpc(session, "admin_catalog_set_mode", { p_mode: mode, p_actor: session.userId }, String);

export const updateCandidate = (
  session: AdminSession,
  id: string,
  fields: Record<string, unknown>,
) =>
  rpc(
    session,
    "admin_catalog_update",
    { p_id: id, p_fields: fields, p_actor: session.userId },
    Boolean,
  );

export const setCandidateStatus = (
  session: AdminSession,
  id: string,
  status: "rejected" | "open",
  note: string | null,
) =>
  rpc(
    session,
    "admin_catalog_set_status",
    { p_id: id, p_status: status, p_note: note, p_actor: session.userId },
    Boolean,
  );

export const mergeCandidate = (session: AdminSession, from: string, into: string) =>
  rpc(
    session,
    "admin_catalog_merge",
    { p_from: from, p_into: into, p_actor: session.userId },
    Boolean,
  );

export const addCandidateSource = (
  session: AdminSession,
  id: string,
  source: { name: string; url: string; license: string | null; verified: boolean },
) =>
  rpc(
    session,
    "admin_catalog_source",
    {
      p_id: id,
      p_name: source.name,
      p_url: source.url,
      p_license: source.license,
      p_verified: source.verified,
      p_actor: session.userId,
    },
    Boolean,
  );

export const approveCandidate = (
  session: AdminSession,
  id: string,
  vintages: Array<number | null>,
) =>
  rpc(
    session,
    "admin_catalog_approve",
    { p_id: id, p_vintages: vintages, p_actor: session.userId },
    (d) => d as { status: string; wineId?: string; messages?: string[] },
  );

// ---- Correction signals (Sprint Q) ----------------------------------------------------------------------------

export function readCorrections(session: AdminSession): Result<CorrectionRow[]> {
  return rpc(session, "admin_catalog_corrections", {}, (d) => CorrectionRowSchema.array().parse(d));
}

export function readCorrection(
  session: AdminSession,
  wineId: string,
): Result<CorrectionDetail | "none"> {
  return rpc(session, "admin_catalog_correction", { p_wine: wineId }, (d) =>
    d === null ? "none" : CorrectionDetailSchema.parse(d),
  );
}

export function readAiSignals(session: AdminSession, days: number): Result<AiSignalStats> {
  return rpc(session, "admin_catalog_ai_signals", { p_days: days }, (d) =>
    AiSignalStatsSchema.parse(d),
  );
}

export const reviewSignal = (
  session: AdminSession,
  id: string,
  review: { status: SignalReview; note: string },
) =>
  rpc(
    session,
    "admin_catalog_review_signal",
    { p_id: id, p_status: review.status, p_note: review.note, p_actor: session.userId },
    (d) => d === true,
  );
