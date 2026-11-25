import { StorageConfigSchema } from "@cellr/domain";
import { authed, readJson, uuidParam } from "@/server/http";
import { servicesFor } from "@/server/services";
import { revisionFromIfMatch } from "@/server/smart-cellar/revision";

type Params = { id: string };

/**
 * PUT { structure: { template, rows, cols, cellCapacity, zones }, appearance: { v, material, color, lighting, door } }
 * → the place's whole layout, look and temperature zones replaced in ONE database transaction (save_storage_layout),
 * or nothing changed at all. The template decides the kind and what an index means. Zones are saved here, with the
 * shelves they split; `zones: []` removes them.
 *
 * Refused: anything the catalogue does not allow (422), more than one bottle per position (409: switched off), a
 * layout that would take a bottle's spot away (409). Not switched on for writing in this deployment: 403 (and 404
 * where the Smart Cellar API is closed altogether). Never on production, and never to a database that is not known
 * to be a test one (lib/smart-cellar-write-target.ts).
 *
 * Optional `If-Match: "<revision>"` (sprint 3): the revision of the place the draft started from. When the place has
 * changed since, nothing is saved (409). Where the database has migration 0051 the revision is also compared under
 * the place's row lock, so a save that lands in between is refused too (the same 409); without 0051 only the app's
 * own check is made (see the service).
 */
export const PUT = authed<Params>(async ({ request, ctx, params }) => {
  const id = uuidParam(params.id);
  const smartCellar = servicesFor(ctx).smartCellar;
  smartCellar.guardWrites();
  const config = await readJson(request, StorageConfigSchema);
  return smartCellar.saveLayout(id, config, revisionFromIfMatch(request.headers.get("if-match")));
});
