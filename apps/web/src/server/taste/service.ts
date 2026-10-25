import "server-only";
import {
  buildTasteProfile,
  DomainError,
  NO_PREFERENCES,
  type InsightOutput,
  type SaveTastePreferences,
  type TasteProfileView,
  type TasteTasting,
  tasteExampleVintageIds,
  withExampleAvailability,
} from "@cellr/domain";
import type { ActiveHousehold } from "@/server/cellar/types";
import type { TasteRepository, TasteRow } from "./types";

/** An AI profile counts for structure only when it is not a bare style estimate and not low confidence. */
const reliable = (o: InsightOutput) => o.evidence !== "style_estimate" && o.confidence !== "low";
/** And for grapes only when it rests on this exact wine or on the appellation's own rules. */
const grapesTrusted = (o: InsightOutput) =>
  o.evidence === "exact_wine" || o.evidence === "appellation_rules";

export function toTasteTastings(
  rows: readonly TasteRow[],
  insights: ReadonlyMap<string, InsightOutput>,
): TasteTasting[] {
  return rows.map((r) => {
    const o = insights.get(r.vintageId);
    const grapes =
      r.curatedGrapes.length > 0 ? r.curatedGrapes : o && grapesTrusted(o) ? o.grapes : [];
    return {
      wineId: r.wineId,
      vintageId: r.vintageId,
      producer: r.producer,
      wineName: r.wineName,
      year: r.year,
      type: r.type,
      region: r.region,
      appellation: r.appellation,
      score: r.score,
      grapes,
      structure: o && reliable(o) && o.structure ? o.structure : null,
    };
  });
}

export function createTasteService({
  repo,
  userId,
  household,
}: {
  repo: TasteRepository;
  userId: string;
  household: () => Promise<ActiveHousehold>;
}) {
  return {
    /** My taste profile: worked out on the server; only the aggregates (and a few example wines) leave it. */
    async profile(): Promise<TasteProfileView> {
      const { id } = await household();
      const [rows, preferences] = await Promise.all([
        repo.listMyTastings(id, userId),
        repo.getPreferences(userId),
      ]);
      const insights =
        rows && rows.length > 0
          ? await repo.listInsights(
              id,
              rows.map((r) => r.vintageId),
            )
          : new Map();
      const view = buildTasteProfile(
        toTasteTastings(rows ?? [], insights),
        preferences ?? NO_PREFERENCES,
        {
          tastings: rows !== null,
          preferences: preferences !== null,
        },
      );
      // Archived wines still count above; only the few example wines are checked, in one bounded lookup, so
      // none of them links to a page that no longer opens.
      const examples = tasteExampleVintageIds(view);
      return withExampleAvailability(
        view,
        examples.length > 0 ? await repo.listAvailableVintages(id, examples) : new Set(),
      );
    },

    /** Saves my own answers (only mine: the row is keyed by my id and RLS checks it). */
    async savePreferences(input: SaveTastePreferences): Promise<TasteProfileView> {
      if (!(await repo.savePreferences(userId, input)))
        throw new DomainError("INTERNAL", "Taste preferences need one more database step first.");
      return this.profile();
    },
  };
}
