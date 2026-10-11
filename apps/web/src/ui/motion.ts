import type { Transition } from "motion/react";

/**
 * Animation language (docs/00-architecture-plan.md §7.4).
 * Motion explains hierarchy or physicality, or it does not ship. Under prefers-reduced-motion the
 * app-wide <MotionConfig reducedMotion="user"> drops transforms and keeps opacity — a plain fade.
 */
export const spring = {
  /** toggles, chips, small moves */
  snap: { type: "spring", stiffness: 420, damping: 34 } satisfies Transition,
  /** sheets, card → detail (~320 ms) */
  glide: { type: "spring", stiffness: 240, damping: 30 } satisfies Transition,
} as const;

export const fade: Transition = { duration: 0.15, ease: [0.2, 0.8, 0.2, 1] };
