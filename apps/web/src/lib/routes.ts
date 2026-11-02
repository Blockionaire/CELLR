/** Which pages need a session? Used by the proxy (and mirrored by the (app) layout as a second layer). */
export type PathKind = "public" | "auth-only" | "protected";

const PUBLIC_PREFIXES = ["/design"];
const AUTH_ONLY_PREFIXES = ["/sign-in"];

const matches = (pathname: string, prefix: string) =>
  pathname === prefix || pathname.startsWith(prefix + "/");

export function classifyPath(pathname: string): PathKind {
  if (AUTH_ONLY_PREFIXES.some((p) => matches(pathname, p))) return "auth-only";
  if (PUBLIC_PREFIXES.some((p) => matches(pathname, p))) return "public";
  return "protected";
}

/** The internal admin dashboard (pages, actions and its private media routes). */
export const isAdminPath = (pathname: string) => matches(pathname, "/admin");

/**
 * The path a refused admin request is rewritten to: it matches no route, so Next answers with the app's not-found
 * page and a real 404 status, decided before anything is rendered or streamed.
 */
export const ADMIN_NOT_FOUND_PATH = "/_not-found-admin";

/**
 * Whether the proxy must answer an admin path with a plain 404: a signed-in person whose verified user id is not on
 * the server-only allowlist. Signed-out visitors are sent to sign-in as for any protected page; allowlisted ones go on
 * to the admin layout and pages, which verify the session again with the auth server (the authoritative check). This
 * only decides the HTTP status early: the root loading boundary streams a 200 before a page's notFound() can run.
 */
export function refuseAdmin(
  pathname: string,
  userId: string | null,
  allowlist: ReadonlySet<string>,
): boolean {
  return isAdminPath(pathname) && userId !== null && !allowlist.has(userId.toLowerCase());
}

/** Only same-site relative paths may be used as a post-sign-in destination (no open redirects). */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return "/";
  if (classifyPath(next.split("?")[0] ?? "/") === "auth-only") return "/";
  return next;
}
