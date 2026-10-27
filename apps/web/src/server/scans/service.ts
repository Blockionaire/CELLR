import "server-only";
import {
  DomainError,
  isUsableQuad,
  matchLabel,
  normalizeExtraction,
  quadFromNumbers,
  confirmedFacts,
  recallScan,
  type ImageSide,
  type ScanResult,
  type WineSummary,
} from "@cellr/domain";
import type { AiErrorKind, AiUsage, LlmProvider } from "@/server/ai";
import {
  LABEL_EXTRACTION_SCHEMA,
  LABEL_EXTRACTION_SYSTEM,
  LABEL_EXTRACTION_USER,
  parseLabelExtraction,
} from "@/server/ai/prompts/label-extraction";
import type { ImageService, UploadInput } from "@/server/images/service";
import type { CacheResult } from "@/server/images/types";
import type { ScanRepository } from "./repository";

export interface ScanDeps {
  images: Pick<ImageService, "prepare" | "save">;
  /** What this household confirmed an identical photo to be (the recognition cache). */
  recall: ScanRepository["recall"];
  /** Notes what the model read on this photo, for catalogue learning (never fails the scan). */
  noteRead?: (read: {
    imageId: string;
    householdId: string;
    producer: string;
    name: string;
    type: string | null;
  }) => Promise<void>;
  /** The wines this household can choose from. */
  wines: () => Promise<WineSummary[]>;
  householdId: () => Promise<string>;
  /** Null = no AI configured: the photo is kept and the person fills the wine in by hand. */
  llm: LlmProvider | null;
  /** Spends from the scan budget; throws RATE_LIMITED when it is gone. */
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

/**
 * Point the phone at a label: the photo is kept first (so nothing the person did is ever lost), then read by
 * a vision model, then checked and matched against the wines already in the household by plain code. An
 * identical photo this household already confirmed is answered from that confirmation, without the model. Every
 * way it can go wrong ends in the same place: the photo is kept and the person fills the wine in by hand.
 */
export function createScanService(deps: ScanDeps) {
  const now = deps.now ?? (() => new Date());

  return {
    async scan(input: {
      photo: Uint8Array;
      thumb?: Uint8Array | null | undefined;
      blurColor?: string | null | undefined;
      side?: ImageSide;
    }): Promise<ScanResult> {
      const upload: UploadInput = {
        side: input.side ?? "front",
        photo: input.photo,
        thumb: input.thumb,
        blurColor: input.blurColor,
      };
      const prepared = deps.images.prepare(upload);
      const householdId = await deps.householdId();

      // The recognition cache, before any budget is spent or model asked: this exact photo, confirmed before in
      // this household. Whatever goes wrong here (not set up yet, the database, disagreeing confirmations) only
      // means "not remembered", and the photo is read as before.
      let remembered: ReturnType<typeof recallScan> = null;
      let cacheResult: CacheResult | null = null;
      try {
        const confirmations = await deps.recall(householdId, prepared.fingerprint);
        if (confirmations) {
          remembered =
            confirmations.length > 0 ? recallScan(confirmations, await deps.wines()) : null;
          cacheResult = remembered ? "hit" : "miss";
        }
      } catch {
        remembered = null;
        cacheResult = null;
      }

      const { image, photo } = await deps.images.save(prepared, cacheResult);
      if (remembered)
        return {
          image,
          outcome: "found",
          facts: confirmedFacts(remembered.wine, remembered.year),
          matches: [{ wine: remembered.wine, score: 1 }],
          reason: null,
          // Corners belong to one photo; this is a new upload, so none are carried over.
          labelCorners: null,
          remembered: true,
        };
      const unread = (reason: NonNullable<ScanResult["reason"]>): ScanResult => ({
        image,
        outcome: "unread",
        facts: null,
        matches: [],
        reason,
        labelCorners: null,
      });

      if (!deps.llm) return unread("ai-off");
      try {
        await deps.spendScan();
      } catch (error) {
        if (error instanceof DomainError && error.code === "RATE_LIMITED") return unread("limit");
        throw error;
      }

      const result = await deps.llm.generateObject({
        task: "label_extraction",
        model: "vision",
        system: LABEL_EXTRACTION_SYSTEM,
        user: LABEL_EXTRACTION_USER,
        images: [{ mime: "image/jpeg", bytes: photo }],
        schemaName: "wine_label",
        jsonSchema: LABEL_EXTRACTION_SCHEMA,
        parse: parseLabelExtraction,
        maxOutputTokens: 800,
        timeoutMs: 40_000,
      });
      await deps
        .recordUsage({
          householdId,
          task: "label_extraction",
          status: result.ok ? "ok" : STATUS[result.kind],
          usage: result.usage,
        })
        .catch(() => {});

      if (!result.ok) return unread(result.kind === "budget" ? "budget" : "ai-down");
      const facts = normalizeExtraction(result.value, now());
      if (!facts) return unread("not-a-label");
      if (deps.noteRead && facts.producer && facts.name)
        await deps
          .noteRead({
            imageId: image.id,
            householdId,
            producer: facts.producer,
            name: facts.name,
            type: facts.type,
          })
          .catch(() => {});

      const { outcome, matches } = matchLabel(facts, await deps.wines());
      // The model's idea of where the label is only counts if it is a believable label in this very photo.
      const corners = quadFromNumbers(result.value.label_corners);
      const labelCorners =
        corners && image.width && image.height && isUsableQuad(corners, image.width, image.height)
          ? corners
          : null;
      return { image, outcome, facts, matches, reason: null, labelCorners };
    },
  };
}

export type ScanService = ReturnType<typeof createScanService>;
