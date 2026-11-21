/**
 * The exact extra origins this server accepts for cookie-authenticated mutations, read from ITS OWN environment,
 * never from the request: `CELLR_DEMO_ORIGINS`, a comma-separated list of origins (`https://host[:port]`, nothing
 * else). Only the local demonstration sets it (scripts/demo/up.sh), for the private GitHub Codespaces address of its
 * own port: Codespaces forwards a request with the internal host (localhost:3200), so the browser's external Origin
 * can't match it. Anything that is not exactly an origin is ignored, and on a Vercel Production deployment the whole
 * setting is ignored.
 */
export function demoOriginsIn(env: NodeJS.ProcessEnv): ReadonlySet<string> {
  if (env.VERCEL_ENV === "production" || env.VERCEL_TARGET_ENV === "production") return new Set();
  const origins = new Set<string>();
  for (const raw of (env.CELLR_DEMO_ORIGINS ?? "").split(",")) {
    const value = raw.trim();
    if (!value) continue;
    try {
      const url = new URL(value);
      if (
        (url.protocol === "https:" || url.protocol === "http:") &&
        url.origin === value &&
        /^[a-z0-9.-]+$/.test(url.hostname) // a plain host name: no wildcard, no pattern
      )
        origins.add(value);
    } catch {
      // not an origin: ignored
    }
  }
  return origins;
}
