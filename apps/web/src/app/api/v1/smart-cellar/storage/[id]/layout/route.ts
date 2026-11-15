import { StorageConfigSchema } from "@cellr/domain";
import { authed, readJson, uuidParam } from "@/server/http";
import { servicesFor } from "@/server/services";

type Params = { id: string };

/**
 * PUT { structure: { template, rows, cols, cellCapacity, zones }, appearance: { v, material, color, lighting, door } }
 * → the place's whole layout, look and temperature zones replaced in ONE database transaction (save_storage_layout),
 * or nothing changed at all. The template decides the kind and what an index means. Zones are saved here, with the
 * shelves they split; `zones: []` removes them.
 *
 * Refused: anything the catalogue does not allow (422), more than one bottle per position (409: switched off), a
 * layout that would take a bottle's spot away (409). Not switched on for writing in this deployment: 403 (and 404
 * where the Smart Cellar API is closed altogether). Never on production.
 */
export const PUT = authed<Params>(async ({ request, ctx, params }) => {
  const id = uuidParam(params.id);
  const smartCellar = servicesFor(ctx).smartCellar;
  smartCellar.guardWrites();
  const config = await readJson(request, StorageConfigSchema);
  return smartCellar.saveLayout(id, config);
});
