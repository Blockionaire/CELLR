/** Which pages need a session? Used by the proxy (and mirrored by the (app) layout as a second layer). */
export type PathKind = "public" | "auth-only" | "protected";

const PUBLIC_PREFIXES = ["/offline", "/design"];
const AUTH_ONLY_PREFIXES = ["/sign-in"];

const matches = (pathname: string, prefix: string) =>
  pathname === prefix || pathname.startsWith(prefix + "/");

export function classifyPath(pathname: string): PathKind {
  if (AUTH_ONLY_PREFIXES.some((p) => matches(pathname, p))) return "auth-only";
  if (PUBLIC_PREFIXES.some((p) => matches(pathname, p))) return "public";
  return "protected";
}

/** Only same-site relative paths may be used as a post-sign-in destination (no open redirects). */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return "/";
  if (classifyPath(next.split("?")[0] ?? "/") === "auth-only") return "/";
  return next;
}
