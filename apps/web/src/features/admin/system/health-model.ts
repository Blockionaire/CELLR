import {
  worstStatus,
  type HealthCounts,
  type HealthHistorySample,
  type HealthStatus,
} from "@cellr/domain";

/**
 * Display rules for System › Health (sprint 2), kept apart from the page so they can be tested. They never turn a
 * gap into a status: an empty slot is "no measurement", and the headline names unmeasured checks instead of calling
 * the system healthy.
 */

/** The health badge: a shape and a colour per status (never colour alone; the word is always next to it). */
export const HEALTH_COLOR: Readonly<Record<HealthStatus, string>> = {
  healthy: "var(--sys-h-healthy)",
  degraded: "var(--sys-h-degraded)",
  failed: "var(--sys-h-failed)",
  unknown: "var(--sys-h-unknown)",
};
export const HEALTH_GLYPH: Readonly<Record<HealthStatus, string>> = {
  healthy: "✓",
  degraded: "!",
  failed: "×",
  unknown: "?",
};

/** One slot of a probe's history strip: the worst status measured in it, or null when nothing was measured. */
export interface StripSlot {
  readonly from: string;
  readonly status: HealthStatus | null;
  readonly samples: number;
}

export function historyStrip(
  samples: readonly HealthHistorySample[],
  probe: string,
  now: Date,
  hours = 24,
  slots = 48,
): StripSlot[] {
  const span = hours * 3_600_000;
  const size = span / slots;
  const start = now.getTime() - span;
  const buckets: HealthStatus[][] = Array.from({ length: slots }, () => []);
  for (const s of samples) {
    if (s.probe !== probe) continue;
    const t = Date.parse(s.measuredAt);
    if (!Number.isFinite(t) || t < start || t > now.getTime()) continue;
    buckets[Math.min(slots - 1, Math.floor((t - start) / size))]!.push(s.status);
  }
  return buckets.map((b, i) => ({
    from: new Date(start + i * size).toISOString(),
    status: b.length ? worstStatus(b) : null,
    samples: b.length,
  }));
}

/** The page's headline. "All checks pass" only when every check has a current, passing measurement. */
export function headline(counts: HealthCounts): { status: HealthStatus; text: string } {
  const total = counts.healthy + counts.degraded + counts.failed + counts.unknown;
  if (counts.failed > 0)
    return { status: "failed", text: `${counts.failed} of ${total} checks failed` };
  if (counts.degraded > 0)
    return { status: "degraded", text: `${counts.degraded} of ${total} checks degraded` };
  if (counts.unknown > 0)
    return {
      status: "unknown",
      text: `No failure measured · ${counts.unknown} of ${total} checks without a current measurement`,
    };
  return { status: "healthy", text: `All ${total} checks pass (only what each one measures)` };
}

/** "3 min ago", "2 h ago", "4 d ago"; "—" without a time. */
export function age(sec: number | null): string {
  if (sec === null) return "—";
  if (sec < 0) return "in the future";
  if (sec < 90) return `${sec} s ago`;
  if (sec < 5400) return `${Math.round(sec / 60)} min ago`;
  if (sec < 172_800) return `${Math.round(sec / 3600)} h ago`;
  return `${Math.round(sec / 86_400)} d ago`;
}

/** A reason code as words: "last_run_failed" → "last run failed". */
export const reasonText = (reason: string) => reason.replaceAll("_", " ").replaceAll(":", ": ");
