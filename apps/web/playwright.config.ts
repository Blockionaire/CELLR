import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const STACK_URL = "http://localhost:54321";
// The sandbox ships Chromium at a fixed path; CI lets Playwright find its own browser.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  fullyParallel: true,
  // A shared CI runner now and then stalls a browser; one retry, and a retried pass is still reported as flaky.
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
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
      env: {
        NEXT_PUBLIC_SUPABASE_URL: STACK_URL,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_localstack_0000000000",
        SUPABASE_SERVICE_ROLE_KEY: "sb_secret_localstack_00000000000000",
        DESIGN_GALLERY: "1",
        // An OpenAI-compatible endpoint inside the local stack: tests program what it answers.
        OPENAI_API_KEY: "sk-local-stack-0000000000",
        AI_BASE_URL: STACK_URL + "/openai/v1",
      },
    },
  ],
});
