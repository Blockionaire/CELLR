import "server-only";
import {
  InsightOutputSchema,
  type InsightOutput,
  type ValuationSource,
  type AcquiredHow,
  type BottleExtras,
  type BottleExtrasView,
} from "@cellr/domain";
import type { Db } from "@/server/db/clients";
import { isMissingTable, mapDbError } from "@/server/db/errors";
import { allRows } from "@/server/db/paging";
import type { InsightRow, InsightsRepository } from "./types";

const isEmpty = (e: BottleExtras) =>
  e.acquiredHow === null &&
  e.giftFrom === null &&
  e.occasionTitle === null &&
  e.occasionOn === null;

/** Sources as stored (a JSON list), read defensively: only well-formed https pages. */
function readSources(value: unknown): ValuationSource[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((s: unknown) => {
    const o = s as { name?: unknown; url?: unknown };
    return typeof o?.name === "string" && typeof o.url === "string" && o.url.startsWith("https://")
      ? [{ name: o.name, url: o.url }]
      : [];
  });
}

export function createInsightsRepository(db: Db): InsightsRepository {
  /**
   * Update the row if there is one, else insert it. (A one-statement upsert would also "update" the key
   * columns, which clients are deliberately not allowed to change.)
   */
  async function saveInsightRow(
    householdId: string,
    vintageId: string,
    values: {
      output?: InsightOutput;
      model?: string;
      generated_at?: string;
      my_value_cents?: number | null;
    },
  ): Promise<boolean> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const updated = await db
        .from("vintage_insights")
        .update(values)
        .eq("household_id", householdId)
        .eq("vintage_id", vintageId)
        .select("id");
      if (updated.error && isMissingTable(updated.error)) return false;
      if (updated.error) throw mapDbError(updated.error);
      if (updated.data.length > 0) return true;
      const inserted = await db
        .from("vintage_insights")
        .insert({ household_id: householdId, vintage_id: vintageId, ...values });
      if (!inserted.error) return true;
      if (isMissingTable(inserted.error)) return false;
      // Someone saved the same row a moment ago: go round again and update theirs.
      if (inserted.error.code !== "23505") throw mapDbError(inserted.error);
    }
    throw new Error("could not save the insight");
  }

  async function allValuations(householdId: string) {
    const { data, error } = await allRows((a, b) =>
      db
        .from("vintage_valuations")
        .select("id, vintage_id, low_cents, high_cents, valued_at")
        .eq("household_id", householdId)
        .order("id")
        .range(a, b),
    );
    if (error && isMissingTable(error)) return null;
    if (error) throw mapDbError(error);
    return data
      .map((r) => ({
        vintageId: r.vintage_id,
        cents: Math.round((r.low_cents + r.high_cents) / 2),
        valuedAt: r.valued_at,
      }))
      .sort((x, y) => x.valuedAt.localeCompare(y.valuedAt));
  }

  return {
    async getInsight(householdId, vintageId) {
      const { data, error } = await db
        .from("vintage_insights")
        .select("output, model, generated_at, my_value_cents")
        .eq("household_id", householdId)
        .eq("vintage_id", vintageId)
        .maybeSingle();
      if (error && isMissingTable(error)) return null;
      if (error) throw mapDbError(error);
      if (!data) return { row: null };
      // What is stored was checked on the way in; check again on the way out, so a bad row can never reach a screen.
      const parsed = InsightOutputSchema.safeParse(data.output);
      const row: InsightRow = {
        output: parsed.success ? parsed.data : null,
        model: data.model,
        generatedAt: data.generated_at,
        myValueCents: data.my_value_cents,
      };
      return { row };
    },

    saveInsight: (householdId, vintageId, insight) =>
      saveInsightRow(householdId, vintageId, {
        output: insight.output,
        model: insight.model,
        generated_at: insight.generatedAt,
      }),

    saveMyValue: (householdId, vintageId, cents) =>
      saveInsightRow(householdId, vintageId, { my_value_cents: cents }),

    async listValuations(householdId, vintageId) {
      const { data, error } = await db
        .from("vintage_valuations")
        .select("low_cents, high_cents, currency, basis, sources, valued_at")
        .eq("household_id", householdId)
        .eq("vintage_id", vintageId)
        .order("valued_at")
        .limit(240);
      if (error && isMissingTable(error)) return null;
      if (error) throw mapDbError(error);
      return data.map((r) => ({
        lowCents: r.low_cents,
        highCents: r.high_cents,
        currency: r.currency,
        basis: r.basis,
        sources: readSources(r.sources),
        valuedAt: r.valued_at,
      }));
    },

    async addValuation(householdId, vintageId, v, model) {
      const { error } = await db.from("vintage_valuations").insert({
        household_id: householdId,
        vintage_id: vintageId,
        low_cents: v.lowCents,
        high_cents: v.highCents,
        currency: v.currency,
        basis: v.basis,
        sources: v.sources.map((s) => ({ name: s.name, url: s.url })),
        model,
      });
      if (error && isMissingTable(error)) return false;
      if (error) throw mapDbError(error);
      return true;
    },

    allValuations,

    async listOwnValues(householdId) {
      const { data, error } = await allRows((a, b) =>
        db
          .from("vintage_insights")
          .select("vintage_id, my_value_cents")
          .eq("household_id", householdId)
          .not("my_value_cents", "is", null)
          .order("vintage_id")
          .range(a, b),
      );
      if (error && isMissingTable(error)) return null;
      if (error) throw mapDbError(error);
      return new Map(data.map((r) => [r.vintage_id, r.my_value_cents!]));
    },

    async listValues(householdId) {
      const { data, error } = await allRows((a, b) =>
        db
          .from("vintage_insights")
          .select("vintage_id, my_value_cents, output")
          .eq("household_id", householdId)
          .order("vintage_id")
          .range(a, b),
      );
      if (error && isMissingTable(error)) return null;
      if (error) throw mapDbError(error);
      // The latest looked-up value per vintage (when value history is switched on).
      const latest = new Map<string, number>();
      for (const v of (await allValuations(householdId)) ?? []) latest.set(v.vintageId, v.cents);
      const out = new Map<string, number>(latest);
      for (const r of data) {
        if (r.my_value_cents !== null) {
          out.set(r.vintage_id, r.my_value_cents);
          continue;
        }
        if (out.has(r.vintage_id)) continue;
        const parsed = InsightOutputSchema.safeParse(r.output);
        const value = parsed.success ? parsed.data.value : null;
        if (value) out.set(r.vintage_id, Math.round((value.lowCents + value.highCents) / 2));
      }
      return [...out].map(([vintageId, valueCents]) => ({ vintageId, valueCents }));
    },

    async listWindows(householdId) {
      const { data, error } = await allRows((a, b) =>
        db
          .from("vintage_insights")
          .select("vintage_id, output")
          .eq("household_id", householdId)
          .order("vintage_id")
          .range(a, b),
      );
      if (error && isMissingTable(error)) return null;
      if (error) throw mapDbError(error);
      return data.flatMap((r) => {
        const parsed = InsightOutputSchema.safeParse(r.output);
        const w = parsed.success ? parsed.data.drinkWindow : null;
        // A guess the AI itself is unsure about is worse than the style table.
        return w && parsed.success && parsed.data.confidence !== "low"
          ? [{ vintageId: r.vintage_id, from: w.from, until: w.until }]
          : [];
      });
    },

    async reservedBottles(householdId) {
      const { data, error } = await allRows((a, b) =>
        db
          .from("bottle_extras")
          .select("bottle_id, occasion_title, occasion_on, bottles!inner(status, vintage_id)")
          .eq("household_id", householdId)
          .eq("bottles.status", "in_cellar")
          .not("occasion_title", "is", null)
          .order("bottle_id")
          .range(a, b),
      );
      if (error && isMissingTable(error)) return null;
      if (error) throw mapDbError(error);
      return data.flatMap((r) =>
        r.occasion_title
          ? [
              {
                bottleId: r.bottle_id,
                vintageId: r.bottles.vintage_id,
                title: r.occasion_title,
                on: r.occasion_on,
              },
            ]
          : [],
      );
    },

    async listExtras(bottleIds) {
      if (bottleIds.length === 0) return [];
      const { data, error } = await db
        .from("bottle_extras")
        .select("bottle_id, acquired_how, gift_from, occasion_title, occasion_on")
        .in("bottle_id", [...bottleIds]);
      if (error && isMissingTable(error)) return null;
      if (error) throw mapDbError(error);
      return data.map((r): BottleExtrasView => ({
        bottleId: r.bottle_id,
        acquiredHow: r.acquired_how as AcquiredHow | null,
        giftFrom: r.gift_from,
        occasionTitle: r.occasion_title,
        occasionOn: r.occasion_on,
      }));
    },

    async saveExtras(householdId, bottleId, extras) {
      if (isEmpty(extras)) {
        const { error } = await db.from("bottle_extras").delete().eq("bottle_id", bottleId);
        if (error && isMissingTable(error)) return false;
        if (error) throw mapDbError(error);
        return true;
      }
      const values = {
        acquired_how: extras.acquiredHow,
        gift_from: extras.giftFrom,
        occasion_title: extras.occasionTitle,
        occasion_on: extras.occasionOn,
      };
      for (let attempt = 0; attempt < 2; attempt++) {
        const updated = await db
          .from("bottle_extras")
          .update(values)
          .eq("bottle_id", bottleId)
          .select("bottle_id");
        if (updated.error && isMissingTable(updated.error)) return false;
        if (updated.error) throw mapDbError(updated.error);
        if (updated.data.length > 0) return true;
        const inserted = await db
          .from("bottle_extras")
          .insert({ bottle_id: bottleId, household_id: householdId, ...values });
        if (!inserted.error) return true;
        if (isMissingTable(inserted.error)) return false;
        if (inserted.error.code !== "23505") throw mapDbError(inserted.error);
      }
      throw new Error("could not save the bottle's details");
    },

    async reminders(householdId, from, to) {
      const { data, error } = await allRows((a, b) =>
        db
          .from("bottle_extras")
          .select(
            "bottle_id, occasion_title, occasion_on, bottles!inner(status, vintage_id, wine_vintages!inner(year, wines!inner(name, producers!inner(name))))",
          )
          .eq("household_id", householdId)
          .eq("bottles.status", "in_cellar")
          .gte("occasion_on", from)
          .lte("occasion_on", to)
          .order("occasion_on")
          .order("bottle_id")
          .range(a, b),
      );
      if (error && isMissingTable(error)) return null;
      if (error) throw mapDbError(error);
      return data.flatMap((r) =>
        r.occasion_title && r.occasion_on
          ? [
              {
                bottleId: r.bottle_id,
                vintageId: r.bottles.vintage_id,
                producer: r.bottles.wine_vintages.wines.producers.name,
                wineName: r.bottles.wine_vintages.wines.name,
                year: r.bottles.wine_vintages.year,
                title: r.occasion_title,
                on: r.occasion_on,
              },
            ]
          : [],
      );
    },
  };
}
