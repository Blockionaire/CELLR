import "server-only";
import {
  DomainError,
  isUsableQuad,
  LABEL_TEXT_LIMITS,
  labelPhrases,
  matchLabel,
  recognizeLabelText,
  normalizeExtraction,
  quadFromNumbers,
  confirmedFacts,
  recallScan,
  type BottleArtRef,
  type ImageSide,
  type ScanResult,
  type TextRecognition,
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
import type { CacheResult, TextMeasure } from "@/server/images/types";
import type { ScanRepository } from "./repository";

export interface ScanDeps {
  images: Pick<ImageService, "prepare" | "save">;
  /** What this household confirmed an identical photo to be (the recognition cache). */
  recall: ScanRepository["recall"];
  /**
   * The wines whose producer or name is printed on the label (Sprint S, database-first recognition). Missing =
   * the label text is not used and every photo is read by the model as before.
   */
  findByText?: ScanRepository["findByText"];
  /** Published 2D bottle pictures by wine (with verified catalogue inheritance). Missing or failing = none. */
  art?: (wineIds: string[]) => Promise<ReadonlyMap<string, BottleArtRef>>;
  /**
   * Notes what the model read on this photo, and what CELLR proposed from it, for catalogue learning (never fails
   * the scan). `proposal`: the catalogue wine proposed, or the AI's own reading when nothing matched; null when the
   * proposal was the household's own wine or several wines (nothing to learn about the catalogue).
   */
  noteRead?: (read: {
    imageId: string;
    householdId: string;
    producer: string;
    name: string;
    type: string | null;
    proposal: ScanProposal | null;
    /** Where the proposal came from (default: the vision model's reading). */
    source?: "vision" | "text";
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
/** What the phone read on the label itself (local OCR), sent along with the photo. Never stored. */
export interface LabelText {
  /** The printed text, line by line; null or empty when the OCR read nothing. */
  text: string | null;
  /** How long the OCR took on the phone (as it reports it; only used for measuring). */
  ms: number | null;
}

const clampMs = (ms: number | null | undefined) =>
  typeof ms === "number" && Number.isFinite(ms)
    ? Math.max(0, Math.min(60_000, Math.round(ms)))
    : null;

export function createScanService(deps: ScanDeps) {
  const now = deps.now ?? (() => new Date());
  const clock = () => performance.now();

  /**
   * Database-first recognition: does the printed text name exactly one known catalogue wine? Anything that goes
   * wrong (no text, the lookup unavailable, the database) only means "not from the text", and the photo is read by
   * the model as before. Returns what to record about it (never the text), or null when it was not tried.
   */
  async function fromText(
    householdId: string,
    label: LabelText | null | undefined,
  ): Promise<{
    measure: TextMeasure | null;
    match: Extract<TextRecognition, { kind: "match" }> | null;
  }> {
    if (!label || !deps.findByText) return { measure: null, match: null };
    const ocrMs = clampMs(label.ms);
    const text = (label.text ?? "").slice(0, LABEL_TEXT_LIMITS.chars);
    const phrases = labelPhrases(text);
    if (phrases.length === 0) return { measure: { result: "no_text", ocrMs }, match: null };
    const started = clock();
    try {
      const candidates = await deps.findByText(householdId, phrases);
      if (candidates === null) return { measure: null, match: null }; // the database step is not taken yet
      const found = recognizeLabelText(text, candidates, now());
      const lookupMs = clampMs(clock() - started);
      return found.kind === "match"
        ? {
            measure: {
              result: "hit",
              wineId: found.wine.id,
              year: found.facts.year,
              ocrMs,
              lookupMs,
            },
            match: found,
          }
        : { measure: { result: "miss", ocrMs, lookupMs }, match: null };
    } catch {
      return { measure: null, match: null };
    }
  }

  const artOf = async (wineId: string): Promise<BottleArtRef | null> => {
    if (!deps.art) return null;
    try {
      return (await deps.art([wineId])).get(wineId) ?? null;
    } catch {
      return null; // the drawn bottle, as before
    }
  };

  return {
    async scan(input: {
      photo: Uint8Array;
      thumb?: Uint8Array | null | undefined;
      blurColor?: string | null | undefined;
      side?: ImageSide;
      /** What the phone's own OCR read on the label (Sprint S); absent when it did not try. */
      labelText?: LabelText | null;
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

      // Database-first: a new photo of a known catalogue wine, named exactly by its printed text, needs no model.
      // An identical confirmed photo needs no text; the phone read it anyway (it cannot know before the server
      // looked), so only how long that took is kept, to measure what reading first costs on cache hits.
      const text = remembered
        ? {
            measure: input.labelText ? { ocrMs: clampMs(input.labelText.ms) } : null,
            match: null,
          }
        : await fromText(householdId, input.labelText);

      const { image, photo } = await deps.images.save(prepared, cacheResult, text.measure);
      if (text.match) {
        const { wine, facts } = text.match;
        // The catalogue wine is proposed for learning like any other match (source: the label text); a household's
        // own wine (linked to it) proposes nothing to learn about the catalogue.
        if (deps.noteRead && wine.catalog)
          await deps
            .noteRead({
              imageId: image.id,
              householdId,
              producer: wine.producer,
              name: wine.name,
              type: wine.type,
              proposal: { kind: "catalog", wineId: wine.id, year: facts.year },
              source: "text",
            })
            .catch(() => {});
        return {
          image,
          outcome: "found",
          facts,
          matches: [{ wine, score: 1 }],
          reason: null,
          // No model looked at this photo, so there is no label outline to straighten it by.
          labelCorners: null,
          fromText: true,
          art: await artOf(wine.id),
        };
      }
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
          art: await artOf(remembered.wine.id),
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
      const { outcome, matches } = matchLabel(facts, await deps.wines());
      if (deps.noteRead && facts.producer && facts.name)
        await deps
          .noteRead({
            imageId: image.id,
            householdId,
            producer: facts.producer,
            name: facts.name,
            type: facts.type,
            proposal: proposalOf(outcome, matches, facts),
          })
          .catch(() => {});

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

/** What a scan proposed, for learning whether the catalogue (or the AI's reading) was right. */
export type ScanProposal =
  | { kind: "catalog"; wineId: string; year: number | null }
  | {
      kind: "ai";
      year: number | null;
      ai: {
        producer: string;
        name: string;
        type: string | null;
        country: string | null;
        region: string | null;
      };
    };

/**
 * A single catalogue wine found, or the AI's own reading when nothing matched. A household's own wine, or a choice
 * between several, proposes nothing to learn from.
 */
export function proposalOf(
  outcome: ScanResult["outcome"],
  matches: ScanResult["matches"],
  facts: NonNullable<ScanResult["facts"]>,
): ScanProposal | null {
  const top = matches[0];
  if (outcome === "found" && top?.wine.catalog)
    return { kind: "catalog", wineId: top.wine.id, year: facts.year };
  if (outcome === "new" && facts.producer && facts.name)
    return {
      kind: "ai",
      year: facts.year,
      ai: {
        producer: facts.producer,
        name: facts.name,
        type: facts.type,
        country: facts.countryCode,
        region: facts.region,
      },
    };
  return null;
}
