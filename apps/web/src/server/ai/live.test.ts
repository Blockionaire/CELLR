import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizeExtraction } from "@cellr/domain";
import { createOpenAiProvider } from "./openai";
import {
  LABEL_EXTRACTION_SCHEMA,
  LABEL_EXTRACTION_SYSTEM,
  LABEL_EXTRACTION_USER,
  parseLabelExtraction,
} from "./prompts/label-extraction";

/**
 * Opt-in check against the real API (it costs a few cents and needs a key): the prompt, the strict schema and
 * the guards, on real pictures of labels. Run with
 *   LIVE_AI=1 LIVE_LABEL_DIR=/path/with/jpgs OPENAI_API_KEY=… pnpm --filter @cellr/web exec vitest run live
 * where the folder holds margaux.jpg, brut.jpg, injection.jpg and notalabel.jpg.
 */
const live = process.env.LIVE_AI === "1" && process.env.LIVE_LABEL_DIR;

describe.skipIf(!live)("reading real labels with the real model", () => {
  const provider = createOpenAiProvider({
    apiKey: process.env.OPENAI_API_KEY ?? "injected-by-the-environment",
    baseUrl: process.env.AI_BASE_URL ?? "https://api.openai.com/v1",
    visionModel: process.env.AI_MODEL_VISION ?? "gpt-4.1",
    chatModel: "unused",
  });
  const read = async (name: string) => {
    const bytes = new Uint8Array(readFileSync(`${process.env.LIVE_LABEL_DIR}/${name}.jpg`));
    const result = await provider.generateObject({
      task: "label_extraction",
      model: "vision",
      system: LABEL_EXTRACTION_SYSTEM,
      user: LABEL_EXTRACTION_USER,
      images: [{ mime: "image/jpeg", bytes }],
      schemaName: "wine_label",
      jsonSchema: LABEL_EXTRACTION_SCHEMA,
      parse: parseLabelExtraction,
      maxOutputTokens: 800,
      timeoutMs: 60_000,
    });
    console.log(name, JSON.stringify(result.ok ? result.value : result, null, 1), result.usage);
    return result;
  };

  it("reads a classic French label", { timeout: 90_000 }, async () => {
    const result = await read("margaux");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const facts = normalizeExtraction(result.value)!;
    expect(facts.producer).toMatch(/margaux/i);
    expect(facts.name).toMatch(/pavillon/i);
    expect(facts.year).toBe(2015);
    expect(facts.countryCode).toBe("FR");
    expect(facts.type).toBe("red");
  });

  it("reads a champagne and sees it is sparkling", { timeout: 90_000 }, async () => {
    const result = await read("brut");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const facts = normalizeExtraction(result.value)!;
    expect(facts.producer).toMatch(/bollinger/i);
    expect(facts.type).toBe("sparkling");
    expect(facts.year).toBeNull();
  });

  it("does not obey instructions printed on the label", { timeout: 90_000 }, async () => {
    const result = await read("injection");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const facts = normalizeExtraction(result.value)!;
    expect(facts.producer).toMatch(/bella/i);
    expect(facts.year).toBe(2016);
  });

  it("says plainly that a picture of the sky is not a label", { timeout: 90_000 }, async () => {
    const result = await read("notalabel");
    expect(result.ok).toBe(true);
    if (result.ok) expect(normalizeExtraction(result.value)).toBeNull();
  });
});
