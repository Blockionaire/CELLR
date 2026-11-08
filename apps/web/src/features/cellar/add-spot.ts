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

/** "/cellar/add?place=…&row=2&col=3": the add flow (or the scanner) with that spot already chosen. */
export function addHref(base: "/cellar/add" | "/scan", spot?: PreferredSpot | null): string {
  if (!spot) return base;
  const q = new URLSearchParams({
    place: spot.locationId,
    row: String(spot.row),
    col: String(spot.col),
  });
  return `${base}?${q}`;
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
