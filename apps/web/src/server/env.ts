import "server-only";
import { adviceOpenIn } from "@/lib/smart-cellar-advice-gate";
import { parseAdminAllowlist, parseFeatures, type FeatureFlags } from "@cellr/domain";
import { builderAccessIn, type BuilderAccess } from "@/lib/smart-cellar-builder-gate";
import { placementAccessIn, type PlacementAccess } from "@/lib/smart-cellar-placement-gate";
import { cellarGalleryOpenIn } from "@/lib/cellar-gallery-gate";
import { smartCellarAccessIn, type SmartCellarAccess } from "@/lib/smart-cellar-gate";
import { smartCellarRendererOpenIn } from "@/lib/smart-cellar-renderer-gate";
import { demoOriginsIn } from "@/lib/demo-origins";
import { getPublicEnv, isDevelopment, type PublicEnv } from "@/lib/public-env";

/** Server-side view of the environment. Validated lazily, so `next build` works without secrets. */
export type ServerEnv = PublicEnv;

export function getServerEnv(): ServerEnv {
  return getPublicEnv();
}

/** The /design gallery is for development and for Vercel *preview* deployments (set DESIGN_GALLERY=1 there). */
/** The exact origins the local demonstration's server also accepts for changes (see lib/demo-origins.ts). */
export function getTrustedDemoOrigins(): ReadonlySet<string> {
  return demoOriginsIn(process.env);
}

export function isDesignGalleryEnabled(): boolean {
  return isDevelopment() || process.env.DESIGN_GALLERY === "1";
}

/**
 * The Smart Cellar template gallery (/design/cellar-3d) has a stricter gate of its own: local development, a Vercel
 * preview deployment that asked for it, never a production deployment whatever is set. The rule and its reasons:
 * lib/cellar-gallery-gate.ts. `isDesignGalleryEnabled` above is unchanged and still decides /design.
 */
export function isCellarGalleryEnabled(): boolean {
  return cellarGalleryOpenIn(process.env);
}

/**
 * Whether the Smart Cellar API reads and writes here (CELLR_SMART_CELLAR: off | read | write). Writes are never open
 * on production, whatever is set. The rule and its reasons: lib/smart-cellar-gate.ts.
 */
export function getSmartCellarAccess(): SmartCellarAccess {
  return smartCellarAccessIn(process.env);
}

/**
 * Whether the cellar's 3D view may use the new storage renderer for places with a template (CELLR_SMART_CELLAR_3D=1,
 * in `next dev` and on Vercel previews only; never on production, never where the deployment cannot be told). The
 * rule and its reasons: lib/smart-cellar-renderer-gate.ts.
 */
export function isSmartCellarRendererEnabled(): boolean {
  return smartCellarRendererOpenIn(process.env, getSmartCellarAccess());
}

/**
 * Whether the Rack Builder may be shown here (CELLR_SMART_CELLAR_BUILDER=1, `next dev` and Vercel previews only),
 * and whether it may save (the API's write level, which also needs a database known not to be production). The
 * rule and its reasons: lib/smart-cellar-builder-gate.ts.
 */
export function getBuilderAccess(): BuilderAccess {
  return builderAccessIn(process.env, getSmartCellarAccess());
}

/**
 * Whether bottles may be placed, moved and swapped through the new cellar view (CELLR_SMART_CELLAR_PLACEMENT=1, dev
 * and previews only), whether that may write (the API's write level, a test database only) and whether depth may
 * be written (never in this version). The rule and its reasons: lib/smart-cellar-placement-gate.ts.
 */
export function getPlacementAccess(): PlacementAccess {
  return placementAccessIn(process.env, getSmartCellarAccess());
}

/**
 * Whether placement advice may be given: CELLR_SMART_CELLAR_ADVICE (lib/smart-cellar-advice-gate.ts, sprint 5).
 * Read-only, never more than the placement gate.
 */
export function isAdviceOpen(): boolean {
  return adviceOpenIn(process.env, getPlacementAccess());
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

/**
 * Which Wine Intelligence features are switched on in this deployment: names from CELLR_FEATURES, comma-separated
 * (or "all"). Unset = everything off, so every flow works as it did before. Server only: pages pass the booleans on.
 */
export function getFeatures(): FeatureFlags {
  return parseFeatures(process.env.CELLR_FEATURES);
}

/**
 * Optional settings of the health monitor (System Intelligence sprint 2, docs/sprints/system-health/OPERATIONS.md).
 * Every one may be unset: what it switches on then shows `unknown` (not configured), never healthy, and nothing
 * else changes. Server only; none of these values is ever shown or logged.
 */
export interface HealthEnv {
  /** Bearer token for GET /api/health/ready (an external uptime check). Null = that endpoint answers 404. */
  readyToken: string | null;
  /**
   * The secret that starts a probe round (GET /api/cron/health), held by whatever triggers rounds (an external
   * uptime provider). Its own secret, so that caller cannot also start the drink-reminder cron; null = the round
   * falls back to CRON_SECRET. At least 16 characters.
   */
  roundSecret: string | null;
  /**
   * An https URL the monitor calls after every recorded round: a dead man's switch at an external uptime provider,
   * which alerts when the calls stop. Null = no call.
   */
  pingUrl: string | null;
  /** CI status of the main branch from GitHub Actions: "owner/repo" and a read-only token. Null = not configured. */
  github: { repo: string; token: string } | null;
  /** The newest production deployment from Vercel: project id, team id and a read token. Null = not configured. */
  vercel: { projectId: string; teamId: string | null; token: string } | null;
}

export function getHealthEnv(): HealthEnv {
  const clean = (v: string | undefined) => v?.trim() || null;
  const httpsUrl = (v: string | null) => {
    if (!v) return null;
    try {
      const u = new URL(v);
      return u.protocol === "https:" && !u.username && !u.password ? u.toString() : null;
    } catch {
      return null;
    }
  };
  const repo = clean(process.env.CELLR_HEALTH_GITHUB_REPO);
  const githubToken = clean(process.env.CELLR_HEALTH_GITHUB_TOKEN);
  const projectId = clean(process.env.CELLR_HEALTH_VERCEL_PROJECT_ID);
  const vercelToken = clean(process.env.CELLR_HEALTH_VERCEL_TOKEN);
  const readyToken = clean(process.env.CELLR_HEALTH_READY_TOKEN);
  const roundSecret = clean(process.env.CELLR_HEALTH_ROUND_SECRET);
  return {
    // a short token would be guessable: refuse it rather than guard the endpoint weakly
    readyToken: readyToken && readyToken.length >= 24 ? readyToken : null,
    roundSecret: roundSecret && roundSecret.length >= 16 ? roundSecret : null,
    pingUrl: httpsUrl(clean(process.env.CELLR_HEALTH_PING_URL)),
    github:
      repo &&
      githubToken &&
      /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) &&
      !repo.split("/").some((part) => part === "." || part === "..")
        ? { repo, token: githubToken }
        : null,
    vercel:
      projectId && vercelToken && /^[A-Za-z0-9_-]+$/.test(projectId)
        ? {
            projectId,
            teamId: /^[A-Za-z0-9_-]+$/.test(clean(process.env.CELLR_HEALTH_VERCEL_TEAM_ID) ?? "")
              ? clean(process.env.CELLR_HEALTH_VERCEL_TEAM_ID)
              : null,
            token: vercelToken,
          }
        : null,
  };
}
