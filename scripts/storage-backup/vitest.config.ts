import { defineConfig } from "vitest/config";

// The real-stack round trip needs a running local Supabase; it is run on its own (pnpm real-stack), never here.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000,
  },
});
