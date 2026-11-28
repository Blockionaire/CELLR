import path from "node:path";
import { defineConfig } from "vitest/config";

// Pool size: vitest's default (one worker per core, less one). The root `pnpm test` runs the workspace suites one
// after the other, so this suite has the machine to itself. Run side by side (`pnpm -r --parallel`), six suites put
// six times that many workers on the same cores, and heavy tests ran past the 5 s timeout on CI runners.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      // `server-only` throws outside a React Server environment; tests are server-side Node, so stub it.
      "server-only": path.resolve(import.meta.dirname, "src/test/server-only-stub.ts"),
    },
  },
  test: { include: ["src/**/*.test.ts", "src/**/*.test.tsx"], environment: "node" },
});
