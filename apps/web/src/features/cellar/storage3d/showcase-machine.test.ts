import { describe, expect, it } from "vitest";
import {
  SHOWCASE_IDLE,
  isOut,
  showcaseReducer,
  targetOf,
  type ShowcaseEvent,
  type ShowcaseState,
} from "./showcase-machine";
import { seeded } from "./fixtures";

const run = (events: ShowcaseEvent[], from: ShowcaseState = SHOWCASE_IDLE) =>
  events.reduce(showcaseReducer, from);
const open = (bottleId: string): ShowcaseEvent => ({ type: "open", bottleId });
const OUT = run([open("a")]);
const SHOWN = run([open("a"), { type: "arrived", run: 1 }]);
const HOME = run([open("a"), { type: "arrived", run: 1 }, { type: "dismiss" }]);

describe("taking a bottle out, looking at it, putting it back", () => {
  it("goes idle → extracting → inspecting → returning → idle", () => {
    expect(SHOWCASE_IDLE).toEqual({ phase: "idle", bottleId: null, run: 0 });
    expect(OUT).toEqual({ phase: "extracting", bottleId: "a", run: 1 });
    expect(SHOWN).toEqual({ phase: "inspecting", bottleId: "a", run: 1 });
    expect(HOME).toEqual({ phase: "returning", bottleId: "a", run: 1 });
    expect(run([{ type: "returned", run: 1 }], HOME)).toEqual({
      phase: "idle",
      bottleId: null,
      run: 1,
    });
  });

  it("every new inspection has a new number", () => {
    const again = run([{ type: "returned", run: 1 }, open("b")], HOME);
    expect(again).toEqual({ phase: "extracting", bottleId: "b", run: 2 });
  });

  it("knows which way the movement is heading, and whether a bottle is out", () => {
    expect([SHOWCASE_IDLE, OUT, SHOWN, HOME].map((s) => targetOf(s.phase))).toEqual([0, 1, 1, 0]);
    expect([SHOWCASE_IDLE, OUT, SHOWN, HOME].map(isOut)).toEqual([false, true, true, true]);
  });
});

describe("interrupting a movement", () => {
  it("dismissed on its way out, the bottle turns round and goes home", () => {
    expect(run([{ type: "dismiss" }], OUT)).toEqual({ phase: "returning", bottleId: "a", run: 1 });
  });

  it("asked for again on its way home, the same bottle turns round and comes out: the same inspection", () => {
    expect(run([open("a")], HOME)).toEqual({ phase: "extracting", bottleId: "a", run: 1 });
  });

  it("cancelled anywhere (the place changed, the view closed): over at once, with no movement owed", () => {
    for (const from of [OUT, SHOWN, HOME])
      expect(run([{ type: "cancel" }], from)).toEqual({ phase: "idle", bottleId: null, run: 1 });
    expect(run([{ type: "cancel" }])).toBe(SHOWCASE_IDLE);
  });
});

describe("what is refused (the very same state comes back)", () => {
  const refused = (from: ShowcaseState, event: ShowcaseEvent) =>
    expect(showcaseReducer(from, event), `${from.phase} + ${event.type}`).toBe(from);

  it("another bottle while one is out or moving: the selection never changes halfway", () => {
    for (const from of [OUT, SHOWN, HOME]) refused(from, open("b"));
    // and the one that is out is not opened a second time
    refused(OUT, open("a"));
    refused(SHOWN, open("a"));
  });

  it("an ending that has nothing to end", () => {
    refused(SHOWCASE_IDLE, { type: "arrived", run: 0 });
    refused(SHOWCASE_IDLE, { type: "returned", run: 0 });
    refused(SHOWCASE_IDLE, { type: "dismiss" });
    refused(SHOWN, { type: "arrived", run: 1 });
    refused(SHOWN, { type: "returned", run: 1 });
    refused(OUT, { type: "returned", run: 1 });
    refused(HOME, { type: "arrived", run: 1 });
    refused(HOME, { type: "dismiss" });
  });

  it("an ending reported by an inspection that is over: an interrupted movement cannot finish a later one", () => {
    const second = run([{ type: "returned", run: 1 }, open("b")], HOME); // run 2
    refused(second, { type: "arrived", run: 1 });
    const secondHome = run([{ type: "dismiss" }], second);
    refused(secondHome, { type: "returned", run: 1 });
    expect(run([{ type: "returned", run: 2 }], secondHome).phase).toBe("idle");
  });
});

describe("whatever is thrown at it", () => {
  it("ten thousand taps, endings and cancellations in any order never leave it in a state that is not one", () => {
    const rnd = seeded(2026);
    const ids = ["a", "b", "c"];
    let state = SHOWCASE_IDLE;
    for (let i = 0; i < 10_000; i++) {
      const before = state;
      const dice = rnd();
      const event: ShowcaseEvent =
        dice < 0.4
          ? open(ids[Math.floor(rnd() * ids.length)]!)
          : dice < 0.55
            ? { type: "arrived", run: before.run - Math.floor(rnd() * 2) }
            : dice < 0.75
              ? { type: "dismiss" }
              : dice < 0.93
                ? { type: "returned", run: before.run - Math.floor(rnd() * 2) }
                : { type: "cancel" };
      state = showcaseReducer(before, event);
      // a bottle is named exactly when one is out
      expect(state.bottleId === null).toBe(state.phase === "idle");
      // while one is out it stays the same bottle, whatever is asked
      if (before.phase !== "idle" && state.phase !== "idle")
        expect(state.bottleId).toBe(before.bottleId);
      // the count of inspections only goes up, and only when a new one starts from idle
      expect(state.run - before.run).toBe(
        before.phase === "idle" && state.phase === "extracting" ? 1 : 0,
      );
      // inspecting is only reached by arriving; idle from a movement only by returning or cancelling
      if (state.phase === "inspecting" && before.phase !== "inspecting")
        expect(event.type).toBe("arrived");
      if (state.phase === "idle" && before.phase !== "idle")
        expect(["returned", "cancel"]).toContain(event.type);
    }
  });
});
