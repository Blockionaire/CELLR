import { devices } from "@playwright/test";
import base from "./playwright.config";

/**
 * The Tonight hero on WebKit (Safari's engine), at the iPhone's size: `pnpm exec playwright test -c
 * playwright.webkit.config.ts`. Needs Playwright's WebKit (`pnpm exec playwright install --with-deps webkit`), which
 * the default run does not install; the same test server as the main config.
 */
export default {
  ...base,
  testMatch: ["home-hero.spec.ts"],
  projects: [
    {
      name: "webkit-phone",
      use: { ...devices["iPhone 13"], browserName: "webkit" as const, launchOptions: {} },
    },
  ],
};
