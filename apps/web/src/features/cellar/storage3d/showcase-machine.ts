/**
 * Taking a bottle out to look at it, as a state machine (Smart Cellar 3D, sprint 2B.1). Plain data and one pure
 * function: no three.js, no React, no clock. The animation tells it when a movement has ended; it says what may
 * happen next.
 *
 *   idle ──open──▶ extracting ──arrived──▶ inspecting ──dismiss──▶ returning ──returned──▶ idle
 *                      │                                                ▲  │
 *                      └───────────────dismiss──────────────────────────┘  └──open (the same bottle)──▶ extracting
 *
 *   any state ──cancel──▶ idle      (the place changed, the bottle is gone, the view closed: no movement, just over)
 *
 * WHAT IT REFUSES, and why:
 * - another bottle while one is out or moving: the selection never changes halfway through a movement. The one
 *   that is out goes home first.
 * - "arrived" and "returned" from an inspection that is no longer the current one (`run`): a movement that was
 *   interrupted cannot finish a later one.
 * An event that is refused returns the very same state object, so a caller (and a test) can tell.
 */
export type ShowcasePhase = "idle" | "extracting" | "inspecting" | "returning";

export interface ShowcaseState {
  phase: ShowcasePhase;
  /** The bottle that is out, on its way out or on its way home; null when idle. */
  bottleId: string | null;
  /** Counts inspections: every `open` from idle starts a new one. Movements report back with it. */
  run: number;
}

export type ShowcaseEvent =
  | { type: "open"; bottleId: string }
  | { type: "arrived"; run: number }
  | { type: "dismiss" }
  | { type: "returned"; run: number }
  | { type: "cancel" };

export const SHOWCASE_IDLE: ShowcaseState = { phase: "idle", bottleId: null, run: 0 };

export function showcaseReducer(state: ShowcaseState, event: ShowcaseEvent): ShowcaseState {
  switch (event.type) {
    case "open":
      if (state.phase === "idle")
        return { phase: "extracting", bottleId: event.bottleId, run: state.run + 1 };
      // on its way home, the same bottle is asked for again: it turns round where it is (the same inspection)
      if (state.phase === "returning" && state.bottleId === event.bottleId)
        return { ...state, phase: "extracting" };
      return state;
    case "arrived":
      return state.phase === "extracting" && event.run === state.run
        ? { ...state, phase: "inspecting" }
        : state;
    case "dismiss":
      return state.phase === "extracting" || state.phase === "inspecting"
        ? { ...state, phase: "returning" }
        : state;
    case "returned":
      return state.phase === "returning" && event.run === state.run
        ? { phase: "idle", bottleId: null, run: state.run }
        : state;
    case "cancel":
      return state.phase === "idle" ? state : { phase: "idle", bottleId: null, run: state.run };
  }
}

/** A bottle is out of its place (on display or moving): the storage camera holds still, taps do not choose. */
export const isOut = (state: ShowcaseState): boolean => state.phase !== "idle";
/** Where the movement is heading: 1 = on display, 0 = in its place. */
export const targetOf = (phase: ShowcasePhase): 0 | 1 =>
  phase === "extracting" || phase === "inspecting" ? 1 : 0;
