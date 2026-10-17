import type { DrinkPhase } from "@cellr/domain";

/** Decorative only: the words always say the same thing, in text. */
export const PHASE_COLOUR: Record<DrinkPhase, string> = {
  young: "var(--young)",
  developing: "var(--ready)",
  peak: "var(--peak)",
  ready: "var(--fading)",
  past: "var(--danger)",
  unknown: "var(--ink-3)",
};
