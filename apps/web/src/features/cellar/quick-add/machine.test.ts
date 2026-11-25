import { describe, expect, it } from "vitest";
import {
  QUICK_VIEW,
  chosenSpot,
  offersSpots,
  quickActive,
  quickReducer,
  type QuickEvent,
  type QuickState,
} from "./machine";

const A = { row: 1, col: 2, index: 1 as const };
const B = { row: 3, col: 1, index: 1 as const };
const run = (events: QuickEvent[], from: QuickState = QUICK_VIEW) =>
  events.reduce(quickReducer, from);

describe("3D Quick Add state machine", () => {
  it("the whole way: view → placing → spot → action → saving → success → view", () => {
    let s = run([{ type: "enter" }]);
    expect(s.phase).toBe("placing");
    expect(offersSpots(s)).toBe(true);
    s = run([{ type: "pick", spot: A }], s);
    expect(s).toEqual({ phase: "spot", spot: A });
    s = run([{ type: "choose", action: "unplaced" }], s);
    expect(s).toEqual({ phase: "action", spot: A, action: "unplaced" });
    expect(offersSpots(s)).toBe(false);
    s = run([{ type: "submit" }], s);
    expect(s.phase).toBe("saving");
    s = run([{ type: "saved" }], s);
    expect(s).toEqual({ phase: "success", spot: A });
    expect(quickActive(s)).toBe(false);
    expect(run([{ type: "reset" }], s)).toBe(QUICK_VIEW);
  });

  it("one write at a time: a second submit while saving is refused (same object)", () => {
    const saving = run([
      { type: "enter" },
      { type: "pick", spot: A },
      { type: "choose", action: "move" },
      { type: "submit" },
    ]);
    expect(quickReducer(saving, { type: "submit" })).toBe(saving);
  });

  it("nothing is picked, chosen, backed out of or cancelled under a write on its way", () => {
    const saving = run([
      { type: "enter" },
      { type: "pick", spot: A },
      { type: "choose", action: "unplaced" },
      { type: "submit" },
    ]);
    for (const e of [
      { type: "pick", spot: B },
      { type: "choose", action: "scan" },
      { type: "back" },
      { type: "cancel" },
      { type: "enter" },
      { type: "reset" },
    ] as QuickEvent[])
      expect(quickReducer(saving, e), e.type).toBe(saving);
  });

  it("success only after saving: a stray 'saved' anywhere else changes nothing", () => {
    for (const s of [
      QUICK_VIEW,
      run([{ type: "enter" }]),
      run([{ type: "enter" }, { type: "pick", spot: A }]),
      run([{ type: "enter" }, { type: "pick", spot: A }, { type: "choose", action: "move" }]),
    ])
      expect(quickReducer(s, { type: "saved" })).toBe(s);
  });

  it("a conflict is recoverable: retry returns to the action with the same spot, back returns to the sheet", () => {
    const conflict = run([
      { type: "enter" },
      { type: "pick", spot: A },
      { type: "choose", action: "unplaced" },
      { type: "submit" },
      { type: "conflict" },
    ]);
    expect(conflict).toEqual({ phase: "conflict", spot: A, action: "unplaced" });
    expect(run([{ type: "retry" }], conflict)).toEqual({
      phase: "action",
      spot: A,
      action: "unplaced",
    });
    expect(run([{ type: "submit" }], conflict).phase).toBe("saving");
    expect(run([{ type: "back" }], conflict)).toEqual({ phase: "spot", spot: A });
  });

  it("spots are picked only while offered; another spot can be picked from the sheet", () => {
    expect(quickReducer(QUICK_VIEW, { type: "pick", spot: A })).toBe(QUICK_VIEW);
    const spot = run([{ type: "enter" }, { type: "pick", spot: A }, { type: "pick", spot: B }]);
    expect(chosenSpot(spot)).toEqual(B);
    const action = run([{ type: "choose", action: "move" }], spot);
    expect(quickReducer(action, { type: "pick", spot: A })).toBe(action);
  });

  it("scan and manual entry leave the screen with the spot kept; nothing is written here", () => {
    const leaving = run([
      { type: "enter" },
      { type: "pick", spot: A },
      { type: "choose", action: "scan" },
    ]);
    expect(leaving).toEqual({ phase: "leaving", spot: A, action: "scan" });
    expect(quickReducer(leaving, { type: "submit" })).toBe(leaving);
    expect(run([{ type: "back" }], leaving)).toEqual({ phase: "spot", spot: A });
  });

  it("cancel from anything but saving; back walks one step", () => {
    const spot = run([{ type: "enter" }, { type: "pick", spot: A }]);
    expect(run([{ type: "back" }], spot)).toEqual({ phase: "placing" });
    expect(run([{ type: "cancel" }], spot)).toEqual({ phase: "cancelled" });
    expect(run([{ type: "cancel" }, { type: "reset" }], spot)).toBe(QUICK_VIEW);
    expect(quickReducer(QUICK_VIEW, { type: "cancel" })).toBe(QUICK_VIEW);
  });
});
