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
  NODE_EXTRA_CA_CERTS: PUSH_CERT,
};

export default defineConfig({
  testDir: "./e2e",
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
      env: { ...APP_ENV, CELLR_FEATURES: "all" },
    },
  ],
});
