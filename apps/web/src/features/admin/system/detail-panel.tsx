"use client";

import { ExternalLink, Link2, X } from "lucide-react";
import {
  COMPONENT_STATUS_LABEL,
  EDGE_KIND_LABEL,
  SYSTEM_LAYER_LABEL,
  edgeId,
  impactOf,
  type ArchitectureView,
  type GraphIndex,
  type SystemComponent,
  type SystemEdge,
  type TraceDirection,
} from "@cellr/domain";
import { useMemo, useState } from "react";
import { cn } from "@/ui/cn";
import { Segmented } from "@/ui/segmented";
import { sourceUrl, type MapEmphasis } from "./model";
import { KIND_COLOR, LAYER_COLOR, SEVERITY_COLOR, kindDash } from "./system-map";

/** Everything known about one component: what it does, what it uses and is used by (with the evidence), its risks. */
export interface PanelProps {
  view: ArchitectureView;
  index: GraphIndex;
  component: SystemComponent | null;
  emphasis: MapEmphasis;
  direction: TraceDirection;
  depth: number;
  pathTo: string | null;
  onDirection: (d: TraceDirection) => void;
  onDepth: (n: number) => void;
  onPathTo: (id: string | null) => void;
  onSelect: (id: string | null, focus?: boolean) => void;
  onCopyLink: () => void;
  copied: boolean;
}

const DEPTHS = [
  { value: "1", label: "Direct" },
  { value: "2", label: "2 steps" },
  { value: "3", label: "3 steps" },
  { value: "all", label: "All" },
] as const;
const DIRECTIONS = [
  { value: "dependencies", label: "Uses" },
  { value: "dependents", label: "Used by" },
  { value: "both", label: "Both" },
] as const;

export function DetailPanel(p: PanelProps) {
  const { view, component: c } = p;
  if (!c) return <Intro view={view} />;
  return <Details key={c.id} {...p} component={c} />;
}

function Intro({ view }: { view: ArchitectureView }) {
  const risks = view.registry.components.flatMap((c) => c.risks ?? []);
  return (
    <div className="space-y-4 text-small text-ink-2">
      <p className="text-caption font-semibold uppercase tracking-[0.1em] text-ink-3">
        How to read the map
      </p>
      <p className="text-ink">
        Select a component to see what it uses and what uses it, with the file that proves each
        line.
      </p>
      <ul className="space-y-2">
        <li>Columns run from what people use (left) to data and the platform (right).</li>
        <li>
          An arrow reads <span className="text-ink">“uses”</span>: it calls, reads, writes, guards
          or schedules. Dashed lines are feedback or planned; dotted lines are guards and
          operations.
        </li>
        <li>A coloured dot counts known risks; red is high.</li>
        <li>
          Nothing here is live: health and incidents come in their own overlay (sprints 2 and 3).
        </li>
      </ul>
      <p>
        {view.registry.components.length} components · {view.registry.edges.length} edges ·{" "}
        {risks.filter((r) => r.severity === "high").length} high risks · register v
        {view.registry.version}, reviewed {view.registry.reviewedOn}.
      </p>
    </div>
  );
}

function Details({
  view,
  index,
  component: c,
  emphasis,
  direction,
  depth,
  pathTo,
  onDirection,
  onDepth,
  onPathTo,
  onSelect,
  onCopyLink,
  copied,
}: PanelProps & { component: SystemComponent }) {
  const reg = view.registry;
  const byId = useMemo(() => new Map(reg.components.map((x) => [x.id, x])), [reg]);
  const out = index.out.get(c.id) ?? [];
  const inn = index.in.get(c.id) ?? [];
  const impact = useMemo(() => impactOf(index, c.id), [index, c.id]);
  const methods = useMemo(
    () => new Map(view.inventory.apiRoutes.map((r) => [r.path, r.methods])),
    [view.inventory],
  );
  const tableRefs = useMemo(
    () => new Map(view.inventory.tables.map((t) => [t.name, t.references])),
    [view.inventory],
  );
  const name = (id: string) => byId.get(id)?.name ?? id;

  return (
    <article
      className="space-y-5"
      aria-labelledby="system-detail-title"
      data-testid="system-detail"
    >
      <header>
        <div className="flex items-start justify-between gap-2">
          <p className="flex flex-wrap items-center gap-1.5 text-caption font-semibold uppercase tracking-[0.08em]">
            <span style={{ color: LAYER_COLOR(c.layer) }}>{SYSTEM_LAYER_LABEL[c.layer]}</span>
            <span aria-hidden="true" className="text-ink-3">
              ·
            </span>
            <StatusPill status={c.status} />
          </p>
          <div className="flex shrink-0 gap-1">
            <IconButton
              label={copied ? "Link copied" : "Copy a link to this view"}
              onClick={onCopyLink}
            >
              <Link2 size={15} aria-hidden="true" />
            </IconButton>
            <IconButton label="Close" onClick={() => onSelect(null)}>
              <X size={16} aria-hidden="true" />
            </IconButton>
          </div>
        </div>
        <h2 id="system-detail-title" className="mt-1 font-display text-title text-ink">
          {c.name}
        </h2>
        <p className="mt-1 text-small text-ink">{c.summary}</p>
        <p className="mt-2 text-small text-ink-2">{c.responsibility}</p>
      </header>

      <Block title="Trace">
        <div className="space-y-2">
          <Segmented
            label="Trace direction"
            layout="block"
            options={DIRECTIONS}
            value={direction}
            onChange={onDirection}
          />
          <Segmented
            label="Trace depth"
            layout="block"
            options={DEPTHS}
            value={depth === Infinity ? "all" : (String(depth) as "1" | "2" | "3")}
            onChange={(v) => onDepth(v === "all" ? Infinity : Number(v))}
          />
          {emphasis.reason === "trace" && (
            <p className="text-caption text-ink-2" data-testid="trace-summary">
              {emphasis.nodes!.size - 1} components and {emphasis.edges!.size} edges in this trace.
            </p>
          )}
        </div>
      </Block>

      <Block title={`If this fails (${impact.length})`}>
        {impact.length === 0 ? (
          <p className="text-caption text-ink-2">Nothing depends on it at run time.</p>
        ) : (
          <>
            <p className="mb-2 text-caption text-ink-2">
              Everything that uses it, directly or further up (runtime edges only; feedback, CI and
              planned edges are left out).
            </p>
            <ul className="flex flex-wrap gap-1.5" data-testid="impact-list">
              {impact.map((i) => (
                <li key={i.id}>
                  <Chip onClick={() => onSelect(i.id, true)}>
                    {name(i.id)} <span className="text-ink-3 tnum">· {i.distance}</span>
                  </Chip>
                </li>
              ))}
            </ul>
          </>
        )}
      </Block>

      <Block title="Find a path">
        <label className="sr-only" htmlFor="system-path-to">
          Shortest path from {c.name} to
        </label>
        <select
          id="system-path-to"
          value={pathTo ?? ""}
          onChange={(e) => onPathTo(e.target.value || null)}
          className="w-full rounded-[10px] bg-surface px-3 py-2 text-small text-ink ring-1 ring-ink-3/60 hover:ring-ink-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-fg"
        >
          <option value="">From {c.name} to…</option>
          {reg.components
            .filter((x) => x.id !== c.id)
            .map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
        </select>
        {emphasis.reason === "path" && (
          <div className="mt-2 text-caption" data-testid="path-result">
            {emphasis.path!.length === 0 ? (
              <p className="text-ink-2">No path along confirmed edges.</p>
            ) : (
              <ol className="space-y-1">
                {emphasis.path!.map((s, i) => {
                  const e = reg.edges.find((x) => edgeId(x) === s)!;
                  return (
                    <li key={s} className="flex items-center gap-2 text-ink-2">
                      <span className="tnum text-ink-3">{i + 1}.</span>
                      <KindLine kind={e.kind} />
                      <span>
                        <span className="text-ink">{name(e.from)}</span> → {name(e.to)}
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        )}
      </Block>

      {(c.inputs.length > 0 || c.outputs.length > 0) && (
        <Block title="Inputs and outputs">
          <dl className="grid grid-cols-1 gap-2 text-caption sm:grid-cols-2">
            <div>
              <dt className="font-semibold text-ink-2">In</dt>
              {c.inputs.map((x) => (
                <dd key={x} className="text-ink">
                  {x}
                </dd>
              ))}
            </div>
            <div>
              <dt className="font-semibold text-ink-2">Out</dt>
              {c.outputs.map((x) => (
                <dd key={x} className="text-ink">
                  {x}
                </dd>
              ))}
            </div>
          </dl>
        </Block>
      )}

      <EdgeList
        title={`Uses (${out.length})`}
        edges={out}
        other={(e) => e.to}
        name={name}
        repo={reg.repository}
        onSelect={onSelect}
      />
      <EdgeList
        title={`Used by (${inn.length})`}
        edges={inn}
        other={(e) => e.from}
        name={name}
        repo={reg.repository}
        onSelect={onSelect}
      />

      {c.risks && c.risks.length > 0 && (
        <Block title={`Known risks (${c.risks.length})`}>
          <ul className="space-y-2">
            {c.risks.map((r) => (
              <li key={r.id} className="rounded-[12px] border border-hairline p-3">
                <p className="flex items-center gap-2 text-small font-medium text-ink">
                  <span
                    className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: SEVERITY_COLOR[r.severity] }}
                    aria-hidden="true"
                  />
                  {r.title}
                </p>
                <p className="mt-1 text-caption text-ink-2">
                  <span className="font-semibold uppercase">{r.severity}</span> · {r.id} ·{" "}
                  {r.detail}
                </p>
              </li>
            ))}
          </ul>
        </Block>
      )}

      {c.gates && c.gates.length > 0 && (
        <Block title="Switches">
          <ul className="space-y-1 text-caption">
            {c.gates.map((g) => (
              <li key={g.name}>
                <code className="rounded bg-raised px-1.5 py-0.5 text-ink">{g.name}</code>{" "}
                <span className="text-ink-2">
                  ({g.kind === "feature" ? "CELLR_FEATURES" : "server setting"}) · {g.note}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-caption text-ink-3">
            Whether a switch is on in a deployment is not known here.
          </p>
        </Block>
      )}

      {c.tables && c.tables.length > 0 && (
        <Block title={`Tables (${c.tables.length})`}>
          <ul className="space-y-1 font-mono text-caption">
            {c.tables.map((t) => (
              <li key={t} className="text-ink">
                {t}
                {(tableRefs.get(t) ?? []).length > 0 && (
                  <span className="text-ink-3"> → {(tableRefs.get(t) ?? []).join(", ")}</span>
                )}
              </li>
            ))}
          </ul>
        </Block>
      )}

      {c.routes && c.routes.length > 0 && (
        <Block title={`Routes (${c.routes.length})`}>
          <ul className="space-y-1 font-mono text-caption">
            {c.routes.map((r) => (
              <li key={r} className="break-all text-ink">
                <span className="text-ink-3">{(methods.get(r) ?? []).join(" ")}</span> {r}
              </li>
            ))}
          </ul>
        </Block>
      )}

      {(c.buckets?.length ?? 0) + (c.cronJobs?.length ?? 0) > 0 && (
        <Block title="Buckets and jobs">
          <ul className="space-y-1 font-mono text-caption text-ink">
            {(c.buckets ?? []).map((b) => (
              <li key={b}>bucket {b}</li>
            ))}
            {(c.cronJobs ?? []).map((j) => (
              <li key={j}>
                pg_cron {j}{" "}
                <span className="text-ink-3">
                  {view.inventory.cronJobs.find((x) => x.name === j)?.schedule}
                </span>
              </li>
            ))}
          </ul>
        </Block>
      )}

      {c.sources.length > 0 && (
        <Block title="Source">
          <ul className="space-y-1 text-caption">
            {c.sources.map((s) => (
              <li key={s}>
                <a
                  href={sourceUrl(reg.repository, s)}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1 break-all font-mono text-accent-fg underline-offset-4 hover:underline"
                >
                  {s}
                  <ExternalLink size={12} aria-hidden="true" className="shrink-0" />
                </a>
              </li>
            ))}
          </ul>
        </Block>
      )}
    </article>
  );
}

function EdgeList({
  title,
  edges,
  other,
  name,
  repo,
  onSelect,
}: {
  title: string;
  edges: readonly SystemEdge[];
  other: (e: SystemEdge) => string;
  name: (id: string) => string;
  repo: string;
  onSelect: (id: string, focus?: boolean) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  if (!edges.length) return null;
  return (
    <Block title={title}>
      <ul className="space-y-1">
        {edges.map((e) => {
          const id = edgeId(e);
          return (
            <li key={id} className="rounded-[10px] border border-transparent hover:border-hairline">
              <div className="flex items-center gap-2 px-1 py-1">
                <KindLine kind={e.kind} />
                <button
                  type="button"
                  onClick={() => onSelect(other(e), true)}
                  className="min-w-0 flex-1 truncate text-left text-small font-medium text-ink hover:underline"
                >
                  {name(other(e))}
                </button>
                <button
                  type="button"
                  aria-expanded={open === id}
                  onClick={() => setOpen(open === id ? null : id)}
                  className="shrink-0 rounded-full px-2 py-0.5 text-caption text-ink-2 ring-1 ring-ink-3/40 hover:bg-raised"
                >
                  {e.kind === "planned" ? "planned" : "evidence"}
                </button>
              </div>
              <p className="px-1 pb-1 pl-8 text-caption text-ink-2">
                {EDGE_KIND_LABEL[e.kind]}
                {e.label ? ` · ${e.label}` : ""}
              </p>
              {open === id && (
                <div className="mx-1 mb-2 rounded-[10px] bg-raised p-2 text-caption">
                  {e.evidence.length === 0 ? (
                    <p className="text-ink-2">A proposed relation: no code yet.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {e.evidence.map((ev) => (
                        <li key={ev.path + ev.contains}>
                          <a
                            href={sourceUrl(repo, ev.path)}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="break-all font-mono text-accent-fg underline-offset-4 hover:underline"
                          >
                            {ev.path}
                          </a>
                          <code className="mt-0.5 block break-all text-ink">{ev.contains}</code>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Block>
  );
}

export function KindLine({ kind }: { kind: SystemEdge["kind"] }) {
  return (
    <svg width="22" height="8" aria-hidden="true" className="shrink-0">
      <line
        x1="1"
        y1="4"
        x2="21"
        y2="4"
        style={{ stroke: KIND_COLOR(kind), strokeWidth: 2.2, strokeDasharray: kindDash(kind) }}
      />
    </svg>
  );
}

export function StatusPill({ status }: { status: SystemComponent["status"] }) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-caption font-medium normal-case tracking-normal",
        status === "implemented" && "bg-ready-bg text-ready-ink",
        status === "gated" && "bg-peak-bg text-peak-ink",
        status === "unverified" && "bg-fading-bg text-fading-ink",
        status === "planned" && "bg-raised text-ink-2",
      )}
    >
      {COMPONENT_STATUS_LABEL[status]}
    </span>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-caption font-semibold uppercase tracking-[0.1em] text-ink-3">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Chip({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full bg-raised px-2.5 py-1 text-caption text-ink hover:ring-1 hover:ring-ink-3"
    >
      {children}
    </button>
  );
}

function IconButton({
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
      onClick={onClick}
      className="grid h-8 w-8 place-items-center rounded-full text-ink-2 hover:bg-raised hover:text-ink"
    >
      {children}
    </button>
  );
}
