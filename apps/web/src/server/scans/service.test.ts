import { describe, expect, it } from "vitest";
import { DomainError, type RawExtraction, type WineSummary } from "@cellr/domain";
import type { GenerateObjectRequest, LlmProvider } from "@/server/ai/types";
import type { Confirmation } from "./repository";
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
  label_corners: null,
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
    answer?:
      RawExtraction | "invalid" | "unavailable" | "timeout" | "rate_limited" | "refused" | "budget";
    wines?: WineSummary[];
    noAi?: boolean;
    spend?: () => Promise<void>;
    uploadFails?: boolean;
    usageFails?: boolean;
    /** Confirmations per fingerprint (the cache), or how the cache fails. */
    recall?: Record<string, Confirmation[]> | "unavailable" | "throws";
  } = {},
) {
  const state = {
    uploads: [] as Array<{ photo: Uint8Array; side: string; cacheResult: string | null }>,
    recalls: [] as Array<{ householdId: string; fingerprint: string }>,
    reads: [] as Array<{ imageId: string; householdId: string; producer: string; name: string }>,
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
      prepare(input) {
        if (options.uploadFails) throw new DomainError("UPLOAD_REJECTED");
        // The fake fingerprint is the photo itself, so the same bytes give the same one.
        const fingerprint = Array.from(input.photo, (b) => b.toString(16).padStart(2, "0")).join(
          "",
        );
        return {
          ...input,
          photo: cleanPhoto,
          width: 600,
          height: 800,
          thumb: null,
          blurColor: null,
          fingerprint,
        };
      },
      async save(prepared, cacheResult = null) {
        state.uploads.push({ photo: prepared.photo, side: prepared.side, cacheResult });
        return {
          image: { id: "img1", side: prepared.side, blurColor: "#aabbcc", width: 600, height: 800 },
          photo: cleanPhoto,
        };
      },
    },
    noteRead: async (read) => {
      state.reads.push(read);
    },
    recall: async (householdId, fingerprint) => {
      state.recalls.push({ householdId, fingerprint });
      if (options.recall === "throws") throw new Error("database unavailable");
      if (options.recall === "unavailable") return null;
      return options.recall?.[fingerprint] ?? [];
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
  it("passes on where the label is when it is believable in this photo, and only then", async () => {
    const good = [0.2, 0.15, 0.8, 0.15, 0.8, 0.85, 0.2, 0.85];
    const believable = await setup({ answer: raw({ label_corners: good }) }).service.scan({
      photo,
    });
    expect(believable.labelCorners).toEqual([
      { x: 0.2, y: 0.15 },
      { x: 0.8, y: 0.15 },
      { x: 0.8, y: 0.85 },
      { x: 0.2, y: 0.85 },
    ]);
    for (const bad of [
      [0.2, 0.15, 0.8, 0.15, 0.8], // too few
      [0.5, 0.5, 0.52, 0.5, 0.52, 0.52, 0.5, 0.52], // a speck
      [0.2, 0.85, 0.8, 0.85, 0.8, 0.15, 0.2, 0.15], // the wrong way round
    ]) {
      const result = await setup({ answer: raw({ label_corners: bad }) }).service.scan({ photo });
      expect(result.labelCorners).toBeNull();
      expect(result.outcome).not.toBe("unread"); // the reading itself is unaffected
    }
    expect((await setup().service.scan({ photo })).labelCorners).toBeNull();
  });

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

  it("the platform's AI budget spent: its own reason, so a batch stops sending photos", async () => {
    const { service, state } = setup({ answer: "budget" });
    const result = await service.scan({ photo });
    expect(result).toMatchObject({ outcome: "unread", reason: "budget", image: { id: "img1" } });
    expect(state.usage[0]!.status).toBe("budget_exhausted");
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

  describe("the recognition cache", () => {
    const margaux = wine("w1", "Château Margaux", "Pavillon Rouge");
    const confirmed = { "010203": [{ wineId: "w1", year: 2015 }] };

    it("the first scan of a photo nobody confirmed is read by the model, and counted as a miss", async () => {
      const { service, state } = setup({ wines: [margaux] });
      const result = await service.scan({ photo });
      expect(state.recalls).toEqual([{ householdId: "h1", fingerprint: "010203" }]);
      expect(state.requests).toHaveLength(1);
      expect(state.uploads[0]!.cacheResult).toBe("miss");
      expect(result.remembered).toBeUndefined();
    });

    it("a photo confirmed before is answered without the model, the budget or a usage record", async () => {
      let spent = 0;
      const { service, state } = setup({
        wines: [margaux, wine("w2", "Château Latour", "Les Forts")],
        recall: confirmed,
        spend: async () => {
          spent += 1;
        },
      });
      const result = await service.scan({ photo });
      expect(state.requests).toHaveLength(0);
      expect(spent).toBe(0);
      expect(state.usage).toHaveLength(0);
      expect(state.uploads[0]!.cacheResult).toBe("hit");
      // The same contract as a reading: a suggestion of the confirmed wine and year, for the person to confirm.
      expect(result).toMatchObject({
        outcome: "found",
        reason: null,
        image: { id: "img1" },
        facts: {
          producer: "Château Margaux",
          name: "Pavillon Rouge",
          year: 2015,
          nonVintage: false,
        },
        remembered: true,
        labelCorners: null,
      });
      expect(result.matches).toEqual([{ wine: margaux, score: 1 }]);
    });

    it("a remembered photo works without AI configured, and even when the scan limit is spent", async () => {
      const off = setup({ noAi: true, wines: [margaux], recall: confirmed });
      expect((await off.service.scan({ photo })).remembered).toBe(true);
      const spentOut = setup({
        wines: [margaux],
        recall: confirmed,
        spend: async () => {
          throw new DomainError("RATE_LIMITED");
        },
      });
      expect(await spentOut.service.scan({ photo })).toMatchObject({
        outcome: "found",
        remembered: true,
      });
    });

    it("disagreeing confirmations, or a wine that is no longer there, go to the model as before", async () => {
      const disagree = setup({
        wines: [margaux],
        recall: {
          "010203": [
            { wineId: "w1", year: 2015 },
            { wineId: "w1", year: 2016 },
          ],
        },
      });
      expect((await disagree.service.scan({ photo })).remembered).toBeUndefined();
      expect(disagree.state.requests).toHaveLength(1);
      expect(disagree.state.uploads[0]!.cacheResult).toBe("miss");

      const gone = setup({ wines: [], recall: confirmed });
      await gone.service.scan({ photo });
      expect(gone.state.requests).toHaveLength(1);
    });

    it("another photo is never answered from this one's confirmation", async () => {
      const { service, state } = setup({ wines: [margaux], recall: confirmed });
      await service.scan({ photo: new Uint8Array([1, 2, 4]) });
      expect(state.requests).toHaveLength(1);
    });

    it("when the cache is not set up or fails, scanning carries on exactly as before", async () => {
      for (const recall of ["unavailable", "throws"] as const) {
        const { service, state } = setup({ wines: [margaux], recall });
        const result = await service.scan({ photo });
        expect(result.outcome).toBe("found");
        expect(state.requests).toHaveLength(1);
        expect(state.uploads[0]!.cacheResult).toBeNull();
      }
    });
  });

  describe("catalogue learning", () => {
    it("what the model read on the photo is noted for the household, once per reading", async () => {
      const { service, state } = setup({ wines: [] });
      await service.scan({ photo });
      expect(state.reads).toEqual([
        {
          imageId: "img1",
          householdId: "h1",
          producer: "Château Margaux",
          name: "Pavillon Rouge",
          type: "red",
        },
      ]);
    });

    it("nothing is noted without a real reading (remembered, not a label, AI down)", async () => {
      const remembered = setup({
        wines: [wine("w1", "Château Margaux", "Pavillon Rouge")],
        recall: { "010203": [{ wineId: "w1", year: 2015 }] },
      });
      await remembered.service.scan({ photo });
      const notLabel = setup({ answer: raw({ is_wine_label: false }) });
      await notLabel.service.scan({ photo });
      const down = setup({ answer: "unavailable" });
      await down.service.scan({ photo });
      expect([...remembered.state.reads, ...notLabel.state.reads, ...down.state.reads]).toEqual([]);
    });
  });
});
