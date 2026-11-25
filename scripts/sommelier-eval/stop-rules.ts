/**
 * THE STOP RULES OF THE PAID PLAN (P8_MEASUREMENT_PLAN.md §9), fixed before any paid run. The ones a machine can
 * enforce are enforced here: the runner stops at once, sends nothing more, and marks the run incomplete with the
 * rule that stopped it (run.ts, menu-run.ts); the results report prints "STOPPED: <rule>" for it.
 *
 * Enforced in code, during a run (paid mode only; an estimate answers "no AI" by design and is never stopped):
 * - `shown-cellar-fact`: with `check` on, an invented cellar fact (unknown ref, not in the cellar, wrong vintage,
 *   wrong count) in the words SHOWN to the person, as the check's own rules find it run on the final text;
 * - `shown-serving-claim`: with `annotate` on, a shown sentence that `reconcileServingClaims` would still take out;
 * - `served-model`: the provider says another model answered than the one configured;
 * - `failed-calls`: more than 5% of the calls failed (timeout, invalid output, refused, unavailable), after at
 *   least 20 calls, or at the end of the run: the comparison would be biased;
 * - `budget`: paid.ts's own guard (the run's --max-usd or the total --total-usd would be passed).
 *
 * Enforced in code after the runs: the cost criterion (cost-check.ts) and the regression rule (results-report.ts).
 * Judged by a person: every stopped answer, the review sheets, and every "possible regression".
 */
import type { AiResult } from "@/server/ai/types";

export const STOP_RULES = {
  "shown-cellar-fact":
    "an invented cellar fact (unknown ref, not in the cellar, wrong vintage, wrong count) was SHOWN after the check",
  "shown-serving-claim":
    "a shown sentence states a serving temperature, decanting time or drinking years the card contradicts",
  "served-model": "the provider answered with another model than the configured one",
  "failed-calls":
    "more than 5% of the calls failed (timeouts, invalid output): the comparison would be biased",
  budget: "the approved spending limit would be passed (paid.ts guard)",
} as const;
export type StopRule = keyof typeof STOP_RULES;

/** The codes of the check that are invented cellar facts (the others, price, shop, action, are trimmed by design). */
export const CELLAR_FACT_CODES = [
  "unknown-ref",
  "not-in-cellar",
  "wrong-vintage",
  "wrong-count",
] as const;

export const FAILED_SHARE_MAX = 0.05;
export const FAILED_MIN_CALLS = 20;

/** Whether a served model is the configured one, or a dated snapshot of it ("gpt-6-luna-2026-10-01"); nothing else. */
export const sameModel = (configured: string, served: string) =>
  served === configured ||
  (served.startsWith(`${configured}-`) &&
    /^\d{4}-\d{2}-\d{2}$/.test(served.slice(configured.length + 1)));

export class RunMonitor {
  calls = 0;
  failed = 0;
  served = new Set<string>();
  stopped: { rule: StopRule; detail: string } | null = null;

  constructor(
    readonly configured: string,
    /** Only a paid run is watched: an estimate answers "no AI" for every call on purpose. */
    readonly active: boolean,
  ) {}

  stop(rule: StopRule, detail: string) {
    if (this.active && !this.stopped) this.stopped = { rule, detail };
  }

  /** After every model call. */
  call(result: AiResult<unknown>) {
    if (!this.active) return;
    this.calls += 1;
    if (!result.ok) this.failed += 1;
    const served = result.usage.servedModel;
    if (served) {
      this.served.add(served);
      if (!sameModel(this.configured, served))
        this.stop("served-model", `served ${served}, configured ${this.configured}`);
    }
    if (this.calls >= FAILED_MIN_CALLS && this.failed / this.calls > FAILED_SHARE_MAX)
      this.stop("failed-calls", `${this.failed} of ${this.calls} calls failed`);
  }

  /** At the end of a run: the failure share over every call, however few. */
  end() {
    if (this.calls > 0 && this.failed / this.calls > FAILED_SHARE_MAX)
      this.stop("failed-calls", `${this.failed} of ${this.calls} calls failed`);
  }
}
