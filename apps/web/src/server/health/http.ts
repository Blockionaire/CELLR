import "server-only";
import { timingSafeEqual } from "node:crypto";
import { HEALTH_PROBE_TIMEOUT_MS, summarizeHealth } from "@cellr/domain";
import { getCronSecret, getHealthEnv } from "@/server/env";
import { jsonResponse } from "@/server/http";
import { logWarn } from "@/server/log";
import { healthPort } from "@/server/privileged/health";
import { PROBES } from "./catalogue";
import { reasonOf, withTimeout } from "./probes";
import { runHealthRound, type RoundResult } from "./round";

/**
 * The health monitor's three HTTP endpoints (System Intelligence sprint 2, ADR-002):
 *
 *   GET /api/health         PUBLIC liveness: {"status":"ok"} and nothing else. No database, no detail, no version.
 *                           Answers as long as the app runs; an external uptime check watches it.
 *   GET /api/health/ready   readiness for an external uptime provider, with CELLR_HEALTH_READY_TOKEN: one word
 *                           for the whole system from the stored measurements (no probe runs), 503 when the monitor
 *                           stopped or an infrastructure check failed. 404 while no token is configured.
 *   GET /api/cron/health    runs one round, with CRON_SECRET (the heartbeat). Says whether it was recorded and how
 *                           many infrastructure checks failed; 503 when nothing could be recorded.
 *
 * None of them ever returns a component's name, a reason, an error message or a configuration value.
 */

/** The request shows `Bearer <secret>`, compared in constant time. */
function bearerMatches(request: Request, secret: string): boolean {
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function handleLiveness(): Response {
  return jsonResponse({ status: "ok" });
}

const ROUND_HTTP: Record<RoundResult["kind"], number> = {
  recorded: 200,
  skipped: 200,
  not_configured: 503,
  not_installed: 503,
  database_unreachable: 503,
  record_failed: 503,
};

export async function handleHealthCron(request: Request): Promise<Response> {
  const secret = getCronSecret();
  if (!secret) return jsonResponse({ ok: false, reason: "not_configured" }, 503);
  if (!bearerMatches(request, secret)) return jsonResponse({ ok: false }, 401);
  const result = await runHealthRound("heartbeat");
  const body =
    result.kind === "recorded"
      ? {
          ok: true,
          recorded: true,
          outcome: result.outcome,
          failedInfrastructure: result.failedInfrastructure,
        }
      : result.kind === "skipped"
        ? { ok: true, recorded: false, reason: "too_soon" }
        : { ok: false, recorded: false, reason: result.kind };
  return jsonResponse(body, ROUND_HTTP[result.kind]);
}

export async function handleReadiness(request: Request): Promise<Response> {
  const token = getHealthEnv().readyToken;
  if (!token) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  if (!bearerMatches(request, token)) return jsonResponse({ status: "unauthorized" }, 401);
  const port = healthPort(HEALTH_PROBE_TIMEOUT_MS);
  if (!port) return jsonResponse({ status: "unknown", monitor: "not_configured" }, 503);
  try {
    const latest = await withTimeout(port.latest(), HEALTH_PROBE_TIMEOUT_MS);
    const o = summarizeHealth(PROBES, latest, [], new Date());
    const infra = o.probes.filter((p) => p.probe.kind === "infrastructure");
    const failed = infra.some((p) => p.status === "failed");
    const degraded = infra.some((p) => p.status === "degraded");
    const running = o.monitor.state === "running" || o.monitor.state === "late";
    const status = !running ? "unknown" : failed ? "failed" : degraded ? "degraded" : "ok";
    return jsonResponse({ status, monitor: o.monitor.state }, running && !failed ? 200 : 503);
  } catch (e) {
    logWarn("health_ready_unreadable", { reason: reasonOf(e) });
    return jsonResponse({ status: "unknown", monitor: "unreadable" }, 503);
  }
}
