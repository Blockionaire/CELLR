import { describe, expect, it, vi } from "vitest";
import {
  DomainError,
  InsightOutputSchema,
  PROFILE_VERSION,
  type Valuation,
  type VintageDetail,
} from "@cellr/domain";
import type { AiResult, LlmProvider } from "@/server/ai";
import { createInsightsService, type InsightsDeps } from "./service";
import type { InsightsRepository } from "./types";

vi.mock("server-only", () => ({}));

const usage = { model: "test-model", tokensIn: 10, tokensOut: 20, latencyMs: 5 };
const raw = {
  summary: "A ripe red.",
  style: "Full-bodied red",
  grapes: ["Merlot"],
  tasting: "Plum.",
  serving_temp_min_c: 16,
  serving_temp_max_c: 18,
  decant_minutes: 30,
  abv_percent: 13.5,
  pairings: ["Lamb"],
  aging: "A decade.",
  body: 4,
  tannin: 4,
  sweetness: 1,
  acidity: 3,
  flavors: [{ group: "black_fruit" as const, notes: ["Plum"] }],
  pairing_kinds: ["lamb" as const],
  drink_from_year: 2020,
  drink_until_year: 2035,
  country_code: "FR",
  region: "Bordeaux",
  appellation: "Pauillac",
  confidence: "medium" as const,
  evidence: "producer" as const,
  sources: [] as Array<{ name: string; url: string }>,
};

const detail = {
  vintageId: "v1",
  year: 2015,
  averagePriceCents: 3000,
  wine: {
    id: "w1",
    producer: "Margaux",
    name: "Pavillon",
    type: "red",
    region: "Bordeaux",
    countryCode: "FR",
    appellation: null,
  },
  bottles: [{ id: "b1" }, { id: "b2" }],
} as unknown as VintageDetail;

function setup(
  over: Partial<InsightsDeps> = {},
  answer: AiResult<unknown> = { ok: true, value: raw, usage },
) {
  const saved: unknown[] = [];
  const repo: InsightsRepository = {
    getInsight: vi.fn(async () => ({ row: null }) as { row: null } | null),
    saveInsight: vi.fn(async (_h, _v, i) => (saved.push(i), true)),
    saveMyValue: vi.fn(async () => true),
    listValues: vi.fn(async () => []),
    listWindows: vi.fn(async () => []),
    reservedBottles: vi.fn(async () => []),
    listExtras: vi.fn(async () => []),
    saveExtras: vi.fn(async () => true),
    reminders: vi.fn(async () => []),
    listValuations: vi.fn(async () => [] as Valuation[] | null),
    addValuation: vi.fn(async () => true),
    allValuations: vi.fn(async () => []),
    listOwnValues: vi.fn(async () => new Map<string, number>()),
  };
  const llm: LlmProvider = {
    generateObject: vi.fn(async (req) =>
      answer.ok ? { ...answer, value: req.parse(answer.value) } : answer,
    ) as LlmProvider["generateObject"],
  };
  const recorded: string[] = [];
  const service = createInsightsService({
    repo,
    household: async () => ({ id: "h1", currency: "EUR" }),
    vintage: async () => detail,
    locale: async () => "nl",
    llm,
    spend: async () => {},
    now: () => new Date("2026-12-20T12:00:00Z"),
    recordUsage: async (e) => void recorded.push(e.status),
    today: () => "2026-12-20",
    ...over,
  });
  return { service, repo, llm, saved, recorded };
}

const storedProfile = (version: number, confidence: "low" | "medium" | "high" = "high") =>
  InsightOutputSchema.parse({
    summary: "The words the person read first.",
    style: "Full",
    grapes: ["Merlot"],
    tasting: "Plum.",
    serving: null,
    decantMinutes: 30,
    pairings: ["Lamb"],
    aging: "A decade.",
    confidence,
    version,
  });

describe("a profile stays as it was written", () => {
  it("a complete profile is given back as it is, without asking the AI", async () => {
    const base = setup();
    const getInsight = vi.fn(async () => ({
      row: {
        output: storedProfile(PROFILE_VERSION),
        model: "m",
        generatedAt: "2026-01-01",
        myValueCents: null,
      },
    }));
    const s = setup({ repo: { ...base.repo, getInsight } });
    const view = await s.service.generate("v1");
    expect(view.insight?.output.summary).toBe("The words the person read first.");
    expect(s.llm.generateObject).not.toHaveBeenCalled();
    expect(base.saved).toHaveLength(0);
  });

  it("an older generic profile that was not sure of itself is written again, once, from research", async () => {
    const base = setup();
    const getInsight = vi.fn(async () => ({
      row: {
        output: storedProfile(5, "low"),
        model: "m",
        generatedAt: "2026-01-01",
        myValueCents: null,
      },
    }));
    const s = setup({ repo: { ...base.repo, getInsight, saveInsight: base.repo.saveInsight } });
    await s.service.generate("v1");
    expect(base.saved[0]).toMatchObject({
      output: { summary: "A ripe red.", version: PROFILE_VERSION, evidence: "producer" },
    });
    expect(vi.mocked(s.llm.generateObject).mock.calls[0]![0]).toMatchObject({
      task: "wine_insight",
      webSearch: true,
      maxSearches: 2,
    });
  });

  it("an older profile is only filled in: its words stay", async () => {
    const base = setup();
    const getInsight = vi.fn(async () => ({
      row: { output: storedProfile(1), model: "m", generatedAt: "2026-01-01", myValueCents: null },
    }));
    const s = setup({ repo: { ...base.repo, getInsight, saveInsight: base.repo.saveInsight } });
    await s.service.generate("v1");
    expect(base.saved).toHaveLength(1);
    expect(base.saved[0]).toMatchObject({
      output: {
        summary: "The words the person read first.",
        decantMinutes: 30,
        structure: { body: 4 },
        version: PROFILE_VERSION,
      },
    });
  });
});

describe("what a bottle is worth", () => {
  const offer = (url: string, price: number) => ({
    name: "Shop",
    url,
    price,
    vintage: 2015,
    bottle_ml: 750,
    same_wine: true,
  });
  const found = {
    low: 40,
    high: 60,
    basis: "Two shops.",
    sources: [offer("https://shop.example/w", 40), offer("https://cave.example/w", 60)],
  };
  const answer = (consulted: string[]) =>
    ({ ok: true, value: found, usage, consulted }) as AiResult<unknown>;

  it("is looked up on the web, kept with its real sources, and accounted for", async () => {
    const s = setup(
      {},
      answer(["https://shop.example/w?utm_source=openai", "https://www.cave.example/w"]),
    );
    await s.service.valuate("v1");
    expect(s.repo.addValuation).toHaveBeenCalledWith(
      "h1",
      "v1",
      {
        lowCents: 4000,
        highCents: 6000,
        currency: "EUR",
        basis: "Two shops.",
        sources: [
          { name: "Shop", url: "https://shop.example/w" },
          { name: "Shop", url: "https://cave.example/w" },
        ],
      },
      "test-model",
    );
    const call = vi.mocked(s.llm.generateObject).mock.calls[0]![0];
    expect(call).toMatchObject({ task: "wine_valuation", webSearch: true, maxSearches: 4 });
    expect(s.recorded).toEqual(["ok"]);
  });

  it("without a page the search really opened, nothing is kept", async () => {
    // Same site, another page: not enough.
    const s = setup({}, answer(["https://elsewhere.example/", "https://shop.example/other"]));
    await expect(s.service.valuate("v1")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(s.repo.addValuation).not.toHaveBeenCalled();
  });

  it("at most once a month", async () => {
    const base = setup({}, answer(["https://shop.example/w"]));
    const recent: Valuation = {
      lowCents: 1,
      highCents: 2,
      currency: "EUR",
      basis: "",
      sources: [],
      valuedAt: "2026-12-01T00:00:00Z",
    };
    const s = setup(
      { repo: { ...base.repo, listValuations: vi.fn(async () => [recent]) } },
      answer(["https://shop.example/w"]),
    );
    await expect(s.service.valuate("v1")).rejects.toMatchObject({ code: "CONFLICT" });
    expect(s.llm.generateObject).not.toHaveBeenCalled();
  });

  it("needs the database step first", async () => {
    const base = setup();
    const s = setup({ repo: { ...base.repo, listValuations: vi.fn(async () => null) } });
    await expect(s.service.valuate("v1")).rejects.toMatchObject({ code: "INTERNAL" });
  });
});

describe("a wine profile", () => {
  it("is asked for in the person's language, checked, kept, and accounted for", async () => {
    const { service, llm, saved, recorded } = setup();
    const view = await service.generate("v1");
    expect(view.insight).toBeNull(); // the fake repo returns nothing when read back
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      model: "test-model",
      output: {
        version: PROFILE_VERSION,
        structure: { body: 4, tannin: 4, sweetness: 1, acidity: 3 },
        pairingKinds: ["lamb"],
        value: null,
      },
    });
    expect(recorded).toEqual(["ok"]);
    const call = vi.mocked(llm.generateObject).mock.calls[0]![0];
    expect(call.user).toContain("Language: Dutch");
    expect(call.user).toContain("paid about 30 EUR");
  });

  it("fills in only what the person left empty, and never overwrites", async () => {
    const fillWine = vi.fn(async () => ({}));
    const { service } = setup({ fillWine });
    await service.generate("v1");
    // region and country were already there; only the appellation was missing
    expect(fillWine).toHaveBeenCalledWith("w1", { appellation: "Pauillac" });

    const sure = vi.fn(async () => ({}));
    await setup(
      { fillWine: sure },
      { ok: true, value: { ...raw, confidence: "low" }, usage },
    ).service.generate("v1");
    expect(sure).not.toHaveBeenCalled();

    // a refusal (shared catalogue wine) does not break the profile
    const refuse = vi.fn(async () => {
      throw new DomainError("FORBIDDEN");
    });
    await expect(setup({ fillWine: refuse }).service.generate("v1")).resolves.toBeTruthy();
  });

  it("is an error, and keeps nothing, when there is no AI, no budget, or no good answer", async () => {
    const none = setup({ llm: null });
    await expect(none.service.generate("v1")).rejects.toMatchObject({ code: "AI_UNAVAILABLE" });

    const spent = setup({
      spend: async () => {
        throw new DomainError("RATE_LIMITED");
      },
    });
    await expect(spent.service.generate("v1")).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(spent.llm.generateObject).not.toHaveBeenCalled();

    // The research call failing is retried once without search; both are accounted for.
    const down = setup({}, { ok: false, kind: "timeout", usage });
    await expect(down.service.generate("v1")).rejects.toMatchObject({ code: "AI_UNAVAILABLE" });
    expect(down.saved).toHaveLength(0);
    expect(down.recorded).toEqual(["timeout", "timeout"]);
    const calls = vi.mocked(down.llm.generateObject).mock.calls.map((c) => c[0].webSearch);
    expect(calls).toEqual([true, undefined]);

    // Out of budget: no second try.
    const broke = setup({}, { ok: false, kind: "budget", usage });
    await expect(broke.service.generate("v1")).rejects.toMatchObject({ code: "AI_UNAVAILABLE" });
    expect(broke.recorded).toEqual(["budget_exhausted"]);

    const empty = setup({}, { ok: true, value: { ...raw, summary: " " }, usage });
    await expect(empty.service.generate("v1")).rejects.toMatchObject({ code: "AI_UNAVAILABLE" });
    expect(empty.saved).toHaveLength(0);
  });

  it("says plainly when the database step hasn't been taken", async () => {
    const { service, repo } = setup();
    vi.mocked(repo.saveInsight).mockResolvedValue(false);
    await expect(service.generate("v1")).rejects.toMatchObject({ code: "INTERNAL" });
    vi.mocked(repo.getInsight).mockResolvedValue(null);
    expect(await service.get("v1")).toMatchObject({ ready: false });
  });
});

describe("reminders", () => {
  it("looks from two weeks back to six weeks ahead and counts the days", async () => {
    const { service, repo } = setup();
    vi.mocked(repo.reminders).mockResolvedValue([
      {
        bottleId: "b1",
        vintageId: "v1",
        producer: "P",
        wineName: "W",
        year: 2015,
        title: "Christmas",
        on: "2026-12-25",
      },
    ]);
    const view = await service.reminders();
    expect(vi.mocked(repo.reminders).mock.calls[0]).toEqual(["h1", "2026-12-06", "2027-02-03"]);
    expect(view).toMatchObject({ ready: true, items: [{ title: "Christmas", daysUntil: 5 }] });
  });
});

describe("what we know about the bottles", () => {
  it("reads the extras of this vintage's bottles only", async () => {
    const { service, repo } = setup();
    await service.listExtras("v1");
    expect(repo.listExtras).toHaveBeenCalledWith(["b1", "b2"]);
  });
});

describe("reservations", () => {
  const row = (bottleId: string, vintageId: string, title: string, on: string | null) => ({
    bottleId,
    vintageId,
    title,
    on,
  });
  it("counts the bottles kept for an occasion that hasn't passed, and names the soonest", async () => {
    const { service, repo } = setup();
    vi.mocked(repo.reservedBottles).mockResolvedValue([
      row("b1", "v1", "New Year", "2027-01-01"),
      row("b2", "v1", "Christmas", "2026-12-25"),
      row("b3", "v1", "Someday", null),
      row("b4", "v2", "Last week", "2026-12-10"), // today is 2026-12-20: passed
      row("b5", "v3", "No day yet", null),
    ]);
    const { vintages, bottles } = await service.reservations();
    expect(vintages.get("v1")).toEqual({ count: 3, title: "Christmas", on: "2026-12-25" });
    expect(vintages.has("v2")).toBe(false);
    expect(vintages.get("v3")).toEqual({ count: 1, title: "No day yet", on: null });
    expect([...bottles].sort()).toEqual(["b1", "b2", "b3", "b5"]);
  });
  it("is simply empty when the database step hasn't been taken", async () => {
    const { service, repo } = setup();
    vi.mocked(repo.reservedBottles).mockResolvedValue(null);
    expect((await service.reservations()).vintages.size).toBe(0);
  });
});
