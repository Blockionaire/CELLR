import { describe, expect, it } from "vitest";
import {
  edgeId,
  impactOf,
  indexGraph,
  searchComponents,
  shortestPath,
  traceComponent,
  validateRegistry,
  type ArchitectureRegistry,
  type RepositoryInventory,
  type SystemComponent,
  type SystemEdge,
} from "./system-architecture";

const comp = (id: string, extra: Partial<SystemComponent> = {}): SystemComponent => ({
  id,
  name: id.toUpperCase(),
  layer: "service",
  status: "implemented",
  summary: `${id} summary`,
  responsibility: "",
  inputs: [],
  outputs: [],
  sources: [`src/${id}.ts`],
  ...extra,
});
const ev = [{ path: "src/x.ts", contains: "x" }];
const edge = (from: string, to: string, kind: SystemEdge["kind"] = "request"): SystemEdge => ({
  from,
  to,
  kind,
  label: "",
  evidence: kind === "planned" ? [] : ev,
});

const inventory: RepositoryInventory = {
  tables: [{ name: "bottles", references: [] }],
  functions: [],
  migrations: { count: 1, latest: "x.sql" },
  buckets: ["bottle-images"],
  cronJobs: [{ name: "purge", schedule: "* * * * *" }],
  vercelCrons: [],
  apiRoutes: [{ path: "/api/v1/bottles", methods: ["GET"] }],
  serverModules: [],
  ciJobs: [],
  features: ["scan_resolver"],
};

// api → svc → db, svc → ai; ui → api; db ⇢ svc (feedback); future ⇢ svc (planned)
const registry: ArchitectureRegistry = {
  version: "1.0.0",
  reviewedOn: "2026-11-19",
  repository: "o/r",
  components: [
    comp("ui", { layer: "client" }),
    comp("api", { layer: "edge", routes: ["/api/v1/bottles"] }),
    comp("svc", {
      status: "gated",
      gates: [{ name: "scan_resolver", kind: "feature", note: "" }],
      buckets: ["bottle-images"],
    }),
    comp("db", { layer: "data", tables: ["bottles"], cronJobs: ["purge"] }),
    comp("ai", { layer: "platform" }),
    comp("future", { layer: "planned", status: "planned", sources: [] }),
    comp("ci", { layer: "platform" }),
  ],
  edges: [
    edge("ui", "api"),
    edge("api", "svc"),
    edge("svc", "db", "data-write"),
    edge("svc", "ai", "external-call"),
    edge("db", "svc", "feedback"),
    edge("future", "svc", "planned"),
    edge("ci", "db", "verifies"),
  ],
  flows: [
    {
      id: "loop",
      name: "Loop",
      status: "proven",
      summary: "",
      steps: ["svc->db:data-write", "db->svc:feedback"],
    },
  ],
};

const errors = (r: ArchitectureRegistry, i = inventory) =>
  validateRegistry(r, i)
    .filter((x) => x.level === "error")
    .map((x) => x.code);

describe("validating the architecture register", () => {
  it("a consistent register has no errors and no warnings", () => {
    expect(validateRegistry(registry, inventory)).toEqual([]);
  });

  it("catches unknown endpoints, duplicates, self edges and missing evidence", () => {
    const bad: ArchitectureRegistry = {
      ...registry,
      components: [...registry.components, comp("ui", { layer: "client" })],
      edges: [
        ...registry.edges,
        edge("ui", "api"),
        edge("api", "ghost"),
        edge("svc", "svc"),
        { ...edge("api", "db", "data-read"), evidence: [] },
      ],
    };
    expect(errors(bad)).toEqual(
      expect.arrayContaining([
        "duplicate-component",
        "duplicate-edge",
        "unknown-endpoint",
        "self-edge",
        "no-evidence",
      ]),
    );
  });

  it("a planned component sits in the planned layer and has only planned edges", () => {
    const bad: ArchitectureRegistry = {
      ...registry,
      components: [...registry.components, comp("later", { status: "planned", sources: [] })],
      edges: [...registry.edges, edge("later", "svc", "request")],
    };
    expect(errors(bad)).toEqual(expect.arrayContaining(["planned-layer", "planned-confirmed"]));
  });

  it("a gated component names a real switch", () => {
    const noGate = {
      ...registry,
      components: registry.components.map((c) => (c.id === "svc" ? { ...c, gates: [] } : c)),
    };
    expect(errors(noGate)).toContain("gate-missing");
    const unknown = {
      ...registry,
      components: registry.components.map((c) =>
        c.id === "svc"
          ? { ...c, gates: [{ name: "nope", kind: "feature" as const, note: "" }] }
          : c,
      ),
    };
    expect(errors(unknown)).toContain("unknown-feature");
  });

  it("every table, bucket, cron job and route has exactly one owner that exists", () => {
    const inv: RepositoryInventory = {
      ...inventory,
      tables: [...inventory.tables, { name: "wines", references: ["bottles"] }],
      apiRoutes: [...inventory.apiRoutes, { path: "/api/v1/new", methods: ["POST"] }],
    };
    expect(errors(registry, inv)).toEqual(
      expect.arrayContaining(["unowned-table", "unowned-route"]),
    );
    const shared = {
      ...registry,
      components: registry.components.map((c) =>
        c.id === "api" ? { ...c, tables: ["bottles", "ghost_table"] } : c,
      ),
    };
    expect(errors(shared)).toEqual(expect.arrayContaining(["shared-table", "unknown-table"]));
  });

  it("a flow's steps are edges, a proven flow rests on no planned edge, and an open one names its gap", () => {
    const bad: ArchitectureRegistry = {
      ...registry,
      flows: [
        { id: "a", name: "", status: "proven", summary: "", steps: ["future->svc:planned"] },
        { id: "b", name: "", status: "partial", summary: "", steps: ["nope"] },
      ],
    };
    expect(errors(bad)).toEqual(
      expect.arrayContaining(["proven-planned", "unknown-step", "flow-gap"]),
    );
  });

  it("warns, without failing, about components with no edges", () => {
    const lonely = { ...registry, components: [...registry.components, comp("alone")] };
    expect(errors(lonely)).toEqual([]);
    expect(validateRegistry(lonely, inventory)).toContainEqual(
      expect.objectContaining({ level: "warning", code: "orphan", ref: "alone" }),
    );
  });

  it("checks the version and review date formats", () => {
    expect(errors({ ...registry, version: "v1", reviewedOn: "19-11-2026" })).toEqual(
      expect.arrayContaining(["version", "reviewed-on"]),
    );
  });
});

describe("tracing the graph", () => {
  const index = indexGraph(registry.edges);

  it("direct dependencies and dependents", () => {
    const deps = traceComponent(index, "svc", { direction: "dependencies", depth: 1 });
    expect([...deps.nodes.keys()].sort()).toEqual(["ai", "db", "svc"]);
    const users = traceComponent(index, "svc", { direction: "dependents", depth: 1 });
    expect([...users.nodes.keys()].sort()).toEqual(["api", "db", "future", "svc"]);
  });

  it("transitive with distances, safe on cycles, filtered by kind", () => {
    const all = traceComponent(index, "ui", { direction: "dependencies", depth: Infinity });
    expect(Object.fromEntries(all.nodes)).toEqual({ ui: 0, api: 1, svc: 2, db: 3, ai: 3 });
    expect(all.edges.has("db->svc:feedback")).toBe(true);
    const noData = traceComponent(index, "ui", {
      direction: "dependencies",
      depth: Infinity,
      kinds: new Set(["request", "external-call"]),
    });
    expect([...noData.nodes.keys()].sort()).toEqual(["ai", "api", "svc", "ui"]);
  });

  it("both directions at a depth", () => {
    const t = traceComponent(index, "api", { direction: "both", depth: 1 });
    expect([...t.nodes.keys()].sort()).toEqual(["api", "svc", "ui"]);
    expect([...t.edges].sort()).toEqual(["api->svc:request", "ui->api:request"]);
  });

  it("impact: who stops working when a component fails, ignoring feedback, CI and planned edges", () => {
    expect(impactOf(index, "db")).toEqual([
      { id: "svc", distance: 1 },
      { id: "api", distance: 2 },
      { id: "ui", distance: 3 },
    ]);
    expect(impactOf(index, "ui")).toEqual([]);
  });

  it("shortest directed path, never over a planned edge", () => {
    expect(shortestPath(index, "ui", "db")).toEqual([
      "ui->api:request",
      "api->svc:request",
      "svc->db:data-write",
    ]);
    expect(shortestPath(index, "db", "ui")).toBeNull();
    expect(shortestPath(index, "future", "svc")).toBeNull();
    expect(shortestPath(index, "svc", "svc")).toEqual([]);
    // feedback is not a "uses" relation: db → svc is not a path by default, but can be asked for
    expect(shortestPath(index, "db", "svc")).toBeNull();
    expect(shortestPath(index, "db", "svc", new Set(["feedback"]))).toEqual(["db->svc:feedback"]);
    expect(shortestPath(index, "ui", "db", new Set(["request"]))).toBeNull();
  });

  it("edge ids are stable", () => {
    expect(edgeId({ from: "a", to: "b", kind: "data-read" })).toBe("a->b:data-read");
  });
});

describe("searching components", () => {
  it("matches every word across names, tables, routes and buckets, ignoring case and accents", () => {
    expect(searchComponents(registry.components, "")).toBeNull();
    expect([...searchComponents(registry.components, "BOTTLES")!].sort()).toEqual(["api", "db"]);
    expect([...searchComponents(registry.components, "bottle-images")!]).toEqual(["svc"]);
    expect([...searchComponents(registry.components, "svc summary")!]).toEqual(["svc"]);
    expect(searchComponents(registry.components, "nothing here")!.size).toBe(0);
    expect([...searchComponents([comp("x", { name: "Proeverij é" })], "proeverij e")!]).toEqual([
      "x",
    ]);
  });
});
