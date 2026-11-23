import { describe, expect, it, vi } from "vitest";
import { edgeId, indexGraph, type ArchitectureRegistry } from "@cellr/domain";
import { boundsOf, fitTransform, layoutMap, NODE_H, NODE_W, wrapName } from "./layout";
import { ALL_FILTERS, emphasis, NO_FOCUS, readHash, sourceUrl, writeHash } from "./model";

vi.mock("server-only", () => ({}));
const { ARCHITECTURE_REGISTRY: REG } = await import("@/server/system/registry");

describe("the map layout", () => {
  const layout = layoutMap(REG.components, REG.edges);

  it("places every component exactly once, inside the drawing", () => {
    expect(layout.nodes.size).toBe(REG.components.length);
    for (const b of layout.nodes.values()) {
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w).toBeLessThanOrEqual(layout.width);
      expect(b.y + b.h).toBeLessThanOrEqual(layout.height);
    }
  });

  it("no two components overlap", () => {
    const boxes = [...layout.nodes.values()];
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
        expect(apart, `${a.id} / ${b.id}`).toBe(true);
      }
  });

  it("layers run left to right in their fixed order, a long layer wraps into columns", () => {
    const xs = layout.columns.map((c) => c.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(layout.columns.map((c) => c.layer)).toEqual([
      "client",
      "edge",
      "service",
      "core",
      "data",
      "platform",
      "planned",
    ]);
    const services = layout.columns.find((c) => c.layer === "service")!;
    expect(services.w).toBeGreaterThan(NODE_W); // 24 services: more than one column
    for (const n of layout.nodes.values()) {
      const col = layout.columns.find((c) => c.layer === n.layer)!;
      expect(n.x).toBeGreaterThanOrEqual(col.x);
      expect(n.x + NODE_W).toBeLessThanOrEqual(col.x + col.w);
    }
  });

  it("draws every edge between drawn components, with a valid path", () => {
    expect(layout.edges.length).toBe(REG.edges.length);
    for (const e of layout.edges) expect(e.d).toMatch(/^M-?[\d.]+ -?[\d.]+ C/);
  });

  it("is deterministic", () => {
    expect(layoutMap(REG.components, REG.edges)).toEqual(layout);
  });

  it("an edge into a hidden component is not drawn", () => {
    const some = REG.components.filter((c) => c.layer !== "planned");
    const l = layoutMap(some, REG.edges);
    expect(l.edges.every((e) => !e.id.includes("plan-"))).toBe(true);
  });

  it("bounds of a set of components, for fitting a flow", () => {
    const a = layout.nodes.get("app-pwa")!;
    const b = layout.nodes.get("openai")!;
    expect(boundsOf(layout, ["app-pwa", "openai", "nope"])).toEqual({
      x: a.x,
      y: Math.min(a.y, b.y),
      w: b.x + b.w - a.x,
      h: Math.max(a.y + a.h, b.y + b.h) - Math.min(a.y, b.y),
    });
    expect(boundsOf(layout, ["nope"])).toBeNull();
  });

  it("overview names: at most two lines, clipped", () => {
    expect(wrapName("Stats", 15)).toEqual(["Stats"]);
    expect(wrapName("Wine insights & valuation", 15)).toEqual(["Wine insights &", "valuation"]);
    expect(wrapName("Catalogue contribution setting", 15)).toEqual([
      "Catalogue",
      "contribution s…",
    ]);
    expect(wrapName("Supercalifragilisticexpialidocious", 15)).toEqual(["Supercalifragi…"]);
  });

  it("fit: the whole drawing in the viewport, never above 100%", () => {
    const t = fitTransform({ x: 0, y: 0, w: layout.width, h: layout.height }, { w: 1200, h: 700 });
    expect(t.k).toBeLessThan(1);
    expect(layout.width * t.k).toBeLessThanOrEqual(1200);
    expect(fitTransform({ x: 0, y: 0, w: NODE_W, h: NODE_H }, { w: 1200, h: 700 }).k).toBe(1);
  });
});

// a → b → c, d ⇢ b (feedback), x in another layer
const mini: ArchitectureRegistry = {
  version: "1.0.0",
  reviewedOn: "2026-11-19",
  repository: "o/r",
  components: (["a", "b", "c", "d", "x"] as const).map((id) => ({
    id,
    name: id === "c" ? "Catalogue store" : id.toUpperCase(),
    layer: id === "x" ? ("platform" as const) : ("service" as const),
    status: id === "d" ? ("gated" as const) : ("implemented" as const),
    summary: "",
    responsibility: "",
    inputs: [],
    outputs: [],
    sources: [],
    ...(id === "d" ? { gates: [{ name: "f", kind: "feature" as const, note: "" }] } : {}),
  })),
  edges: [
    { from: "a", to: "b", kind: "request", label: "", evidence: [] },
    { from: "b", to: "c", kind: "data-read", label: "", evidence: [] },
    { from: "d", to: "b", kind: "feedback", label: "", evidence: [] },
    { from: "c", to: "x", kind: "ops", label: "", evidence: [] },
  ],
  flows: [
    {
      id: "loop",
      name: "",
      status: "proven",
      summary: "",
      steps: ["d->b:feedback", "b->c:data-read"],
    },
  ],
};
const idx = indexGraph(mini.edges);

describe("what the map emphasises", () => {
  it("nothing focused: everything drawn at full strength", () => {
    const e = emphasis(mini, idx, ALL_FILTERS, NO_FOCUS);
    expect(e.nodes).toBeNull();
    expect(e.visible.size).toBe(5);
    expect(e.visibleEdges.size).toBe(4);
  });

  it("a selected component: its trace, at the chosen depth and direction", () => {
    const direct = emphasis(mini, idx, ALL_FILTERS, { ...NO_FOCUS, selected: "b" });
    expect([...direct.nodes!].sort()).toEqual(["a", "b", "c", "d"]);
    expect(direct.reason).toBe("trace");
    const deep = emphasis(mini, idx, ALL_FILTERS, {
      ...NO_FOCUS,
      selected: "a",
      direction: "dependencies",
      depth: Infinity,
    });
    expect([...deep.nodes!].sort()).toEqual(["a", "b", "c", "x"]);
    expect(deep.distance.get("x")).toBe(3);
  });

  it("hidden kinds are neither drawn nor followed; hidden layers and statuses hide components", () => {
    const filters = { ...ALL_FILTERS, kinds: new Set(["request", "data-read", "ops"] as const) };
    const e = emphasis(mini, idx, filters, { ...NO_FOCUS, selected: "b" });
    expect(e.visibleEdges.has("d->b:feedback")).toBe(false);
    expect(e.nodes!.has("d")).toBe(false);
    const noPlatform = emphasis(
      mini,
      idx,
      { ...ALL_FILTERS, layers: new Set(["service"] as const) },
      NO_FOCUS,
    );
    expect(noPlatform.visible.has("x")).toBe(false);
    expect(noPlatform.visibleEdges.has("c->x:ops")).toBe(false);
    const noGated = emphasis(
      mini,
      idx,
      { ...ALL_FILTERS, statuses: new Set(["implemented"] as const) },
      NO_FOCUS,
    );
    expect(noGated.visible.has("d")).toBe(false);
  });

  it("a path between two components wins over the trace; no path is an empty path", () => {
    const p = emphasis(mini, idx, ALL_FILTERS, { ...NO_FOCUS, selected: "a", pathTo: "x" });
    expect(p.reason).toBe("path");
    expect(p.path).toEqual(["a->b:request", "b->c:data-read", "c->x:ops"]);
    const none = emphasis(mini, idx, ALL_FILTERS, { ...NO_FOCUS, selected: "x", pathTo: "a" });
    expect(none.path).toEqual([]);
    expect([...none.nodes!].sort()).toEqual(["a", "x"]);
  });

  it("a flow emphasises its steps", () => {
    const f = emphasis(mini, idx, ALL_FILTERS, { ...NO_FOCUS, flow: "loop" });
    expect(f.reason).toBe("flow");
    expect([...f.edges!]).toEqual(["d->b:feedback", "b->c:data-read"]);
    expect([...f.nodes!].sort()).toEqual(["b", "c", "d"]);
  });

  it("search emphasises matches when nothing else is focused", () => {
    const s = emphasis(mini, idx, ALL_FILTERS, { ...NO_FOCUS, query: "catalogue" });
    expect(s.reason).toBe("search");
    expect([...s.nodes!]).toEqual(["c"]);
  });
});

describe("the URL hash", () => {
  const known = new Set(["svc-scans"]);
  const flows = new Set(["taste"]);
  it("round-trips the view", () => {
    const state = {
      tab: "flows",
      mode: "map",
      selected: "svc-scans",
      direction: "dependents",
      depth: Infinity,
      flow: "taste",
    } as const;
    expect(readHash(writeHash(state), known, flows)).toEqual(state);
    expect(writeHash({ tab: "map", selected: null, direction: "both", depth: 1, flow: null })).toBe(
      "",
    );
    // a phone opens the component list unless the link asks for the drawing
    expect(writeHash({ ...state, tab: "map", mode: "list" })).not.toContain("m=");
    expect(readHash("#c=svc-scans", known, flows).mode).toBe("list");
  });
  it("ignores anything it does not know", () => {
    expect(readHash("#v=evil&m=evil&c=<script>&d=up&n=99&f=nope", known, flows)).toEqual({
      tab: "map",
      mode: "list",
      selected: null,
      direction: "both",
      depth: 1,
      flow: null,
    });
  });
});

describe("source links", () => {
  it("files are blobs, folders are trees, on main", () => {
    expect(sourceUrl("Blockionaire/CELLR", "apps/web/src/app/(app)/")).toBe(
      "https://github.com/Blockionaire/CELLR/tree/main/apps/web/src/app/(app)",
    );
    expect(sourceUrl("Blockionaire/CELLR", "apps/web/src/server/services.ts")).toBe(
      "https://github.com/Blockionaire/CELLR/blob/main/apps/web/src/server/services.ts",
    );
  });
  it("edge ids in the real register are unique", () => {
    expect(new Set(REG.edges.map(edgeId)).size).toBe(REG.edges.length);
  });
});
