"use client";

import { Search, X } from "lucide-react";
import {
  COMPONENT_STATUSES,
  COMPONENT_STATUS_LABEL,
  EDGE_KINDS,
  EDGE_KIND_LABEL,
  SYSTEM_LAYERS,
  SYSTEM_LAYER_LABEL,
  indexGraph,
  type ArchitectureView,
  type ComponentStatus,
  type EdgeKind,
  type SystemLayer,
  type TraceDirection,
} from "@cellr/domain";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/ui/cn";
import { DetailPanel, KindLine } from "./detail-panel";
import { layoutMap } from "./layout";
import {
  ALL_FILTERS,
  emphasis,
  readHash,
  writeHash,
  type MapFilters,
  type Tab,
  TABS,
} from "./model";
import { LAYER_COLOR, SystemMap } from "./system-map";
import { ChecksView, DataView, FlowsView, RegisterView, ReviewView } from "./views";

/**
 * The Architecture Control Center (/admin/system, System Intelligence sprint 1). Everything it shows comes from the
 * server-rendered `view` (the register, the repository inventory and their validation); it fetches nothing, so it
 * keeps working when any other system is down. State lives in the URL hash, so a view can be shared.
 */
const TAB_LABEL: Record<Tab, string> = {
  map: "Map",
  register: "Register",
  flows: "Flows",
  data: "Data",
  review: "Review",
  checks: "Checks",
};

/** The components a flow passes through, from its steps ("from->to:kind"). */
const flowNodes = (steps: readonly string[]) => [
  ...new Set(steps.flatMap((s) => s.replace(/:[^:]+$/, "").split("->"))),
];

export function ArchitectureControlCenter({ view }: { view: ArchitectureView }) {
  const reg = view.registry;
  const index = useMemo(() => indexGraph(reg.edges), [reg]);
  const layout = useMemo(() => layoutMap(reg.components, reg.edges), [reg]);
  const known = useMemo(() => new Set(reg.components.map((c) => c.id)), [reg]);
  const flowIds = useMemo(() => new Set(reg.flows.map((f) => f.id)), [reg]);

  const [tab, setTab] = useState<Tab>("map");
  const [selected, setSelected] = useState<string | null>(null);
  const [direction, setDirection] = useState<TraceDirection>("both");
  const [depth, setDepth] = useState(1);
  const [flow, setFlow] = useState<string | null>(null);
  const [pathTo, setPathTo] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [filters, setFilters] = useState<MapFilters>(ALL_FILTERS);
  const [focusRequest, setFocusRequest] = useState<{ seq: number; ids: readonly string[] }>({
    seq: 0,
    ids: [],
  });
  const [copied, setCopied] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Read the view from the URL once, then keep the URL in step with it.
  useEffect(() => {
    const s = readHash(window.location.hash, known, flowIds);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the URL hash exists only in the browser, after hydration
    setTab(s.tab);
    setSelected(s.selected);
    setDirection(s.direction);
    setDepth(s.depth);
    setFlow(s.flow);
    if (s.selected) setFocusRequest((f) => ({ seq: f.seq + 1, ids: [s.selected!] }));
    else if (s.flow) {
      const steps = reg.flows.find((x) => x.id === s.flow)?.steps ?? [];
      setFocusRequest((f) => ({ seq: f.seq + 1, ids: flowNodes(steps) }));
    }
    setHydrated(true);
  }, [known, flowIds, reg]);
  useEffect(() => {
    if (!hydrated) return;
    const hash = writeHash({ tab, selected, direction, depth, flow });
    const url = `${window.location.pathname}${window.location.search}${hash}`;
    if (url !== `${window.location.pathname}${window.location.search}${window.location.hash}`)
      window.history.replaceState(window.history.state, "", url);
  }, [hydrated, tab, selected, direction, depth, flow]);

  // "/" focuses the search, as on most consoles.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key !== "/" || e.metaKey || e.ctrlKey) return;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const emph = useMemo(
    () =>
      emphasis(reg, index, filters, {
        selected,
        direction,
        depth,
        flow,
        pathTo,
        query: deferredQuery,
      }),
    [reg, index, filters, selected, direction, depth, flow, pathTo, deferredQuery],
  );

  const select = useCallback((id: string | null, focus = false) => {
    setSelected(id);
    setPathTo(null);
    if (id) setFlow(null);
    if (id && focus) setFocusRequest((f) => ({ seq: f.seq + 1, ids: [id] }));
  }, []);
  const open = (id: string) => {
    setTab("map");
    select(id, true);
    // on a phone the panel is below the map: bring it into view
    requestAnimationFrame(() => {
      if (window.matchMedia("(max-width: 1023px)").matches)
        panelRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    });
  };
  const showFlow = (id: string) => {
    setTab("map");
    setSelected(null);
    setPathTo(null);
    setFlow(id);
    const steps = reg.flows.find((x) => x.id === id)?.steps ?? [];
    setFocusRequest((f) => ({ seq: f.seq + 1, ids: flowNodes(steps) }));
  };
  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") setQuery("");
    if (e.key === "Enter" && emph.matches?.size) {
      const first = reg.components.find((c) => emph.matches!.has(c.id));
      if (first) {
        setTab("map");
        select(first.id, true);
      }
    }
  };
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  const toggle = <T,>(set: ReadonlySet<T>, v: T): Set<T> => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    return next;
  };
  const filtered =
    filters.kinds.size !== EDGE_KINDS.length ||
    filters.layers.size !== SYSTEM_LAYERS.length ||
    filters.statuses.size !== COMPONENT_STATUSES.length;

  const component = selected ? (reg.components.find((c) => c.id === selected) ?? null) : null;
  const activeFlow = flow ? reg.flows.find((f) => f.id === flow) : undefined;
  const high = reg.components
    .flatMap((c) => c.risks ?? [])
    .filter((r) => r.severity === "high").length;
  const confirmed = reg.edges.filter((e) => e.kind !== "planned").length;
  const errors = view.issues.filter((i) => i.level === "error").length;

  return (
    <div className="space-y-4" data-testid="architecture-control-center">
      <dl className="grid grid-cols-3 gap-2 sm:gap-3 xl:grid-cols-6">
        <Kpi label="Components" value={reg.components.length} />
        <Kpi
          label="Confirmed edges"
          value={confirmed}
          hint={`${reg.edges.length - confirmed} planned`}
        />
        <Kpi
          label="Tables owned"
          value={view.inventory.tables.length}
          hint="every one by one component"
        />
        <Kpi label="Routes owned" value={view.inventory.apiRoutes.length} />
        <Kpi label="High risks" value={high} tone={high ? "warn" : undefined} />
        <Kpi
          label="Register checks"
          value={errors ? `${errors} errors` : "Consistent"}
          tone={errors ? "bad" : "ok"}
          hint={`v${reg.version} · ${reg.reviewedOn}`}
        />
      </dl>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div
          role="tablist"
          aria-label="Views"
          className="flex gap-1 overflow-x-auto rounded-full bg-raised p-1"
        >
          {TABS.map((t) => (
            <button
              key={t}
              role="tab"
              type="button"
              id={`system-tab-${t}`}
              aria-selected={tab === t}
              aria-controls={`system-panel-${t}`}
              onClick={() => setTab(t)}
              className={cn(
                "whitespace-nowrap rounded-full px-4 py-1.5 text-small font-medium transition-colors",
                tab === t ? "bg-surface text-ink shadow-raised" : "text-ink-2 hover:text-ink",
              )}
            >
              {TAB_LABEL[t]}
            </button>
          ))}
        </div>
        <div className="relative w-full lg:w-80">
          <Search
            size={16}
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3"
          />
          <label htmlFor="system-search" className="sr-only">
            Search components, tables, routes, files
          </label>
          <input
            id="system-search"
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKey}
            placeholder="Search components, tables, routes…  /"
            autoComplete="off"
            className="w-full rounded-full bg-surface py-2 pl-9 pr-16 text-small text-ink ring-1 ring-ink-3/60 placeholder:text-ink-3 hover:ring-ink-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-fg"
          />
          {query && (
            <span
              className="absolute right-3 top-1/2 -translate-y-1/2 text-caption text-ink-2 tnum"
              aria-live="polite"
            >
              {emph.matches?.size ?? 0} found
            </span>
          )}
        </div>
      </div>

      {tab === "map" && (
        <div
          id="system-panel-map"
          role="tabpanel"
          aria-labelledby="system-tab-map"
          className="space-y-3"
        >
          <Filters
            filters={filters}
            filtered={filtered}
            onKind={(k) => setFilters((f) => ({ ...f, kinds: toggle(f.kinds, k) }))}
            onLayer={(l) => setFilters((f) => ({ ...f, layers: toggle(f.layers, l) }))}
            onStatus={(s) => setFilters((f) => ({ ...f, statuses: toggle(f.statuses, s) }))}
            onReset={() => setFilters(ALL_FILTERS)}
          />
          {activeFlow && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-[14px] border border-hairline bg-surface px-4 py-2 text-small">
              <span>
                Showing the flow <span className="font-semibold text-ink">{activeFlow.name}</span> ·{" "}
                {activeFlow.steps.length} steps · {activeFlow.status}
              </span>
              <button
                type="button"
                onClick={() => setFlow(null)}
                className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-caption text-ink ring-1 ring-ink-3/60 hover:bg-raised"
              >
                <X size={13} aria-hidden="true" /> Clear
              </button>
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
            <SystemMap
              layout={layout}
              components={reg.components}
              edges={reg.edges}
              emphasis={emph}
              selected={selected}
              focusRequest={focusRequest}
              onSelect={(id) => select(id)}
              className="h-[64dvh] min-h-[380px] lg:h-[calc(100dvh-400px)] lg:min-h-[520px]"
            />
            <div
              ref={panelRef}
              className="scroll-mt-4 rounded-[18px] border border-hairline bg-surface p-4 lg:h-[calc(100dvh-400px)] lg:min-h-[520px] lg:overflow-y-auto"
              aria-live="polite"
            >
              <DetailPanel
                view={view}
                index={index}
                component={component}
                emphasis={emph}
                direction={direction}
                depth={depth}
                pathTo={pathTo}
                onDirection={setDirection}
                onDepth={setDepth}
                onPathTo={setPathTo}
                onSelect={select}
                onCopyLink={copyLink}
                copied={copied}
              />
            </div>
          </div>
        </div>
      )}
      {tab !== "map" && (
        <div id={`system-panel-${tab}`} role="tabpanel" aria-labelledby={`system-tab-${tab}`}>
          {tab === "register" && (
            <RegisterView view={view} index={index} matches={emph.matches} onOpen={open} />
          )}
          {tab === "flows" && <FlowsView view={view} onShow={showFlow} />}
          {tab === "data" && (
            <DataView view={view} index={index} matches={emph.matches} onOpen={open} />
          )}
          {tab === "review" && (
            <ReviewView view={view} index={index} matches={emph.matches} onOpen={open} />
          )}
          {tab === "checks" && <ChecksView view={view} />}
        </div>
      )}
    </div>
  );
}

function Filters({
  filters,
  filtered,
  onKind,
  onLayer,
  onStatus,
  onReset,
}: {
  filters: MapFilters;
  filtered: boolean;
  onKind: (k: EdgeKind) => void;
  onLayer: (l: SystemLayer) => void;
  onStatus: (s: ComponentStatus) => void;
  onReset: () => void;
}) {
  return (
    <div className="space-y-2 text-caption">
      <div
        role="group"
        aria-label="Show lines of kind"
        className="flex flex-wrap items-center gap-1.5"
      >
        <span className="mr-1 font-semibold uppercase tracking-[0.08em] text-ink-3">Lines</span>
        {EDGE_KINDS.map((k) => (
          <FilterChip key={k} on={filters.kinds.has(k)} onClick={() => onKind(k)}>
            <KindLine kind={k} />
            {EDGE_KIND_LABEL[k]}
          </FilterChip>
        ))}
      </div>
      <details className="group">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-full px-2 py-1 font-medium text-ink-2 hover:text-ink">
          <span className="transition-transform group-open:rotate-90" aria-hidden="true">
            ›
          </span>
          Layers and status
          {filtered && <span className="text-accent-fg"> · filtered</span>}
        </summary>
        <div className="mt-2 space-y-2">
          <div
            role="group"
            aria-label="Show layers"
            className="flex flex-wrap items-center gap-1.5"
          >
            <span className="mr-1 font-semibold uppercase tracking-[0.08em] text-ink-3">
              Layers
            </span>
            {SYSTEM_LAYERS.map((l) => (
              <FilterChip key={l} on={filters.layers.has(l)} onClick={() => onLayer(l)}>
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ background: LAYER_COLOR(l) }}
                  aria-hidden="true"
                />
                {SYSTEM_LAYER_LABEL[l]}
              </FilterChip>
            ))}
          </div>
          <div
            role="group"
            aria-label="Show status"
            className="flex flex-wrap items-center gap-1.5"
          >
            <span className="mr-1 font-semibold uppercase tracking-[0.08em] text-ink-3">
              Status
            </span>
            {COMPONENT_STATUSES.map((s) => (
              <FilterChip key={s} on={filters.statuses.has(s)} onClick={() => onStatus(s)}>
                {COMPONENT_STATUS_LABEL[s]}
              </FilterChip>
            ))}
          </div>
        </div>
      </details>
      {filtered && (
        <button
          type="button"
          onClick={onReset}
          className="font-medium text-accent-fg underline-offset-4 hover:underline"
        >
          Show everything again
        </button>
      )}
    </div>
  );
}

function FilterChip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 ring-1 transition-colors",
        on
          ? "bg-surface text-ink ring-ink-3/60"
          : "bg-transparent text-ink-3 ring-hairline line-through",
      )}
    >
      {children}
    </button>
  );
}

function Kpi({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: number | string;
  hint?: string;
  tone?: "ok" | "warn" | "bad" | undefined;
}) {
  return (
    <div className="min-w-0 rounded-[14px] border border-hairline bg-surface px-3 py-2 sm:px-4">
      <dt className="truncate text-caption text-ink-2">{label}</dt>
      <dd
        className={cn(
          "truncate font-display text-title tnum sm:text-headline",
          tone === "ok" && "text-ok",
          tone === "warn" && "text-peak-ink",
          tone === "bad" && "text-danger",
          !tone && "text-ink",
        )}
      >
        {value}
      </dd>
      {hint && <dd className="hidden truncate text-caption text-ink-3 sm:block">{hint}</dd>}
    </div>
  );
}
