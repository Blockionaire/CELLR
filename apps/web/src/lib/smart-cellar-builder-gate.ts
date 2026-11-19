import { writesMayOpenIn, type SmartCellarAccess } from "./smart-cellar-gate";
import { internalPreviewIn } from "./smart-cellar-renderer-gate";
import { writeTargetIn } from "./smart-cellar-write-target";

/**
 * Whether the Rack Builder (/cellar/builder, Smart Cellar 3D sprint 3) may be shown, and whether it may SAVE. A gate
 * of its own, decided on the server and handed to the page as plain data: nothing the browser holds opens it.
 *
 * ONE SETTING, CELLR_SMART_CELLAR_BUILDER, read on the server only. Open only when it is exactly "1", the deployment
 * is one where unreleased work may be shown (`next dev`, a Vercel preview: the renderer gate's rule, never
 * production, never a deployment that cannot be told), and the Smart Cellar API reads here (the builder reads
 * places through it). Closed, the builder's page is "not found" and no entry point to it is rendered.
 *
 * Independent of the other gates: the design gallery's (DESIGN_GALLERY), the cellar's new 3D view
 * (CELLR_SMART_CELLAR_3D) and the API's write level. OPENING THE BUILDER OPENS NO WRITES. Saving needs the API's
 * own "write" level, which needs a deployment that may write AND a database known not to be production
 * (smart-cellar-write-target.ts). Where the builder is open and saving is not, it is a preview: no Save button that
 * would predictably fail, and a sentence saying why.
 */
export type BuilderEnv = Readonly<Record<string, string | undefined>>;

/** Why saving is not possible here, for the sentence the builder shows. Null: it is. */
export type BuilderSaveBlock =
  /** CELLR_SMART_CELLAR is not "write" here. */
  | "setting"
  /** The deployment is not one that may write. */
  | "deployment"
  /** The database is production, or not declared as a test database. */
  | "database";

export interface BuilderAccess {
  open: boolean;
  canSave: boolean;
  saveBlockedBy: BuilderSaveBlock | null;
}

export const BUILDER_CLOSED: BuilderAccess = Object.freeze({
  open: false,
  canSave: false,
  saveBlockedBy: null,
});

export function builderAccessIn(env: BuilderEnv, api: SmartCellarAccess): BuilderAccess {
  if (env.CELLR_SMART_CELLAR_BUILDER !== "1" || !internalPreviewIn(env) || !api.reads)
    return BUILDER_CLOSED;
  if (api.writes) return Object.freeze({ open: true, canSave: true, saveBlockedBy: null });
  const block: BuilderSaveBlock =
    (env.CELLR_SMART_CELLAR ?? "").trim().toLowerCase() !== "write"
      ? "setting"
      : !writesMayOpenIn(env)
        ? "deployment"
        : !writeTargetIn(env).verified
          ? "database"
          : "setting";
  return Object.freeze({ open: true, canSave: false, saveBlockedBy: block });
}
