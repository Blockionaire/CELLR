import type { SmartCellarAccess } from "./smart-cellar-gate";

/**
 * Whether the cellar's 3D view may use the NEW storage renderer (Smart Cellar 3D, sprint 2B.3) for places that
 * have a template. A gate of its own, decided on the server and handed to the screen as a plain boolean: the
 * browser never reads a setting, so nothing a visitor can change opens it.
 *
 * ONE SETTING, CELLR_SMART_CELLAR_3D, read on the server only. It is OFF unless it is exactly "1", AND the
 * deployment is one of the two places where unreleased work may be shown:
 *   1. `next dev` (NODE_ENV "development"), unless the environment says it is production;
 *   2. a Vercel PREVIEW deployment (VERCEL_ENV "preview", and no custom target environment).
 *
 * CLOSED, whatever is set:
 *   - a Vercel production deployment (VERCEL_ENV or VERCEL_TARGET_ENV "production");
 *   - a production build that carries no Vercel marker at all: the app cannot tell what such a place is, so it is
 *     treated as production (the gallery gate's rule, lib/cellar-gallery-gate.ts);
 *   - a custom Vercel environment (staging, qa).
 * Opening it for real users is a reviewed change to this file after the owner decides and after the view has been
 * validated on real phones; it is never a variable someone can set.
 *
 * INDEPENDENT OF THE OTHER GATES. Not the design gallery's (DESIGN_GALLERY opens nothing here), and not the Smart
 * Cellar API's permission to write (the renderer only reads; with this gate open and the API on "read", layouts
 * still cannot be saved). It does NEED the API to read, since that is where its data comes from: where the API is
 * closed, the renderer is off, and the cellar's 3D view is the existing one, asking for nothing new.
 *
 * What it changes when open: only how a place WITH a template is drawn in the 3D view. A place from before
 * templates is drawn by the existing view either way, the "3d" view mode and its cookie are the same, and with the
 * gate closed the screen makes no new request and downloads none of the new view's code.
 */
export type RendererEnv = Readonly<Record<string, string | undefined>>;

/** Whether this deployment is one where unreleased work may be shown at all (never production, never unknown). */
export function internalPreviewIn(env: RendererEnv): boolean {
  const vercelEnv = env.VERCEL_ENV;
  const target = env.VERCEL_TARGET_ENV;
  if (vercelEnv === "production" || target === "production") return false;
  if (env.NODE_ENV === "development") return true;
  return vercelEnv === "preview" && (target === undefined || target === "preview");
}

/**
 * The rule, on an environment and the Smart Cellar API's access handed to it. The app asks through
 * `isSmartCellarRendererEnabled()` in src/server/env.ts.
 */
export function smartCellarRendererOpenIn(env: RendererEnv, api: SmartCellarAccess): boolean {
  return env.CELLR_SMART_CELLAR_3D === "1" && internalPreviewIn(env) && api.reads;
}
