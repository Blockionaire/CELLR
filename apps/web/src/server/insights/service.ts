import "server-only";
import {
  checkInsight,
  daysUntil,
  DomainError,
  REMINDER_AHEAD_DAYS,
  REMINDER_BEHIND_DAYS,
  type BottleExtras,
  type BottleExtrasView,
  type Reservation,
  type RemindersView,
  type VintageDetail,
  type VintageInsightView,
} from "@cellr/domain";
import type { AiErrorKind, AiUsage, LlmProvider } from "@/server/ai";
import {
  INSIGHT_SCHEMA,
  INSIGHT_SYSTEM,
  insightUserMessage,
  parseInsight,
} from "@/server/ai/prompts/insight";
import type { ActiveHousehold } from "@/server/cellar/types";
import type { InsightsRepository } from "./types";

export interface InsightsDeps {
  repo: InsightsRepository;
  household: () => Promise<ActiveHousehold>;
  /** The vintage as this person sees it; throws NOT_FOUND for one they can't. */
  vintage: (vintageId: string) => Promise<VintageDetail>;
  /** The language to write in: the person's own. */
  locale: () => Promise<string>;
  /** Null = no AI configured. */
  llm: LlmProvider | null;
  /** Spends from the insights budget; throws RATE_LIMITED when it is gone. */
  spend: () => Promise<void>;
  recordUsage: (entry: {
    householdId: string | null;
    task: string;
    status: "ok" | "error" | "timeout" | "invalid_output" | "rate_limited";
    usage: AiUsage;
  }) => Promise<void>;
  /** Today as YYYY-MM-DD (injectable so reminders can be tested). */
  today?: () => string;
}

const STATUS: Record<AiErrorKind, "error" | "timeout" | "invalid_output" | "rate_limited"> = {
  unavailable: "error",
  refused: "error",
  timeout: "timeout",
  invalid: "invalid_output",
  rate_limited: "rate_limited",
};

const NOT_READY =
  "This needs one more database step before it works. Everything else is fine. See docs/SETUP.md, “Updating the database”.";

export function createInsightsService(deps: InsightsDeps) {
  const today = deps.today ?? (() => new Date().toISOString().slice(0, 10));

  async function view(householdId: string, currency: string, vintageId: string) {
    const found = await deps.repo.getInsight(householdId, vintageId);
    if (found === null)
      return {
        ready: false,
        insight: null,
        myValueCents: null,
        currency,
      } satisfies VintageInsightView;
    const row = found.row;
    return {
      ready: true,
      insight:
        row?.output && row.model && row.generatedAt
          ? { output: row.output, model: row.model, generatedAt: row.generatedAt }
          : null,
      myValueCents: row?.myValueCents ?? null,
      currency,
    } satisfies VintageInsightView;
  }

  return {
    /** The saved profile and own value for a vintage. */
    async get(vintageId: string): Promise<VintageInsightView> {
      const { id, currency } = await deps.household();
      await deps.vintage(vintageId);
      return view(id, currency, vintageId);
    },

    /**
     * Asks the AI for a profile of the wine, checks it in code, and keeps it. There is no plain fallback for
     * this (it is the AI's knowledge or nothing), so a failure is an error the screen words kindly; nothing
     * is stored and nothing is lost.
     */
    async generate(vintageId: string): Promise<VintageInsightView> {
      const { id, currency } = await deps.household();
      const detail = await deps.vintage(vintageId);
      if (!deps.llm)
        throw new DomainError("AI_UNAVAILABLE", "Wine profiles aren't switched on yet.", {
          retryable: false,
        });
      await deps.spend();

      const locale = await deps.locale();
      const result = await deps.llm.generateObject({
        task: "wine_insight",
        model: "chat",
        system: INSIGHT_SYSTEM,
        user: insightUserMessage({
          producer: detail.wine.producer,
          wine: detail.wine.name,
          year: detail.year,
          type: detail.wine.type,
          region: detail.wine.region,
          country: detail.wine.countryCode,
          appellation: detail.wine.appellation,
          currency,
          paidCents: detail.averagePriceCents,
          language: locale === "nl" ? "Dutch" : "English",
        }),
        schemaName: "wine_insight",
        jsonSchema: INSIGHT_SCHEMA,
        parse: parseInsight,
        maxOutputTokens: 900,
        timeoutMs: 40_000,
      });
      await deps
        .recordUsage({
          householdId: id,
          task: "wine_insight",
          status: result.ok ? "ok" : STATUS[result.kind],
          usage: result.usage,
        })
        .catch(() => {});
      if (!result.ok) throw new DomainError("AI_UNAVAILABLE", undefined, { retryable: true });

      const output = checkInsight(result.value, currency, detail.year);
      if (!output) throw new DomainError("AI_UNAVAILABLE", undefined, { retryable: true });
      const saved = await deps.repo.saveInsight(id, vintageId, {
        output,
        model: result.usage.model,
        generatedAt: new Date().toISOString(),
      });
      if (!saved) throw new DomainError("INTERNAL", NOT_READY);
      return view(id, currency, vintageId);
    },

    /** Your own idea of what a bottle is worth now (null clears it). */
    async saveMyValue(vintageId: string, cents: number | null): Promise<VintageInsightView> {
      const { id, currency } = await deps.household();
      await deps.vintage(vintageId);
      if (!(await deps.repo.saveMyValue(id, vintageId, cents)))
        throw new DomainError("INTERNAL", NOT_READY);
      return view(id, currency, vintageId);
    },

    /** What is known about each bottle of a vintage that is in the cellar. */
    async listExtras(vintageId: string): Promise<{ ready: boolean; items: BottleExtrasView[] }> {
      const detail = await deps.vintage(vintageId);
      const items = await deps.repo.listExtras(detail.bottles.map((b) => b.id));
      return items === null ? { ready: false, items: [] } : { ready: true, items };
    },

    async saveExtras(bottleId: string, extras: BottleExtras): Promise<BottleExtrasView> {
      const { id } = await deps.household();
      if (!(await deps.repo.saveExtras(id, bottleId, extras)))
        throw new DomainError("INTERNAL", NOT_READY);
      return { bottleId, ...extras };
    },

    /**
     * Which bottles are kept for an occasion that hasn't passed yet, and per wine how many and for what (the soonest).
     * Never fails the screen that asks: with the database step not taken it is simply empty.
     */
    async reservations(): Promise<{
      vintages: ReadonlyMap<string, Reservation>;
      bottles: ReadonlySet<string>;
    }> {
      const { id } = await deps.household();
      const rows = (await deps.repo.reservedBottles(id)) ?? [];
      const now = today();
      const live = rows.filter((r) => r.on === null || r.on >= now);
      const vintages = new Map<string, Reservation>();
      for (const r of live) {
        const have = vintages.get(r.vintageId);
        const sooner = !have || (r.on !== null && (have.on === null || r.on < have.on));
        vintages.set(r.vintageId, {
          count: (have?.count ?? 0) + 1,
          title: sooner ? r.title : have.title,
          on: sooner ? r.on : have.on,
        });
      }
      return { vintages, bottles: new Set(live.map((r) => r.bottleId)) };
    },

    /** What the AI said about when each vintage drinks well, by vintage id. */
    async windows(): Promise<ReadonlyMap<string, { from: number; until: number }>> {
      const { id } = await deps.household();
      const rows = (await deps.repo.listWindows(id)) ?? [];
      return new Map(rows.map((r) => [r.vintageId, { from: r.from, until: r.until }]));
    },

    /** Bottles being kept for a day that is coming (or just passed). */
    async reminders(): Promise<RemindersView> {
      const { id } = await deps.household();
      const now = today();
      const shift = (days: number) =>
        new Date(Date.parse(`${now}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
      const rows = await deps.repo.reminders(
        id,
        shift(-REMINDER_BEHIND_DAYS),
        shift(REMINDER_AHEAD_DAYS),
      );
      if (rows === null) return { ready: false, items: [] };
      return {
        ready: true,
        items: rows.map((r) => ({ ...r, daysUntil: daysUntil(r.on, now) })),
      };
    },
  };
}

export type InsightsService = ReturnType<typeof createInsightsService>;
