import {
  COMPONENT_STATUSES,
  EDGE_KINDS,
  SYSTEM_LAYERS,
  PATH_KINDS,
  edgeId,
  searchComponents,
  shortestPath,
  traceComponent,
  type ArchitectureRegistry,
  type ComponentStatus,
  type EdgeKind,
  type GraphIndex,
  type SystemLayer,
  type TraceDirection,
} from "@cellr/domain";

/**
 * What the map shows and emphasises, from the viewer's choices. Pure, so the rules are tested without a browser:
 *   - filters decide what is drawn (a hidden layer or status hides its components and their edges; a hidden kind
 *     hides those edges);
 *   - one focus decides what is emphasised, in this order: a path between two components, a flow, the selected
 *     component's trace, the search. Everything drawn outside the focus is dimmed, never removed.
 */
export interface MapFilters {
  readonly kinds: ReadonlySet<EdgeKind>;
  readonly layers: ReadonlySet<SystemLayer>;
  readonly statuses: ReadonlySet<ComponentStatus>;
}
export const ALL_FILTERS: MapFilters = {
  kinds: new Set(EDGE_KINDS),
  layers: new Set(SYSTEM_LAYERS),
  statuses: new Set(COMPONENT_STATUSES),
};

export interface MapFocus {
  readonly selected: string | null;
  readonly direction: TraceDirection;
  /** 1, 2, 3 or Infinity */
  readonly depth: number;
  readonly flow: string | null;
  readonly pathTo: string | null;
  readonly query: string;
}
export const NO_FOCUS: MapFocus = {
  selected: null,
  direction: "both",
  depth: 1,
  flow: null,
  pathTo: null,
  query: "",
};

export interface MapEmphasis {
  /** Components that are drawn. */
  readonly visible: ReadonlySet<string>;
  /** Edges that are drawn. */
  readonly visibleEdges: ReadonlySet<string>;
  /** null: nothing is focused, everything drawn is at full strength. */
  readonly nodes: ReadonlySet<string> | null;
  readonly edges: ReadonlySet<string> | null;
  /** Distance from the selected component, for the trace. */
  readonly distance: ReadonlyMap<string, number>;
  /** The path's steps when a path was asked for; [] when there is none; null when none was asked. */
  readonly path: readonly string[] | null;
  readonly matches: ReadonlySet<string> | null;
  readonly reason: "path" | "flow" | "trace" | "search" | null;
}

export function emphasis(
  reg: ArchitectureRegistry,
  index: GraphIndex,
  filters: MapFilters,
  focus: MapFocus,
): MapEmphasis {
  const visible = new Set(
    reg.components
      .filter((c) => filters.layers.has(c.layer) && filters.statuses.has(c.status))
      .map((c) => c.id),
  );
  const visibleEdges = new Set(
    reg.edges
      .filter((e) => filters.kinds.has(e.kind) && visible.has(e.from) && visible.has(e.to))
      .map(edgeId),
  );
  const matches = searchComponents(
    reg.components.filter((c) => visible.has(c.id)),
    focus.query,
  );
  const base = { visible, visibleEdges, matches, distance: new Map<string, number>() };

  if (focus.selected && focus.pathTo && focus.selected !== focus.pathTo) {
    const kinds = new Set([...PATH_KINDS].filter((k) => filters.kinds.has(k)));
    const path = shortestPath(index, focus.selected, focus.pathTo, kinds) ?? [];
    const ends = new Set([focus.selected, focus.pathTo]);
    for (const s of path) {
      const e = reg.edges.find((x) => edgeId(x) === s);
      if (e) ends.add(e.from).add(e.to);
    }
    return { ...base, nodes: ends, edges: new Set(path), path, reason: "path" };
  }

  const flow = focus.flow ? reg.flows.find((f) => f.id === focus.flow) : undefined;
  if (flow) {
    const nodes = new Set<string>();
    for (const s of flow.steps) {
      const e = reg.edges.find((x) => edgeId(x) === s);
      if (e) nodes.add(e.from).add(e.to);
    }
    return { ...base, nodes, edges: new Set(flow.steps), path: null, reason: "flow" };
  }

  if (focus.selected && visible.has(focus.selected)) {
    const t = traceComponent(index, focus.selected, {
      direction: focus.direction,
      depth: focus.depth,
      kinds: filters.kinds,
    });
    const nodes = new Set([...t.nodes.keys()].filter((id) => visible.has(id)));
    const edges = new Set([...t.edges].filter((id) => visibleEdges.has(id)));
    return { ...base, distance: t.nodes, nodes, edges, path: null, reason: "trace" };
  }

  if (matches) return { ...base, nodes: matches, edges: new Set(), path: null, reason: "search" };
  return { ...base, nodes: null, edges: null, path: null, reason: null };
}

/** The map's state in the URL hash, so a view can be shared: #c=<component>&d=<direction>&n=<depth>&f=<flow>&v=<tab>. */
export const TABS = ["map", "register", "flows", "data", "review", "checks"] as const;
export type Tab = (typeof TABS)[number];

export interface HashState {
  readonly tab: Tab;
  readonly selected: string | null;
  readonly direction: TraceDirection;
  readonly depth: number;
  readonly flow: string | null;
}

const DIRECTIONS: readonly TraceDirection[] = ["dependencies", "dependents", "both"];

export function readHash(
  hash: string,
  known: ReadonlySet<string>,
  flows: ReadonlySet<string>,
): HashState {
  const p = new URLSearchParams(hash.replace(/^#/, ""));
  const tab = p.get("v");
  const c = p.get("c");
  const d = p.get("d");
  const n = p.get("n");
  const f = p.get("f");
  return {
    tab: (TABS as readonly string[]).includes(tab ?? "") ? (tab as Tab) : "map",
    selected: c && known.has(c) ? c : null,
    direction: DIRECTIONS.includes(d as TraceDirection) ? (d as TraceDirection) : "both",
    depth: n === "all" ? Infinity : [1, 2, 3].includes(Number(n)) ? Number(n) : 1,
    flow: f && flows.has(f) ? f : null,
  };
}

export function writeHash(s: HashState): string {
  const p = new URLSearchParams();
  if (s.tab !== "map") p.set("v", s.tab);
  if (s.selected) p.set("c", s.selected);
  if (s.direction !== "both") p.set("d", s.direction);
  if (s.depth !== 1) p.set("n", s.depth === Infinity ? "all" : String(s.depth));
  if (s.flow) p.set("f", s.flow);
  const text = p.toString();
  return text ? `#${text}` : "";
}

/** A link to a file or folder on the repository's main branch. */
export function sourceUrl(repository: string, path: string): string {
  const kind = path.endsWith("/") ? "tree" : "blob";
  const clean = path.replace(/\/$/, "");
  return `https://github.com/${repository}/${kind}/main/${clean.split("/").map(encodeURIComponent).join("/")}`;
}
