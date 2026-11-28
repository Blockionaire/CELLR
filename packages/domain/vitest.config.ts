import { defineConfig } from "vitest/config";

// Pool size: vitest's default. The root `pnpm test` runs the workspace suites one after the other, so this suite
// has the machine to itself (see apps/web/vitest.config.ts).

export default defineConfig({ test: { include: ["src/**/*.test.ts"], environment: "node" } });
