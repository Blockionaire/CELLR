import "server-only";
import { buildStats, valueOverTime, type BottleSpan, type StatsView } from "@cellr/domain";
import type { ActiveHousehold, InventoryRow, OpenedRow } from "@/server/cellar/types";

export interface StatsDeps {
  household: () => Promise<ActiveHousehold>;
  rows: (householdId: string) => Promise<InventoryRow[]>;
  opened: (householdId: string) => Promise<OpenedRow[]>;
  scores: (householdId: string) => Promise<Array<{ vintageId: string; score: number }>>;
  values: (householdId: string) => Promise<Array<{ vintageId: string; valueCents: number }>>;
  /** For the value over time; absent = not shown. */
  spans?: (householdId: string) => Promise<BottleSpan[]>;
  valuations?: (
    householdId: string,
  ) => Promise<Array<{ vintageId: string; cents: number; valuedAt: string }>>;
  ownValues?: (householdId: string) => Promise<Map<string, number>>;
  now?: () => Date;
}

/** The cellar in numbers: worked out from what the household already keeps, as the person asking sees it. */
export function createStatsService(deps: StatsDeps) {
  return {
    async overview(): Promise<StatsView> {
      const { id, currency } = await deps.household();
      const now = (deps.now ?? (() => new Date()))();
      const [rows, opened, scores, values, spans, points, own] = await Promise.all([
        deps.rows(id),
        deps.opened(id),
        deps.scores(id),
        deps.values(id),
        deps.spans?.(id) ?? [],
        deps.valuations?.(id) ?? [],
        deps.ownValues?.(id) ?? new Map<string, number>(),
      ]);
      const stats = buildStats({
        bottles: rows,
        opened,
        scores,
        values,
        currency: rows.find((r) => r.currency)?.currency ?? currency,
        now,
      });
      return {
        ...stats,
        valueByMonth: valueOverTime({
          spans,
          points,
          own,
          today: new Map(values.map((v) => [v.vintageId, v.valueCents])),
          now,
        }),
      };
    },
  };
}

export type StatsService = ReturnType<typeof createStatsService>;
