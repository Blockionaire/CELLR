import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * Architecture rules (docs/00-architecture-plan.md §3.2). They are lint errors, not guidelines,
 * and src/test/architecture.test.ts proves they actually reject illegal imports.
 *
 *   app → features/ui → lib → (HTTP) → api/v1 → services → repositories → db
 *
 * `no-restricted-imports` blocks must cover DISJOINT file sets: in flat config the last matching
 * block replaces the options of earlier ones instead of merging with them.
 */
const SUPABASE = {
  group: ["@supabase/*"],
  message:
    "Supabase may only be imported in server/**/repository.ts, server/db, server/privileged.",
};
const NO_SERVER_INTERNALS = {
  group: [
    "@/server/*/repository",
    "@/server/db",
    "@/server/db/*",
    "@/server/privileged",
    "@/server/privileged/*",
  ],
  message:
    "Go through a service. Repositories, db clients and privileged code are server-internal.",
};
const NO_UI_LAYERS = {
  group: ["@/features/*", "@/ui/*", "@/app/*"],
  message: "Server code must not depend on UI layers.",
};

const TESTS = ["**/*.test.ts", "**/*.test.tsx", "src/test/**"];
const DATA_ACCESS = [
  "src/server/**/repository.ts",
  "src/server/db/**",
  "src/server/privileged/**",
  "src/server/auth/gateway.ts",
];

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "next-env.d.ts",
    "public/**",
    "playwright-report/**",
    "test-results/**",
  ]),

  // Client-side layers never touch the server or Supabase.
  {
    files: ["src/ui/**", "src/features/**", "src/lib/**"],
    ignores: TESTS,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            SUPABASE,
            {
              group: ["@/server/*", "server-only"],
              message: "Client code calls /api/v1, never server modules.",
            },
          ],
        },
      ],
    },
  },
  // Routes (RSC + /api/v1 handlers) compose services; they never reach into data access.
  {
    files: ["src/app/**", "src/proxy.ts"],
    ignores: [...TESTS, "src/proxy.ts"],
    rules: { "no-restricted-imports": ["error", { patterns: [SUPABASE, NO_SERVER_INTERNALS] }] },
  },
  // Services and other server code: no Supabase, no UI.
  {
    files: ["src/server/**/*.ts"],
    ignores: [...TESTS, ...DATA_ACCESS],
    rules: { "no-restricted-imports": ["error", { patterns: [SUPABASE, NO_UI_LAYERS] }] },
  },
  // The only places allowed to talk to Supabase.
  {
    files: DATA_ACCESS,
    ignores: TESTS,
    rules: { "no-restricted-imports": ["error", { patterns: [NO_UI_LAYERS] }] },
  },

  // Environment variables are read in exactly two files; the service-role key in exactly one.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      ...TESTS,
      "src/server/env.ts",
      "src/server/privileged/env.ts",
      "src/lib/public-env.ts",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message: "Read env through src/server/env.ts (server) or src/lib/public-env.ts (public).",
        },
      ],
    },
  },
]);
