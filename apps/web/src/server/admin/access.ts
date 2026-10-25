import "server-only";
import { isAdminUser } from "@cellr/domain";

/**
 * WHO MAY SEE THE ADMIN DASHBOARD. Only a verified Supabase session whose user id is on the server-only allowlist
 * (CELLR_ADMIN_USER_IDS). Never an email, a role, a profile field, a request parameter or anything the browser
 * sends: the id comes from the signed session token and is confirmed with the auth server. Fails closed: no
 * session, an unreachable auth server, an empty or malformed list, or a mismatch all mean "not an admin".
 */
export interface AdminSession {
  readonly userId: string;
}

/** Sessions issued by verifyAdmin, so privileged reads can check at run time that one is real. */
const issued = new WeakSet<AdminSession>();

export interface AdminCheckDeps {
  /** The caller's session, from the signed token (getClaims); null when signed out. */
  session: () => Promise<{ userId: string } | null>;
  /** Confirms the session with the auth server; the user id it reports, or null. */
  confirm: () => Promise<string | null>;
  allowlist: () => ReadonlySet<string>;
}

export async function verifyAdmin(deps: AdminCheckDeps): Promise<AdminSession | null> {
  try {
    const allowlist = deps.allowlist();
    if (allowlist.size === 0) return null;
    const session = await deps.session();
    if (!session || !isAdminUser(session.userId, allowlist)) return null;
    // A token can outlive its user (deleted, signed out elsewhere): ask the auth server, too.
    const confirmed = await deps.confirm();
    if (confirmed !== session.userId) return null;
    const admin: AdminSession = Object.freeze({ userId: session.userId });
    issued.add(admin);
    return admin;
  } catch {
    return null;
  }
}

/** Throws unless this session came from verifyAdmin: the second lock in front of every privileged read. */
export function assertAdmin(
  session: AdminSession | null | undefined,
): asserts session is AdminSession {
  if (!session || !issued.has(session)) throw new Error("admin session required");
}
