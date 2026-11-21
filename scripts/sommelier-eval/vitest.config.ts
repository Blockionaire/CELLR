import path from "node:path";
import { defineConfig } from "vitest/config";

const web = path.resolve(import.meta.dirname, "../../apps/web/src");
export default defineConfig({
  resolve: {
    alias: {
      "@": web,
      // `server-only` throws outside a React Server environment; the benchmark is server-side Node.
      "server-only": path.resolve(web, "test/server-only-stub.ts"),
    },
  },
  test: { include: ["*.test.ts"], environment: "node" },
});
