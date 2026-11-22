/**
 * SYSTEM ARCHITECTURE (System Intelligence epic, ADR-001). The contracts of the architecture register shown in the
 * admin's Architecture Control Center, and the pure graph functions over it: validation against a repository
 * inventory, tracing dependencies and dependents, shortest paths, impact and search. No I/O and no data: the
 * register itself is server-only (apps/web/src/server/system/registry.ts) and the inventory is generated from the
 * repository. The register describes structure only; live health is a separate overlay keyed by component id.
 */

/** Columns of the map, left to right. */
export const SYSTEM_LAYERS = [
  "client",
  "edge",
  "service",
  "core",
  "data",
  "platform",
  "planned",
] as const;
export type SystemLayer = (typeof SYSTEM_LAYERS)[number];

export const SYSTEM_LAYER_LABEL: Readonly<Record<SystemLayer, string>> = {
  client: "Clients",
  edge: "Edge & API",
  service: "Domain services",
  core: "Shared core",
  data: "Data",
  platform: "Platform",
  planned: "Planned",
};

/**
 * What an edge means. `from → to` always reads "from uses to": it calls, reads, writes, guards or schedules it.
 * `feedback` is data that comes back and changes later behaviour; `verifies` is CI or a rehearsal exercising it
 * outside production (never a runtime dependency); `planned` is a proposed relation, not code.
 */
export const EDGE_KINDS = [
  "request",
  "data-read",
  "data-write",
  "external-call",
  "feedback",
  "control",
  "ops",
  "verifies",
  "planned",
] as const;
export type EdgeKind = (typeof EDGE_KINDS)[number];

export const EDGE_KIND_LABEL: Readonly<Record<EdgeKind, string>> = {
  request: "Request / invoke",
  "data-read": "Data read",
  "data-write": "Data write",
  "external-call": "External API call",
  feedback: "Feedback",
  control: "Auth / guard / gate",
  ops: "Operations",
  verifies: "Test / rehearsal",
  planned: "Planned",
};

/**
 * What the repository can prove about a component. `gated`: the code is there behind a server switch whose value
 * in a deployment cannot be known from the repository. `unverified`: it lives outside the repository (hosting,
 * backups, accounts). Nothing here means "operational": that is measured, not declared.
 */
export const COMPONENT_STATUSES = ["implemented", "gated", "unverified", "planned"] as const;
export type ComponentStatus = (typeof COMPONENT_STATUSES)[number];

export const COMPONENT_STATUS_LABEL: Readonly<Record<ComponentStatus, string>> = {
  implemented: "Implemented",
  gated: "Behind a switch",
  unverified: "Outside the repository",
  planned: "Planned",
};

export const RISK_SEVERITIES = ["high", "medium", "low"] as const;
export type RiskSeverity = (typeof RISK_SEVERITIES)[number];

/** A file in the repository that contains a given text: the proof an edge is real. */
export interface Evidence {
  readonly path: string;
  readonly contains: string;
}

export interface ComponentRisk {
  readonly id: string;
  readonly severity: RiskSeverity;
  readonly title: string;
  readonly detail: string;
}

/** A server switch the component depends on. `feature`: a name in CELLR_FEATURES; `env`: another setting. */
export interface ComponentGate {
  readonly name: string;
  readonly kind: "feature" | "env";
  readonly note: string;
}

export interface SystemComponent {
  readonly id: string;
  readonly name: string;
  readonly layer: SystemLayer;
  readonly status: ComponentStatus;
  /** One line, shown on the map. */
  readonly summary: string;
  /** What it is responsible for, and what it is not. */
  readonly responsibility: string;
  readonly inputs: readonly string[];
  readonly outputs: readonly string[];
  /** Repository-relative files or directories (a directory ends in "/"). */
  readonly sources: readonly string[];
  readonly tables?: readonly string[];
  readonly buckets?: readonly string[];
  readonly cronJobs?: readonly string[];
  /** Route handlers it owns, as in the inventory (e.g. "/api/v1/scans"). */
  readonly routes?: readonly string[];
  readonly gates?: readonly ComponentGate[];
  /** Environment variables it reads that are not gates (configuration, keys), by name only. */
  readonly env?: readonly string[];
  /** External hosts its code names (https:// literals), as in the inventory. */
  readonly hosts?: readonly string[];
  /** Runtime npm dependencies it is the reason for, as in the inventory. */
  readonly packages?: readonly string[];
  /**
   * Shared plumbing every part may import (database clients, configuration): imports INTO it need no edge. Use it
   * sparingly; anything with behaviour of its own is not foundation.
   */
  readonly foundation?: boolean;
  readonly risks?: readonly ComponentRisk[];
}

export interface SystemEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: EdgeKind;
  readonly label: string;
  /** Required for every kind but `planned`; checked against the repository in CI. */
  readonly evidence: readonly Evidence[];
}

export const FLOW_STATUSES = ["proven", "partial", "planned"] as const;
export type FlowStatus = (typeof FLOW_STATUSES)[number];

/** A named path through the map, e.g. a feedback loop. Steps are edge ids, in order. */
export interface SystemFlow {
  readonly id: string;
  readonly name: string;
  readonly status: FlowStatus;
  readonly summary: string;
  readonly steps: readonly string[];
  /** What is missing for the loop to close (shown for partial and planned flows). */
  readonly gap?: string;
}

export interface ArchitectureRegistry {
  /** Semantic version of the register's content. */
  readonly version: string;
  /** ISO date the register was last reviewed against the code. */
  readonly reviewedOn: string;
  readonly repository: string;
  readonly components: readonly SystemComponent[];
  readonly edges: readonly SystemEdge[];
  readonly flows: readonly SystemFlow[];
}

/** Facts read from the repository by `pnpm architecture:inventory`; never edited by hand. */
export interface RepositoryInventory {
  readonly tables: ReadonlyArray<{ readonly name: string; readonly references: readonly string[] }>;
  readonly functions: readonly string[];
  readonly migrations: { readonly count: number; readonly latest: string };
  readonly buckets: readonly string[];
  readonly cronJobs: ReadonlyArray<{ readonly name: string; readonly schedule: string }>;
  readonly vercelCrons: ReadonlyArray<{ readonly path: string; readonly schedule: string }>;
  readonly apiRoutes: ReadonlyArray<{ readonly path: string; readonly methods: readonly string[] }>;
  readonly serverModules: readonly string[];
  readonly ciJobs: readonly string[];
  readonly features: readonly string[];
  /** GitHub Actions workflows and their job ids. */
  readonly workflows: ReadonlyArray<{ readonly file: string; readonly jobs: readonly string[] }>;
  /** Environment variable names the app reads. */
  readonly envVars: readonly string[];
  /** External hosts named in the app's code. */
  readonly externalHosts: readonly string[];
  /** Runtime npm dependencies of what is deployed. */
  readonly dependencies: readonly string[];
  /** Which code area reads or writes which table (`.from("table")`). */
  readonly dataAccess: ReadonlyArray<{ readonly area: string; readonly table: string }>;
  /** Which code area uses which other area at run time (type-only imports excluded). */
  readonly imports: ReadonlyArray<{ readonly from: string; readonly to: string }>;
}

export const edgeId = (e: Pick<SystemEdge, "from" | "to" | "kind">) =>
  `${e.from}->${e.to}:${e.kind}`;

// ---- Validation --------------------------------------------------------------------------------------------------

export type RegistryIssueLevel = "error" | "warning";
export interface RegistryIssue {
  readonly level: RegistryIssueLevel;
  readonly code: string;
  readonly message: string;
  /** The component, edge or flow id the issue is about. */
  readonly ref: string;
}

const SEMVER = /^\d+\.\d+\.\d+$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Everything that can be checked without the file system: ids, endpoints, evidence presence, statuses, flows, and
 * ownership of every table, bucket, cron job and route in the inventory. The repository test adds the file checks
 * (paths exist, evidence texts are found). An empty list of errors is the bar for CI.
 */
export function validateRegistry(
  reg: ArchitectureRegistry,
  inv: RepositoryInventory,
): RegistryIssue[] {
  const issues: RegistryIssue[] = [];
  const err = (code: string, ref: string, message: string) =>
    issues.push({ level: "error", code, ref, message });
  const warn = (code: string, ref: string, message: string) =>
    issues.push({ level: "warning", code, ref, message });

  if (!SEMVER.test(reg.version))
    err("version", "registry", `version "${reg.version}" is not x.y.z`);
  if (!ISO_DATE.test(reg.reviewedOn))
    err("reviewed-on", "registry", `reviewedOn "${reg.reviewedOn}" is not an ISO date`);

  const byId = new Map<string, SystemComponent>();
  const riskIds = new Set<string>();
  for (const c of reg.components) {
    if (byId.has(c.id)) err("duplicate-component", c.id, `component id "${c.id}" is used twice`);
    byId.set(c.id, c);
    if (c.status === "planned" ? c.layer !== "planned" : c.layer === "planned")
      err("planned-layer", c.id, "planned components, and only they, sit in the planned layer");
    if (c.status !== "planned" && c.sources.length === 0)
      err("no-sources", c.id, "a component that exists names at least one source");
    if (c.status === "gated" && !(c.gates && c.gates.length))
      err("gate-missing", c.id, "a gated component names its switch");
    for (const g of c.gates ?? [])
      if (g.kind === "feature" && !inv.features.includes(g.name))
        err("unknown-feature", c.id, `feature "${g.name}" is not a CELLR_FEATURES switch`);
    for (const r of c.risks ?? []) {
      if (riskIds.has(r.id)) err("duplicate-risk", c.id, `risk id "${r.id}" is used twice`);
      riskIds.add(r.id);
    }
  }

  const edgeIds = new Set<string>();
  const linked = new Set<string>();
  for (const e of reg.edges) {
    const id = edgeId(e);
    if (edgeIds.has(id)) err("duplicate-edge", id, "the same edge is listed twice");
    edgeIds.add(id);
    const from = byId.get(e.from);
    const to = byId.get(e.to);
    if (!from) err("unknown-endpoint", id, `edge starts at unknown component "${e.from}"`);
    if (!to) err("unknown-endpoint", id, `edge ends at unknown component "${e.to}"`);
    if (e.from === e.to) err("self-edge", id, "an edge points at its own component");
    if (e.kind === "planned") {
      if (e.evidence.length) warn("planned-evidence", id, "a planned edge needs no evidence");
    } else {
      if (e.evidence.length === 0) err("no-evidence", id, "a confirmed edge carries evidence");
      if (from?.status === "planned" || to?.status === "planned")
        err("planned-confirmed", id, "an edge to a planned component can only be planned");
    }
    for (const ev of e.evidence)
      if (!ev.path || !ev.contains.trim())
        err("empty-evidence", id, "evidence names a file and a text");
    linked.add(e.from);
    linked.add(e.to);
  }
  for (const c of reg.components)
    if (!linked.has(c.id)) warn("orphan", c.id, "component has no edges");

  const flowIds = new Set<string>();
  const edgeKind = new Map(reg.edges.map((e) => [edgeId(e), e.kind]));
  for (const f of reg.flows) {
    if (flowIds.has(f.id)) err("duplicate-flow", f.id, `flow id "${f.id}" is used twice`);
    flowIds.add(f.id);
    if (f.steps.length === 0) err("empty-flow", f.id, "a flow has at least one step");
    for (const s of f.steps) {
      const kind = edgeKind.get(s);
      if (!kind) err("unknown-step", f.id, `step "${s}" is not an edge`);
      else if (kind === "planned" && f.status === "proven")
        err("proven-planned", f.id, `a proven flow cannot rest on the planned edge "${s}"`);
    }
    if (f.status !== "proven" && !f.gap)
      err("flow-gap", f.id, "a flow that is not proven says what is missing");
  }

  ownership(
    issues,
    "table",
    inv.tables.map((t) => t.name),
    reg.components.flatMap((c) => (c.tables ?? []).map((t) => [c.id, t] as const)),
  );
  ownership(
    issues,
    "bucket",
    inv.buckets,
    reg.components.flatMap((c) => (c.buckets ?? []).map((b) => [c.id, b] as const)),
  );
  ownership(
    issues,
    "cron job",
    inv.cronJobs.map((j) => j.name),
    reg.components.flatMap((c) => (c.cronJobs ?? []).map((j) => [c.id, j] as const)),
  );
  ownership(
    issues,
    "route",
    inv.apiRoutes.map((r) => r.path),
    reg.components.flatMap((c) => (c.routes ?? []).map((r) => [c.id, r] as const)),
  );
  ownership(
    issues,
    "env var",
    inv.envVars,
    reg.components.flatMap((c) => [
      ...(c.env ?? []).map((v) => [c.id, v] as const),
      ...(c.gates ?? []).filter((g) => g.kind === "env").map((g) => [c.id, g.name] as const),
    ]),
  );
  ownership(
    issues,
    "host",
    inv.externalHosts,
    reg.components.flatMap((c) => (c.hosts ?? []).map((h) => [c.id, h] as const)),
  );
  ownership(
    issues,
    "dependency",
    inv.dependencies,
    reg.components.flatMap((c) => (c.packages ?? []).map((p) => [c.id, p] as const)),
  );
  return issues;
}

/** Every inventory item has exactly one owner, and every claimed item exists. */
function ownership(
  issues: RegistryIssue[],
  what: string,
  known: readonly string[],
  claims: ReadonlyArray<readonly [string, string]>,
) {
  const owners = new Map<string, string[]>();
  for (const [component, item] of claims)
    owners.set(item, [...(owners.get(item) ?? []), component]);
  const knownSet = new Set(known);
  const code = what.replace(" ", "-");
  for (const [item, by] of owners) {
    if (!knownSet.has(item))
      issues.push({
        level: "error",
        code: `unknown-${code}`,
        ref: by[0]!,
        message: `${what} "${item}" is not in the repository`,
      });
    if (by.length > 1)
      issues.push({
        level: "error",
        code: `shared-${code}`,
        ref: by[0]!,
        message: `${what} "${item}" is owned by ${by.join(", ")}`,
      });
  }
  for (const item of known)
    if (!owners.has(item))
      issues.push({
        level: "error",
        code: `unowned-${code}`,
        ref: item,
        message: `${what} "${item}" belongs to no component`,
      });
}

// ---- Graph ---------------------------------------------------------------------------------------------------------

export interface GraphIndex {
  readonly out: ReadonlyMap<string, readonly SystemEdge[]>;
  readonly in: ReadonlyMap<string, readonly SystemEdge[]>;
}

export function indexGraph(edges: readonly SystemEdge[]): GraphIndex {
  const out = new Map<string, SystemEdge[]>();
  const inn = new Map<string, SystemEdge[]>();
  for (const e of edges) {
    out.set(e.from, [...(out.get(e.from) ?? []), e]);
    inn.set(e.to, [...(inn.get(e.to) ?? []), e]);
  }
  return { out, in: inn };
}

/** "dependencies": what it uses (outgoing). "dependents": what uses it (incoming). */
export type TraceDirection = "dependencies" | "dependents" | "both";

export interface TraceOptions {
  readonly direction: TraceDirection;
  /** 1 = direct neighbours only. Infinity = the whole reachable graph. */
  readonly depth: number;
  /** Only follow edges of these kinds; all kinds when absent. */
  readonly kinds?: ReadonlySet<EdgeKind>;
}

export interface TraceResult {
  /** Every reached component with its distance (the start has 0). */
  readonly nodes: ReadonlyMap<string, number>;
  readonly edges: ReadonlySet<string>;
}

/** Breadth-first: each component is reached at its shortest distance; cycles are safe. */
export function traceComponent(index: GraphIndex, start: string, opts: TraceOptions): TraceResult {
  const nodes = new Map<string, number>([[start, 0]]);
  const edges = new Set<string>();
  const follow = (e: SystemEdge) => !opts.kinds || opts.kinds.has(e.kind);
  const walk = (dir: "out" | "in") => {
    let frontier = [start];
    const seen = new Set([start]);
    for (let d = 1; d <= opts.depth && frontier.length; d++) {
      const next: string[] = [];
      for (const id of frontier)
        for (const e of index[dir].get(id) ?? []) {
          if (!follow(e)) continue;
          edges.add(edgeId(e));
          const other = dir === "out" ? e.to : e.from;
          if (seen.has(other)) continue;
          seen.add(other);
          next.push(other);
          nodes.set(other, Math.min(nodes.get(other) ?? Infinity, d));
        }
      frontier = next;
    }
  };
  if (opts.direction !== "dependents") walk("out");
  if (opts.direction !== "dependencies") walk("in");
  return { nodes, edges };
}

/**
 * What stops working, directly or further up, when this component fails: its dependents, transitively, over the
 * edges that carry a runtime dependency (not feedback, which only improves later answers, not CI or rehearsals
 * that only verify it, and not planned ones).
 * Sorted by distance, then id.
 */
export function impactOf(
  index: GraphIndex,
  failed: string,
): Array<{ readonly id: string; readonly distance: number }> {
  const runtime = new Set<EdgeKind>(
    EDGE_KINDS.filter((k) => k !== "feedback" && k !== "planned" && k !== "verifies"),
  );
  const { nodes } = traceComponent(index, failed, {
    direction: "dependents",
    depth: Infinity,
    kinds: runtime,
  });
  return [...nodes]
    .filter(([id]) => id !== failed)
    .map(([id, distance]) => ({ id, distance }))
    .sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id));
}

/** What a path follows by default: real "uses" relations, not feedback, CI checks or proposals. */
export const PATH_KINDS: ReadonlySet<EdgeKind> = new Set(
  EDGE_KINDS.filter((k) => k !== "planned" && k !== "feedback" && k !== "verifies"),
);

/** The shortest directed path from → to over edges of the given kinds, as edge ids; null when there is none. */
export function shortestPath(
  index: GraphIndex,
  from: string,
  to: string,
  kinds: ReadonlySet<EdgeKind> = PATH_KINDS,
): string[] | null {
  if (from === to) return [];
  const via = new Map<string, SystemEdge>();
  const seen = new Set([from]);
  let frontier = [from];
  while (frontier.length) {
    const next: string[] = [];
    for (const id of frontier)
      for (const e of index.out.get(id) ?? []) {
        if (!kinds.has(e.kind) || e.kind === "planned" || seen.has(e.to)) continue;
        seen.add(e.to);
        via.set(e.to, e);
        if (e.to === to) {
          const path: string[] = [];
          for (let at = to; at !== from;) {
            const step = via.get(at)!;
            path.unshift(edgeId(step));
            at = step.from;
          }
          return path;
        }
        next.push(e.to);
      }
    frontier = next;
  }
  return null;
}

// ---- Search --------------------------------------------------------------------------------------------------------

const fold = (s: string) => s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();

/** The text a component is found by: names, summary, tables, routes, buckets, sources, gates and risks. */
export function componentSearchText(c: SystemComponent): string {
  return fold(
    [
      c.id,
      c.name,
      c.summary,
      c.responsibility,
      ...(c.tables ?? []),
      ...(c.routes ?? []),
      ...(c.buckets ?? []),
      ...(c.cronJobs ?? []),
      ...c.sources,
      ...(c.gates ?? []).map((g) => g.name),
      ...(c.risks ?? []).map((r) => r.title),
    ].join(" "),
  );
}

/** Ids of the components that contain every word of the query (case and accents ignored); null for no query. */
export function searchComponents(
  components: readonly SystemComponent[],
  query: string,
): Set<string> | null {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  return new Set(
    components
      .filter((c) => {
        const text = componentSearchText(c);
        return words.every((w) => text.includes(w));
      })
      .map((c) => c.id),
  );
}

/** What the admin page receives: the register, the repository facts and the validation result. */
export interface ArchitectureView {
  readonly registry: ArchitectureRegistry;
  readonly inventory: RepositoryInventory;
  readonly issues: readonly RegistryIssue[];
}
