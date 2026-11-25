"use client";

import { Focus, Maximize2, Minus, Plus } from "lucide-react";
import {
  EDGE_KINDS,
  HEALTH_STATUS_LABEL,
  edgeId,
  type ComponentRisk,
  type HealthStatus,
  type EdgeKind,
  type SystemComponent,
  type SystemEdge,
} from "@cellr/domain";
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { cn } from "@/ui/cn";
import { HEALTH_COLOR, HEALTH_GLYPH } from "./health-model";
import { boundsOf, clampScale, fitTransform, wrapName, type MapLayout } from "./layout";
import type { MapEmphasis } from "./model";

/**
 * The architecture map: an SVG drawing of the register, laid out by layoutMap. Pan by dragging or scrolling, zoom
 * with ctrl/⌘ + scroll, a pinch, the buttons or + / − / 0 on the keyboard. Every component is a button (Tab, Enter).
 * It draws structure; health is an optional overlay (a badge per measured component), and without it — or with it
 * unavailable — the drawing is exactly the same.
 */

export type HealthMarks = ReadonlyMap<string, HealthStatus>;
export interface Transform {
  readonly k: number;
  readonly x: number;
  readonly y: number;
}

export const LAYER_COLOR = (layer: string) => `var(--sys-${layer})`;
export const KIND_COLOR = (kind: EdgeKind) => `var(--sys-k-${kind})`;
const DASHED: ReadonlySet<EdgeKind> = new Set(["feedback", "planned"]);
const DOTTED: ReadonlySet<EdgeKind> = new Set(["control", "ops", "verifies"]);
export const kindDash = (k: EdgeKind) =>
  DASHED.has(k) ? "7 5" : DOTTED.has(k) ? "2 4" : undefined;

export const SEVERITY_COLOR = { high: "var(--danger)", medium: "var(--peak)", low: "var(--ink-3)" };
export const worstRisk = (risks: readonly ComponentRisk[] | undefined) =>
  risks?.find((r) => r.severity === "high") ??
  risks?.find((r) => r.severity === "medium") ??
  risks?.[0];

const STATUS_TAG: Record<string, string> = {
  gated: "BEHIND A SWITCH",
  unverified: "OUTSIDE THE REPO",
  planned: "PLANNED",
};

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

interface MapProps {
  layout: MapLayout;
  components: readonly SystemComponent[];
  edges: readonly SystemEdge[];
  emphasis: MapEmphasis;
  selected: string | null;
  /**
   * A new `seq` moves the view: one id is centred (after a search or a jump from a list), several are fitted (a
   * flow).
   */
  focusRequest: { readonly seq: number; readonly ids: readonly string[] };
  /** Health per component id; null = no overlay (not shown, or not available). */
  health?: HealthMarks | null;
  onSelect: (id: string | null) => void;
  className?: string;
}

export function SystemMap({
  layout,
  components,
  edges,
  emphasis,
  selected,
  focusRequest,
  health = null,
  onSelect,
  className,
}: MapProps) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [t, setT] = useState<Transform>({ k: 0.5, x: 0, y: 0 });
  const [animate, setAnimate] = useState(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ moved: boolean; dist: number | null; x: number; y: number }>({
    moved: false,
    dist: null,
    x: 0,
    y: 0,
  });

  const fit = useCallback(() => {
    if (!size.w || !size.h) return;
    setAnimate(true);
    setT(fitTransform({ x: 0, y: 0, w: layout.width, h: layout.height }, size, 16));
  }, [layout.width, layout.height, size]);

  // Measure the viewport; fit once it has a size.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let fitted = false;
    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const next = { w: entry.contentRect.width, h: entry.contentRect.height };
      setSize(next);
      if (!fitted && next.w > 0) {
        fitted = true;
        setT(fitTransform({ x: 0, y: 0, w: layout.width, h: layout.height }, next, 16));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [layout.width, layout.height]);

  const fitTo = (ids: Iterable<string>, at = size) => {
    const b = boundsOf(layout, ids);
    if (!b || !at.w) return;
    setAnimate(true);
    setT(fitTransform(b, at, 40, 1));
  };

  // Move the view when asked: adjusted while rendering, on a new request only.
  // -1: a request made while the map was not mounted (another tab) still applies when it mounts
  const [seenFocus, setSeenFocus] = useState(-1);
  if (focusRequest.seq !== seenFocus && size.w) {
    setSeenFocus(focusRequest.seq);
    const [only] = focusRequest.ids;
    const n = focusRequest.ids.length === 1 && only ? layout.nodes.get(only) : undefined;
    if (n) {
      const k = Math.max(t.k, 0.75);
      setAnimate(true);
      setT({ k, x: size.w / 2 - (n.x + n.w / 2) * k, y: size.h / 2 - (n.y + n.h / 2) * k });
    } else if (focusRequest.ids.length > 1) fitTo(focusRequest.ids);
  }

  // Below this scale the drawing switches to large names only, and the layer titles grow, so it stays legible.
  const overview = t.k < 0.55;
  const labelScale = Math.min(3.5, Math.max(1, Math.round((0.9 / t.k) * 4) / 4));

  const zoomAt = useCallback((factor: number, cx: number, cy: number, smooth = false) => {
    setAnimate(smooth);
    setT((cur) => {
      const k = clampScale(cur.k * factor);
      return { k, x: cx - ((cx - cur.x) * k) / cur.k, y: cy - ((cy - cur.y) * k) / cur.k };
    });
  }, []);
  const zoomCentre = (factor: number) => zoomAt(factor, size.w / 2, size.h / 2, true);
  const pan = (dx: number, dy: number, smooth = false) => {
    setAnimate(smooth);
    setT((cur) => ({ ...cur, x: cur.x + dx, y: cur.y + dy }));
  };

  // A pointer released outside the map (before it became a drag, so not captured) must not linger as a "finger".
  useEffect(() => {
    const drop = (e: PointerEvent) => {
      pointers.current.delete(e.pointerId);
      if (pointers.current.size < 2) gesture.current.dist = null;
    };
    window.addEventListener("pointerup", drop);
    window.addEventListener("pointercancel", drop);
    return () => {
      window.removeEventListener("pointerup", drop);
      window.removeEventListener("pointercancel", drop);
    };
  }, []);

  // Scrolling pans; ctrl/⌘ + scroll (and a trackpad pinch, which arrives as one) zooms. Not passive: the page must
  // not scroll underneath.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey)
        zoomAt(Math.exp(-e.deltaY * 0.0022), e.clientX - r.left, e.clientY - r.top);
      else {
        setAnimate(false);
        setT((cur) => ({ ...cur, x: cur.x - e.deltaX, y: cur.y - e.deltaY }));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1)
      gesture.current = { moved: false, dist: null, x: e.clientX, y: e.clientY };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const next = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, next);
    const all = [...pointers.current.values()];
    if (all.length === 2) {
      const [a, b] = all as [{ x: number; y: number }, { x: number; y: number }];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const r = box.current!.getBoundingClientRect();
      if (gesture.current.dist)
        zoomAt(dist / gesture.current.dist, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
      gesture.current = { ...gesture.current, moved: true, dist };
      return;
    }
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    if (
      !gesture.current.moved &&
      Math.hypot(next.x - gesture.current.x, next.y - gesture.current.y) < 4
    )
      return;
    // Capture only once it is a drag: capturing on press would send the click to the map, not the component.
    if (!gesture.current.moved) (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    gesture.current.moved = true;
    pan(dx, dy);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) gesture.current.dist = null;
  };
  /** A click that was not the end of a drag. */
  const clicked = () => !gesture.current.moved;
  // Keyboard focus on a component outside the view brings it into view (Tab through the map).
  const view = useRef({ t, size });
  useEffect(() => {
    view.current = { t, size };
  });
  const reveal = useCallback(
    (id: string) => {
      const n = layout.nodes.get(id);
      const { t: cur, size: s } = view.current;
      if (!n || !s.w) return;
      const left = n.x * cur.k + cur.x;
      const top = n.y * cur.k + cur.y;
      const right = left + n.w * cur.k;
      const bottom = top + n.h * cur.k;
      const m = 24;
      const dx = left < m ? m - left : right > s.w - m ? s.w - m - right : 0;
      const dy = top < m ? m - top : bottom > s.h - m ? s.h - m - bottom : 0;
      if (!dx && !dy) return;
      setAnimate(true);
      setT({ ...cur, x: cur.x + dx, y: cur.y + dy });
    },
    [layout.nodes],
  );
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  });
  // Stable, so the memoised drawing is not re-rendered by panning. A keyboard activation is never a drag.
  const selectNode = useCallback((id: string, keyboard: boolean) => {
    if (keyboard || !gesture.current.moved) onSelectRef.current(id);
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = 60;
    const keys: Record<string, () => void> = {
      "+": () => zoomCentre(1.25),
      "=": () => zoomCentre(1.25),
      "-": () => zoomCentre(0.8),
      "0": fit,
      ArrowLeft: () => pan(step, 0, true),
      ArrowRight: () => pan(-step, 0, true),
      ArrowUp: () => pan(0, step, true),
      ArrowDown: () => pan(0, -step, true),
      Escape: () => onSelect(null),
    };
    // arrows only pan when the map itself (not a component) has focus
    if (e.key.startsWith("Arrow") && e.target !== e.currentTarget) return;
    const run = keys[e.key];
    if (run) {
      e.preventDefault();
      run();
    }
  };

  return (
    <div
      ref={box}
      tabIndex={0}
      role="application"
      aria-roledescription="architecture map"
      aria-label="Architecture map. Tab to a component, Enter to select it. Arrow keys pan, plus and minus zoom, 0 fits."
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClick={(e) => {
        if (clicked() && (e.target as Element).closest("[data-node]") === null) onSelect(null);
      }}
      className={cn(
        "relative cursor-grab touch-none select-none overflow-hidden rounded-[18px] border border-hairline bg-canvas active:cursor-grabbing",
        className,
      )}
      data-testid="system-map"
    >
      <svg width="100%" height="100%" className="block" aria-hidden={false}>
        <g
          style={{
            transform: `translate(${t.x}px, ${t.y}px) scale(${t.k})`,
            transformOrigin: "0 0",
            transition: animate ? "transform 320ms var(--ease-out)" : "none",
          }}
          onTransitionEnd={() => setAnimate(false)}
        >
          <MapContent
            layout={layout}
            components={components}
            edges={edges}
            emphasis={emphasis}
            selected={selected}
            onSelect={selectNode}
            onReveal={reveal}
            overview={overview}
            labelScale={labelScale}
            health={health}
          />
        </g>
      </svg>
      <div className="pointer-events-none absolute left-3 top-3 rounded-full bg-surface/90 px-3 py-1 text-caption text-ink-2 shadow-raised tnum">
        {Math.round(t.k * 100)}%
        <span className="hidden sm:inline">
          {" "}
          · drag or scroll to move · ctrl/⌘ + scroll or pinch to zoom
        </span>
      </div>
      <div className="absolute bottom-3 right-3 flex flex-col overflow-hidden rounded-[12px] border border-hairline bg-surface shadow-raised">
        <MapButton label="Zoom in" onClick={() => zoomCentre(1.25)}>
          <Plus size={16} aria-hidden="true" />
        </MapButton>
        <MapButton label="Zoom out" onClick={() => zoomCentre(0.8)}>
          <Minus size={16} aria-hidden="true" />
        </MapButton>
        {emphasis.nodes && emphasis.nodes.size > 1 && (
          <MapButton label="Fit to what is highlighted" onClick={() => fitTo(emphasis.nodes!)}>
            <Focus size={15} aria-hidden="true" />
          </MapButton>
        )}
        <MapButton label="Fit the whole map" onClick={fit}>
          <Maximize2 size={15} aria-hidden="true" />
        </MapButton>
      </div>
    </div>
  );
}

function MapButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="grid size-11 place-items-center text-ink-2 hover:bg-raised hover:text-ink focus-visible:outline-offset-[-2px] lg:size-10"
    >
      {children}
    </button>
  );
}

/** The drawing itself; memoised so panning and zooming never re-render it. */
const MapContent = memo(function MapContent({
  layout,
  components,
  edges,
  emphasis,
  selected,
  onSelect,
  onReveal,
  overview,
  labelScale,
  health,
}: {
  layout: MapLayout;
  components: readonly SystemComponent[];
  edges: readonly SystemEdge[];
  emphasis: MapEmphasis;
  selected: string | null;
  onSelect: (id: string, keyboard: boolean) => void;
  onReveal: (id: string) => void;
  overview: boolean;
  labelScale: number;
  health: HealthMarks | null;
}) {
  const uid = useId().replace(/:/g, "");
  const byId = useMemo(() => new Map(edges.map((e) => [edgeId(e), e])), [edges]);
  const degree = useMemo(() => {
    const m = new Map<string, { in: number; out: number }>();
    for (const e of edges) {
      m.set(e.from, { in: m.get(e.from)?.in ?? 0, out: (m.get(e.from)?.out ?? 0) + 1 });
      m.set(e.to, { in: (m.get(e.to)?.in ?? 0) + 1, out: m.get(e.to)?.out ?? 0 });
    }
    return m;
  }, [edges]);
  const focusNodes = emphasis.nodes;
  const focusEdges = emphasis.edges;
  const showLabels = focusEdges !== null && focusEdges.size > 0 && focusEdges.size <= 24;

  const drawnEdges = layout.edges.filter((p) => emphasis.visibleEdges.has(p.id));
  // focused edges last, so they are drawn on top
  drawnEdges.sort(
    (a, b) => Number(focusEdges?.has(a.id) ?? false) - Number(focusEdges?.has(b.id) ?? false),
  );

  return (
    <>
      <defs>
        {EDGE_KINDS.map((k) => (
          <marker
            key={k}
            id={`${uid}-arrow-${k}`}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M0 0 L10 5 L0 10 z" style={{ fill: KIND_COLOR(k) }} />
          </marker>
        ))}
      </defs>

      {layout.columns.map((c) => (
        <g key={c.layer}>
          <rect
            x={c.x - 16}
            y={c.y}
            width={c.w + 32}
            height={c.h}
            rx={22}
            style={{
              fill: `color-mix(in srgb, ${LAYER_COLOR(c.layer)} 6%, transparent)`,
              stroke: `color-mix(in srgb, ${LAYER_COLOR(c.layer)} 22%, transparent)`,
              strokeDasharray: c.layer === "planned" ? "6 6" : undefined,
            }}
          />
          <text
            x={c.x}
            y={c.y + 36 + (labelScale - 1) * 6}
            className="font-semibold uppercase tracking-[0.12em]"
            style={{
              fill: LAYER_COLOR(c.layer),
              // grows when zoomed out, never wider than its column (≈ 10 px per letter at 13 px, uppercase, tracked)
              fontSize:
                13 * Math.max(1, Math.min(labelScale, (c.w + 16) / (c.label.length * 10.5))),
            }}
          >
            {c.label}
          </text>
        </g>
      ))}

      <g fill="none">
        {drawnEdges.map((p) => {
          const e = byId.get(p.id)!;
          const on = focusEdges?.has(p.id) ?? false;
          const dim = focusEdges !== null && !on;
          return (
            <path
              key={p.id}
              d={p.d}
              data-edge={p.id}
              markerEnd={`url(#${uid}-arrow-${e.kind})`}
              style={{
                stroke: KIND_COLOR(e.kind),
                strokeWidth: on ? 2.4 : 1.3,
                strokeDasharray: kindDash(e.kind),
                opacity: dim ? 0.07 : on ? 0.95 : 0.5,
                transition: "opacity 200ms, stroke-width 200ms",
              }}
            >
              <title>{`${e.from} → ${e.to} · ${e.kind}${e.label ? ` · ${e.label}` : ""}`}</title>
            </path>
          );
        })}
      </g>

      {showLabels &&
        drawnEdges
          .filter((p) => focusEdges!.has(p.id) && byId.get(p.id)!.label)
          .map((p) => (
            <text
              key={`l-${p.id}`}
              x={p.mid.x}
              y={p.mid.y - 5}
              textAnchor="middle"
              className="pointer-events-none fill-ink-2 text-[11px]"
              style={{
                paintOrder: "stroke",
                stroke: "var(--canvas)",
                strokeWidth: 4,
                strokeLinejoin: "round",
              }}
            >
              {clip(byId.get(p.id)!.label, 40)}
            </text>
          ))}

      {components.map((c) => {
        const b = layout.nodes.get(c.id);
        if (!b || !emphasis.visible.has(c.id)) return null;
        const on = c.id === selected;
        const dim = focusNodes !== null && !focusNodes.has(c.id);
        const match = emphasis.matches?.has(c.id) ?? false;
        const risk = worstRisk(c.risks);
        const d = degree.get(c.id) ?? { in: 0, out: 0 };
        const distance = emphasis.reason === "trace" ? emphasis.distance.get(c.id) : undefined;
        const tag = STATUS_TAG[c.status];
        const h = health ? (health.get(c.id) ?? null) : undefined;
        const healthText =
          h === undefined
            ? ""
            : ` Health: ${h ? HEALTH_STATUS_LABEL[h].toLowerCase() : "not measured"}.`;
        return (
          <g
            key={c.id}
            data-node={c.id}
            data-health={h === undefined ? undefined : (h ?? "none")}
            role="button"
            tabIndex={0}
            aria-pressed={on}
            aria-label={`${c.name}. ${c.summary}.${tag ? ` ${tag.toLowerCase()}.` : ""}${c.risks?.length ? ` ${c.risks.length} known risk${c.risks.length > 1 ? "s" : ""}.` : ""}${healthText}`}
            transform={`translate(${b.x} ${b.y})`}
            className="cursor-pointer outline-none [&:focus-visible>rect:first-child]:stroke-[var(--accent-fg)] [&:focus-visible>rect:first-child]:[stroke-width:3]"
            style={{ opacity: dim ? 0.2 : 1, transition: "opacity 200ms" }}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(c.id, false);
            }}
            onFocus={() => onReveal(c.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                onSelect(c.id, true);
              }
            }}
          >
            <title>{`${c.name} — ${c.summary}`}</title>
            <rect
              width={b.w}
              height={b.h}
              rx={12}
              style={{
                fill: "var(--surface)",
                stroke: on ? "var(--accent-fg)" : match ? LAYER_COLOR(c.layer) : "var(--hairline)",
                strokeWidth: on ? 2.5 : match ? 2 : 1,
                strokeDasharray: c.status === "planned" ? "5 4" : undefined,
                filter: on ? "drop-shadow(0 6px 14px rgb(0 0 0 / 0.18))" : undefined,
              }}
            />
            <rect
              width={4}
              height={b.h - 16}
              x={0}
              y={8}
              rx={2}
              style={{ fill: LAYER_COLOR(c.layer) }}
            />
            {overview ? (
              wrapName(c.name, 15).map((line, i, all) => (
                <text
                  key={i}
                  x={16}
                  y={all.length === 1 ? 45 : 32 + i * 27}
                  className="fill-ink font-semibold"
                  style={{ fontSize: 23 }}
                >
                  {line}
                </text>
              ))
            ) : (
              <>
                <text x={16} y={25} className="fill-ink text-[14px] font-semibold">
                  {clip(c.name, 25)}
                </text>
                <text x={16} y={44} className="fill-ink-2 text-[11.5px]">
                  {clip(c.summary, 35)}
                </text>
                <text
                  x={16}
                  y={62}
                  className="text-[10px] font-medium tracking-[0.06em]"
                  style={{
                    fill: tag
                      ? LAYER_COLOR(c.status === "planned" ? "planned" : "core")
                      : "var(--ink-3)",
                  }}
                >
                  {tag ?? `${d.in} IN · ${d.out} OUT`}
                </text>
              </>
            )}
            {risk && (
              <g transform={`translate(${b.w - 18} 18)`}>
                <circle r={7} style={{ fill: SEVERITY_COLOR[risk.severity] }} />
                <text
                  y={3.5}
                  textAnchor="middle"
                  className="text-[10px] font-bold"
                  style={{ fill: "var(--surface)" }}
                >
                  {c.risks!.length}
                </text>
              </g>
            )}
            {h && (
              <g
                transform={
                  overview
                    ? // on the node's corner, half outside it: the large badge never covers the name
                      `translate(${b.w - 4} 4)`
                    : `translate(${risk ? b.w - 40 : b.w - 18} 18)`
                }
                data-testid="health-badge"
              >
                <circle
                  // zoomed out the badge must still read as a mark: large enough at a third of full size
                  r={overview ? 19 : 8}
                  style={{ fill: HEALTH_COLOR[h], stroke: "var(--surface)", strokeWidth: 2 }}
                />
                <text
                  y={overview ? 8 : 3.5}
                  textAnchor="middle"
                  className={overview ? "text-[23px] font-bold" : "text-[11px] font-bold"}
                  style={{ fill: "var(--surface)" }}
                >
                  {HEALTH_GLYPH[h]}
                </text>
              </g>
            )}
            {distance !== undefined && distance > 0 && (
              <g transform={`translate(${b.w - 18} ${b.h - 16})`}>
                <circle r={8} style={{ fill: "var(--raised)", stroke: "var(--hairline)" }} />
                <text
                  y={3.5}
                  textAnchor="middle"
                  className="fill-ink-2 text-[10px] font-semibold tnum"
                >
                  {distance}
                </text>
              </g>
            )}
          </g>
        );
      })}
    </>
  );
});
