import {
  resolveStorage,
  type ResolvedStorage,
  type SmartPlacementView,
  type SmartStorageUnitView,
} from "@cellr/domain";
import { shapeFor } from "../wine-visuals";
import type { StoredBottle } from "./model";

/**
 * FROM THE SMART CELLAR API TO THE NEW VIEW (sprint 1C). The view draws a `ResolvedStorage` and a list of
 * `StoredBottle`s; the API sends a place as the server read it and its bottles with their whole spot. Nothing is
 * mounted with this yet (sprint 2B.3 does that, behind a flag): this is the one place the two meet, so that the
 * mapping is written and tested once.
 *
 * The place is read again with the same `resolveStorage` the server used, from the fields the server passes through
 * as stored (kind, size, template, bottles per cell, meaning of the index), so the two readings agree. Only what was
 * replaced on the server (a look or zones it could not use) cannot be read again from the view, so the server's own
 * list of fallbacks is taken as it is.
 */
export function resolvedFromView(unit: SmartStorageUnitView): ResolvedStorage {
  const resolved = resolveStorage({
    kind: unit.kind,
    rows: unit.rows,
    cols: unit.cols,
    template: unit.templateId,
    cellCapacity: unit.cellCapacity,
    semantics: unit.slotSemantics,
    zones: unit.zones,
    appearance: unit.appearance,
  });
  return { ...resolved, fallbacks: [...unit.fallbacks] };
}

/** The view's bottles: the whole spot, the index as stored (never reduced), the shape from the kind of wine. */
export const storedBottlesFrom = (placements: readonly SmartPlacementView[]): StoredBottle[] =>
  placements.map((p) => ({
    id: p.bottleId,
    row: p.row,
    col: p.col,
    index: p.index,
    type: p.type,
    shape: shapeFor(p.type),
  }));
