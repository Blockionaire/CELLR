import { describe, expect, it, vi } from "vitest";
import { DomainError, type VintageDetail } from "@cellr/domain";
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
  value_low: 40,
  value_high: 60,
  value_basis: "Auctions.",
  drink_from_year: 2020,
  drink_until_year: 2035,
  confidence: "medium" as const,
};

const detail = {
  vintageId: "v1",
  year: 2015,
  averagePriceCents: 3000,
  wine: {
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
    recordUsage: async (e) => void recorded.push(e.status),
    today: () => "2026-12-20",
    ...over,
  });
  return { service, repo, llm, saved, recorded };
}

describe("a wine profile", () => {
  it("is asked for in the person's language, checked, kept, and accounted for", async () => {
    const { service, llm, saved, recorded } = setup();
    const view = await service.generate("v1");
    expect(view.insight).toBeNull(); // the fake repo returns nothing when read back
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      model: "test-model",
      output: { value: { lowCents: 4000, highCents: 6000, currency: "EUR" } },
    });
    expect(recorded).toEqual(["ok"]);
    const call = vi.mocked(llm.generateObject).mock.calls[0]![0];
    expect(call.user).toContain("Language: Dutch");
    expect(call.user).toContain("paid about 30 EUR");
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

    const down = setup({}, { ok: false, kind: "timeout", usage });
    await expect(down.service.generate("v1")).rejects.toMatchObject({ code: "AI_UNAVAILABLE" });
    expect(down.saved).toHaveLength(0);
    expect(down.recorded).toEqual(["timeout"]);

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
