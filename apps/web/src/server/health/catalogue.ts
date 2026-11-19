import "server-only";
import { HEALTH_STALE_SEC, type ProbeDefinition } from "@cellr/domain";

/**
 * WHAT THE HEALTH MONITOR MEASURES (System Intelligence sprint 2, ADR-002). Every probe, the architecture-register
 * components it speaks for, and — as plainly — what a pass does not show. Public by design (the repository is
 * public): it says what is measured, never what was measured.
 *
 * Kept true by src/server/system/health-catalogue.test.ts: every component id exists in the register, the buckets
 * and pg_cron jobs below are exactly the ones the migrations create, and every AI task the code records has a
 * probe.
 */

/** Storage buckets every deployment must have (the migrations create them; Storage is checked against this). */
export const EXPECTED_BUCKETS = [
  "bottle-art",
  "bottle-images",
  "bottle-submissions",
  "catalog-labels",
  "tasting-images",
  "user-avatars",
  "wine-labels",
] as const;

/** pg_cron jobs the migrations schedule, and what each is for. */
export const EXPECTED_CRON_JOBS = [
  { name: "catalog-scan-reads-purge", purpose: "Deletes old scan reads (catalogue learning)" },
  { name: "health-samples-purge", purpose: "Keeps 14 days of health history" },
  { name: "sommelier-conversations-purge", purpose: "Deletes expired sommelier conversations" },
] as const;

/** Every AI task the code records in ai_usage, and the components whose features it serves. */
export const AI_TASKS = [
  { task: "label_extraction", label: "Label scanning", components: ["svc-scans"] },
  { task: "purchase_check", label: "Koopcheck", components: ["svc-purchase-check"] },
  {
    task: "purchase_explanation",
    label: "Koopcheck explanation",
    components: ["svc-purchase-check"],
  },
  { task: "sommelier_chat", label: "Sommelier chat", components: ["svc-sommelier-chat"] },
  { task: "wine_insight", label: "Wine profiles", components: ["svc-insights"] },
  { task: "wine_valuation", label: "Valuations", components: ["svc-insights"] },
] as const;

const stale = HEALTH_STALE_SEC;

export const PROBES: readonly ProbeDefinition[] = [
  {
    id: "monitor.round",
    label: "Monitoring round",
    kind: "monitor",
    components: ["health-monitor"],
    staleAfterSec: stale,
    proves:
      "A round of these checks ran on the server and was recorded: the heartbeat reached the app, the probe route answered and the database stored the result.",
    doesNotProve:
      "That anything the checks do not cover works. When rounds stop, every check here turns unknown; an outside alert for that is the external heartbeat's job (OPERATIONS.md).",
  },
  {
    id: "db.read",
    label: "Database read",
    kind: "infrastructure",
    components: ["supabase-postgres"],
    staleAfterSec: stale,
    proves:
      "The API layer (PostgREST) and Postgres answer a read with the service role, within the time shown.",
    doesNotProve:
      "That reads under row-level security work for people, that any one table is reachable, or that queries other than this one are fast.",
  },
  {
    id: "db.write",
    label: "Database write",
    kind: "infrastructure",
    components: ["supabase-postgres"],
    staleAfterSec: stale,
    proves: "Postgres accepts a write (the round's own row) and commits it.",
    doesNotProve: "That writes to other tables succeed, or that the database has room to grow.",
  },
  {
    id: "auth.api",
    label: "Sign-in service",
    kind: "infrastructure",
    components: ["supabase-auth"],
    staleAfterSec: stale,
    proves: "Supabase Auth (GoTrue) answers its health endpoint through the gateway.",
    doesNotProve: "That sign-in e-mails are delivered, or that a person can sign in end to end.",
  },
  {
    id: "storage.api",
    label: "File storage",
    kind: "infrastructure",
    components: ["supabase-storage"],
    staleAfterSec: stale,
    proves:
      "The Storage API answers with the service role, and every bucket the migrations create exists.",
    doesNotProve:
      "That uploads or downloads work, that Storage policies let the right people in, or that files are backed up.",
  },
  {
    id: "cron.extension",
    label: "Job scheduler",
    kind: "job",
    components: ["pg-cron"],
    staleAfterSec: stale,
    proves: "pg_cron is installed and its job list can be read.",
    doesNotProve: "That any one job runs; each has its own check below.",
  },
  ...EXPECTED_CRON_JOBS.map((j): ProbeDefinition => ({
    id: `cron.${j.name}`,
    label: `Job: ${j.name}`,
    kind: "job",
    components: ["pg-cron"],
    staleAfterSec: stale,
    proves: `${j.purpose}: the job is scheduled and active, its newest run did not fail, and it ran within three of its intervals (pg_cron's own run history).`,
    doesNotProve:
      "That the job did all its work: pg_cron records that the statement finished, not what it changed.",
  })),
  {
    id: "ai.all",
    label: "AI calls (all features)",
    kind: "traffic",
    components: ["ai-gateway", "openai"],
    staleAfterSec: stale,
    proves:
      "Real AI calls of the last hour mostly succeeded, few fell back to the plain version, and they were not too slow (from ai_usage; no test call is made).",
    doesNotProve:
      "Anything when nobody used an AI feature in the last hour (unknown), or that the answers were good.",
  },
  ...AI_TASKS.map((t): ProbeDefinition => ({
    id: `ai.${t.task}`,
    label: `AI: ${t.label}`,
    kind: "traffic",
    components: [...t.components],
    staleAfterSec: stale,
    proves: `Real ${t.label.toLowerCase()} calls of the last hour mostly succeeded and fell back rarely (from ai_usage).`,
    doesNotProve:
      "That the feature works for people: only its AI step is measured, and only when it was used in the last hour.",
  })),
  {
    id: "delivery.ci",
    label: "CI on main",
    kind: "delivery",
    components: ["github-actions"],
    staleAfterSec: stale,
    proves: "The newest GitHub Actions run on the main branch passed.",
    doesNotProve:
      "That production runs that code, or that flaky end-to-end tests are not hiding a regression. Unknown until a read-only GitHub token is configured.",
  },
  {
    id: "delivery.deploy",
    label: "Production deployment",
    kind: "delivery",
    components: ["vercel"],
    staleAfterSec: stale,
    proves: "Vercel's newest production deployment is ready (not failed or cancelled).",
    doesNotProve:
      "That the app answers people: that is the external heartbeat's to show. Unknown until a Vercel read token is configured.",
  },
];

export const PROBE_IDS: ReadonlySet<string> = new Set(PROBES.map((p) => p.id));
