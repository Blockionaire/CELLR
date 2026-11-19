import { CONDITIONAL_RENAME_ONLY, DomainError, UpdateStorageSchema } from "@cellr/domain";
import { authed, readJson, uuidParam } from "@/server/http";
import { servicesFor } from "@/server/services";

type Params = { id: string };

/**
 * PATCH { label?, kind?, rows?, cols? } → renames or resizes a place (never below bottles still in it).
 *
 * Optional `If-Match: "<revision>"` (sprint 3, the Rack Builder): a RENAME made against the version of the place
 * the caller saw. Applied in one statement only while the place is still that version; otherwise 409 and nothing
 * changes. Only `{ label }` may be sent this way (422 otherwise). The answer then carries the new `revision`.
 * Without the header, everything is exactly as before.
 */
export const PATCH = authed<Params>(async ({ request, ctx, params }) => {
  const id = uuidParam(params.id);
  const patch = await readJson(request, UpdateStorageSchema);
  const expected = expectedRevision(request.headers.get("if-match"));
  if (expected === undefined) return servicesFor(ctx).cellar.updateStorage(id, patch);
  const keys = Object.keys(patch);
  if (keys.length !== 1 || patch.label === undefined)
    throw new DomainError("VALIDATION", CONDITIONAL_RENAME_ONLY);
  if (expected === null) throw new DomainError("VALIDATION", CONDITIONAL_RENAME_ONLY);
  return servicesFor(ctx).cellar.renameStorageIfCurrent(id, patch.label, expected);
});

/** DELETE → removes an empty place. Owner only. */
export const DELETE = authed<Params>(async ({ ctx, params }) => {
  await servicesFor(ctx).cellar.deleteStorage(uuidParam(params.id));
});

/**
 * The revision named in If-Match: undefined when there is no header (an ordinary edit), null when the header names
 * no single usable revision (refused, never taken as "no condition"), else the revision.
 */
function expectedRevision(header: string | null): string | null | undefined {
  if (header === null) return undefined;
  const tag = header.trim().replace(/^W\//, "");
  const bare = tag.startsWith('"') && tag.endsWith('"') && tag.length >= 2 ? tag.slice(1, -1) : tag;
  return bare.length > 0 && bare.length <= 64 && !bare.includes(",") && bare !== "*" ? bare : null;
}
