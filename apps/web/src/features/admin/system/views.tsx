"use client";

import {
  EDGE_KIND_LABEL,
  RISK_SEVERITIES,
  SYSTEM_LAYERS,
  SYSTEM_LAYER_LABEL,
  edgeId,
  type ArchitectureView,
  type GraphIndex,
  type SystemComponent,
} from "@cellr/domain";
import { useMemo, useState } from "react";
import { cn } from "@/ui/cn";
import { KindLine, StatusPill } from "./detail-panel";
import { LAYER_COLOR, SEVERITY_COLOR } from "./system-map";

/** The register's other views: a sortable table, the flows, the data, the review and the checks. */
interface ViewProps {
  view: ArchitectureView;
  index: GraphIndex;
  /** Components the search matches; null for no search. */
  matches: ReadonlySet<string> | null;
  onOpen: (id: string) => void;
}

type SortKey = "name" | "layer" | "status" | "in" | "out" | "risks";

export function RegisterView({ view, index, matches, onOpen }: ViewProps) {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "layer", desc: false });
  const rows = useMemo(() => {
    const order = new Map(view.registry.components.map((c, i) => [c.id, i]));
    const value = (c: SystemComponent): string | number => {
      switch (sort.key) {
        case "name":
          return c.name.toLowerCase();
        case "layer":
          return SYSTEM_LAYERS.indexOf(c.layer) * 1000 + order.get(c.id)!;
        case "status":
          return c.status;
        case "in":
          return index.in.get(c.id)?.length ?? 0;
        case "out":
          return index.out.get(c.id)?.length ?? 0;
        case "risks":
          return c.risks?.length ?? 0;
      }
    };
    return view.registry.components
      .filter((c) => !matches || matches.has(c.id))
      .sort((a, b) => {
        const x = value(a);
        const y = value(b);
        const cmp = x < y ? -1 : x > y ? 1 : 0;
        return sort.desc ? -cmp : cmp;
      });
  }, [view, index, matches, sort]);

  const th = (k: SortKey, children: string, className?: string) => (
    <th
      key={k}
      scope="col"
      aria-sort={sort.key === k ? (sort.desc ? "descending" : "ascending") : "none"}
      className={cn("px-3 py-2 text-left font-semibold", className)}
    >
      <button
        type="button"
        onClick={() => setSort((s) => ({ key: k, desc: s.key === k ? !s.desc : false }))}
        className="hover:text-ink"
      >
        {children}
        {sort.key === k ? (sort.desc ? " ↓" : " ↑") : ""}
      </button>
    </th>
  );

  return (
    <div className="overflow-x-auto rounded-[18px] border border-hairline bg-surface">
      <table className="w-full min-w-[760px] text-small" data-testid="register-table">
        <caption className="sr-only">Component register, {rows.length} components</caption>
        <thead className="border-b border-hairline text-caption uppercase tracking-[0.06em] text-ink-2">
          <tr>
            {th("name", "Component")}
            {th("layer", "Layer")}
            {th("status", "Status")}
            {th("out", "Uses", "text-right")}
            {th("in", "Used by", "text-right")}
            {th("risks", "Risks", "text-right")}
            <th scope="col" className="px-3 py-2 text-left font-semibold">
              Owns
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id} className="border-b border-hairline last:border-0 hover:bg-raised/60">
              <td className="px-3 py-2">
                <button
                  type="button"
                  onClick={() => onOpen(c.id)}
                  className="text-left font-medium text-accent-fg underline-offset-4 hover:underline"
                >
                  {c.name}
                </button>
                <p className="text-caption text-ink-2">{c.summary}</p>
              </td>
              <td className="whitespace-nowrap px-3 py-2" style={{ color: LAYER_COLOR(c.layer) }}>
                {SYSTEM_LAYER_LABEL[c.layer]}
              </td>
              <td className="whitespace-nowrap px-3 py-2">
                <StatusPill status={c.status} />
              </td>
              <td className="px-3 py-2 text-right tnum">{index.out.get(c.id)?.length ?? 0}</td>
              <td className="px-3 py-2 text-right tnum">{index.in.get(c.id)?.length ?? 0}</td>
              <td className="px-3 py-2 text-right tnum">{c.risks?.length ?? 0}</td>
              <td className="px-3 py-2 text-caption text-ink-2">
                {[
                  c.tables?.length ? `${c.tables.length} tables` : null,
                  c.routes?.length ? `${c.routes.length} routes` : null,
                  c.buckets?.length ? `${c.buckets.length} buckets` : null,
                  c.cronJobs?.length ? `${c.cronJobs.length} jobs` : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const FLOW_TONE = {
  proven: "bg-ready-bg text-ready-ink",
  partial: "bg-peak-bg text-peak-ink",
  planned: "bg-raised text-ink-2",
} as const;

export function FlowsView({
  view,
  onShow,
}: {
  view: ArchitectureView;
  onShow: (flowId: string) => void;
}) {
  const byId = new Map(view.registry.components.map((c) => [c.id, c]));
  const edges = new Map(view.registry.edges.map((e) => [edgeId(e), e]));
  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-small text-ink-2">
        Named paths through the map. “Proven” means every step is a confirmed edge in the code; it
        does not mean the loop is observed working in production. None of these is a self-training
        model.
      </p>
      <ul className="grid grid-cols-1 gap-4 xl:grid-cols-2" data-testid="flows">
        {view.registry.flows.map((f) => (
          <li key={f.id} className="rounded-[18px] border border-hairline bg-surface p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h3 className="text-body font-semibold text-ink">{f.name}</h3>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-caption font-medium",
                  FLOW_TONE[f.status],
                )}
              >
                {f.status}
              </span>
            </div>
            <p className="mt-1 text-small text-ink-2">{f.summary}</p>
            <ol className="mt-3 space-y-1">
              {f.steps.map((s, i) => {
                const e = edges.get(s)!;
                return (
                  <li key={s} className="flex items-center gap-2 text-caption text-ink-2">
                    <span className="w-4 text-right tnum text-ink-3">{i + 1}</span>
                    <KindLine kind={e.kind} />
                    <span>
                      <span className="text-ink">{byId.get(e.from)?.name}</span> →{" "}
                      {byId.get(e.to)?.name}
                      <span className="text-ink-3"> · {EDGE_KIND_LABEL[e.kind].toLowerCase()}</span>
                    </span>
                  </li>
                );
              })}
            </ol>
            {f.gap && (
              <p className="mt-3 rounded-[12px] bg-raised p-3 text-caption text-ink">
                <span className="font-semibold">What is missing: </span>
                {f.gap}
              </p>
            )}
            <button
              type="button"
              onClick={() => onShow(f.id)}
              className="mt-3 rounded-full px-3 py-1.5 text-caption font-medium text-ink ring-1 ring-ink-3/60 hover:bg-raised"
            >
              Show on the map
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DataView({ view, matches, onOpen }: ViewProps) {
  const inv = view.inventory;
  const groups = view.registry.components.filter((c) => c.layer === "data");
  const refs = new Map(inv.tables.map((t) => [t.name, t.references]));
  const owner = new Map(groups.flatMap((g) => (g.tables ?? []).map((t) => [t, g.id] as const)));
  // a bucket is "used by code" when an edge's evidence names it
  const evidence = view.registry.edges
    .flatMap((e) => e.evidence.map((ev) => ev.contains))
    .join("\n");
  const fkCount = inv.tables.reduce((n, t) => n + t.references.length, 0);
  return (
    <div className="space-y-6">
      <Facts
        items={[
          ["Tables", inv.tables.length],
          ["Foreign-key links", fkCount],
          ["Functions (RPC)", inv.functions.length],
          ["Migrations", inv.migrations.count],
          ["Storage buckets", inv.buckets.length],
          ["pg_cron jobs", inv.cronJobs.length],
        ]}
      />
      <p className="text-caption text-ink-2">
        From the repository (generated types and migrations), latest migration{" "}
        <code className="text-ink">{inv.migrations.latest}</code>. Row-level security is on for
        every table by the migrations; production row counts are not read here.
      </p>
      <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2" data-testid="data-groups">
        {groups
          .filter((g) => !matches || matches.has(g.id))
          .map((g) => (
            <li key={g.id} className="rounded-[18px] border border-hairline bg-surface p-4">
              <div className="flex items-start justify-between gap-2">
                <button
                  type="button"
                  onClick={() => onOpen(g.id)}
                  className="text-left text-body font-semibold text-accent-fg underline-offset-4 hover:underline"
                >
                  {g.name}
                </button>
                <span className="text-caption text-ink-3 tnum">{g.tables?.length ?? 0} tables</span>
              </div>
              <p className="text-caption text-ink-2">{g.summary}</p>
              <ul className="mt-3 space-y-1 font-mono text-caption">
                {(g.tables ?? []).map((t) => (
                  <li key={t} className="text-ink">
                    {t}
                    {(refs.get(t) ?? []).length > 0 && (
                      <span className="text-ink-3">
                        {" → "}
                        {(refs.get(t) ?? [])
                          .map((r) => (owner.get(r) === g.id ? r : `${r}*`))
                          .join(", ")}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          ))}
      </ul>
      <p className="text-caption text-ink-3">* a table in another group.</p>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="rounded-[18px] border border-hairline bg-surface p-4">
          <h3 className="text-body font-semibold text-ink">Storage buckets</h3>
          <ul className="mt-2 space-y-1 text-caption" data-testid="buckets">
            {inv.buckets.map((b) => {
              const used = evidence.includes(`"${b}"`);
              return (
                <li key={b} className="flex items-center justify-between gap-2">
                  <code className="text-ink">{b}</code>
                  <span className={used ? "text-ink-2" : "font-medium text-danger"}>
                    {used ? "used by code" : "no code reference"}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
        <section className="rounded-[18px] border border-hairline bg-surface p-4">
          <h3 className="text-body font-semibold text-ink">Scheduled jobs</h3>
          <ul className="mt-2 space-y-1 text-caption">
            {inv.cronJobs.map((j) => (
              <li key={j.name} className="flex justify-between gap-2">
                <code className="text-ink">pg_cron · {j.name}</code>
                <span className="text-ink-2 tnum">{j.schedule}</span>
              </li>
            ))}
            {inv.vercelCrons.map((j) => (
              <li key={j.path} className="flex justify-between gap-2">
                <code className="text-ink">Vercel · {j.path}</code>
                <span className="text-ink-2 tnum">{j.schedule}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

export function ReviewView({ view, matches, onOpen }: ViewProps) {
  const risks = view.registry.components
    .filter((c) => !matches || matches.has(c.id))
    .flatMap((c) => (c.risks ?? []).map((r) => ({ ...r, component: c })));
  return (
    <div className="space-y-6" data-testid="review">
      <Facts
        items={RISK_SEVERITIES.map((s) => [
          `${s} risks`,
          risks.filter((r) => r.severity === s).length,
        ])}
      />
      {RISK_SEVERITIES.map((s) => {
        const list = risks.filter((r) => r.severity === s);
        if (!list.length) return null;
        return (
          <section key={s}>
            <h3 className="mb-2 flex items-center gap-2 text-caption font-semibold uppercase tracking-[0.1em] text-ink-2">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ background: SEVERITY_COLOR[s] }}
                aria-hidden="true"
              />
              {s} ({list.length})
            </h3>
            <ul className="space-y-2">
              {list.map((r) => (
                <li key={r.id} className="rounded-[14px] border border-hairline bg-surface p-3">
                  <p className="text-small font-medium text-ink">{r.title}</p>
                  <p className="mt-1 text-caption text-ink-2">{r.detail}</p>
                  <p className="mt-2 text-caption text-ink-3">
                    {r.id} ·{" "}
                    <button
                      type="button"
                      onClick={() => onOpen(r.component.id)}
                      className="font-medium text-accent-fg underline-offset-4 hover:underline"
                    >
                      {r.component.name}
                    </button>
                  </p>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      <section className="rounded-[18px] border border-hairline bg-surface p-4 text-small">
        <h3 className="text-body font-semibold text-ink">What this page can and cannot say</h3>
        <dl className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <dt className="font-semibold text-ink">Checked against the code</dt>
            <dd className="text-ink-2">
              Components, source files, every edge’s evidence, the ownership of tables, buckets,
              jobs, routes and server modules (in CI, on every change).
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-ink">Not knowable here</dt>
            <dd className="text-ink-2">
              Which switches are on in a deployment, hosting settings, whether backups restore,
              production row counts and real usage.
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-ink">Next</dt>
            <dd className="text-ink-2">
              Sprint 2 measures health per component; sprint 3 turns it into incidents with impact
              from this graph.
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}

const CI_CHECKS = [
  "The committed inventory equals what the repository says now (tables, functions, migrations, buckets, jobs, routes, modules, CI jobs, switches)",
  "The register validates without errors or warnings",
  "Every source path exists",
  "Every confirmed edge's evidence text is found in its file",
  "Every table, bucket, pg_cron job and route has exactly one owner",
  "Every server module belongs to a component",
  "Every feature and env switch named is real",
  "No secret, e-mail address or user id in the register",
  "Only the admin service reaches the register; it is server-only",
];

export function ChecksView({ view }: { view: ArchitectureView }) {
  const errors = view.issues.filter((i) => i.level === "error");
  const warnings = view.issues.filter((i) => i.level === "warning");
  const evidence = view.registry.edges.reduce((n, e) => n + e.evidence.length, 0);
  const confirmed = view.registry.edges.filter((e) => e.kind !== "planned").length;
  const inv = view.inventory;
  return (
    <div className="space-y-6" data-testid="checks">
      <div
        className={cn(
          "rounded-[18px] border p-4",
          errors.length ? "border-danger/60 bg-danger/10" : "border-hairline bg-surface",
        )}
        role="status"
      >
        <p className="text-body font-semibold text-ink">
          {errors.length === 0 && warnings.length === 0
            ? "The register is consistent with the repository inventory."
            : `${errors.length} errors, ${warnings.length} warnings`}
        </p>
        <p className="mt-1 text-caption text-ink-2">
          Validated when this page was rendered, against the inventory generated at build time.
          Register v{view.registry.version}, reviewed against the code on {view.registry.reviewedOn}
          .
        </p>
        {view.issues.length > 0 && (
          <ul className="mt-3 space-y-1 text-caption">
            {view.issues.map((i, n) => (
              <li key={n} className={i.level === "error" ? "text-danger" : "text-ink-2"}>
                <span className="font-semibold uppercase">{i.level}</span> · {i.code} · {i.ref}:{" "}
                {i.message}
              </li>
            ))}
          </ul>
        )}
      </div>
      <Facts
        items={[
          ["Components", view.registry.components.length],
          ["Confirmed edges", confirmed],
          ["Evidence references", evidence],
          ["Planned edges", view.registry.edges.length - confirmed],
          ["Route handlers", inv.apiRoutes.length],
          ["Server modules", inv.serverModules.length],
          ["CI jobs", inv.ciJobs.length],
          ["Feature switches", inv.features.length],
        ]}
      />
      <section className="rounded-[18px] border border-hairline bg-surface p-4">
        <h3 className="text-body font-semibold text-ink">Checked in CI on every change</h3>
        <p className="mt-1 text-caption text-ink-2">
          <code>apps/web/src/server/system/registry.test.ts</code>, part of <code>pnpm test</code>.
          A red check means the map would claim something the code does not prove, or the code has
          something the map does not show.
        </p>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-small text-ink">
          {CI_CHECKS.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Facts({ items }: { items: ReadonlyArray<readonly [string, number]> }) {
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-[14px] border border-hairline bg-surface px-4 py-3">
          <dt className="text-caption capitalize text-ink-2">{label}</dt>
          <dd className="font-display text-headline text-ink tnum">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
