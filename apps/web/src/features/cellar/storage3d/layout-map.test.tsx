import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { STORAGE_TEMPLATE_IDS, resolveStorage } from "@cellr/domain";
import { fixtureBottles, fixturePlace, type FixtureBottle } from "./fixtures";
import {
  MAP_LABELS_EN,
  cellLabel,
  chosenByPressing,
  chosenPlace,
  frontOf,
  mapData,
  modeOf,
  type MapBottle,
} from "./layout-cells";
import { LayoutMap } from "./layout-map";
import { buildModel, placeBottles } from "./model";

const named = (bottles: FixtureBottle[]): MapBottle[] =>
  bottles.map((b) => ({ ...b, name: `${b.wine.producer} ${b.wine.name}` }));
const UNSURE = resolveStorage({
  kind: "rack",
  rows: 2,
  cols: 3,
  template: "diamond_bins",
  cellCapacity: 8,
  semantics: "depth",
});

describe("the flat picture, as data", () => {
  it("shows a template the way its index is meant", () => {
    const modes = Object.fromEntries(
      STORAGE_TEMPLATE_IDS.map((id) => [id, modeOf(fixturePlace({ template: id }))]),
    );
    expect(modes).toMatchObject({
      rack_classic: "position",
      rack_double_depth: "depth",
      wall_pegs: "position",
      cube_modular: "count",
      diamond_bins: "count",
      crate_storage: "count",
    });
    // whatever a rail or a cooler holds per position, it is never a loose pile
    for (const id of STORAGE_TEMPLATE_IDS)
      expect(modes[id] === "count").toBe(
        fixturePlace({ template: id }).layout.semantics === "ordinal",
      );
  });

  it("agrees with the 3D view, for every template: the same bottles in the same cells, the same ones left out", () => {
    for (const id of STORAGE_TEMPLATE_IDS) {
      const resolved = fixturePlace({ template: id });
      const bottles = named(fixtureBottles(resolved.layout, "partial"));
      // and one on a spot the place does not have
      const all = [...bottles, { ...bottles[0]!, id: "lost", row: resolved.layout.rows + 1 }];
      const data = mapData(resolved, all);
      const drawn = placeBottles(
        buildModel(resolved),
        all.map((b) => ({ ...b, shape: "bordeaux" as const })),
      );
      expect(data.used).toBe(drawn.placed.length);
      expect(data.stranded.map((b) => b.id)).toEqual(drawn.stranded.map((b) => b.id));
      expect(data.capacity).toBe(resolved.layout.capacity);
      for (const cell of data.cells)
        expect(cell.used).toBe(
          drawn.placed.filter((b) => b.address.row === cell.row && b.address.col === cell.col)
            .length,
        );
    }
  });

  it("a deep position knows which bottle is in front and which behind", () => {
    const resolved = fixturePlace({ template: "rack_double_depth", rows: 1, cols: 2 });
    const bottles: MapBottle[] = [
      { id: "back", row: 1, col: 1, index: 2, type: "red", name: "Back wine" },
      { id: "front", row: 1, col: 1, index: 1, type: "white", name: "Front wine" },
      { id: "alone", row: 1, col: 2, index: 2, type: "rose", name: "Lonely wine" },
    ];
    const [a, b] = mapData(resolved, bottles).cells;
    expect(a!.slots!.map((s) => s?.id)).toEqual(["front", "back"]);
    // a bottle at the back with nothing in front of it stays at the back: it is not moved forward
    expect(b!.slots!.map((s) => s?.id ?? null)).toEqual([null, "alone"]);
    expect(cellLabel(a!, MAP_LABELS_EN)).toBe(
      "Shelf 1, position 1: front: Front wine; back: Back wine",
    );
    expect(cellLabel(b!, MAP_LABELS_EN)).toBe(
      "Shelf 1, position 2: front: free; back: Lonely wine",
    );
  });

  it("a compartment says how many, and nothing about where", () => {
    const resolved = fixturePlace({ template: "diamond_bins", rows: 1, cols: 1, cellCapacity: 6 });
    const bottles: MapBottle[] = [3, 5].map((index) => ({
      id: `b${index}`,
      row: 1,
      col: 1,
      index,
      type: "red",
      name: "X",
    }));
    const cell = mapData(resolved, bottles).cells[0]!;
    expect(cell).toMatchObject({ mode: "count", used: 2, capacity: 6, slots: null });
    expect(cellLabel(cell, MAP_LABELS_EN)).toBe("Compartment 1·1: 2 of 6 bottles");
  });

  it("a place whose arrangement is not known is counted, whatever its stored meaning of an index", () => {
    expect(UNSURE.arrangementKnown).toBe(false);
    const data = mapData(UNSURE, named(fixtureBottles(UNSURE.layout, "partial")));
    expect(data.mode).toBe("count");
    expect(data.cells.every((c) => c.slots === null)).toBe(true);
  });

  it("two bottles stored on one spot: one is shown there, the other is reported", () => {
    const resolved = fixturePlace({ template: "rack_classic", rows: 1, cols: 1 });
    const twice: MapBottle[] = ["a", "b"].map((id) => ({
      id,
      row: 1,
      col: 1,
      type: "red",
      name: id,
    }));
    const data = mapData(resolved, twice);
    expect(data.used).toBe(1);
    expect(data.stranded.map((b) => b.id)).toEqual(["b"]);
  });
});

describe("the flat picture, on the page", () => {
  const html = (
    resolved = fixturePlace({ template: "rack_double_depth", rows: 2, cols: 3 }),
    fill: "partial" | "full" = "full",
  ) =>
    renderToStaticMarkup(
      <LayoutMap
        resolved={resolved}
        bottles={named(fixtureBottles(resolved.layout, fill))}
        label="Test rack"
        onSelect={() => {}}
      />,
    );

  it("is a named grid of buttons, one per cell, each saying what is there", () => {
    const out = html();
    expect(out).toContain('role="grid"');
    expect(out).toContain('aria-label="Test rack"');
    expect(out).toContain('aria-rowcount="2"');
    expect(out).toContain('aria-colcount="3"');
    expect(out.match(/<button/g)).toHaveLength(6);
    expect(out).toMatch(/aria-label="Shelf 1, position 1: front: [^"]+; back: [^"]+"/);
  });

  it("is one stop for the Tab key: the arrow keys do the rest", () => {
    const out = html();
    expect(out.match(/tabindex="0"/g)).toHaveLength(1);
    expect(out.match(/tabindex="-1"/g)).toHaveLength(5);
  });

  it("draws the places behind the front bottle in a deep rack, and none in a single one", () => {
    expect(html().match(/data-testid="depth-pips"/g)).toHaveLength(6);
    expect(html(fixturePlace({ template: "rack_classic", rows: 2, cols: 3 }))).not.toContain(
      "depth-pips",
    );
  });

  it("draws no bottle at any place in a compartment: a number and a bar", () => {
    const out = html(fixturePlace({ template: "crate_storage", rows: 1, cols: 2 }));
    expect(out).toContain('data-mode="count"');
    expect(out).not.toContain("--wine-");
    expect(out).toMatch(/aria-label="Compartment 1·1: \d+ of \d+ bottles"/);
  });

  it("says so when the arrangement is not known", () => {
    const out = html(UNSURE, "partial");
    expect(out).toContain('data-testid="layout-map-unknown"');
    expect(out).toContain("does not know how this place is arranged");
    expect(html()).not.toContain("layout-map-unknown");
  });
});

/**
 * Regression (sprint 2A review): a deep position with a FREE front and a bottle behind it. The picture shows the
 * front as free and the cell says "front: free", so pressing the cell must not choose the bottle behind.
 */
describe("pressing a position chooses its front bottle, and only that", () => {
  const deep = (cellCapacity = 2) =>
    fixturePlace({ template: "rack_double_depth", rows: 1, cols: 3, cellCapacity });
  const bottle = (id: string, col: number, index: number): MapBottle => ({
    id,
    row: 1,
    col,
    index,
    type: "red",
    name: id,
  });
  // position 1: front free, back taken. position 2: both taken. position 3: front taken, back free.
  const BOTTLES = [
    bottle("rear-alone", 1, 2),
    bottle("front-2", 2, 1),
    bottle("rear-2", 2, 2),
    bottle("front-3", 3, 1),
  ];
  const cells = () => mapData(deep(), BOTTLES).cells;

  it("a free front with a bottle behind stands for no bottle", () => {
    const [freeFront] = cells();
    expect(freeFront!.slots!.map((b) => b?.id ?? null)).toEqual([null, "rear-alone"]);
    expect(frontOf(freeFront!)).toBeNull();
    expect(chosenByPressing(freeFront!, null)).toBeNull();
    // whatever was chosen before, pressing it never lands on the bottle behind
    for (const before of [null, "front-2", "rear-2", "rear-alone", "front-3"])
      expect(chosenByPressing(freeFront!, before), String(before)).toBeNull();
  });

  it("three deep, with only the back taken, or only the middle: still no bottle", () => {
    const three = deep(3);
    const only = (index: number) => mapData(three, [bottle("behind", 1, index)]).cells[0]!;
    for (const index of [2, 3]) {
      expect(frontOf(only(index))).toBeNull();
      expect(chosenByPressing(only(index), null)).toBeNull();
    }
    expect(chosenByPressing(only(1), null)).toBe("behind");
  });

  it("a taken front is chosen, whatever lies behind, and pressing again lets go", () => {
    const [, both, frontOnly] = cells();
    expect(chosenByPressing(both!, null)).toBe("front-2");
    expect(chosenByPressing(both!, "front-2")).toBeNull();
    // with the bottle BEHIND it chosen (in the 3D view), pressing chooses the front one: never stays on the rear
    expect(chosenByPressing(both!, "rear-2")).toBe("front-2");
    expect(chosenByPressing(frontOnly!, null)).toBe("front-3");
  });

  it("a compartment and a single position keep their meaning", () => {
    const bins = fixturePlace({ template: "diamond_bins", rows: 1, cols: 1, cellCapacity: 4 });
    const pile = mapData(bins, [{ id: "p", row: 1, col: 1, index: 3, type: "red", name: "p" }])
      .cells[0]!;
    expect(frontOf(pile)).toBeNull();
    expect(chosenByPressing(pile, null)).toBeNull();
    const single = fixturePlace({ template: "rack_classic", rows: 1, cols: 1 });
    const cell = mapData(single, [{ id: "s", row: 1, col: 1, type: "red", name: "s" }]).cells[0]!;
    expect(chosenByPressing(cell, null)).toBe("s");
  });

  it("knows which place of a cell holds the chosen bottle", () => {
    const [freeFront, both] = cells();
    expect(chosenPlace(freeFront!, "rear-alone")).toBe(2);
    expect(chosenPlace(freeFront!, "front-2")).toBeNull();
    expect(chosenPlace(both!, "front-2")).toBe(1);
    expect(chosenPlace(both!, "rear-2")).toBe(2);
    expect(chosenPlace(both!, null)).toBeNull();
  });

  const html = (selectedId: string | null) =>
    renderToStaticMarkup(
      <LayoutMap
        resolved={deep()}
        bottles={BOTTLES}
        label="Deep"
        selectedId={selectedId}
        onSelect={() => {}}
      />,
    );
  const cellHtml = (out: string, key: string) =>
    out.match(new RegExp(`<button[^>]*data-cell="${key}"[^>]*>`))![0];

  it("on the page: a free front reads as free and is not pressed, even when the bottle behind it is the chosen one", () => {
    const idle = cellHtml(html(null), "1:1");
    expect(idle).toContain('aria-label="Shelf 1, position 1: front: free; back: rear-alone"');
    expect(idle).toContain('aria-pressed="false"');
    expect(idle).not.toContain("data-chosen-place");

    // chosen in the 3D view: the cell says which place it is, and is still not "pressed" (its front is free)
    const rearChosen = cellHtml(html("rear-alone"), "1:1");
    expect(rearChosen).toContain(
      'aria-label="Shelf 1, position 1: front: free; back: rear-alone (chosen)"',
    );
    expect(rearChosen).toContain('aria-pressed="false"');
    expect(rearChosen).toContain('data-chosen-place="2"');
  });

  it("on the page: pressed means the front bottle is the chosen one", () => {
    const front = cellHtml(html("front-2"), "1:2");
    expect(front).toContain('aria-pressed="true"');
    expect(front).toContain('data-chosen-place="1"');
    expect(front).toContain("front: front-2 (chosen); back: rear-2");
    const rear = cellHtml(html("rear-2"), "1:2");
    expect(rear).toContain('aria-pressed="false"');
    expect(rear).toContain('data-chosen-place="2"');
    expect(rear).toContain("front: front-2; back: rear-2 (chosen)");
    // exactly one cell is pressed at most, and none when a rear bottle is chosen
    expect(html("front-2").match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html("rear-2").match(/aria-pressed="true"/g)).toBeNull();
  });

  it("says in the legend that a position chooses its front bottle only", () => {
    expect(html(null)).toContain("Choosing a position chooses its front bottle only.");
  });
});
