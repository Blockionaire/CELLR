import { describe, expect, it } from "vitest";
import { STORAGE_TEMPLATE_IDS, resolveStorage, type StorageTemplateId } from "@cellr/domain";
import { fixtureBottles, fixturePlace, type FixturePlace } from "./fixtures";
import {
  buildModel,
  placeBottles,
  type PlacedBottle,
  type RenderModel,
  type StoredBottle,
} from "./model";
import { bottleOverlap, box, penetration, type Pose } from "./parts";
import {
  obstaclesOn,
  planExtraction,
  samplePath,
  wayOut,
  type ExtractionPlan,
} from "./showcase-plan";

const modelOf = (place: FixturePlace) => buildModel(fixturePlace(place));
const stage = (
  place: FixturePlace,
  fill: "full" | "partial" = "full",
  bottles?: StoredBottle[],
) => {
  const model = modelOf(place);
  const { placed } = placeBottles(model, bottles ?? fixtureBottles(model.resolved.layout, fill));
  const plan = (id: string) =>
    planExtraction(
      model,
      placed.find((b) => b.id === id)!,
      placed,
    );
  return { model, placed, plan, plans: () => placed.map((b) => planExtraction(model, b, placed)) };
};
const tally = (plans: ExtractionPlan[]) => {
  const count: Record<string, number> = {};
  for (const p of plans) count[`${p.mode}/${p.reason}`] = (count[`${p.mode}/${p.reason}`] ?? 0) + 1;
  return count;
};
const bottle = (row: number, col: number, index = 1): StoredBottle => ({
  id: `b-${row}:${col}:${index}`,
  row,
  col,
  index,
  type: "red",
  shape: "bordeaux",
});

describe("how a bottle leaves its place, per template", () => {
  /** What every bottle of a full place of the template gets, at its default size and look. */
  const EXPECTED: Record<StorageTemplateId, Record<string, number>> = {
    rack_classic: { "physical/clear_path": 40 },
    rack_double_depth: { "physical/clear_path": 40, "emerge/behind_bottle": 40 },
    rack_metal: { "physical/clear_path": 36 },
    shelving_open: { "physical/clear_path": 24 },
    cabinet_closed: { "physical/clear_path": 24 }, // its solid doors stand open
    rack_generic: { "physical/clear_path": 24 },
    cube_modular: { "lift/pile": 81 },
    diamond_bins: { "lift/pile": 48 },
    crate_storage: { "lift/pile": 36 },
    wall_pegs: { "physical/clear_path": 36 },
    wall_rails: { "physical/clear_path": 9 },
    cooler_single: { "emerge/behind_door": 20 }, // behind glass
    cooler_dual: { "emerge/behind_door": 40 },
    cooler_undercounter: { "emerge/behind_door": 24 },
  };
  for (const id of STORAGE_TEMPLATE_IDS)
    it(`${id}: ${Object.keys(EXPECTED[id]).join(", ")}`, () => {
      expect(tally(stage({ template: id }).plans())).toEqual(EXPECTED[id]);
    });
});

describe("what a plan carries", () => {
  it("the bottle's address and its drawn pose, untouched, for every bottle of every template", () => {
    for (const id of STORAGE_TEMPLATE_IDS) {
      const { placed, plans } = stage({ template: id }, "partial");
      plans().forEach((plan, i) => {
        const b = placed[i]!;
        expect(plan.address).toEqual({ row: b.row, col: b.col, index: b.index ?? 1 });
        expect(plan.address).toBe(b.address);
        expect(plan.origin).toBe(b.pose);
        expect(plan.originScale).toBe(1);
        if (plan.mode === "physical") expect(plan.path[0]).toEqual(b.pose.position);
        else expect(plan.path).toEqual([]);
      });
    }
  });

  it("planning changes nothing: the same bottles lie in the same places afterwards", () => {
    for (const id of STORAGE_TEMPLATE_IDS) {
      const { model, placed, plans } = stage({ template: id }, "partial");
      const before = JSON.stringify(placed);
      plans();
      expect(JSON.stringify(placed)).toBe(before);
      // and putting the same bottles down again gives the same picture (a pile included)
      expect(JSON.stringify(placeBottles(model, placed).placed)).toBe(before);
    }
  });
});

describe("a path a bottle is really drawn out along touches nothing", () => {
  /** Checked here on its own, finer than the planner samples: wood, glass, rods and every other bottle. */
  const worst = (
    model: RenderModel,
    placed: PlacedBottle[],
    b: PlacedBottle,
    path: ExtractionPlan["path"],
  ) => {
    let deepest = -Infinity;
    const fine = path.flatMap((p, i) =>
      i === 0
        ? [p]
        : Array.from({ length: 40 }, (_, k) => {
            const a = path[i - 1]!;
            const t = (k + 1) / 40;
            return [
              a[0] + (p[0] - a[0]) * t,
              a[1] + (p[1] - a[1]) * t,
              a[2] + (p[2] - a[2]) * t,
            ] as [number, number, number];
          }),
    );
    for (const position of fine) {
      const pose: Pose = { position, lie: b.pose.lie };
      for (const part of model.parts)
        if (!["wall", "glow", "glowB", "display"].includes(part.role))
          deepest = Math.max(deepest, penetration(pose, part));
      for (const other of placed)
        if (other.id !== b.id) deepest = Math.max(deepest, bottleOverlap(pose, other.pose));
    }
    return deepest;
  };

  for (const id of STORAGE_TEMPLATE_IDS)
    it(`${id}: every physical extraction, full and half full, at two sizes`, () => {
      for (const place of [{ template: id }, { template: id, rows: 2, cols: 2 }] as FixturePlace[])
        for (const fill of ["full", "partial"] as const) {
          const { model, placed, plans } = stage(place, fill);
          plans().forEach((plan, i) => {
            if (plan.mode !== "physical") return;
            expect(plan.path.length).toBeGreaterThanOrEqual(2);
            expect(
              worst(model, placed, placed[i]!, plan.path),
              `${id} ${placed[i]!.id}`,
            ).toBeLessThanOrEqual(1e-6);
          });
        }
    });

  it("ends clear of the furniture: all of the bottle is before its front", () => {
    for (const id of [
      "rack_classic",
      "rack_metal",
      "shelving_open",
      "rack_generic",
      "cabinet_closed",
    ] as const) {
      const { model, plans } = stage({ template: id });
      const front = Math.max(
        ...model.parts.filter((p) => !p.soft).map((p) => p.pos[2] + p.size[2] / 2),
      );
      for (const plan of plans()) expect(plan.path.at(-1)![2] - 3.4 / 2).toBeGreaterThan(front);
    }
  });

  it("a bottle on a wall is lifted off what carries it first, then taken away from the wall", () => {
    for (const id of ["wall_pegs", "wall_rails"] as const)
      for (const plan of stage({ template: id }).plans()) {
        const [from, up, away] = plan.path;
        expect(plan.path).toHaveLength(3);
        expect(up![1]).toBeGreaterThan(from![1]);
        expect([up![0], up![2]]).toEqual([from![0], from![2]]);
        expect(away![2]).toBeGreaterThan(up![2] + 0.9);
        expect([away![0], away![1]]).toEqual([up![0], up![1]]);
      }
  });
});

describe("a rack with bottles one behind the other", () => {
  const deep = { template: "rack_double_depth", rows: 1, cols: 2 } as const;

  it("the bottle behind a bottle is shown, never drawn out through it; and index 2 stays index 2", () => {
    const { plan } = stage(deep, "full", [bottle(1, 1, 1), bottle(1, 1, 2)]);
    expect(plan("b-1:1:1")).toMatchObject({ mode: "physical", reason: "clear_path" });
    expect(plan("b-1:1:2")).toMatchObject({
      mode: "emerge",
      reason: "behind_bottle",
      address: { row: 1, col: 1, index: 2 },
    });
  });

  it("the bottle at the back with nothing before it is drawn out through the free place", () => {
    const { plan, model } = stage(deep, "full", [bottle(1, 1, 2), bottle(1, 2, 1)]);
    const rear = plan("b-1:1:2");
    expect(rear).toMatchObject({ mode: "physical", reason: "clear_path", address: { index: 2 } });
    // it starts a bottle's length further back than a front bottle does, and ends at the same place before the rack
    const front = stage(deep, "full", [bottle(1, 1, 1)]).plan("b-1:1:1");
    expect(rear.path[0]![2]).toBeLessThan(front.path[0]![2] - 3.4);
    expect(rear.path.at(-1)).toEqual(front.path.at(-1));
    expect(wayOut(model, rear.origin)).toEqual(rear.path);
  });

  it("three deep: the middle one is held by the front one, the back one by either", () => {
    const three = { template: "rack_double_depth", rows: 1, cols: 1, cellCapacity: 3 } as const;
    expect(stage(three, "full", [bottle(1, 1, 2), bottle(1, 1, 3)]).plan("b-1:1:3").reason).toBe(
      "behind_bottle",
    );
    expect(stage(three, "full", [bottle(1, 1, 1), bottle(1, 1, 3)]).plan("b-1:1:3").reason).toBe(
      "behind_bottle",
    );
    expect(stage(three, "full", [bottle(1, 1, 3)]).plan("b-1:1:3").mode).toBe("physical");
    expect(stage(three, "full", [bottle(1, 1, 2)]).plan("b-1:1:2").mode).toBe("physical");
  });

  it("a rail three deep on a wall: the same rule, away from the wall", () => {
    const rail = { template: "wall_rails", rows: 2, cols: 1, cellCapacity: 3 } as const;
    const full = stage(rail, "full");
    expect(tally(full.plans())).toEqual({ "physical/clear_path": 2, "emerge/behind_bottle": 4 });
    expect(stage(rail, "full", [bottle(1, 1, 3)]).plan("b-1:1:3").mode).toBe("physical");
  });
});

describe("a door", () => {
  it("a cabinet behind glass: shown through the door, which is not opened", () => {
    const glass = stage({ template: "cabinet_closed", appearance: { door: "glass" } });
    expect(tally(glass.plans())).toEqual({ "emerge/behind_door": 24 });
  });

  it("a cabinet with its doors open: drawn out", () => {
    expect(
      tally(stage({ template: "cabinet_closed", appearance: { door: "solid" } }).plans()),
    ).toEqual({ "physical/clear_path": 24 });
  });

  it("a cooler is never drawn out of: behind glass the door holds it, door open the lip of its shelf does", () => {
    for (const id of ["cooler_single", "cooler_dual", "cooler_undercounter"] as const) {
      expect(
        Object.keys(tally(stage({ template: id, appearance: { door: "glass" } }).plans())),
      ).toEqual(["emerge/behind_door"]);
      expect(
        Object.keys(tally(stage({ template: id, appearance: { door: "solid" } }).plans())),
      ).toEqual(["emerge/blocked"]);
    }
  });

  it("a bottle behind a bottle behind a door: the bottle is what is said", () => {
    const { plan } = stage(
      { template: "cooler_single", rows: 1, cols: 1, cellCapacity: 2 },
      "full",
      [bottle(1, 1, 1), bottle(1, 1, 2)],
    );
    expect(plan("b-1:1:2").reason).toBe("behind_bottle");
    expect(plan("b-1:1:1").reason).toBe("behind_door");
  });
});

describe("a pile", () => {
  it("no bottle of a bin is given a path, whichever index it has and wherever it is drawn", () => {
    for (const id of ["cube_modular", "diamond_bins", "crate_storage"] as const)
      for (const plan of stage({ template: id }, "partial").plans()) {
        expect(plan).toMatchObject({ mode: "lift", reason: "pile", path: [] });
      }
  });

  it("the plan is about the bottle, not about its index: the same bottle with another index gets the same plan from the same place in the pile", () => {
    const bin = { template: "diamond_bins", rows: 1, cols: 1, cellCapacity: 8 } as const;
    // two bottles, stored with indexes 3 and 7, and the same two stored with 1 and 2: the same pile of two
    const a = stage(bin, "full", [
      { ...bottle(1, 1, 3), id: "x" },
      { ...bottle(1, 1, 7), id: "y" },
    ]);
    const b = stage(bin, "full", [
      { ...bottle(1, 1, 1), id: "x" },
      { ...bottle(1, 1, 2), id: "y" },
    ]);
    for (const id of ["x", "y"]) expect(a.plan(id).origin).toEqual(b.plan(id).origin);
    // and the address is each one's own, as stored
    expect(a.plan("y").address.index).toBe(7);
    expect(b.plan("y").address.index).toBe(2);
  });

  it("looking at a bottle is not taking it out of the place: the pile it returns to is the pile it left", () => {
    const { model, placed, plan } = stage({ template: "crate_storage" }, "partial");
    const looked = placed[3]!;
    plan(looked.id);
    const after = placeBottles(model, placed).placed;
    expect(after.map((b) => [b.id, b.pose.position])).toEqual(
      placed.map((b) => [b.id, b.pose.position]),
    );
    expect(after.find((b) => b.id === looked.id)!.address).toEqual(looked.address);
  });
});

describe("a place whose arrangement is not known", () => {
  const UNSURE = [
    {
      kind: "rack",
      rows: 3,
      cols: 4,
      template: "hex_rack_2031",
      cellCapacity: 4,
      semantics: "depth",
    },
    {
      kind: "wall",
      rows: 3,
      cols: 4,
      template: "rack_double_depth",
      cellCapacity: 2,
      semantics: "depth",
    },
    { kind: "wall", rows: 3, cols: 4, template: "wall_pegs", cellCapacity: 3, semantics: "single" },
    {
      kind: "rack",
      rows: 2,
      cols: 3,
      template: "diamond_bins",
      cellCapacity: 8,
      semantics: "depth",
    },
  ] as const;

  it("no extraction from furniture is ever planned: the bottle is shown from its counter", () => {
    for (const stored of UNSURE) {
      const model = buildModel(resolveStorage(stored));
      const { placed } = placeBottles(model, fixtureBottles(model.resolved.layout, "partial"));
      expect(placed.length).toBeGreaterThan(0);
      for (const b of placed) {
        const plan = planExtraction(model, b, placed);
        expect(plan).toMatchObject({ mode: "emerge", reason: "unknown_arrangement", path: [] });
        // it starts at the counter, the size of a counter, and its address is what was stored: nothing is made up
        expect(plan.origin).toBe(b.pose);
        expect(plan.origin.lie).toBe("token");
        expect(plan.originScale).toBeLessThan(0.25);
        expect(plan.address).toBe(b.address);
      }
    }
  });
});

describe("the checks themselves", () => {
  it("a path is sampled closely enough that nothing as thin as a pane slips between two samples", () => {
    const points = samplePath([
      [0, 0, 0],
      [0, 0, 5],
      [0, 2, 5],
    ]);
    expect(points[0]).toEqual([0, 0, 0]);
    expect(points.at(-1)).toEqual([0, 2, 5]);
    for (let i = 1; i < points.length; i++) {
      const [a, b] = [points[i - 1]!, points[i]!];
      expect(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])).toBeLessThanOrEqual(0.0801);
    }
  });

  it("sees a bottle, a door and a board apart", () => {
    const path: Array<[number, number, number]> = [
      [0, 0, 0],
      [0, 0, 6],
    ];
    const free = obstaclesOn(path, "z", [], []);
    expect(free).toEqual({ bottle: false, door: false, furniture: false });
    expect(obstaclesOn(path, "z", [], [{ position: [0, 0, 4], lie: "z" }]).bottle).toBe(true);
    const pane = box("glass", [4, 4, 0.04], [0, 0, 5], { soft: true });
    expect(obstaclesOn(path, "z", [pane], [])).toEqual({
      bottle: false,
      door: true,
      furniture: false,
    });
    const board = box("frame", [4, 4, 0.1], [0, 0, 5]);
    expect(obstaclesOn(path, "z", [board], [])).toEqual({
      bottle: false,
      door: false,
      furniture: true,
    });
    // a light and the wall behind are never in the way
    const light = box("glow", [4, 4, 0.04], [0, 0, 5], { soft: true });
    expect(obstaclesOn(path, "z", [light], [])).toEqual(free);
  });
});
