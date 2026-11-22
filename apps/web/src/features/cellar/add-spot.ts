import { z } from "zod";
import type { StorageUnitView } from "@cellr/domain";

/** An exact spot to add a new bottle to: the empty spot someone tapped in a rack. */
export interface PreferredSpot {
  locationId: string;
  row: number;
  col: number;
}

const SpotParams = z.object({
  place: z.uuid(),
  row: z.coerce.number().int().min(1).max(30),
  col: z.coerce.number().int().min(1).max(30),
});

/** Where an add was started from, when it should go back there afterwards (sprint 7: the 3D cellar). */
export type AddOrigin = "3d";

/**
 * "/cellar/add?place=…&row=2&col=3": the add flow (or the scanner) with that spot already chosen; `&from=3d` when it
 * was chosen in the 3D cellar, which the flow then offers to go back to. Only ever these values: no URL is carried,
 * so nothing can be redirected anywhere else.
 */
export function addHref(
  base: "/cellar/add" | "/scan",
  spot?: PreferredSpot | null,
  origin?: AddOrigin,
): string {
  if (!spot) return base;
  const q = new URLSearchParams({
    place: spot.locationId,
    row: String(spot.row),
    col: String(spot.col),
    ...(origin ? { from: origin } : {}),
  });
  return `${base}?${q}`;
}

/** The origin in a page's search params: exactly "3d", or nothing. */
export function originFromParams(params: {
  from?: string | string[] | undefined;
}): AddOrigin | undefined {
  return params.from === "3d" ? "3d" : undefined;
}

/**
 * Back to the 3D cellar on the place the bottle went to, with the new bottle named so the view can show it:
 * `/cellar?unit=<id>&added=<id>`. Both are only hints: the 3D view uses them only when the place is one of the
 * household's own (from the server) and the bottle is really there (from the server), and removes them from the URL.
 */
export function back3dHref(locationId: string, bottleId: string | null): string {
  const q = new URLSearchParams({ unit: locationId, ...(bottleId ? { added: bottleId } : {}) });
  return `/cellar?${q}`;
}

/**
 * The spot in a page's search params, if it is one of the household's own places and inside it. Anything else
 * (no params, a malformed id, another household's place, a spot past the last shelf) is no spot: the page opens
 * as it always did. The server checks again when the bottle is saved.
 */
export function spotFromParams(
  params: {
    place?: string | string[] | undefined;
    row?: string | string[] | undefined;
    col?: string | string[] | undefined;
  },
  units: readonly StorageUnitView[],
): PreferredSpot | undefined {
  const parsed = SpotParams.safeParse(params);
  if (!parsed.success) return undefined;
  const { place, row, col } = parsed.data;
  const unit = units.find((u) => u.id === place);
  if (!unit || row > unit.rows || col > unit.cols) return undefined;
  return { locationId: unit.id, row, col };
}
