import "server-only";
import { DomainError, type LearningMode } from "@cellr/domain";
import type { Db } from "@/server/db/clients";
import { isMissingTable, mapDbError, missingColumn } from "@/server/db/errors";

export interface ContributionView {
  /** Whether catalogue learning is switched on, and how (the owner decides). */
  mode: LearningMode;
  /** This person's own choice; null = none made yet. */
  contribute: boolean | null;
  /** Whether this person's confirmed wines count now. */
  active: boolean;
}

/**
 * A person's choice about helping the shared wine catalogue with the wines they confirm. Read and written as the
 * person (their own profile row); the mode is the owner's switch. Before the step exists, learning is simply off.
 */
export function createContributionService(db: Db, userId: string) {
  const view = (mode: LearningMode, contribute: boolean | null): ContributionView => ({
    mode,
    contribute,
    active:
      mode === "opt_out" ? contribute !== false : mode === "opt_in" ? contribute === true : false,
  });

  async function mode(): Promise<LearningMode> {
    const { data, error } = await db.from("catalog_learning").select("mode").maybeSingle();
    if (error && (isMissingTable(error) || missingColumn(error))) return "off";
    if (error) throw mapDbError(error);
    return (data?.mode as LearningMode | undefined) ?? "off";
  }

  async function choice(): Promise<boolean | null> {
    const { data, error } = await db
      .from("profiles")
      .select("catalog_contribute")
      .eq("id", userId)
      .maybeSingle();
    if (error && missingColumn(error)) return null;
    if (error) throw mapDbError(error);
    return data?.catalog_contribute ?? null;
  }

  return {
    async get(): Promise<ContributionView> {
      const [m, c] = await Promise.all([mode(), choice()]);
      return view(m, c);
    },

    async set(contribute: boolean): Promise<ContributionView> {
      const { error } = await db
        .from("profiles")
        .update({ catalog_contribute: contribute })
        .eq("id", userId);
      if (error && missingColumn(error))
        throw new DomainError("CONFLICT", "This setting is not available yet.");
      if (error) throw mapDbError(error);
      return view(await mode(), contribute);
    },
  };
}

export type ContributionService = ReturnType<typeof createContributionService>;
