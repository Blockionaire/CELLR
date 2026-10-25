import "server-only";
import {
  InsightOutputSchema,
  NO_PREFERENCES,
  type InsightOutput,
  type TastePreferences,
  type WineFocus,
  type WineType,
} from "@cellr/domain";
import type { Db } from "@/server/db/clients";
import { mapDbError } from "@/server/db/errors";
import { allRows } from "@/server/db/paging";
import type { TasteRepository } from "./types";

const missing = (e: { code?: string }) =>
  e.code === "PGRST205" || e.code === "42P01" || e.code === "PGRST200";

export function createTasteRepository(db: Db): TasteRepository {
  return {
    async listMyTastings(householdId, userId) {
      // Only my own tastings in this household (tastings_user_idx); the wine, its curated grapes.
      const { data, error } = await allRows((from, to) =>
        db
          .from("tastings")
          .select(
            "id, score, vintage_id, wine_vintages!inner(year, wines!inner(id, name, wine_type, region, appellation, producers!inner(name), wine_grapes(grapes(name))))",
          )
          .eq("household_id", householdId)
          .eq("user_id", userId)
          .order("id")
          .range(from, to),
      );
      if (error && missing(error)) return null;
      if (error) throw mapDbError(error);
      return data.map((r) => {
        const w = r.wine_vintages.wines;
        return {
          wineId: w.id,
          vintageId: r.vintage_id,
          producer: w.producers.name,
          wineName: w.name,
          year: r.wine_vintages.year,
          type: w.wine_type as WineType,
          region: w.region,
          appellation: w.appellation,
          score: r.score,
          curatedGrapes: (w.wine_grapes ?? []).flatMap((g) =>
            g.grapes?.name ? [g.grapes.name] : [],
          ),
        };
      });
    },

    async listAvailableVintages(householdId, vintageIds) {
      // Same rule as the tasting journal: a wine's page opens while a bottle of it is in the cellar or opened.
      const available = new Set<string>();
      const ids = [...new Set(vintageIds)];
      for (let i = 0; i < ids.length; i += 100) {
        const { data, error } = await db
          .from("bottles")
          .select("vintage_id")
          .eq("household_id", householdId)
          .in("vintage_id", ids.slice(i, i + 100))
          .in("status", ["in_cellar", "opened"]);
        if (error) throw mapDbError(error);
        for (const b of data) available.add(b.vintage_id);
      }
      return available;
    },

    async listInsights(householdId, vintageIds) {
      const out = new Map<string, InsightOutput>();
      const ids = [...new Set(vintageIds)];
      for (let i = 0; i < ids.length; i += 100) {
        const { data, error } = await db
          .from("vintage_insights")
          .select("vintage_id, output")
          .eq("household_id", householdId)
          .in("vintage_id", ids.slice(i, i + 100))
          .not("output", "is", null);
        if (error && missing(error)) return out;
        if (error) throw mapDbError(error);
        for (const r of data) {
          const parsed = InsightOutputSchema.safeParse(r.output);
          if (parsed.success) out.set(r.vintage_id, parsed.data);
        }
      }
      return out;
    },

    async getPreferences(userId): Promise<TastePreferences | null> {
      const { data, error } = await db
        .from("taste_preferences")
        .select("wine_focus, body, tannin, sweetness, acidity, onboarded_at")
        .eq("user_id", userId)
        .maybeSingle();
      if (error && missing(error)) return null;
      if (error) throw mapDbError(error);
      if (!data) return NO_PREFERENCES;
      return {
        wineFocus: data.wine_focus as WineFocus | null,
        body: data.body,
        tannin: data.tannin,
        sweetness: data.sweetness,
        acidity: data.acidity,
        onboarded: data.onboarded_at !== null,
      };
    },

    async savePreferences(userId, input) {
      const { error } = await db.from("taste_preferences").upsert(
        {
          user_id: userId,
          wine_focus: input.wineFocus,
          body: input.body,
          tannin: input.tannin,
          sweetness: input.sweetness,
          acidity: input.acidity,
          ...(input.onboarded ? { onboarded_at: new Date().toISOString() } : {}),
        },
        { onConflict: "user_id" },
      );
      if (error && missing(error)) return false;
      if (error) throw mapDbError(error);
      return true;
    },
  };
}
