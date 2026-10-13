import "server-only";
import { buildStats, type StatsView } from "@cellr/domain";
import type { ActiveHousehold, InventoryRow, OpenedRow } from "@/server/cellar/types";

export interface StatsDeps {
  household: () => Promise<ActiveHousehold>;
  rows: (householdId: string) => Promise<InventoryRow[]>;
  opened: (householdId: string) => Promise<OpenedRow[]>;
  scores: (householdId: string) => Promise<Array<{ vintageId: string; score: number }>>;
  values: (householdId: string) => Promise<Array<{ vintageId: string; valueCents: number }>>;
  now?: () => Date;
}

/** The cellar in numbers: worked out from what the household already keeps, as the person asking sees it. */
export function createStatsService(deps: StatsDeps) {
  return {
    async overview(): Promise<StatsView> {
      const { id, currency } = await deps.household();
      const [rows, opened, scores, values] = await Promise.all([
        deps.rows(id),
        deps.opened(id),
        deps.scores(id),
        deps.values(id),
      ]);
      return buildStats({
        bottles: rows,
        opened,
        scores,
        values,
        currency: rows.find((r) => r.currency)?.currency ?? currency,
        now: (deps.now ?? (() => new Date()))(),
      });
    },
  };
}

export type StatsService = ReturnType<typeof createStatsService>;
