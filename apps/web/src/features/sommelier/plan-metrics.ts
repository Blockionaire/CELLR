import type { SommelierAnswer } from "@cellr/domain";

/**
 * What is measured about an answer: which engine gave it and what kind of answer it was, as codes and counts.
 * Never what was asked, the dish, a wine, a price, a friend's name or anything else a person typed or owns
 * (docs/METRICS.md). The dish is not even sent as a code: with a small household it could say what they ate.
 */
export function answerMetrics(answer: SommelierAnswer): Record<string, string | number | boolean> {
  const plan = answer.plan;
  if (!plan) return { source: answer.source, engine: "v1" };
  return {
    source: answer.source,
    engine: "v3",
    kind: plan.kind,
    outcome: plan.outcome ?? "none-given",
    confidence: plan.confidence ?? "none-given",
    picks: plan.picks.length,
    set_aside: plan.setAside.length,
    styles: plan.styles.length,
    asked: plan.ask ?? "nothing",
    friends: plan.friends.length,
  };
}
