/**
 * Where the Smart Cellar template gallery (/design/cellar-3d) may be seen. It has its OWN gate, stricter than the
 * design-system page's (`isDesignGalleryEnabled`, which DESIGN_GALLERY=1 opens anywhere, production included):
 * the gallery shows work that is not released, so a flag alone must never open it on a production deployment.
 *
 * FAIL CLOSED. Open in exactly two places; everything else is closed, and above all an environment the app
 * cannot recognise:
 *
 * 1. LOCAL DEVELOPMENT: `next dev` (NODE_ENV "development"), unless the environment says it is production (someone
 *    running `next dev` with production's variables pulled in gets the closed gallery, on purpose).
 * 2. A VERCEL PREVIEW DEPLOYMENT THAT ASKED FOR IT: VERCEL_ENV is exactly "preview" AND DESIGN_GALLERY=1.
 *    A custom environment (staging, qa: VERCEL_TARGET_ENV names it) is not a preview for this purpose.
 *
 * CLOSED, whatever is set:
 * - a Vercel production deployment: no flag and no combination of flags opens it;
 * - a production build that carries no Vercel marker at all. The app cannot prove such a place is somebody's own
 *   machine and not a production host that does not say what it is, so there is NO switch for "a local production
 *   build": not DESIGN_GALLERY, not any second flag. (There was one, CELLAR_GALLERY_LOCAL_BUILD, for the browser
 *   tests; it was removed. The tests' server now declares itself a Vercel preview: playwright.config.ts.)
 *
 * What this rests on: Vercel sets VERCEL_ENV ("production", "preview" or "development") at build and at run time
 * when "Automatically expose System Environment Variables" is on for the project, which is the default. Should
 * that be switched off, a preview cannot be recognised and stays closed. It is a gate on what is SHOWN; who may
 * reach a preview deployment at all is Vercel's deployment protection, not this.
 */
export type GalleryEnv = Readonly<Record<string, string | undefined>>;

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
  // 2. a true Vercel preview that asked for it. Nothing else: no marker, an unknown one, or a custom
  //    environment all end here as closed.
  return (
    env.DESIGN_GALLERY === "1" &&
    vercelEnv === "preview" &&
    (target === undefined || target === "preview")
  );
}
