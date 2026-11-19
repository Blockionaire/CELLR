import "server-only";
import { z } from "zod";
import {
  HealthHistorySchema,
  HealthLatestSchema,
  HEALTH_HISTORY_HOURS,
  type HealthHistorySample,
  type HealthLatest,
  type HealthTrigger,
  type Measurement,
  type RoundOutcome,
} from "@cellr/domain";
import { assertAdmin, type AdminSession } from "@/server/admin/access";
import { createProbeClient } from "./client";

/**
 * The health monitor's database access, with the service role (System Intelligence sprint 2, migration 0047). Two
 * kinds of caller, each authorised before it gets here:
 *  - the probe round (`healthPort`), started by the heartbeat with CRON_SECRET or by an admin;
 *  - the admin's Health view (`readHealth`), which takes the admin session and checks it again.
 * Every request is abandoned after the given timeout. Nothing read here is sent anywhere but those two.
 */

/** The migration that creates the health tables has not been applied to this database. */
export class HealthNotInstalledError extends Error {
  constructor() {
    super("health monitoring is not installed (migration 20261124000047)");
    this.name = "HealthNotInstalledError";
  }
}

type RpcError = { code?: string; message?: string } | null;
const notInstalled = (e: RpcError) =>
  e?.code === "PGRST202" || e?.code === "42883" || e?.code === "PGRST205";
/** supabase-js reports the probe client's own time limit as an ordinary error: recognise it as a timeout. */
const timedOut = (e: { message?: string; name?: string } | null | undefined) =>
  /AbortError|TimeoutError|aborted|timed? ?out/i.test(`${e?.name ?? ""} ${e?.message ?? ""}`);
const timeoutError = () =>
  Object.assign(new Error("health request timed out"), { name: "TimeoutError" });
/** A failed call, as an error that carries a code and never the message of the original. */
function failure(what: string, e: RpcError): Error {
  if (timedOut(e)) return timeoutError();
  return Object.assign(new Error(`${what} failed`), { code: e?.code || "unknown" });
}

export const CronJobRowSchema = z.object({
  name: z.string(),
  schedule: z.string(),
  active: z.boolean(),
  lastStart: z.string().nullable(),
  lastStatus: z.string().nullable(),
  failures24h: z.number().int().nonnegative(),
});
export type CronJobRow = z.infer<typeof CronJobRowSchema>;
const CronJobsSchema = z.object({ available: z.boolean(), jobs: z.array(CronJobRowSchema) });

export const AiTaskRowSchema = z.object({
  task: z.string(),
  calls: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  fallback: z.number().int().nonnegative(),
  p95Ms: z.number().int().nonnegative().nullable(),
});
export type AiTaskRow = z.infer<typeof AiTaskRowSchema>;

/** What the probe round needs from the database and Storage. Every call throws on failure. */
export interface HealthPort {
  /** A new round's id; null when one started too recently. The insert is the proof that writes work. */
  begin(trigger: HealthTrigger, minGapSec: number): Promise<number | null>;
  record(round: number, outcome: RoundOutcome, samples: readonly Measurement[]): Promise<void>;
  /** A read through the API (PostgREST → Postgres). */
  ping(): Promise<{ inRecovery: boolean }>;
  cronJobs(): Promise<z.infer<typeof CronJobsSchema>>;
  aiWindow(from: Date, to: Date): Promise<AiTaskRow[]>;
  /** Storage's bucket ids (Storage API). */
  buckets(): Promise<string[]>;
  latest(): Promise<HealthLatest>;
}

/** The service-role health port, or null when the service role is not configured. */
export function healthPort(timeoutMs: number): HealthPort | null {
  const db = createProbeClient(timeoutMs);
  if (!db) return null;
  const rpc = async <T>(fn: string, args: Record<string, unknown>, parse: (d: unknown) => T) => {
    const { data, error } = await (
      db.rpc as unknown as (
        f: string,
        a: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: RpcError }>
    )(fn, args);
    if (error) {
      if (notInstalled(error)) throw new HealthNotInstalledError();
      throw failure(`health rpc ${fn}`, error);
    }
    return parse(data);
  };
  return {
    begin: (trigger, minGapSec) =>
      rpc("health_begin_round", { p_trigger: trigger, p_min_gap_seconds: minGapSec }, (d) =>
        z.number().int().positive().nullable().parse(d),
      ),
    record: async (round, outcome, samples) => {
      await rpc(
        "health_record_round",
        { p_round: round, p_outcome: outcome, p_samples: samples },
        (d) => z.number().int().parse(d),
      );
    },
    ping: () => rpc("health_ping", {}, (d) => z.object({ inRecovery: z.boolean() }).parse(d)),
    cronJobs: () => rpc("health_cron_jobs", {}, (d) => CronJobsSchema.parse(d)),
    aiWindow: (from, to) =>
      rpc("health_ai_window", { p_from: from.toISOString(), p_to: to.toISOString() }, (d) =>
        z.array(AiTaskRowSchema).parse(d),
      ),
    buckets: async () => {
      const { data, error } = await db.storage.listBuckets();
      if (error) {
        const original = (error as { originalError?: { name?: string; message?: string } })
          .originalError;
        throw timedOut(error) || timedOut(original)
          ? timeoutError()
          : Object.assign(new Error("storage bucket list failed"), { code: "storage" });
      }
      return (data ?? []).map((b) => b.id);
    },
    latest: () => rpc("health_latest", {}, (d) => HealthLatestSchema.parse(d)),
  };
}

/**
 * The admin's Health view: the newest state and the last day's history. "missing" when migration 0047 is not
 * applied; null when the service role is not configured.
 */
export async function readHealth(
  session: AdminSession,
  timeoutMs: number,
): Promise<{ latest: HealthLatest; history: HealthHistorySample[] } | "missing" | null> {
  assertAdmin(session);
  const port = healthPort(timeoutMs);
  if (!port) return null;
  const db = createProbeClient(timeoutMs)!;
  try {
    const [latest, hist] = await Promise.all([
      port.latest(),
      db.rpc("health_history", { p_hours: HEALTH_HISTORY_HOURS }),
    ]);
    if (hist.error) {
      if (notInstalled(hist.error)) return "missing";
      throw failure("health rpc health_history", hist.error);
    }
    return { latest, history: HealthHistorySchema.parse(hist.data) };
  } catch (e) {
    if (e instanceof HealthNotInstalledError) return "missing";
    throw e;
  }
}
