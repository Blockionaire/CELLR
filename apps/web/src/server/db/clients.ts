import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { getServerEnv } from "@/server/env";
import type { Database } from "./database.types";

export type Db = SupabaseClient<Database>;

/** Cookie-session client for the web app. RLS applies as the signed-in user. */
export async function createCookieClient(): Promise<Db> {
  const { supabaseUrl, supabasePublishableKey } = getServerEnv();
  const store = await cookies();
  return createServerClient<Database>(supabaseUrl, supabasePublishableKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Called from a Server Component, where cookies are read-only. The proxy refreshes sessions.
        }
      },
    },
  });
}

/** Bearer-token client for native/mobile callers: same contract, same RLS, no cookies. */
export function createBearerClient(accessToken: string): Db {
  const { supabaseUrl, supabasePublishableKey } = getServerEnv();
  return createClient<Database>(supabaseUrl, supabasePublishableKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
