import "server-only";
import {
  HEALTH_MIN_ROUND_GAP_SEC,
  HEALTH_PROBE_TIMEOUT_MS,
  assertMeasurement,
  summarizeHealth,
  type HealthTrigger,
  type Measurement,
  type RoundOutcome,
} from "@cellr/domain";
import { getHealthEnv, getServerEnv, type HealthEnv } from "@/server/env";
import { logError, logWarn } from "@/server/log";
import { healthPort, HealthNotInstalledError, type HealthPort } from "@/server/privileged/health";
import { PROBES } from "./catalogue";
import { reasonOf, runProbes, withTimeout } from "./probes";

/**
 * ONE ROUND OF HEALTH CHECKS (System Intelligence sprint 2). Started by the heartbeat (GET /api/cron/health with
 * CRON_SECRET) or by an admin ("Measure now"). Bounded whoever asks: at most one round a minute (the database
 * refuses a second), every probe within 3 seconds, the whole round within a few more.
 *
 * What it answers says only whether the round was recorded and how many infrastructure checks failed: never which,
 * never why. The detail stays in the database, for the admin's Health view.
 */

export type RoundResult =
  | {
      readonly kind: "recorded";
      readonly round: number;
      readonly outcome: RoundOutcome;
      /** Failed database, auth and storage checks: what makes the heartbeat raise its alarm. */
      readonly failedInfrastructure: number;
    }
  | {
      readonly kind: "skipped";
      /** Failed infrastructure checks of the round that ran instead (null: it could not be read). */
      readonly failedInfrastructure: number | null;
    }
  | { readonly kind: "not_configured" }
  | { readonly kind: "not_installed" }
  | { readonly kind: "database_unreachable"; readonly reason: string }
  | { readonly kind: "record_failed"; readonly reason: string };

export interface RoundDeps {
  port: HealthPort | null;
  fetch: typeof fetch;
  supabaseUrl: string;
  publishableKey: string;
  health: HealthEnv;
  now: () => Date;
  timeoutMs: number;
  minGapSec: number;
}

/** The real dependencies, for whatever the caller did not give (tests give them all). */
function resolve(o: Partial<RoundDeps>): RoundDeps {
  const env = o.supabaseUrl !== undefined && o.publishableKey !== undefined ? null : getServerEnv();
  return {
    port: o.port !== undefined ? o.port : healthPort(HEALTH_PROBE_TIMEOUT_MS),
    fetch: o.fetch ?? globalThis.fetch.bind(globalThis),
    supabaseUrl: o.supabaseUrl ?? env!.supabaseUrl,
    publishableKey: o.publishableKey ?? env!.supabasePublishableKey,
    health: o.health !== undefined ? o.health : getHealthEnv(),
    now: o.now ?? (() => new Date()),
    timeoutMs: o.timeoutMs ?? HEALTH_PROBE_TIMEOUT_MS,
    minGapSec: o.minGapSec ?? HEALTH_MIN_ROUND_GAP_SEC,
  };
}

const INFRASTRUCTURE = new Set(PROBES.filter((p) => p.kind === "infrastructure").map((p) => p.id));

export async function runHealthRound(
  trigger: HealthTrigger,
  overrides: Partial<RoundDeps> = {},
): Promise<RoundResult> {
  const d = resolve(overrides);
  if (!d.port) return { kind: "not_configured" };
  const started = performance.now();

  // 1. the round's own row: proves the database takes writes (or that it does not, and nothing else can be stored)
  let round: number | null;
  try {
    round = await withTimeout(d.port.begin(trigger, d.minGapSec), d.timeoutMs);
  } catch (e) {
    if (e instanceof HealthNotInstalledError) return { kind: "not_installed" };
    const reason = reasonOf(e);
    logWarn("health_round_unrecorded", { stage: "begin", reason });
    return { kind: "database_unreachable", reason };
  }
  if (round === null) {
    // Another round ran less than a minute ago (an admin's, or a duplicate call). Its findings stand for this one,
    // so the heartbeat still alarms on them: a skipped round never reads as "all fine".
    try {
      const latest = await withTimeout(d.port.latest(), d.timeoutMs);
      const fresh = summarizeHealth(PROBES, latest, [], d.now());
      return {
        kind: "skipped",
        failedInfrastructure: fresh.probes.filter(
          (p) => INFRASTRUCTURE.has(p.probe.id) && p.status === "failed",
        ).length,
      };
    } catch {
      return { kind: "skipped", failedInfrastructure: null };
    }
  }
  const writeLatencyMs = performance.now() - started;

  // 2. every probe at once
  const samples = await runProbes({
    port: d.port,
    fetch: d.fetch,
    supabaseUrl: d.supabaseUrl,
    publishableKey: d.publishableKey,
    health: d.health,
    now: d.now(),
    timeoutMs: d.timeoutMs,
    writeLatencyMs,
  });
  const probeErrors = samples.filter((s) => s.reason === "probe_error").length;
  const outcome: RoundOutcome = probeErrors > 0 ? "partial" : "ok";
  const all: Measurement[] = [
    assertMeasurement({
      probe: "monitor.round",
      status: "healthy",
      reason: trigger === "heartbeat" ? "ok" : "ok_manual",
      latencyMs: Math.round(performance.now() - started),
      detail: { probes: samples.length, probeErrors },
    }),
    ...samples,
  ];

  // 3. stored all at once; if that fails nothing is half-recorded, and the round stays open (then purged)
  try {
    await withTimeout(d.port.record(round, outcome, all), d.timeoutMs);
  } catch (e) {
    const reason = reasonOf(e);
    logWarn("health_round_unrecorded", { stage: "record", reason });
    return { kind: "record_failed", reason };
  }

  // 4. the dead man's switch: tell the external uptime provider that a round was recorded
  if (d.health.pingUrl) {
    try {
      const res = await d.fetch(d.health.pingUrl, {
        method: "GET",
        signal: AbortSignal.timeout(d.timeoutMs),
        cache: "no-store",
        redirect: "error",
      });
      await res.body?.cancel().catch(() => {});
      if (!res.ok) logWarn("health_ping_refused", { status: res.status });
    } catch (e) {
      logWarn("health_ping_failed", { reason: reasonOf(e) });
    }
  }

  const failedInfrastructure = samples.filter(
    (s) => INFRASTRUCTURE.has(s.probe) && s.status === "failed",
  ).length;
  return { kind: "recorded", round, outcome, failedInfrastructure };
}

/** For the admin's "Measure now": the same round, and any unexpected throw becomes a result, never a crash. */
export async function runManualRound(): Promise<RoundResult> {
  try {
    return await runHealthRound("manual");
  } catch (e) {
    logError("health_round_crashed", e);
    return { kind: "record_failed", reason: "error" };
  }
}
