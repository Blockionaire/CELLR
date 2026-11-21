/**
 * WHAT VARIANT E WOULD HAVE DONE TO V1's ANSWERS (S11). V1 answered; its guard said, in shadow mode, which offered
 * bottles it would hold back. Here the two answers are scored side by side with the benchmark's own rules
 * (`qualityRow`): V1 as it answered, and V1 with the flagged bottles taken out (what E would show if it were on).
 *
 * - a catch: a flagged bottle the reference card labels poor (a real error of V1 that E finds);
 * - a false block: a flagged bottle labelled good or acceptable (a right recommendation E would take away);
 * - useful answers before and after: an answer left with no bottle is useful only where nothing suited.
 *
 * Totals only: nothing here names a scenario, so the same block is printed for blind sets.
 */
import { labelOf, qualityRow, type Label } from "./quality";
import type { ScenarioResult } from "./score";
import type { DishCard, EvalAnswer, Scenario } from "./types";

export interface GuardEffect {
  /** Pairing answers with a reference card and at least one bottle offered, where the guard ran. */
  answers: number;
  /** Of those, the ones whose dish the guard read well enough to judge. */
  judged: number;
  /** Answers with at least one bottle flagged. */
  flaggedAnswers: number;
  /** Flagged bottles by label. */
  flagged: Record<Label, number>;
  /** Offered bottles by label, before E. */
  offered: Record<Label, number>;
  /** Answers where the first bottle offered was flagged, by that bottle's label. */
  firstFlagged: Record<Label, number>;
  /** Useful answers: as V1 gave them, and with E's flags applied. */
  useful: [before: number, after: number];
  /** Answers left with no bottle at all once E's flags are applied. */
  emptied: number;
}

export const emptyGuardEffect = (): GuardEffect => ({
  answers: 0,
  judged: 0,
  flaggedAnswers: 0,
  flagged: { good: 0, ok: 0, poor: 0 },
  offered: { good: 0, ok: 0, poor: 0 },
  firstFlagged: { good: 0, ok: 0, poor: 0 },
  useful: [0, 0],
  emptied: 0,
});

/** Adds one scenario's answer to the totals (nothing when the guard did not run or there is no card). */
export function addGuardEffect(
  total: GuardEffect,
  scenario: Scenario,
  card: DishCard | null,
  answer: EvalAnswer,
  result: ScenarioResult,
  cellarKeys: readonly string[],
): void {
  if (!answer.guard || !card || answer.bottles.length === 0) return;
  const before = qualityRow(scenario, card, answer, result, cellarKeys);
  if (!before) return;
  const flagged = new Set(answer.guard.flagged);
  const after = qualityRow(
    scenario,
    card,
    { ...answer, bottles: answer.bottles.filter((k) => !flagged.has(k)) },
    result,
    cellarKeys,
  )!;
  total.answers += 1;
  if (answer.guard.considered) total.judged += 1;
  if (flagged.size > 0) total.flaggedAnswers += 1;
  for (const k of answer.bottles) total.offered[labelOf(card, k)] += 1;
  for (const k of flagged) total.flagged[labelOf(card, k)] += 1;
  if (flagged.has(answer.bottles[0]!)) total.firstFlagged[labelOf(card, answer.bottles[0]!)] += 1;
  if (before.useful) total.useful[0] += 1;
  if (after.useful) total.useful[1] += 1;
  if (after.labels.length === 0) total.emptied += 1;
}

export function formatGuardEffect(g: GuardEffect): string {
  const caught = g.flagged.poor;
  const blocked = g.flagged.good + g.flagged.ok;
  return [
    "### Variant E in shadow mode (V1's bottles, the guard's flags)",
    "",
    `- Pairing answers with bottles: ${g.answers}; the guard judged ${g.judged}; flagged something in ${g.flaggedAnswers}.`,
    `- Bottles offered: good ${g.offered.good}, acceptable ${g.offered.ok}, poor ${g.offered.poor}.`,
    `- Flagged: ${caught} poor (errors of V1 caught), ${blocked} good or acceptable (right bottles E would take away: good ${g.flagged.good}, acceptable ${g.flagged.ok}).`,
    `- First bottle flagged: poor ${g.firstFlagged.poor}, acceptable ${g.firstFlagged.ok}, good ${g.firstFlagged.good}.`,
    `- Useful answers: ${g.useful[0]} as V1 gave them, ${g.useful[1]} with E's flags applied; ${g.emptied} answers left with no bottle.`,
  ].join("\n");
}
