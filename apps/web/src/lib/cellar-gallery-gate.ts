/**
 * Where the Smart Cellar template gallery (/design/cellar-3d) may be seen. It has its OWN gate, stricter than the
 * design-system page's (`isDesignGalleryEnabled`, which DESIGN_GALLERY=1 opens anywhere, production included):
 * the gallery shows work that is not released, so a flag alone must never open it on a production deployment.
 *
 * Open in exactly three places, closed everywhere else (anything not recognised is closed):
 *
 * 1. LOCAL DEVELOPMENT: `next dev` (NODE_ENV "development"), unless the environment says it is production (someone
 *    running `next dev` with production's variables pulled in gets the closed gallery, on purpose).
 * 2. A VERCEL PREVIEW DEPLOYMENT THAT ASKED FOR IT: VERCEL_ENV is exactly "preview" AND DESIGN_GALLERY=1.
 *    A custom environment (staging, qa: VERCEL_TARGET_ENV names it) is not a preview for this purpose.
 * 3. A PRODUCTION BUILD ON ONE'S OWN MACHINE, for the browser tests: DESIGN_GALLERY=1 AND
 *    CELLAR_GALLERY_LOCAL_BUILD=1, and nothing in the environment that looks like a hosted deployment. Two
 *    switches on purpose: DESIGN_GALLERY=1 by itself, wherever it is set, opens nothing here.
 *
 * VERCEL PRODUCTION IS ALWAYS CLOSED, whatever else is set: no combination of flags opens it.
 *
 * What this rests on: Vercel sets VERCEL_ENV ("production", "preview" or "development") and VERCEL=1 at build and
 * at run time when "Automatically expose System Environment Variables" is on for the project, which is the default.
 * Should that be switched off, cases 1 and 2 cannot be recognised on Vercel and stay closed, and case 3 is refused
 * on anything that carries a hosting marker. It is a gate on what is SHOWN; who may reach a preview deployment at
 * all is Vercel's deployment protection, not this.
 */
export type GalleryEnv = Readonly<Record<string, string | undefined>>;

/** Set by a hosting platform, never by a laptop or a test runner: with any of them, this is not "one's own machine". */
const HOSTED_MARKERS = [
  "VERCEL",
  "VERCEL_ENV",
  "VERCEL_TARGET_ENV",
  "VERCEL_URL",
  "VERCEL_REGION",
  "VERCEL_DEPLOYMENT_ID",
  "AWS_LAMBDA_FUNCTION_NAME",
  "AWS_EXECUTION_ENV",
] as const;

/**
 * The rule, on an environment handed to it (so every case can be tested as plain data). The app asks through
 * `isCellarGalleryEnabled()` in src/server/env.ts, the one place the server reads its environment.
 */
export function cellarGalleryOpenIn(env: GalleryEnv): boolean {
  const vercelEnv = env.VERCEL_ENV;
  const target = env.VERCEL_TARGET_ENV;
  // production first: nothing below can open it
  if (vercelEnv === "production" || target === "production") return false;
  // 1. `next dev` (a deployment is never built or served in development mode)
  if (env.NODE_ENV === "development") return true;
  const asked = env.DESIGN_GALLERY === "1";
  // 2. on Vercel: a true preview that asked for it, and nothing else
  if (vercelEnv !== undefined || target !== undefined || env.VERCEL !== undefined)
    return asked && vercelEnv === "preview" && (target === undefined || target === "preview");
  // 3. a production build on one's own machine, with both switches
  if (HOSTED_MARKERS.some((name) => env[name] !== undefined)) return false;
  return asked && env.CELLAR_GALLERY_LOCAL_BUILD === "1";
}
