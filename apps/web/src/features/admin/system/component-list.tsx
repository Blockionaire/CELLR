"use client";

import { ChevronRight } from "lucide-react";
import {
  HEALTH_STATUS_LABEL,
  SYSTEM_LAYERS,
  SYSTEM_LAYER_LABEL,
  type GraphIndex,
  type HealthStatus,
  type SystemComponent,
} from "@cellr/domain";
import { StatusPill } from "./detail-panel";
import { HEALTH_COLOR, HEALTH_GLYPH } from "./health-model";
import { LAYER_COLOR, SEVERITY_COLOR, worstRisk } from "./system-map";

/**
 * The Map view on a phone: every component as a list, grouped by layer in the map's own order, searchable with the
 * same search as the map and narrowed by the same layer and status filters. Each row says what the component is
 * (its summary), whether it is built (status), what was measured (only when health is on and the component has a
 * check), and how connected it is; a tap opens its details. The drawing itself is one tap away (map mode).
 */
export function ComponentList({
  components,
  index,
  visible,
  matches,
  health,
  selected,
  onOpen,
}: {
  components: readonly SystemComponent[];
  index: GraphIndex;
  /** Components the filters let through. */
  visible: ReadonlySet<string>;
  /** Search matches; null without a search. */
  matches: ReadonlySet<string> | null;
  /** Health per component when the overlay is on; null otherwise. */
  health: ReadonlyMap<string, HealthStatus | null> | null;
  selected: string | null;
  onOpen: (id: string) => void;
}) {
  const shown = components.filter((c) => visible.has(c.id) && (!matches || matches.has(c.id)));
  if (!shown.length)
    return (
      <p
        className="rounded-[14px] border border-dashed border-hairline p-6 text-small text-ink-2"
        data-testid="component-list-empty"
      >
        No component matches this search and these filters.
      </p>
    );
  return (
    <div className="space-y-5" data-testid="component-list">
      {SYSTEM_LAYERS.map((layer) => {
        const items = shown.filter((c) => c.layer === layer);
        if (!items.length) return null;
        return (
          <section key={layer} aria-labelledby={`layer-${layer}`}>
            <h3
              id={`layer-${layer}`}
              className="mb-2 flex items-center gap-2 px-1 text-caption font-semibold uppercase tracking-[0.08em] text-ink-2"
            >
              <span
                aria-hidden="true"
                className="size-2.5 rounded-full"
                style={{ background: LAYER_COLOR(layer) }}
              />
              {SYSTEM_LAYER_LABEL[layer]}
              <span className="font-normal normal-case tracking-normal text-ink-3">
                {items.length}
              </span>
            </h3>
            <ul className="overflow-hidden rounded-[14px] border border-hairline bg-surface">
              {items.map((c) => {
                const uses = index.out.get(c.id)?.length ?? 0;
                const usedBy = index.in.get(c.id)?.length ?? 0;
                const status = health?.get(c.id) ?? null;
                const risk = worstRisk(c.risks);
                return (
                  <li key={c.id} className="border-b border-hairline last:border-0">
                    <button
                      type="button"
                      onClick={() => onOpen(c.id)}
                      aria-current={selected === c.id ? "true" : undefined}
                      data-component-row={c.id}
                      className="flex w-full items-start gap-3 px-3.5 py-3 text-left transition-colors hover:bg-raised aria-[current]:bg-raised"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="font-semibold text-ink">{c.name}</span>
                          <StatusPill status={c.status} />
                        </span>
                        <span className="mt-0.5 block text-small text-ink-2">{c.summary}</span>
                        <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-ink-2">
                          <span className="tnum">
                            Uses {uses} · used by {usedBy}
                          </span>
                          {status && (
                            <span className="inline-flex items-center gap-1">
                              <span
                                aria-hidden="true"
                                className="inline-grid size-4 place-items-center rounded-full text-[10px] font-bold leading-none text-surface"
                                style={{ background: HEALTH_COLOR[status] }}
                              >
                                {HEALTH_GLYPH[status]}
                              </span>
                              {HEALTH_STATUS_LABEL[status]}
                            </span>
                          )}
                          {risk && (
                            <span className="inline-flex items-center gap-1">
                              <span
                                aria-hidden="true"
                                className="size-2 rounded-full"
                                style={{ background: SEVERITY_COLOR[risk.severity] }}
                              />
                              {c.risks!.length} {c.risks!.length === 1 ? "risk" : "risks"}
                              {risk.severity === "high" ? " (high)" : ""}
                            </span>
                          )}
                        </span>
                      </span>
                      <ChevronRight
                        size={18}
                        aria-hidden="true"
                        className="mt-1 shrink-0 text-ink-3"
                      />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
