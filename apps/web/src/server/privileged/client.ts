import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getServerEnv } from "@/server/env";
import type { Db } from "@/server/db/clients";
import type { Database } from "@/server/db/database.types";
import { getServiceRoleKey } from "./env";

/** Service-role client (bypasses RLS). Importable ONLY from inside src/server/privileged. */
export function createServiceClient(): Db | null {
  const key = getServiceRoleKey();
  if (!key) return null;
  return createClient<Database>(getServerEnv().supabaseUrl, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
