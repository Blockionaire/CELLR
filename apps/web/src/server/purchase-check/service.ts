import "server-only";
import {
  catalogIdentityOf,
  checkPurchase,
  enrichPurchaseWine,
  profileLanguage,
  WINE_COUNTRIES,
  DomainError,
  LABEL_TEXT_LIMITS,
  labelPhrases,
  NO_PREFERENCES,
  normalizeExtraction,
  purchaseWineFrom,
  recognizeLabelText,
  type CatalogWineFacts,
  type CellarView,
  type InsightOutput,
  type ProfileLanguage,
  type PurchaseKnowledge,
  type StoredProfile,
  type LabelTextCandidate,
  type PurchaseCheckResult,
  type PurchaseRecognition,
  type PurchaseWine,
  type PurchaseWineTraits,
  type TastePreferences,
  type TasteTasting,
} from "@cellr/domain";
import type { AiErrorKind, AiUsage, LlmProvider } from "@/server/ai";
import {
  LABEL_EXTRACTION_SCHEMA,
  LABEL_EXTRACTION_SYSTEM,
  LABEL_EXTRACTION_USER,
  parseLabelExtraction,
} from "@/server/ai/prompts/label-extraction";
import type { ImageService } from "@/server/images/service";
import { grapesTrusted } from "@/server/taste/service";
import type { WineTraitsRow } from "./repository";

export interface PurchaseCheckDeps {
  /** Checks and cleans the photo (size, type, metadata). Only `prepare`: a Koopcheck photo is never kept. */
  images: Pick<ImageService, "prepare">;
  /**
   * The wines the household can see whose producer or name is in the given phrases, with the household's own wines
   * verifiably linked to them (the scan's database-first lookup; read only). Missing = not used.
   */
  findByText?: (householdId: string, phrases: string[]) => Promise<LabelTextCandidate[] | null>;
  householdId: () => Promise<string>;
  /** The active household's cellar (bottles in it, per vintage). */
  inventory: () => Promise<CellarView>;
  traits: (wineIds: string[]) => Promise<WineTraitsRow[]>;
  /** The household's wine profiles of these vintages (only grapes resting on the exact wine are used). */
  insights: (householdId: string, vintageIds: string[]) => Promise<Map<string, InsightOutput>>;
  /** The signed-in person's own tastings in this household and their own answers. */
  taste: () => Promise<{ tastings: TasteTasting[]; preferences: TastePreferences }>;
  /**
   * What CELLR already knows about a catalogue wine (the `purchase_intel` feature): the catalogue's own facts and
   * the shared profiles of its vintages. Read only, as the person; NEVER a model call, a budget or a write. Missing
   * = the comparison uses the confirmed facts alone, as before.
   */
  knowledge?: (
    wineId: string,
    language: ProfileLanguage,
  ) => Promise<{ catalog: CatalogWineFacts | null; profiles: StoredProfile[] }>;
  /** The person's language (shared profiles are per language). Needed only with `knowledge`. */
  locale?: () => Promise<string>;
  /** Null = no AI configured: the person types the wine. */
  llm: LlmProvider | null;
  /** Spends from the scan budget (a label read costs the same either way); throws RATE_LIMITED when gone. */
  spendScan: () => Promise<void>;
  recordUsage: (entry: {
    householdId: string | null;
    task: string;
    status: "ok" | "error" | "timeout" | "invalid_output" | "rate_limited" | "budget_exhausted";
    usage: AiUsage;
  }) => Promise<void>;
  now?: () => Date;
}

const STATUS: Record<
  AiErrorKind,
  "error" | "timeout" | "invalid_output" | "rate_limited" | "budget_exhausted"
> = {
  unavailable: "error",
  refused: "error",
  timeout: "timeout",
  invalid: "invalid_output",
  rate_limited: "rate_limited",
  budget: "budget_exhausted",
};

const unread = (reason: NonNullable<PurchaseRecognition["reason"]>): PurchaseRecognition => ({
  wine: null,
  source: null,
  reason,
  confidence: null,
  catalog: false,
});

/**
 * KOOPCHECK: is the bottle in the shop worth buying, given this household's cellar and the person's own taste?
 *
 * Two steps, so a correction never costs another photo read:
 *  - recognise: the photo is checked and cleaned in memory, then read (the label's printed text first, which costs
 *    nothing; the vision model only when that does not name a CELLR wine). The photo is NEVER stored: no bottle
 *    image, no catalogue-learning signal, no bottle. Only the AI usage of a model call is recorded, like any other.
 *  - compare: the confirmed wine is compared with the real cellar and taste by plain code (no AI at all).
 */
export function createPurchaseCheckService(deps: PurchaseCheckDeps) {
  const now = deps.now ?? (() => new Date());

  /** The wines named by these words (and linked household wines); empty when the lookup is missing or fails. */
  async function candidates(householdId: string, text: string): Promise<LabelTextCandidate[]> {
    if (!deps.findByText) return [];
    const phrases = labelPhrases(text);
    if (phrases.length === 0) return [];
    try {
      return (await deps.findByText(householdId, phrases)) ?? [];
    } catch {
      return [];
    }
  }

  const identityText = (wine: PurchaseWine) => [wine.producer, wine.name ?? ""].join("\n");

  /** A reading that is exactly one catalogue wine gets what the catalogue verifiably knows, where the label was silent. */
  async function withCatalog(
    householdId: string,
    wine: PurchaseWine,
  ): Promise<{ wine: PurchaseWine; catalog: boolean }> {
    const found = catalogIdentityOf(
      wine,
      (await candidates(householdId, identityText(wine))).map((c) => c.wine),
    );
    if (!found) return { wine, catalog: false };
    return {
      wine: {
        ...wine,
        type: wine.type ?? found.type,
        countryCode: wine.countryCode ?? (found.countryCode as PurchaseWine["countryCode"]),
        region: wine.region ?? found.region,
      },
      catalog: true,
    };
  }

  return {
    async recognize(input: {
      photo: Uint8Array;
      /** What the phone's own OCR read on the label; absent when it did not try. Never stored. */
      labelText?: string | null;
    }): Promise<PurchaseRecognition> {
      // Size, type and metadata are checked as for every photo; the cleaned bytes stay in this request only.
      const prepared = deps.images.prepare({ side: "front", photo: input.photo });
      const householdId = await deps.householdId();

      // Database-first: the printed text naming exactly one CELLR catalogue wine needs no model (and costs nothing).
      const text = (input.labelText ?? "").slice(0, LABEL_TEXT_LIMITS.chars);
      if (text.trim()) {
        const found = recognizeLabelText(text, await candidates(householdId, text), now());
        const wine = found.kind === "match" ? purchaseWineFrom(found.facts) : null;
        if (wine) return { wine, source: "text", reason: null, confidence: null, catalog: true };
      }

      if (!deps.llm) return unread("ai-off");
      try {
        await deps.spendScan();
      } catch (error) {
        if (error instanceof DomainError && error.code === "RATE_LIMITED") return unread("limit");
        throw error;
      }
      const result = await deps.llm.generateObject({
        task: "purchase_check",
        model: "vision",
        system: LABEL_EXTRACTION_SYSTEM,
        user: LABEL_EXTRACTION_USER,
        images: [{ mime: "image/jpeg", bytes: prepared.photo }],
        schemaName: "wine_label",
        jsonSchema: LABEL_EXTRACTION_SCHEMA,
        parse: parseLabelExtraction,
        maxOutputTokens: 800,
        timeoutMs: 40_000,
      });
      await deps
        .recordUsage({
          householdId,
          task: "purchase_check",
          status: result.ok ? "ok" : STATUS[result.kind],
          usage: result.usage,
        })
        .catch(() => {});
      if (!result.ok) return unread(result.kind === "budget" ? "budget" : "ai-down");
      const facts = normalizeExtraction(result.value, now());
      const read = facts ? purchaseWineFrom(facts) : null;
      if (!facts || !read) return unread("not-a-label");
      const { wine, catalog } = await withCatalog(householdId, read);
      return { wine, source: "vision", reason: null, confidence: facts.confidence, catalog };
    },

    /** The confirmed wine against this household's real cellar and this person's own taste. No AI. */
    async compare(request: {
      wine: PurchaseWine;
      priceCents: number | null;
    }): Promise<PurchaseCheckResult> {
      const { wine } = request;
      const householdId = await deps.householdId();
      const [view, taste, found] = await Promise.all([
        deps.inventory(),
        // Taste that cannot be read is simply not known: the advice then says so, it does not fail.
        deps.taste().catch(() => ({ tastings: [], preferences: NO_PREFERENCES })),
        candidates(householdId, identityText(wine)),
      ]);
      const catalog = catalogIdentityOf(
        wine,
        found.map((c) => c.wine),
      );

      const wineIds = [...new Set(view.items.map((i) => i.wineId))];
      const [rows, insights] = await Promise.all([
        wineIds.length > 0 ? deps.traits(wineIds).catch(() => []) : Promise.resolve([]),
        view.items.length > 0
          ? deps
              .insights(
                householdId,
                view.items.map((i) => i.vintageId),
              )
              .catch(() => new Map<string, InsightOutput>())
          : Promise.resolve(new Map<string, InsightOutput>()),
      ]);

      // Grapes the AI profile is sure of (it rests on this exact wine), for wines without curated grapes.
      const profiled = new Map<string, Set<string>>();
      for (const i of view.items) {
        const o = insights.get(i.vintageId);
        if (!o || !grapesTrusted(o)) continue;
        const set = profiled.get(i.wineId) ?? new Set<string>();
        for (const g of o.grapes) set.add(g);
        profiled.set(i.wineId, set);
      }
      const traits = new Map<string, PurchaseWineTraits>();
      for (const r of rows)
        traits.set(r.wineId, {
          appellation: r.appellation,
          grapes: r.grapes.length > 0 ? r.grapes : [...(profiled.get(r.wineId) ?? [])],
          aliases: r.aliases,
          catalogIds: r.catalog ? [r.wineId] : [],
        });
      // A household wine verifiably linked to a catalogue wine is that wine.
      for (const c of found) {
        if (c.wine.catalog || !c.linkedTo) continue;
        const t = traits.get(c.wine.id) ?? {
          appellation: null,
          grapes: [...(profiled.get(c.wine.id) ?? [])],
          aliases: [],
          catalogIds: [],
        };
        if (!t.catalogIds.includes(c.linkedTo)) t.catalogIds.push(c.linkedTo);
        traits.set(c.wine.id, t);
      }

      // What CELLR already knows about exactly this catalogue wine fills the fields the person left open: verified
      // catalogue facts, then a valid profile of this vintage, then only the wine's stable facts. Reading it never
      // asks a model and never writes; if it cannot be read, the comparison goes ahead on the confirmed facts.
      let compared = wine;
      let knowledge: PurchaseKnowledge | null = null;
      if (deps.knowledge && catalog) {
        try {
          const language = profileLanguage(deps.locale ? await deps.locale() : "en");
          const known = await deps.knowledge(catalog.id, language);
          if (known.catalog) {
            const enriched = enrichPurchaseWine(
              wine,
              known.catalog,
              known.profiles,
              WINE_COUNTRIES,
            );
            compared = enriched.wine;
            knowledge = enriched.knowledge;
          }
        } catch {
          knowledge = null;
        }
      }

      const result = checkPurchase({
        wine: compared,
        priceCents: request.priceCents,
        catalogWineId: catalog?.id ?? null,
        items: view.items,
        traits,
        tastings: taste.tastings,
        preferences: taste.preferences,
      });
      return deps.knowledge ? { ...result, knowledge } : result;
    },
  };
}

export type PurchaseCheckService = ReturnType<typeof createPurchaseCheckService>;
