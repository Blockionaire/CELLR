import { describe, expect, it, vi } from "vitest";
import {
  InsightOutputSchema,
  PROFILE_VERSION,
  type InsightOutput,
  type VintageDetail,
} from "@cellr/domain";
import type { LlmProvider } from "@/server/ai";
import type { GenerateObjectRequest } from "@/server/ai/types";
import { createInsightsService } from "./service";
import type { InsightRow, InsightsRepository } from "./types";

vi.mock("server-only", () => ({}));

/** What the research model says about Pavillon Rouge: this exact wine, from a page the search consulted. */
const answer = (over: Record<string, unknown> = {}) => ({
  summary: "Pavillon Rouge, the second wine of Château Margaux.",
  style: "Elegant red",
  grapes: ["Cabernet Sauvignon"],
  tasting: "Cassis.",
  serving_temp_min_c: 16,
  serving_temp_max_c: 18,
  decant_minutes: 60,
  abv_percent: 13.5,
  pairings: ["Lamb"],
  aging: "Ten years.",
  body: 4,
  tannin: 4,
  sweetness: 1,
  acidity: 3,
  flavors: [{ group: "black_fruit", notes: ["Cassis"] }],
  pairing_kinds: ["lamb"],
  drink_from_year: 2024,
  drink_until_year: 2040,
  country_code: "FR",
  region: "Bordeaux",
  appellation: "Margaux",
  confidence: "high",
  evidence: "exact_wine",
  sources: [{ name: "Château Margaux", url: "https://www.chateau-margaux.com/pavillon" }],
  ...over,
});

const canonical = new Set(["v2019", "v2020", "vNV"]);
const years: Record<string, number | null> = { v2019: 2019, v2020: 2020, vNV: null, vOwn: 2019 };

/**
 * One database shared by several households: each household's private profiles, the shared profiles (keyed by
 * vintage and language, as the unique constraint does), and every paid research call.
 */
function world(options: { answer?: Record<string, unknown>; sharedDown?: boolean } = {}) {
  const privateRows = new Map<string, InsightRow & { cacheResult?: string }>();
  const shared = new Map<string, { output: InsightOutput; model: string; generatedAt: string }>();
  const calls: GenerateObjectRequest<unknown>[] = [];
  const usage: Array<{ householdId: string | null }> = [];
  let spent = 0;

  function household(id: string, locale = "en") {
    const repo = {
      getInsight: async (h: string, v: string) => ({ row: privateRows.get(`${h}:${v}`) ?? null }),
      saveInsight: async (
        h: string,
        v: string,
        i: { output: InsightOutput; model: string; generatedAt: string; cacheResult?: string },
      ) => {
        privateRows.set(`${h}:${v}`, {
          output: i.output,
          model: i.model,
          generatedAt: i.generatedAt,
          myValueCents: null,
          ...(i.cacheResult ? { cacheResult: i.cacheResult } : {}),
        });
        return true;
      },
      getShared: async (v: string, language: string) => {
        if (options.sharedDown) throw new Error("database unavailable");
        const found = shared.get(`${v}:${language}`) ?? null;
        return { eligible: canonical.has(v), profile: found };
      },
      listValuations: async () => [],
    } as unknown as InsightsRepository;
    const llm: LlmProvider = {
      async generateObject<T>(request: GenerateObjectRequest<T>) {
        calls.push(request as GenerateObjectRequest<unknown>);
        const value = request.parse(answer(options.answer ?? {}));
        return {
          ok: true as const,
          value,
          consulted: ["https://www.chateau-margaux.com/pavillon"],
          usage: {
            model: "research-model",
            tokensIn: 1,
            tokensOut: 1,
            latencyMs: 1,
            webSearchCalls: 1,
          },
        };
      },
    };
    return createInsightsService({
      repo,
      household: async () => ({ id, currency: "EUR" }),
      vintage: async (vintageId) =>
        ({
          vintageId,
          year: years[vintageId] ?? null,
          averagePriceCents: 2750,
          wine: {
            id: "w",
            producer: "Château Margaux",
            name: "Pavillon Rouge",
            type: "red",
            region: "Bordeaux",
            countryCode: "FR",
            appellation: null,
          },
          bottles: [],
        }) as unknown as VintageDetail,
      locale: async () => locale,
      llm,
      spend: async () => {
        spent += 1;
      },
      recordUsage: async (e) => void usage.push({ householdId: e.householdId }),
      publishShared: async (e) => {
        const key = `${e.vintageId}:${e.language}`;
        if (!canonical.has(e.vintageId) || shared.has(key)) return false;
        shared.set(key, { output: e.output, model: e.model, generatedAt: e.generatedAt });
        return true;
      },
    });
  }
  return {
    household,
    privateRows,
    shared,
    calls,
    usage,
    spent: () => spent,
  };
}

describe("research a wine once, reuse it in every household", () => {
  it("the cost table: one research call serves another household; another vintage is researched", async () => {
    const w = world();
    // Household A adds Wine X 2019: researched once, and the profile is offered to everyone.
    await w.household("A").generate("v2019");
    expect(w.calls).toHaveLength(1);
    expect(w.shared.has("v2019:en")).toBe(true);
    // Household A adds another bottle: its own profile is current, nothing is asked.
    await w.household("A").generate("v2019");
    expect(w.calls).toHaveLength(1);
    // Household B adds the same wine and vintage: reused, no call, no budget, no usage row.
    const spentBefore = w.spent();
    const usageBefore = w.usage.length;
    const b = await w.household("B").generate("v2019");
    expect(w.calls).toHaveLength(1);
    expect(w.spent()).toBe(spentBefore);
    expect(w.usage).toHaveLength(usageBefore);
    expect(b.insight?.output.summary).toContain("Pavillon Rouge");
    expect(b.insight?.output.drinkWindow).toEqual({ from: 2024, until: 2040 });
    expect(w.privateRows.get("B:v2019")?.cacheResult).toBe("hit");
    // Household C adds the same wine, 2020: another vintage is never served the 2019 profile.
    await w.household("C").generate("v2020");
    expect(w.calls).toHaveLength(2);
    expect(w.privateRows.get("C:v2020")?.cacheResult).toBe("miss");
  });

  it("another language is researched in that language, not served the English text", async () => {
    const w = world();
    await w.household("A", "en").generate("v2019");
    await w.household("B", "nl").generate("v2019");
    expect(w.calls).toHaveLength(2);
    expect(w.shared.has("v2019:nl")).toBe(true);
  });

  it("the non-vintage is its own wine: not served a vintage's profile, and it keeps no window", async () => {
    const w = world();
    await w.household("A").generate("v2019");
    await w.household("B").generate("vNV");
    expect(w.calls).toHaveLength(2);
    // A window cannot belong to a non-vintage, so checkInsight keeps none and the profile may still be shared.
    expect(w.shared.get("vNV:en")?.output.drinkWindow).toBeNull();
  });

  it("a household's own wine is researched privately and never shared, and keeps the price hint private", async () => {
    const w = world();
    await w.household("A").generate("vOwn");
    expect(w.calls).toHaveLength(1);
    expect(w.shared.size).toBe(0);
    expect(w.privateRows.get("A:vOwn")?.cacheResult).toBeUndefined();
    // For its own wine the household's price may still help the private profile, as before.
    expect(w.calls[0]!.user).toContain("paid about 28 EUR");
  });

  it("a shareable wine is researched from public facts only: what the household paid never reaches the prompt", async () => {
    const w = world();
    await w.household("A").generate("v2019");
    expect(w.calls[0]!.user).not.toContain("paid");
    const published = w.shared.get("v2019:en")!.output;
    expect(published.value).toBeNull();
    expect(JSON.stringify(published)).not.toMatch(/27\.5|2750|EUR|household|"A"/);
  });

  it("unsure, not exact, unsourced or contradicting profiles stay private and the next household researches", async () => {
    for (const over of [
      { confidence: "medium" },
      { evidence: "producer" },
      { sources: [] },
      { country_code: "IT" },
    ]) {
      const w = world({ answer: over });
      await w.household("A").generate("v2019");
      expect(w.shared.size).toBe(0);
      expect(w.privateRows.get("A:v2019")?.output).toBeTruthy(); // A's own profile is kept as before
      await w.household("B").generate("v2019");
      expect(w.calls).toHaveLength(2);
    }
  });

  it("a shared profile that no longer meets the bar (an older version) is not used: research, then replace", async () => {
    const w = world();
    w.shared.set("v2019:en", {
      output: InsightOutputSchema.parse({
        summary: "An old profile.",
        style: "x",
        grapes: [],
        tasting: "x",
        serving: null,
        decantMinutes: null,
        pairings: [],
        aging: "x",
        confidence: "high",
        evidence: "exact_wine",
        researched: true,
        sources: [{ name: "s", url: "https://s.example/" }],
        version: PROFILE_VERSION - 1,
      }),
      model: "old",
      generatedAt: "2025-01-01T00:00:00Z",
    });
    const b = await w.household("B").generate("v2019");
    expect(w.calls).toHaveLength(1);
    expect(b.insight?.output.summary).toContain("Pavillon Rouge");
  });

  it("when the shared cache is down or not set up, profiles are researched exactly as before", async () => {
    const w = world({ sharedDown: true });
    const a = await w.household("A").generate("v2019");
    expect(w.calls).toHaveLength(1);
    expect(a.insight?.output.summary).toContain("Pavillon Rouge");
    expect(w.privateRows.get("A:v2019")?.cacheResult).toBeUndefined();
  });

  it("a shared profile is reused even when AI is not configured, without spending anything", async () => {
    const w = world();
    await w.household("A").generate("v2019");
    const published = w.shared.get("v2019:en")!;
    const service = createInsightsService({
      repo: {
        getInsight: async () => ({ row: null }),
        saveInsight: async () => true,
        getShared: async () => ({ eligible: true, profile: published }),
        listValuations: async () => [],
      } as unknown as InsightsRepository,
      household: async () => ({ id: "B", currency: "EUR" }),
      vintage: async () =>
        ({
          vintageId: "v2019",
          year: 2019,
          averagePriceCents: null,
          wine: { id: "w", producer: "P", name: "N", type: "red", countryCode: "FR" },
          bottles: [],
        }) as unknown as VintageDetail,
      locale: async () => "en",
      llm: null,
      spend: async () => {
        throw new Error("a reused profile must not spend");
      },
      recordUsage: async () => {
        throw new Error("a reused profile is not an AI call");
      },
    });
    await expect(service.generate("v2019")).resolves.toMatchObject({ ready: true });
  });
});
