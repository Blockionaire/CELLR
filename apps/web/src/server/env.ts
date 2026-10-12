import "server-only";
import { getPublicEnv, isDevelopment, type PublicEnv } from "@/lib/public-env";

/** Server-side view of the environment. Validated lazily, so `next build` works without secrets. */
export type ServerEnv = PublicEnv;

export function getServerEnv(): ServerEnv {
  return getPublicEnv();
}

/** The /design gallery is for development and for Vercel *preview* deployments (set DESIGN_GALLERY=1 there). */
export function isDesignGalleryEnabled(): boolean {
  return isDevelopment() || process.env.DESIGN_GALLERY === "1";
}

export interface AiEnv {
  /** Null = no AI key: every AI feature falls back to its plain version. */
  apiKey: string | null;
  /** Any OpenAI-compatible endpoint. */
  baseUrl: string;
  /** Reads pictures (label scanning). */
  visionModel: string;
  /** Talks (sommelier, explanations). */
  chatModel: string;
}

/** Which AI is configured. Model ids are configuration, so a better one is a settings change, not a release. */
export function getAiEnv(): AiEnv {
  const clean = (v: string | undefined) => (v && v.trim() !== "" ? v.trim() : null);
  return {
    apiKey: clean(process.env.OPENAI_API_KEY),
    baseUrl: (clean(process.env.AI_BASE_URL) ?? "https://api.openai.com/v1").replace(/\/+$/, ""),
    visionModel: clean(process.env.AI_MODEL_VISION) ?? "gpt-4.1",
    chatModel: clean(process.env.AI_MODEL_CHAT) ?? "gpt-4.1-mini",
  };
}
