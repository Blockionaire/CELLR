import "server-only";
import { parseAdminAllowlist } from "@cellr/domain";
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
  /** Talks: web-search valuations, and anything without its own model. */
  chatModel: string;
  /** Sommelier and wine profiles (AI_MODEL_ADVICE); the chat model when unset. */
  adviceModel: string;
  /** For models with a documented reasoning effort only (AI_REASONING_EFFORT): none (default), low or medium. */
  reasoningEffort: ReasoningEffort;
}

export type ReasoningEffort = "none" | "low" | "medium";
const EFFORTS: readonly ReasoningEffort[] = ["none", "low", "medium"];

/** Which AI is configured. Model ids are configuration, so a better one is a settings change, not a release. */
export function getAiEnv(): AiEnv {
  const clean = (v: string | undefined) => (v && v.trim() !== "" ? v.trim() : null);
  const chatModel = clean(process.env.AI_MODEL_CHAT) ?? "gpt-6-luna";
  return {
    apiKey: clean(process.env.OPENAI_API_KEY),
    baseUrl: (clean(process.env.AI_BASE_URL) ?? "https://api.openai.com/v1").replace(/\/+$/, ""),
    visionModel: clean(process.env.AI_MODEL_VISION) ?? "gpt-6-luna",
    chatModel,
    adviceModel: clean(process.env.AI_MODEL_ADVICE) ?? chatModel,
    reasoningEffort: EFFORTS.find((e) => e === clean(process.env.AI_REASONING_EFFORT)) ?? "none",
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

/**
 * Who may open the internal admin dashboard: Supabase Auth user ids from CELLR_ADMIN_USER_IDS (server only, never
 * sent to the browser). Unset, empty or malformed admits nobody.
 */
export function getAdminAllowlist(): ReadonlySet<string> {
  return parseAdminAllowlist(process.env.CELLR_ADMIN_USER_IDS);
}
