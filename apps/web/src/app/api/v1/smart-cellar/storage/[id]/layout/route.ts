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
 * where the Smart Cellar API is closed altogether). Never on production, and never to a database that is not known
 * to be a test one (lib/smart-cellar-write-target.ts).
 *
 * Optional `If-Match: "<revision>"` (sprint 3): the revision of the place the draft started from. When the place has
 * changed since, nothing is saved (409). It narrows lost updates; it does not close every race (see the service).
 */
export const PUT = authed<Params>(async ({ request, ctx, params }) => {
  const id = uuidParam(params.id);
  const smartCellar = servicesFor(ctx).smartCellar;
  smartCellar.guardWrites();
  const config = await readJson(request, StorageConfigSchema);
  return smartCellar.saveLayout(id, config, expectedRevision(request.headers.get("if-match")));
});

/** The revision named in If-Match: one entity tag, quoted or not, weak or not. Anything else names none. */
function expectedRevision(header: string | null): string | null {
  if (!header) return null;
  const tag = header.trim().replace(/^W\//, "");
  const bare = tag.startsWith('"') && tag.endsWith('"') && tag.length >= 2 ? tag.slice(1, -1) : tag;
  return bare.length > 0 && bare.length <= 64 && !bare.includes(",") && bare !== "*" ? bare : null;
}
