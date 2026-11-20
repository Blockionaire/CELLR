import { defineConfig, devices } from "@playwright/test";

/**
 * Smart Cellar 3D, sprint 6: tests against the RUNNING demonstration environment (scripts/demo/up.sh), not against
 * servers of their own. Start the demo first, then:
 *   pnpm exec playwright test -c playwright.demo.config.ts
 * DEMO_URL / DEMO_READONLY_URL point elsewhere (defaults: the demo's localhost ports).
 */
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;
export default defineConfig({
  testDir: "./e2e-demo",
  outputDir: "./test-results/demo",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  timeout: 300_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL: process.env.DEMO_URL || "http://localhost:3200",
    trace: "retain-on-failure",
    launchOptions: executablePath
      ? { executablePath, args: ["--no-sandbox"] }
      : { args: ["--no-sandbox"] },
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
    {
      name: "phone",
      use: { ...devices["iPhone 13"], browserName: "chromium", defaultBrowserType: "chromium" },
    },
  ],
});
