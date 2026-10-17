import "server-only";
import type { BottleExtras, BottleExtrasView, InsightOutput, Reminder } from "@cellr/domain";

export interface InsightRow {
  output: InsightOutput | null;
  model: string | null;
  generatedAt: string | null;
  myValueCents: number | null;
}

/** Every method returns null when the database step for this feature has not been taken yet. */
export interface InsightsRepository {
  getInsight(householdId: string, vintageId: string): Promise<{ row: InsightRow | null } | null>;
  saveInsight(
    householdId: string,
    vintageId: string,
    insight: { output: InsightOutput; model: string; generatedAt: string },
  ): Promise<boolean>;
  saveMyValue(householdId: string, vintageId: string, cents: number | null): Promise<boolean>;

  /** What one bottle of each vintage is worth now, where the household or the AI said so (null = not switched on). */
  listValues(householdId: string): Promise<Array<{ vintageId: string; valueCents: number }> | null>;

  /** The AI's drinking window per vintage, where it was confident enough (null = not switched on). */
  listWindows(
    householdId: string,
  ): Promise<Array<{ vintageId: string; from: number; until: number }> | null>;

  /** Bottles in the cellar that are kept for an occasion (any day), for "this one is reserved" notes. */
  reservedBottles(householdId: string): Promise<Array<{
    bottleId: string;
    vintageId: string;
    title: string;
    on: string | null;
  }> | null>;

  listExtras(bottleIds: readonly string[]): Promise<BottleExtrasView[] | null>;
  /** All-empty extras remove the row. */
  saveExtras(householdId: string, bottleId: string, extras: BottleExtras): Promise<boolean>;

  /** Bottles still in the cellar that are kept for a day between `from` and `to` (inclusive), soonest first. */
  reminders(
    householdId: string,
    from: string,
    to: string,
  ): Promise<Omit<Reminder, "daysUntil">[] | null>;
}
