import { describe, expect, it, vi } from "vitest";
import {
  DomainError,
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
function world(
  options: {
    answer?: Record<string, unknown>;
    sharedDown?: boolean;
    /** Research claims (WI-04): "on" = as the database gives them out; "down" = the claim cannot be taken. */
    claims?: "on" | "down";
    /** The research call fails for these households (the model is down for them). */
    aiDownFor?: string[];
    /** These households are over their own rate limit: the spend is refused. */
    limitedFor?: string[];
    /** Claims cannot be given back (an older database): they only expire. */
    noRelease?: boolean;
    /** The claim call itself fails for these households (a transient database error): they go ahead unclaimed. */
    claimErrorFor?: string[];
    /** Giving a claim back fails (a transient database error): the claim is left to expire. */
    releaseFails?: boolean;
  } = {},
) {
  /** The claims as the database holds them: one per vintage and language, each with its owner's token. */
  const claimed = new Map<string, string>();
  /** Claims whose time has passed: the next request to ask takes them over (and the old token is void). */
  const expired = new Set<string>();
  const released: string[] = [];
  let tokens = 0;
  const sleeps: number[] = [];
  /** Research calls that have started and not yet been let go (so two requests can overlap). */
  const pending: Array<() => void> = [];
  let hold = false;
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
        if (hold) await new Promise<void>((release) => pending.push(release));
        if (options.aiDownFor?.includes(id))
          return {
            ok: false as const,
            kind: "unavailable" as const,
            usage: { model: "research-model", tokensIn: 0, tokensOut: 0, latencyMs: 1 },
          };
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
        if (options.limitedFor?.includes(id)) throw new DomainError("RATE_LIMITED");
        spent += 1;
      },
      recordUsage: async (e) => void usage.push({ householdId: e.householdId }),
      ...(options.claims
        ? {
            claimShared: async (vintageId: string, language: string) => {
              if (options.claims === "down") throw new Error("database unavailable");
              if (options.claimErrorFor?.includes(id)) throw new Error("connection reset");
              const key = `${vintageId}:${language}`;
              if (claimed.has(key) && !expired.has(key)) return { mine: false, token: null };
              expired.delete(key);
              const token = `token-${++tokens}`;
              claimed.set(key, token);
              return { mine: true, token };
            },
            ...(options.noRelease
              ? {}
              : {
                  releaseShared: async (vintageId: string, language: string, token: string) => {
                    released.push(token);
                    if (options.releaseFails) throw new Error("connection reset");
                    const key = `${vintageId}:${language}`;
                    // only the token that took the claim gives it back
                    if (claimed.get(key) === token) claimed.delete(key);
                  },
                }),
            sleep: async (ms: number) => {
              sleeps.push(ms);
              // while one request waits, the other's research gets on
              await new Promise((r) => setImmediate(r));
            },
          }
        : {}),
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
    claimed,
    released,
    /** The claim's time has passed: whoever asks next takes it over. */
    expire: (key: string) => void expired.add(key),
    sleeps,
    /** From now on research calls wait until `release()`. */
    holdResearch: () => {
      hold = true;
    },
    release: () => {
      hold = false;
      for (const r of pending.splice(0)) r();
    },
    pending: () => pending.length,
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

describe("two households ask for the same uncached vintage at the same moment (WI-04)", () => {
  const tick = () => new Promise((r) => setImmediate(r));

  it("one research call: the second request waits for the first one's profile and pays nothing", async () => {
    const w = world({ claims: "on" });
    w.holdResearch();
    const a = w.household("A").generate("v2019");
    await tick();
    await tick();
    expect(w.calls).toHaveLength(1); // A is researching
    const b = w.household("B").generate("v2019");
    await tick();
    await tick();
    expect(w.calls).toHaveLength(1); // B did not start a second research: it waits
    expect(w.sleeps.length).toBeGreaterThan(0);
    w.release();
    const [first, second] = await Promise.all([a, b]);
    expect(w.calls).toHaveLength(1);
    expect(w.spent()).toBe(1);
    expect(w.usage).toHaveLength(1);
    expect(first.insight?.output.summary).toContain("Pavillon Rouge");
    expect(second.insight?.output).toEqual(first.insight?.output);
    expect(w.privateRows.get("B:v2019")?.cacheResult).toBe("hit");
    expect(w.privateRows.get("A:v2019")?.cacheResult).toBe("miss");
  });

  it("ten at once: still one research call", async () => {
    const w = world({ claims: "on" });
    w.holdResearch();
    const all = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"].map((h) =>
      w.household(h).generate("v2019"),
    );
    for (let i = 0; i < 6; i++) await tick();
    expect(w.calls).toHaveLength(1);
    w.release();
    const views = await Promise.all(all);
    expect(w.calls).toHaveLength(1);
    expect(w.spent()).toBe(1);
    expect(views.every((v) => v.insight?.output.summary.includes("Pavillon Rouge"))).toBe(true);
  });

  it("the first one's research fails: its claim is given back, and the next request researches without waiting", async () => {
    const w = world({ claims: "on", aiDownFor: ["A"] });
    await expect(w.household("A").generate("v2019")).rejects.toMatchObject({
      code: "AI_UNAVAILABLE",
    });
    expect(w.claimed.size).toBe(0);
    const callsAfterA = w.calls.length;
    const b = await w.household("B").generate("v2019");
    expect(w.sleeps).toEqual([]);
    expect(w.calls.length - callsAfterA).toBe(1);
    expect(b.insight?.output.summary).toContain("Pavillon Rouge");
    expect(w.shared.has("v2019:en")).toBe(true);
    // A asks again: the shared profile is there now, so nothing is waited for and nothing is paid
    const again = await w.household("A").generate("v2019");
    expect(again.insight?.output).toEqual(b.insight?.output);
    expect(w.sleeps).toEqual([]);
    expect(w.calls.length - callsAfterA).toBe(1);
  });

  it("a person over their own rate limit holds no claim: nobody waits because of them", async () => {
    const w = world({ claims: "on", limitedFor: ["A"] });
    await expect(w.household("A").generate("v2019")).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
    expect(w.claimed.size).toBe(0);
    expect(w.calls).toHaveLength(0);
    await w.household("B").generate("v2019");
    expect(w.sleeps).toEqual([]);
    expect(w.calls).toHaveLength(1);
  });

  it("a profile that cannot be shared (not sure enough) still gives the claim back", async () => {
    const w = world({ claims: "on", answer: { confidence: "medium" } });
    await w.household("A").generate("v2019");
    expect(w.shared.size).toBe(0);
    expect(w.claimed.size).toBe(0);
    await w.household("B").generate("v2019");
    expect(w.sleeps).toEqual([]);
  });

  it("the first one's research fails while others wait: exactly one of them takes over, the rest reuse its profile", async () => {
    const w = world({ claims: "on", aiDownFor: ["A"] });
    w.holdResearch();
    const a = w.household("A").generate("v2019");
    await tick();
    await tick();
    const waiting = ["B", "C", "D"].map((h) => w.household(h).generate("v2019"));
    for (let i = 0; i < 4; i++) await tick();
    expect(w.calls).toHaveLength(1); // only A's
    w.release(); // A's research now fails (also its one retry without search)
    await expect(a).rejects.toMatchObject({ code: "AI_UNAVAILABLE" });
    const views = await Promise.all(waiting);
    const results = ["B", "C", "D"].map((h) => w.privateRows.get(`${h}:v2019`)?.cacheResult);
    expect(results.filter((r) => r === "miss")).toHaveLength(1); // one researched
    expect(results.filter((r) => r === "hit")).toHaveLength(2); // two reused it
    expect(w.spent()).toBe(2); // A's (refused by the model) and the one that took over
    expect(views.every((v) => v.insight?.output.summary.includes("Pavillon Rouge"))).toBe(true);
    expect(w.claimed.size).toBe(0);
  });

  it("a claim nobody gives back (its request died): the wait is bounded by one research timeout", async () => {
    const w = world({ claims: "on", noRelease: true });
    w.claimed.set("v2019:en", "token-of-a-request-that-died");
    const b = await w.household("B").generate("v2019");
    expect(w.sleeps.reduce((x, y) => x + y, 0)).toBe(60_000);
    expect(w.calls).toHaveLength(1);
    expect(b.insight?.output.summary).toContain("Pavillon Rouge");
  });

  it("a slow request whose claim was taken over does not give back the new owner's claim", async () => {
    const w = world({ claims: "on" });
    w.holdResearch();
    const a = w.household("A").generate("v2019"); // A claims, and its research hangs
    await tick();
    await tick();
    const tokenA = w.claimed.get("v2019:en");
    w.expire("v2019:en"); // ... longer than the claim lasts
    const b = w.household("B").generate("v2019"); // B takes the claim over and researches too
    await tick();
    await tick();
    const tokenB = w.claimed.get("v2019:en");
    expect(tokenB).toBeDefined();
    expect(tokenB).not.toBe(tokenA);
    expect(w.calls).toHaveLength(2);
    const c = w.household("C").generate("v2019"); // C sees B's claim and waits
    await tick();
    await tick();
    expect(w.calls).toHaveLength(2);
    w.release();
    await Promise.all([a, b, c]);
    // A gave back with ITS token, which no longer opens anything; B's claim was B's to give back
    expect(w.released).toContain(tokenA);
    expect(w.released).toContain(tokenB);
    expect(w.calls).toHaveLength(2); // C never researched: it reused the profile
    expect(w.privateRows.get("C:v2019")?.cacheResult).toBe("hit");
    expect(w.claimed.size).toBe(0);
  });

  it("a request whose claim call failed goes ahead unclaimed and never gives back another request's claim", async () => {
    const w = world({ claims: "on", claimErrorFor: ["B"] });
    w.holdResearch();
    const a = w.household("A").generate("v2019"); // A holds the claim
    await tick();
    await tick();
    const tokenA = w.claimed.get("v2019:en");
    const b = w.household("B").generate("v2019"); // B's claim call fails: it researches without a claim
    await tick();
    await tick();
    expect(w.calls).toHaveLength(2);
    expect(w.claimed.get("v2019:en")).toBe(tokenA); // A's claim is untouched
    const c = w.household("C").generate("v2019"); // C still sees A's claim and waits
    await tick();
    await tick();
    expect(w.calls).toHaveLength(2);
    w.release();
    await Promise.all([a, b, c]);
    expect(w.released).toEqual([tokenA]); // B held nothing, so it gave nothing back
    expect(w.calls).toHaveLength(2);
    expect(w.privateRows.get("C:v2019")?.cacheResult).toBe("hit");
  });

  it("giving the claim back fails: the profile is still returned, and the claim is left to expire", async () => {
    const w = world({ claims: "on", releaseFails: true });
    const a = await w.household("A").generate("v2019");
    expect(a.insight?.output.summary).toContain("Pavillon Rouge");
    expect(w.claimed.size).toBe(1); // still there: it expires by itself
    // the next household finds the shared profile first, so the leftover claim costs nobody a wait
    await w.household("B").generate("v2019");
    expect(w.sleeps).toEqual([]);
    expect(w.calls).toHaveLength(1);
  });

  it("nothing to share: no token, nothing given back", async () => {
    const w = world({ claims: "on" });
    await w.household("A").generate("vOwn");
    expect(w.claimed.size).toBe(0);
    expect(w.released).toEqual([]);
  });

  it("another vintage, another language and a household's own wine never wait for each other", async () => {
    const w = world({ claims: "on" });
    w.holdResearch();
    const all = [
      w.household("A").generate("v2019"),
      w.household("B").generate("v2020"),
      w.household("C", "nl").generate("v2019"),
      w.household("D").generate("vOwn"),
    ];
    for (let i = 0; i < 6; i++) await tick();
    expect(w.calls).toHaveLength(4);
    expect(w.sleeps).toEqual([]);
    // a household's own wine has no shared identity: no claim is even asked for it
    expect([...w.claimed.keys()].sort()).toEqual(["v2019:en", "v2019:nl", "v2020:en"]);
    w.release();
    await Promise.all(all);
  });

  it("a claim that cannot be taken changes nothing: research goes ahead as before", async () => {
    const w = world({ claims: "down" });
    await w.household("A").generate("v2019");
    expect(w.calls).toHaveLength(1);
    expect(w.sleeps).toEqual([]);
  });

  it("a profile that is already shared is reused without any claim or wait", async () => {
    const w = world({ claims: "on" });
    await w.household("A").generate("v2019");
    w.claimed.clear();
    await w.household("B").generate("v2019");
    expect(w.calls).toHaveLength(1);
    expect(w.claimed.size).toBe(0);
    expect(w.sleeps).toEqual([]);
  });
});
