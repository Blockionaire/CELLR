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

/**
 * The platform-wide AI budget, in micro-USD (from AI_BUDGET_DAILY_USD / AI_BUDGET_MONTHLY_USD, plain dollar
 * amounts like "5" or "2.50"). Unset, empty or nonsense = no limit of that kind, never a lockout. Server only.
 */
export interface AiBudgetEnv {
  dailyUsdMicro: number | null;
  monthlyUsdMicro: number | null;
}

export function getAiBudgetEnv(): AiBudgetEnv {
  const usd = (v: string | undefined) => {
    if (!v || v.trim() === "") return null;
    const n = Number(v.trim());
    return Number.isFinite(n) && n > 0 ? Math.round(n * 1_000_000) : null;
  };
  return {
    dailyUsdMicro: usd(process.env.AI_BUDGET_DAILY_USD),
    monthlyUsdMicro: usd(process.env.AI_BUDGET_MONTHLY_USD),
  };
}

/** The keys that let this app send Web Push messages (VAPID). Null = reminders on the phone are not switched on. */
export interface PushEnv {
  publicKey: string;
  privateKey: string;
  /** Who sends: "mailto:you@example.com" or the app's https address. */
  subject: string;
}

export function getPushEnv(): PushEnv | null {
  const clean = (v: string | undefined) => v?.trim() || null;
  const publicKey = clean(process.env.VAPID_PUBLIC_KEY);
  const privateKey = clean(process.env.VAPID_PRIVATE_KEY);
  const subject = clean(process.env.VAPID_SUBJECT);
  if (!publicKey || !privateKey || !subject) return null;
  return { publicKey, privateKey, subject };
}

/** What a scheduled job must show to run (Vercel sends it as "Authorization: Bearer …"). Null = no scheduled jobs. */
export function getCronSecret(): string | null {
  return process.env.CRON_SECRET?.trim() || null;
}
