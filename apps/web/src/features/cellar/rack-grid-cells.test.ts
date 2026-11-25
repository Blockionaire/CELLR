import { describe, expect, it } from "vitest";
import type { PlacedBottle } from "@cellr/domain";
import { cellsOfBottles } from "./rack-grid";

const b = (
  bottleId: string,
  row: number | null,
  col: number | null,
  index?: number,
): PlacedBottle => ({
  bottleId,
  vintageId: "v",
  producer: "P",
  wineName: "W",
  type: "red",
  year: 2019,
  region: null,
  countryCode: null,
  row,
  col,
  ...(index !== undefined ? { index } : {}),
  image: null,
});

describe("the racks grid by cell (sprint 9: a cell may hold more than one bottle)", () => {
  it("one bottle per cell (depth off): exactly the bottle of each cell, as before", () => {
    const cells = cellsOfBottles([b("a", 1, 1), b("b", 1, 2), b("x", null, null)]);
    expect([...cells.keys()]).toEqual(["1:1", "1:2"]);
    expect(cells.get("1:1")).toEqual({
      front: expect.objectContaining({ bottleId: "a" }),
      count: 1,
    });
  });

  it("two bottles in one cell: the FRONT one is drawn whatever the order, and the other is counted, never lost", () => {
    for (const order of [
      [b("back", 2, 3, 2), b("front", 2, 3)],
      [b("front", 2, 3), b("back", 2, 3, 2)],
    ]) {
      const cell = cellsOfBottles(order).get("2:3")!;
      expect(cell.front.bottleId).toBe("front");
      expect(cell.count).toBe(2);
    }
  });

  it("a lone bottle at the back: it is the cell's bottle (and says it is at the back)", () => {
    const cell = cellsOfBottles([b("back", 1, 1, 2)]).get("1:1")!;
    expect(cell).toMatchObject({ count: 1, front: { bottleId: "back", index: 2 } });
  });
});
