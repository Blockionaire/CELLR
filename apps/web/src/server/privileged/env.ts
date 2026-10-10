import "server-only";

/**
 * The ONLY place the service-role key is read. It bypasses row-level security, so nothing outside
 * src/server/privileged may import this file (lint-enforced and architecture-tested).
 * Returns null when not configured (local development without it).
 */
export function getServiceRoleKey(): string | null {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  return key ? key : null;
}
