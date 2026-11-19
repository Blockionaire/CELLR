import {
  SYSTEM_LAYERS,
  SYSTEM_LAYER_LABEL,
  edgeId,
  type SystemComponent,
  type SystemEdge,
  type SystemLayer,
} from "@cellr/domain";

/**
 * The map's layout (System Intelligence ADR-001 §6): computed, never stored. One column per layer, left to right;
 * a long layer wraps into several columns; rows follow the register's order; columns are centred vertically.
 * Edges are cubic curves between node sides, and the ends on each side are spread out in the order of the node at
 * the other end, so lines cross as little as a layered drawing allows. Deterministic: same input, same pixels.
 */
export const NODE_W = 220;
export const NODE_H = 72;
const ROW_GAP = 16;
const COL_GAP = 104;
const SUB_GAP = 28;
const HEADER = 64;
const PAD = 40;
const MAX_ROWS = 12;

export interface NodeBox {
  readonly id: string;
  readonly layer: SystemLayer;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}
export interface LayerColumn {
  readonly layer: SystemLayer;
  readonly label: string;
  readonly x: number;
  readonly w: number;
  readonly y: number;
  readonly h: number;
}
export interface EdgePath {
  readonly id: string;
  readonly d: string;
  /** Where the arrow ends, and the point halfway, for labels. */
  readonly end: { readonly x: number; readonly y: number };
  readonly mid: { readonly x: number; readonly y: number };
}
export interface MapLayout {
  readonly nodes: ReadonlyMap<string, NodeBox>;
  readonly columns: readonly LayerColumn[];
  readonly edges: readonly EdgePath[];
  readonly width: number;
  readonly height: number;
}

export function layoutMap(
  components: readonly SystemComponent[],
  edges: readonly SystemEdge[],
): MapLayout {
  const layers = SYSTEM_LAYERS.map((layer) => ({
    layer,
    items: components.filter((c) => c.layer === layer),
  })).filter((l) => l.items.length > 0);

  // Split long layers into sub-columns of at most MAX_ROWS, as evenly as possible.
  const split = layers.map(({ layer, items }) => {
    const cols = Math.max(1, Math.ceil(items.length / MAX_ROWS));
    const per = Math.ceil(items.length / cols);
    return {
      layer,
      cols: Array.from({ length: cols }, (_, i) => items.slice(i * per, (i + 1) * per)),
    };
  });
  const colHeight = (n: number) => n * NODE_H + Math.max(0, n - 1) * ROW_GAP;
  const tallest = Math.max(...split.flatMap((l) => l.cols.map((c) => colHeight(c.length))));

  const nodes = new Map<string, NodeBox>();
  const columns: LayerColumn[] = [];
  let x = PAD;
  for (const { layer, cols } of split) {
    const w = cols.length * NODE_W + (cols.length - 1) * SUB_GAP;
    columns.push({ layer, label: SYSTEM_LAYER_LABEL[layer], x, w, y: PAD, h: HEADER + tallest });
    cols.forEach((col, ci) => {
      const top = PAD + HEADER + (tallest - colHeight(col.length)) / 2;
      col.forEach((c, ri) =>
        nodes.set(c.id, {
          id: c.id,
          layer,
          x: x + ci * (NODE_W + SUB_GAP),
          y: top + ri * (NODE_H + ROW_GAP),
          w: NODE_W,
          h: NODE_H,
        }),
      );
    });
    x += w + COL_GAP;
  }
  const width = x - COL_GAP + PAD;
  const height = PAD * 2 + HEADER + tallest;
  return { nodes, columns, edges: routeEdges(nodes, edges), width, height };
}

type Side = "left" | "right";
const cy = (b: NodeBox) => b.y + b.h / 2;

/** Which sides an edge leaves and enters: toward the other node; a same-column edge loops out on the right. */
function sides(a: NodeBox, b: NodeBox): [Side, Side] {
  if (b.x >= a.x + a.w) return ["right", "left"];
  if (b.x + b.w <= a.x) return ["left", "right"];
  return ["right", "right"];
}

function routeEdges(nodes: ReadonlyMap<string, NodeBox>, edges: readonly SystemEdge[]): EdgePath[] {
  const drawn = edges.filter((e) => nodes.has(e.from) && nodes.has(e.to) && e.from !== e.to);
  // Every end of every edge, per node side, ordered by the other node's height: spread them over the side.
  const ports = new Map<string, Array<{ key: string; otherY: number }>>();
  const portKey = (id: string, side: Side) => `${id}|${side}`;
  for (const e of drawn) {
    const a = nodes.get(e.from)!;
    const b = nodes.get(e.to)!;
    const [sa, sb] = sides(a, b);
    const id = edgeId(e);
    for (const [node, side, other, end] of [
      [a, sa, b, "from"],
      [b, sb, a, "to"],
    ] as const) {
      const k = portKey(node.id, side);
      ports.set(k, [...(ports.get(k) ?? []), { key: `${id}|${end}`, otherY: cy(other) }]);
    }
  }
  const portY = new Map<string, number>();
  for (const [k, list] of ports) {
    const node = nodes.get(k.split("|")[0]!)!;
    const sortedList = [...list].sort((p, q) => p.otherY - q.otherY || p.key.localeCompare(q.key));
    const inset = 10;
    const span = node.h - inset * 2;
    sortedList.forEach((p, i) =>
      portY.set(p.key, node.y + inset + (span * (i + 1)) / (sortedList.length + 1)),
    );
  }

  return drawn.map((e) => {
    const a = nodes.get(e.from)!;
    const b = nodes.get(e.to)!;
    const id = edgeId(e);
    const [sa, sb] = sides(a, b);
    const sx = sa === "right" ? a.x + a.w : a.x;
    const ex = sb === "right" ? b.x + b.w : b.x;
    const sy = portY.get(`${id}|from`)!;
    const ey = portY.get(`${id}|to`)!;
    let d: string;
    if (sa === sb) {
      const bulge = 48 + Math.min(120, Math.abs(ey - sy) * 0.18);
      const cx = Math.max(sx, ex) + bulge;
      d = `M${r(sx)} ${r(sy)} C${r(cx)} ${r(sy)} ${r(cx)} ${r(ey)} ${r(ex)} ${r(ey)}`;
    } else {
      const dir = sa === "right" ? 1 : -1;
      const c = Math.max(48, Math.abs(ex - sx) * 0.45);
      d = `M${r(sx)} ${r(sy)} C${r(sx + dir * c)} ${r(sy)} ${r(ex - dir * c)} ${r(ey)} ${r(ex)} ${r(ey)}`;
    }
    return {
      id,
      d,
      end: { x: r(ex), y: r(ey) },
      mid: { x: r(sa === sb ? Math.max(sx, ex) + 40 : (sx + ex) / 2), y: r((sy + ey) / 2) },
    };
  });
}

const r = (n: number) => Math.round(n * 10) / 10;

/** The transform that fits a box into a viewport with a margin, never zooming in past 1. */
export function fitTransform(
  box: { x: number; y: number; w: number; h: number },
  viewport: { w: number; h: number },
  margin = 24,
  maxScale = 1,
) {
  const k = Math.max(
    0.1,
    Math.min(maxScale, (viewport.w - margin * 2) / box.w, (viewport.h - margin * 2) / box.h),
  );
  return {
    k,
    x: viewport.w / 2 - (box.x + box.w / 2) * k,
    y: viewport.h / 2 - (box.y + box.h / 2) * k,
  };
}

export const clampScale = (k: number) => Math.max(0.15, Math.min(2.5, k));

/** The bounding box of some components, for "fit to these". Null when none is placed. */
export function boundsOf(layout: MapLayout, ids: Iterable<string>) {
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const id of ids) {
    const n = layout.nodes.get(id);
    if (!n) continue;
    x1 = Math.min(x1, n.x);
    y1 = Math.min(y1, n.y);
    x2 = Math.max(x2, n.x + n.w);
    y2 = Math.max(y2, n.y + n.h);
  }
  return x1 === Infinity ? null : { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** A name in at most two lines of `width` characters, for the overview's large type. */
export function wrapName(name: string, width: number): [string] | [string, string] {
  const words = name.split(/\s+/);
  const lines: string[] = [""];
  for (const w of words) {
    const cur = lines[lines.length - 1]!;
    if (!cur) lines[lines.length - 1] = w;
    else if (`${cur} ${w}`.length <= width) lines[lines.length - 1] = `${cur} ${w}`;
    else lines.push(w);
  }
  const clip = (s: string) => (s.length > width ? `${s.slice(0, width - 1)}…` : s);
  if (lines.length === 1) return [clip(lines[0]!)];
  const second = lines.slice(1).join(" ");
  return [clip(lines[0]!), clip(second)];
}
