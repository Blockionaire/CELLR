import { internalPreviewIn } from "./smart-cellar-renderer-gate";
import { writeTargetIn } from "./smart-cellar-write-target";

/**
 * Whether the Shared Racks API (/api/v1/shared-racks, ADR-010) answers in this deployment, and whether it may write.
 * A gate of its own, decided on the server: nothing the browser holds opens it, and the database having the
 * shared-rack step (migration 0052) switches NOTHING on. Only this does.
 *
 * ONE SETTING, CELLR_SHARED_RACKS, read on the server only. OPEN only when it is exactly "1" AND the deployment is
 * one where unreleased work may be shown:
 *   1. `next dev` (NODE_ENV "development"), unless the environment says it is production;
 *   2. a Vercel PREVIEW deployment (VERCEL_ENV "preview", and no custom target environment).
 * WRITES need, in addition, a database known NOT to be production (lib/smart-cellar-write-target.ts: the local
 * stack, or the isolated test database this deployment declares by name). A preview that shares the production
 * database can at most read, and there the migration is not applied, so it reads "not set up".
 *
 * CLOSED, whatever is set: a Vercel production deployment, a production build that carries no Vercel marker (it
 * cannot be told what it is, so it is treated as production), a custom Vercel environment. Closed, every route
 * answers 404, as if it did not exist.
 *
 * NOT AUTHORISED FOR PRODUCTION. Unlike the Smart Cellar gates there is no production-release clause here, on
 * purpose: no setting, alone or combined, opens shared racks on production. When the owner approves a release, it is
 * a reviewed change of THIS file that adds one explicit clause in the style of lib/smart-cellar-release.ts (a Vercel
 * production deployment that declares, exactly, the production database it connects to), together with applying the
 * migration by docs/MIGRATIONS.md. ADR-010 §9.
 *
 * Independent of every Smart Cellar gate: none of them opens this, and this opens none of them.
 */
export type SharedRacksEnv = Readonly<Record<string, string | undefined>>;

export interface SharedRacksAccess {
  /** The routes answer (reads). */
  open: boolean;
  /** The routes may change something. */
  writes: boolean;
}

export const SHARED_RACKS_CLOSED: SharedRacksAccess = Object.freeze({ open: false, writes: false });

/** The rule, on an environment handed to it. The app asks through `getSharedRacksAccess()` in src/server/env.ts. */
export function sharedRacksAccessIn(env: SharedRacksEnv): SharedRacksAccess {
  if (env.CELLR_SHARED_RACKS !== "1" || !internalPreviewIn(env)) return SHARED_RACKS_CLOSED;
  return Object.freeze({ open: true, writes: writeTargetIn(env).verified });
}
