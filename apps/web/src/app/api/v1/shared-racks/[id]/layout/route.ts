import { SharedRackLayoutSchema } from "@cellr/domain";
import { authed, readJson, uuidParam } from "@/server/http";
import { servicesFor } from "@/server/services";

type Params = { id: string };

/**
 * PUT { structure: { template, rows, cols, cellCapacity, zones: [] }, appearance } → the rack with its whole layout
 * and look replaced in ONE database transaction, or nothing changed at all. Owners only.
 *
 * Refused: anything the catalogue does not allow, and temperature zones (422); more than one bottle per position
 * (409: switched off); a layout that would take a bottle's spot away (409).
 *
 * Optional `If-Match: "<revision>"`: the revision of the rack the draft started from. It is compared by the database
 * inside the transaction that saves: of two saves from one version exactly one is applied, the other is a 409.
 */
export const PUT = authed<Params>(async ({ request, ctx, params }) => {
  const id = uuidParam(params.id);
  const sharedRacks = servicesFor(ctx).sharedRacks;
  sharedRacks.guardWrites();
  const layout = await readJson(request, SharedRackLayoutSchema);
  return sharedRacks.saveLayout(id, layout, expectedRevision(request.headers.get("if-match")));
});

/** The revision named in If-Match: one entity tag, quoted or not, weak or not. Anything else names none. */
function expectedRevision(header: string | null): string | null {
  if (!header) return null;
  const tag = header.trim().replace(/^W\//, "");
  const bare = tag.startsWith('"') && tag.endsWith('"') && tag.length >= 2 ? tag.slice(1, -1) : tag;
  return bare.length > 0 && bare.length <= 64 && !bare.includes(",") && bare !== "*" ? bare : null;
}
