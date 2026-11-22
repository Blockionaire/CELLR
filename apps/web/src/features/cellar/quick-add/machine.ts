import type { FreeSpot } from "./spots";

/**
 * 3D QUICK ADD, AS A SMALL EXPLICIT STATE MACHINE (Smart Cellar 3D, sprint 7).
 *
 *   view ──enter──▶ placing ──pick──▶ spot ──choose(unplaced|move)──▶ action ──submit──▶ saving ──saved──▶ success
 *                      ▲               │  ╲                              ▲  │                  │
 *                      └──back─────────┘   choose(scan|manual)──▶ leaving   └──back──▶ spot    └──conflict──▶ conflict
 *                                                                                                      │ retry/back
 *   cancel (from anything but saving) ──▶ cancelled;  reset (from success or cancelled) ──▶ view
 *
 * What it guarantees, whatever arrives and in what order (several taps can land before the next render):
 *   - one write at a time: `submit` is taken only from `action` or `conflict`; a second one while saving is ignored;
 *   - nothing is chosen or cancelled under a write on its way: `pick`, `choose`, `back` and `cancel` are ignored while
 *     saving (the outcome is decided by the server's answer, or by a fresh read when that answer is lost);
 *   - a spot is chosen only while spots are on offer (placing, or another spot from the sheet);
 *   - success is entered only from saving, i.e. only after the server (or a fresh read) confirmed the write.
 * The machine holds no authority: the server checks every write; this only keeps the screen honest.
 */
export type QuickAction = "unplaced" | "move" | "scan" | "manual";
export type PanelAction = Extract<QuickAction, "unplaced" | "move">;
export type LeavingAction = Extract<QuickAction, "scan" | "manual">;

export type QuickState =
  | { phase: "view" }
  | { phase: "placing" }
  | { phase: "spot"; spot: FreeSpot }
  | { phase: "action"; spot: FreeSpot; action: PanelAction }
  | { phase: "saving"; spot: FreeSpot; action: PanelAction }
  | { phase: "conflict"; spot: FreeSpot; action: PanelAction }
  | { phase: "leaving"; spot: FreeSpot; action: LeavingAction }
  | { phase: "success"; spot: FreeSpot }
  | { phase: "cancelled" };

export type QuickEvent =
  | { type: "enter" }
  | { type: "pick"; spot: FreeSpot }
  | { type: "choose"; action: QuickAction }
  | { type: "submit" }
  | { type: "saved" }
  | { type: "conflict" }
  | { type: "retry" }
  | { type: "back" }
  | { type: "cancel" }
  | { type: "reset" };

export const QUICK_VIEW: QuickState = Object.freeze({ phase: "view" });

const leaves = (a: QuickAction): a is LeavingAction => a === "scan" || a === "manual";

/** The next state; the SAME object when the event does not apply (so a caller can tell it was refused). */
export function quickReducer(state: QuickState, event: QuickEvent): QuickState {
  switch (event.type) {
    case "enter":
      return state.phase === "view" || state.phase === "cancelled" || state.phase === "success"
        ? { phase: "placing" }
        : state;
    case "pick":
      return state.phase === "placing" || state.phase === "spot"
        ? { phase: "spot", spot: event.spot }
        : state;
    case "choose":
      if (state.phase !== "spot") return state;
      return leaves(event.action)
        ? { phase: "leaving", spot: state.spot, action: event.action }
        : { phase: "action", spot: state.spot, action: event.action };
    case "submit":
      return state.phase === "action" || state.phase === "conflict"
        ? { phase: "saving", spot: state.spot, action: state.action }
        : state;
    case "saved":
      return state.phase === "saving" ? { phase: "success", spot: state.spot } : state;
    case "conflict":
      return state.phase === "saving"
        ? { phase: "conflict", spot: state.spot, action: state.action }
        : state;
    case "retry":
      return state.phase === "conflict"
        ? { phase: "action", spot: state.spot, action: state.action }
        : state;
    case "back":
      if (state.phase === "spot") return { phase: "placing" };
      if (state.phase === "action" || state.phase === "conflict" || state.phase === "leaving")
        return { phase: "spot", spot: state.spot };
      return state;
    case "cancel":
      return state.phase === "view" || state.phase === "saving" || state.phase === "cancelled"
        ? state
        : { phase: "cancelled" };
    case "reset":
      return state.phase === "success" || state.phase === "cancelled" ? QUICK_VIEW : state;
  }
}

/** Whether the picture offers spots to tap (and does not take bottles out meanwhile). */
export const offersSpots = (s: QuickState) => s.phase === "placing" || s.phase === "spot";
/** Whether Quick Add owns the screen at all (bottle inspection is off meanwhile). */
export const quickActive = (s: QuickState) =>
  s.phase !== "view" && s.phase !== "cancelled" && s.phase !== "success";
/** The spot ringed in the picture, if any. */
export const chosenSpot = (s: QuickState): FreeSpot | null =>
  "spot" in s && s.phase !== "success" ? s.spot : null;
