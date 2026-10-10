import { defineConfig, globalIgnores } from "eslint/config";
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores(["dist/**", "coverage/**"]),
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // The domain package is pure: no I/O, no framework, no globals that hide side effects.
      "no-restricted-globals": ["error", "fetch", "window", "document", "localStorage", "process"],
      "no-restricted-imports": [
        "error",
        {
          patterns: ["next", "next/*", "react", "react-dom", "@supabase/*", "node:*", "fs", "path"],
        },
      ],
    },
  },
]);
