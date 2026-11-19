/**
 * WHICH DATABASE A SMART CELLAR LAYOUT MAY BE WRITTEN TO (Smart Cellar 3D, sprint 3). The API's write switch
 * (smart-cellar-gate.ts) asks the DEPLOYMENT whether it is a test one: `next dev`, or a Vercel preview. That is not
 * enough. A Vercel preview is normally given the same Supabase project as production (docs/SETUP.md §5), so "this is
 * a preview" says nothing about whose data a write would change. This file asks the second question: is the
 * database the server actually connects to one that is known NOT to be production?
 *
 * Writes may be open only when the database host is:
 *   1. a loopback address (localhost, 127.0.0.1, ::1): the local stack on this machine; or
 *   2. EXACTLY the host named in CELLR_SMART_CELLAR_WRITE_DATABASE: an isolated test database someone declared for
 *      this deployment, on purpose, by name;
 * and in neither case one of PRODUCTION_DATABASE_HOSTS below. That list is code: no variable can take a host off it,
 * so naming production in CELLR_SMART_CELLAR_WRITE_DATABASE (by accident, or on purpose) opens nothing.
 *
 * Everything else keeps writes closed: a URL that cannot be read, a host nobody declared, a declaration that names
 * another host than the one connected to, a declaration with a scheme, a path, a wildcard or spaces in it.
 *
 * The host comes from the server's own configuration (NEXT_PUBLIC_SUPABASE_URL, which is what lib/public-env.ts
 * connects with), never from a request. The browser cannot name a database here.
 */
export type WriteTargetEnv = Readonly<Record<string, string | undefined>>;

/**
 * The production database(s) of CELLR. Public identifiers, not secrets: the host is in every browser bundle and in
 * docs/BACKUP-RECOVERY.md. Adding a host here is a reviewed change; removing one is never needed.
 */
export const PRODUCTION_DATABASE_HOSTS: readonly string[] = Object.freeze([
  "vvelgyhbjfmjvxkzekyz.supabase.co",
]);

export type WriteTarget =
  /** The local stack on this machine. */
  | { verified: true; kind: "local"; host: string }
  /** The isolated database declared for this deployment by name. */
  | { verified: true; kind: "declared"; host: string }
  /** Production: never written to from here. */
  | { verified: false; kind: "production"; host: string }
  /** A database nobody declared as a test one (or the declaration names another host). */
  | { verified: false; kind: "undeclared"; host: string }
  /** The configuration cannot be read: no URL, not a URL, not http(s). */
  | { verified: false; kind: "unknown"; host: null };

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
/** What a declared host may look like: a bare DNS name or loopback, lower case. Nothing else is compared. */
const HOST_NAME =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    if (parsed.username || parsed.password) return null;
    return parsed.hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

/** The database this server writes to, judged. Pure: the app asks through getSmartCellarAccess() (server/env.ts). */
export function writeTargetIn(env: WriteTargetEnv): WriteTarget {
  const host = hostOf(env.NEXT_PUBLIC_SUPABASE_URL);
  if (host === null) return { verified: false, kind: "unknown", host: null };
  // production first: neither loopback tricks nor a declaration can make it a test database
  if (PRODUCTION_DATABASE_HOSTS.includes(host))
    return { verified: false, kind: "production", host };
  if (LOOPBACK.has(host)) return { verified: true, kind: "local", host };
  const declared = env.CELLR_SMART_CELLAR_WRITE_DATABASE;
  if (declared !== undefined && HOST_NAME.test(declared) && declared === host)
    return { verified: true, kind: "declared", host };
  return { verified: false, kind: "undeclared", host };
}
