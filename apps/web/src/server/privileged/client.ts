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

/**
 * The health probes' service-role client (System Intelligence sprint 2): every request it makes is abandoned after
 * `timeoutMs`, and marked `x-cellr-probe: 1` so probe traffic can be told apart in logs (and, in the local test
 * stack, given a simulated outage). Null when the service role is not configured.
 */
export function createProbeClient(timeoutMs: number): Db | null {
  const key = getServiceRoleKey();
  if (!key) return null;
  return createClient<Database>(getServerEnv().supabaseUrl, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      headers: { "x-cellr-probe": "1" },
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          signal: init?.signal
            ? AbortSignal.any([init.signal, AbortSignal.timeout(timeoutMs)])
            : AbortSignal.timeout(timeoutMs),
        }),
    },
  });
}
