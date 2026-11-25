import fs from "node:fs";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import webpush from "web-push";
import {
  ensureCertificate,
  PUSH_CERT,
  PUSH_DIR,
} from "../../scripts/local-stack/push-receiver.mjs";

const PORT = 3100;
// A second copy of the same build with every Wine Intelligence feature switched on (CELLR_FEATURES=all). The default
// server keeps them off, as production does, so every existing spec keeps testing today's behaviour; specs for the
// new features point at this one (`test.use({ baseURL: FEATURES_URL })`).
const FEATURES_PORT = 3101;
// A third copy of the same build that declares itself a Vercel PREVIEW deployment. The Smart Cellar template gallery
// (/design/cellar-3d) is open only in `next dev` and on a Vercel preview that asked for it; a production build
// that carries no Vercel marker stays closed whatever flags are set (src/lib/cellar-gallery-gate.ts), and the two
// servers above are exactly that. So the gallery's specs point here (`test.use({ baseURL: PREVIEW_URL })`), and
// the default server is what proves that an unrecognised production build shows no gallery. Vercel's variables are
// not put on the other servers: Next itself reads VERCEL_ENV (it changes the manifest link), and no other spec
// should run under it.
const PREVIEW_PORT = 3102;
const STACK_URL = "http://localhost:54321";
// The sandbox ships Chromium at a fixed path; CI lets Playwright find its own browser. That is not the same browser:
// without a path Playwright runs its "headless shell", and a path to the full Chrome runs that instead. They differ
// where a test can see it (the headless shell reports notifications as blocked, for one). To reproduce a CI failure
// here, point PLAYWRIGHT_CHROMIUM_PATH at the headless shell (…/chromium_headless_shell-*/…/chrome-headless-shell).
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;

// Reminders: the test server sends Web Push to the local stack's fake push service (https, self-signed, trusted
// only by the test server), signed with keys made once for this machine. The config is read by every worker,
// so the keys live in a file instead of being made anew each time.
ensureCertificate();
const vapidFile = path.join(PUSH_DIR, "vapid.json");
if (!fs.existsSync(vapidFile))
  fs.writeFileSync(vapidFile, JSON.stringify(webpush.generateVAPIDKeys()));
const vapid = JSON.parse(fs.readFileSync(vapidFile, "utf8")) as {
  publicKey: string;
  privateKey: string;
};
const CRON_SECRET = "local-stack-cron"; // e2e/reminders.spec.ts knows it too

const APP_ENV: Record<string, string> = {
  NEXT_PUBLIC_SUPABASE_URL: STACK_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_localstack_0000000000",
  SUPABASE_SERVICE_ROLE_KEY: "sb_secret_localstack_00000000000000",
  DESIGN_GALLERY: "1",
  // One fixed admin (e2e/feedback.spec.ts creates this user): the /admin dashboard is otherwise closed.
  CELLR_ADMIN_USER_IDS: "00000000-0000-4000-8000-00000000ad01",
  // An OpenAI-compatible endpoint inside the local stack: tests program what it answers.
  OPENAI_API_KEY: "sk-local-stack-0000000000",
  AI_BASE_URL: STACK_URL + "/openai/v1",
  VAPID_PUBLIC_KEY: vapid.publicKey,
  VAPID_PRIVATE_KEY: vapid.privateKey,
  VAPID_SUBJECT: "mailto:tests@cellr.invalid",
  CRON_SECRET,
  // System › Health's readiness endpoint (e2e/system-health.spec.ts knows it too)
  CELLR_HEALTH_READY_TOKEN: "local-stack-ready-token-000000000000",
  NODE_EXTRA_CA_CERTS: PUSH_CERT,
};

/**
 * The specs that draw a 3D scene with software WebGL (SwiftShader on a CI runner). They are a sixth of the tests and
 * about half of the suite's time (1–5 minutes each on a busy runner), and a shard takes tests by count and in file
 * order, so they piled up in the last shards until one ran into the job's time limit (issue #77). CI therefore runs
 * them as a suite of their own (E2E_SUITE=3d) beside the rest (E2E_SUITE=core), each with its own shards. Unset, the
 * whole suite runs, as before. `scripts/e2e-suites-check.mjs` proves in CI that the two suites together are exactly
 * the whole suite: no spec is run twice or left out.
 */
export const THREE_D_SPECS = [
  /[\\/]e2e[\\/]cellar3d[^\\/]*\.spec\.ts$/,
  /[\\/]e2e[\\/]smart-cellar-3d[^\\/]*\.spec\.ts$/,
  /[\\/]e2e[\\/]storage-[^\\/]*\.spec\.ts$/,
  /[\\/]e2e[\\/]three-view\.spec\.ts$/,
  /[\\/]e2e[\\/]quick-add\.spec\.ts$/, // Smart Cellar 3D sprint 7: Quick Add in the 3D cellar
  /[\\/]e2e[\\/]visual-[^\\/]*3d[^\\/]*\.spec\.ts$/,
  /[\\/]e2e[\\/]perf-[^\\/]*3d[^\\/]*\.spec\.ts$/,
];
const SUITE = process.env.E2E_SUITE || "all";
if (!["all", "3d", "core"].includes(SUITE))
  throw new Error(`E2E_SUITE must be "3d", "core" or unset (the whole suite), not "${SUITE}"`);

export default defineConfig({
  testDir: "./e2e",
  ...(SUITE === "3d" ? { testMatch: THREE_D_SPECS } : {}),
  ...(SUITE === "core" ? { testIgnore: THREE_D_SPECS } : {}),
  outputDir: "./test-results",
  fullyParallel: true,
  // A shared CI runner now and then stalls a browser; one retry, and a retried pass is still reported as flaky.
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    // E2E_BASE_URL=http://localhost:3101 runs any existing spec against the server with every feature switched on
    // (a compatibility check; specs that drive the old picker by its buttons are expected to differ there).
    // (`||`, not `??`: CI passes an empty string when the features run was not asked for)
    baseURL: process.env.E2E_BASE_URL || `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    launchOptions: executablePath
      ? { executablePath, args: ["--no-sandbox"] }
      : { args: ["--no-sandbox"] },
  },
  projects: [
    {
      name: "phone",
      use: { ...devices["iPhone 13"], browserName: "chromium", defaultBrowserType: "chromium" },
    },
    { name: "desktop", use: { viewport: { width: 1280, height: 800 } } },
  ],
  webServer: [
    {
      // The whole backend, no Docker: Postgres + our migrations, real PostgREST, a fake Auth/gateway.
      command: "bash ../../scripts/local-stack/up.sh",
      url: STACK_URL + "/__health",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      // Give the script time to stop Postgres cleanly instead of being killed mid-teardown.
      gracefulShutdown: { signal: "SIGTERM", timeout: 15_000 },
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      command: `pnpm exec next start -p ${PORT}`,
      url: `http://localhost:${PORT}/manifest.webmanifest`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: APP_ENV,
    },
    {
      command: `pnpm exec next start -p ${FEATURES_PORT}`,
      url: `http://localhost:${FEATURES_PORT}/manifest.webmanifest`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      // The Smart Cellar API (sprint 1C) asks to write here, and must only READ: an unmarked production build.
      // ...and the same for the product's new 3D renderer (sprint 2B.3): asked for here, and it must stay CLOSED.
      env: {
        ...APP_ENV,
        CELLR_FEATURES: "all",
        // Every Sommelier V1+ part, and a name that is not one (ignored). Built so far: `check`
        // (e2e/sommelier-check.spec.ts), `annotate`, `quantities` (e2e/sommelier-cards.spec.ts) and `menu`
        // (e2e/sommelier-menu.spec.ts). The default server names none: V1 as it was, and the specs ask it too.
        CELLR_SOMMELIER: "check,annotate,quantities,menu,fallback,not-a-part",
        CELLR_SMART_CELLAR: "write",
        CELLR_SMART_CELLAR_3D: "1",
        // asked for on a production build: the Rack Builder must stay closed here (sprint 3)
        CELLR_SMART_CELLAR_BUILDER: "1",
        // ... and so must placement (sprint 4)
        CELLR_SMART_CELLAR_PLACEMENT: "1",
        CELLR_SMART_CELLAR_ADVICE: "1",
      },
    },
    {
      command: `pnpm exec next start -p ${PREVIEW_PORT}`,
      url: `http://localhost:${PREVIEW_PORT}/manifest.webmanifest`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      // what Vercel sets on a preview deployment (DESIGN_GALLERY=1 is already in APP_ENV)
      // ...and the Smart Cellar API reads and writes here (a preview is where writes may be opened, sprint 1C)
      env: {
        ...APP_ENV,
        VERCEL: "1",
        VERCEL_ENV: "preview",
        VERCEL_TARGET_ENV: "preview",
        CELLR_SMART_CELLAR: "write",
        // the cellar's 3D view uses the new renderer for places with a template here (sprint 2B.3)
        CELLR_SMART_CELLAR_3D: "1",
        // the Rack Builder is open here, and saves: the database is the local stack (sprint 3)
        CELLR_SMART_CELLAR_BUILDER: "1",
        // placing, moving and swapping bottles in the new 3D view, writing to the local stack (sprint 4)
        CELLR_SMART_CELLAR_PLACEMENT: "1",
        CELLR_SMART_CELLAR_ADVICE: "1",
      },
    },
  ],
});
