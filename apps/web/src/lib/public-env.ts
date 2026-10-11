import { z } from "zod";

/**
 * Environment values that are safe to be public (they ship in the browser bundle anyway).
 * Kept free of `server-only` so the proxy and tests can use it. Secrets live in src/server/**.
 */
const PublicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
});

export interface PublicEnv {
  supabaseUrl: string;
  supabasePublishableKey: string;
}

export function parsePublicEnv(source: Record<string, string | undefined>): PublicEnv {
  const result = PublicEnvSchema.safeParse(source);
  if (!result.success) {
    // Names only — never echo values.
    const names = [...new Set(result.error.issues.map((i) => i.path.join(".")))].join(", ");
    throw new Error(`Missing or invalid environment variables: ${names}. See .env.example.`);
  }
  return {
    supabaseUrl: result.data.NEXT_PUBLIC_SUPABASE_URL,
    supabasePublishableKey: result.data.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  };
}

let cached: PublicEnv | undefined;
export function getPublicEnv(): PublicEnv {
  return (cached ??= parsePublicEnv(process.env));
}

/** True under `next dev`. (NODE_ENV is not configuration, but it is read here so no other file touches process.env.) */
export const isDevelopment = (): boolean => process.env.NODE_ENV === "development";
