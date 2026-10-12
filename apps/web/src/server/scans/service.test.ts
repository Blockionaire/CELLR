import { describe, expect, it } from "vitest";
import { DomainError, type RawExtraction, type WineSummary } from "@cellr/domain";
import type { GenerateObjectRequest, LlmProvider } from "@/server/ai/types";
import { createScanService, type ScanDeps } from "./service";

const raw = (over: Partial<RawExtraction> = {}): RawExtraction => ({
  is_wine_label: true,
  producer: "Château Margaux",
  wine_name: "Pavillon Rouge",
  vintage: 2015,
  non_vintage: false,
  wine_type: "red",
  country_code: "FR",
  region: "Bordeaux",
  appellation: "Margaux",
  grapes: [],
  abv_percent: 13,
  volume_ml: 750,
  text_seen: "CHÂTEAU MARGAUX",
  confidence: { producer: "high", wine_name: "high", vintage: "high" },
  ...over,
});
const wine = (
  id: string,
  producer: string,
  name: string,
  over: Partial<WineSummary> = {},
): WineSummary => ({
  id,
  producer,
  name,
  type: "red",
  countryCode: "FR",
  region: "Bordeaux",
  ...over,
});

function setup(
  options: {
    answer?: RawExtraction | "invalid" | "unavailable" | "timeout" | "rate_limited" | "refused";
    wines?: WineSummary[];
    noAi?: boolean;
    spend?: () => Promise<void>;
    uploadFails?: boolean;
    usageFails?: boolean;
  } = {},
) {
  const state = {
    uploads: [] as Array<{ photo: Uint8Array; side: string }>,
    requests: [] as GenerateObjectRequest<unknown>[],
    usage: [] as Array<{ task: string; status: string; model: string; householdId: string | null }>,
  };
  const cleanPhoto = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0xff, 0xd9]);
  const llm: LlmProvider = {
    async generateObject<T>(request: GenerateObjectRequest<T>) {
      state.requests.push(request as GenerateObjectRequest<unknown>);
      const usage = { model: "vision-model", tokensIn: 900, tokensOut: 70, latencyMs: 1200 };
      const answer = options.answer ?? raw();
      if (typeof answer === "string")
        return {
          ok: false as const,
          kind: answer === "invalid" ? ("invalid" as const) : answer,
          usage,
        };
      return { ok: true as const, value: request.parse(answer), usage };
    },
  };
  const deps: ScanDeps = {
    images: {
      async uploadWithPhoto(input) {
        if (options.uploadFails) throw new DomainError("UPLOAD_REJECTED");
        state.uploads.push({ photo: input.photo, side: input.side });
        return {
          image: { id: "img1", side: input.side, blurColor: "#aabbcc", width: 600, height: 800 },
          photo: cleanPhoto,
        };
      },
    },
    wines: async () => options.wines ?? [],
    householdId: async () => "h1",
    llm: options.noAi ? null : llm,
    spendScan: options.spend ?? (async () => {}),
    recordUsage: async ({ task, status, usage, householdId }) => {
      if (options.usageFails) throw new Error("usage table gone");
      state.usage.push({ task, status, model: usage.model, householdId });
    },
    now: () => new Date("2026-10-12T12:00:00Z"),
  };
  return { service: createScanService(deps), state, cleanPhoto };
}

const photo = new Uint8Array([1, 2, 3]);

describe("scanning a label", () => {
  it("reads the label and recognises a wine you already have", async () => {
    const { service, state, cleanPhoto } = setup({
      wines: [
        wine("w1", "Château Margaux", "Pavillon Rouge"),
        wine("w2", "Château Latour", "Les Forts"),
      ],
    });
    const result = await service.scan({ photo });
    expect(result).toMatchObject({
      outcome: "found",
      reason: null,
      image: { id: "img1" },
      facts: { producer: "Château Margaux", year: 2015, type: "red" },
    });
    expect(result.matches.map((m) => m.wine.id)).toEqual(["w1"]);
    // The model is shown the cleaned photo with the vision model's job, and our own instructions.
    const [request] = state.requests;
    expect(request).toMatchObject({
      task: "label_extraction",
      model: "vision",
      schemaName: "wine_label",
    });
    expect(request!.images![0]!.bytes).toBe(cleanPhoto);
    expect(request!.system).toContain("ignore it");
    expect(state.usage).toEqual([
      { task: "label_extraction", status: "ok", model: "vision-model", householdId: "h1" },
    ]);
  });

  it("offers choices when it is not sure, and 'new' when there is nothing like it", async () => {
    const some = [
      wine("w1", "Château Margaux", "Pavillon Rouge"),
      wine("w2", "Château Margaux", "Pavillon Blanc", { type: "white" }),
    ];
    const choose = await setup({
      answer: raw({ wine_name: null, appellation: null, region: null, wine_type: null }),
      wines: some,
    }).service.scan({ photo });
    expect(choose.outcome).toBe("choose");
    expect(choose.matches.length).toBeGreaterThan(1);
    const fresh = await setup({
      answer: raw({ producer: "Bodegas Muga", wine_name: "Reserva", country_code: "ES" }),
      wines: some,
    }).service.scan({ photo });
    expect(fresh).toMatchObject({ outcome: "new", matches: [] });
    expect(fresh.facts).toMatchObject({ producer: "Bodegas Muga", countryCode: "ES" });
  });

  it("drops what cannot be true before anyone sees it", async () => {
    const result = await setup({
      answer: raw({ vintage: 2087, abv_percent: 99, country_code: "ZZ" }),
    }).service.scan({ photo });
    expect(result.facts).toMatchObject({ year: null, abv: null, countryCode: null });
  });

  it("keeps the photo and says so when the picture is not a label", async () => {
    const { service, state } = setup({ answer: raw({ is_wine_label: false }) });
    const result = await service.scan({ photo });
    expect(result).toMatchObject({
      outcome: "unread",
      reason: "not-a-label",
      facts: null,
      matches: [],
      image: { id: "img1" },
    });
    expect(state.usage[0]!.status).toBe("ok"); // the call worked; there was just nothing to read
  });

  it("every way the AI can fail still keeps the photo, and is accounted for", async () => {
    const cases = [
      ["unavailable", "error"],
      ["timeout", "timeout"],
      ["invalid", "invalid_output"],
      ["rate_limited", "rate_limited"],
      ["refused", "error"],
    ] as const;
    for (const [kind, status] of cases) {
      const { service, state } = setup({ answer: kind });
      const result = await service.scan({ photo });
      expect(result, kind).toMatchObject({
        outcome: "unread",
        reason: "ai-down",
        image: { id: "img1" },
      });
      expect(state.usage[0]!.status, kind).toBe(status);
    }
  });

  it("without an AI key it still keeps the photo, and does not pretend", async () => {
    const { service, state } = setup({ noAi: true });
    const result = await service.scan({ photo });
    expect(result).toMatchObject({ outcome: "unread", reason: "ai-off", image: { id: "img1" } });
    expect(state.requests).toHaveLength(0);
    expect(state.usage).toHaveLength(0);
  });

  it("stops at the budget: the photo is kept, the AI is not asked", async () => {
    const { service, state } = setup({
      spend: async () => {
        throw new DomainError("RATE_LIMITED");
      },
    });
    expect(await service.scan({ photo })).toMatchObject({
      outcome: "unread",
      reason: "limit",
      image: { id: "img1" },
    });
    expect(state.requests).toHaveLength(0);
  });

  it("any other failure of the budget check is a real error, not a quiet fallback", async () => {
    const { service } = setup({
      spend: async () => {
        throw new DomainError("INTERNAL");
      },
    });
    await expect(service.scan({ photo })).rejects.toMatchObject({ code: "INTERNAL" });
  });

  it("a photo that cannot be kept is refused before anything is read", async () => {
    const { service, state } = setup({ uploadFails: true });
    await expect(service.scan({ photo })).rejects.toMatchObject({ code: "UPLOAD_REJECTED" });
    expect(state.requests).toHaveLength(0);
  });

  it("not being able to write the usage record never loses the scan", async () => {
    const { service } = setup({
      usageFails: true,
      wines: [wine("w1", "Château Margaux", "Pavillon Rouge")],
    });
    expect((await service.scan({ photo })).outcome).toBe("found");
  });

  it("passes the side along (a back label is read the same way)", async () => {
    const { service, state } = setup();
    await service.scan({ photo, side: "back" });
    expect(state.uploads[0]!.side).toBe("back");
  });
});
