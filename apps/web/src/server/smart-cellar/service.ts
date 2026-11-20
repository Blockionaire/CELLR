import "server-only";
import {
  DEPTH_PLACEMENT_ENABLED,
  DomainError,
  EXPORT_VERSIONS,
  SMART_CELLAR_API_VERSION,
  STORAGE_APPEARANCE_VERSION,
  STALE_LAYOUT_MESSAGE,
  STORAGE_CATALOG_VERSION,
  STORAGE_TEMPLATES,
  indexMeaningOf,
  landingSpot,
  placementMeaning,
  placementProblem,
  swapProblem,
  type PlacementProblem,
  type SmartMove,
  type SmartMoveResult,
  type SmartSwap,
  type SmartSwapResult,
  type SmartBottleSpot,
  layoutChangeProblem,
  resolveStorage,
  type LayoutChangeProblem,
  type ResolvedStorage,
  type SmartCellarCapabilities,
  type SmartStoragePlacementsView,
  type SmartStorageUnitView,
  type StorageConfig,
} from "@cellr/domain";
import type { ActiveHousehold } from "@/server/cellar/types";
import type { SmartCellarAccess } from "@/lib/smart-cellar-gate";
import { PLACEMENT_CLOSED, type PlacementAccess } from "@/lib/smart-cellar-placement-gate";
import type { SaveLayoutOutcome, SmartCellarRepository, StoredPlaceRow } from "./types";

/** The place as `resolveStorage` reads it: every stored field passed on, nothing pre-chewed. */
export function resolvePlace(row: StoredPlaceRow): ResolvedStorage {
  return resolveStorage({
    kind: row.kind,
    rows: row.rows,
    cols: row.cols,
    template: row.template,
    cellCapacity: row.cellCapacity,
    semantics: row.semantics,
    zones: row.zones,
    appearance: row.appearance,
  });
}

/**
 * Pure: a stored place as the API shows it. All interpreting is `resolveStorage`'s (no fallback rule is repeated
 * here); this only adds the counts and the truthful meaning of an index. The stored template id, rows, columns,
 * capacity and meaning of the index are passed through as stored, so a client can see what is there even when the
 * server cannot use all of it (`arrangementKnown`, `fallbacks`). Unit-tested.
 */
export function toUnitView(row: StoredPlaceRow): SmartStorageUnitView {
  const r = resolvePlace(row);
  const capacity = row.rows * row.cols * row.cellCapacity;
  return {
    id: row.id,
    label: row.label,
    kind: row.kind,
    templateId: row.template,
    layoutTemplateId: r.template.id,
    family: r.layout.family,
    rows: row.rows,
    cols: row.cols,
    cellCapacity: row.cellCapacity,
    slotSemantics: row.semantics,
    indexMeaning: indexMeaningOf(r),
    appearance: r.appearance,
    zones: r.structure.zones,
    capacity,
    occupied: row.occupied,
    free: Math.max(0, capacity - row.occupied),
    legacy: r.legacy,
    arrangementKnown: r.arrangementKnown,
    fallbacks: r.fallbacks,
    revision: row.revision,
  };
}

/** What a refused layout means for the person, by the domain's (and the database's) reason. */
function refusal(problem: LayoutChangeProblem | Exclude<SaveLayoutOutcome, "saved">): DomainError {
  switch (problem) {
    case "depth_not_enabled":
      return new DomainError(
        "CONFLICT",
        "More than one bottle per position isn't switched on yet.",
      );
    case "in_use":
      return new DomainError(
        "CONFLICT",
        "There are still bottles in the part you're removing. Move them first.",
      );
    case "semantics_change":
      return new DomainError("CONFLICT", "There are still bottles in it. Move them out first.");
    case "invalid_zones":
      return new DomainError(
        "VALIDATION",
        "The zones must cover every shelf once, from top to bottom.",
      );
    case "not_found":
      return new DomainError("NOT_FOUND", "We couldn't find that place.");
  }
}

export interface SmartCellarDeps {
  repo: SmartCellarRepository;
  household: () => Promise<ActiveHousehold>;
  /** Whether this deployment reads and writes (lib/smart-cellar-gate.ts). */
  access: SmartCellarAccess;
  /**
   * Whether bottles may be placed, moved and swapped here (lib/smart-cellar-placement-gate.ts, sprint 4). Left out:
   * closed.
   */
  placement?: PlacementAccess | undefined;
}

/** The words of a placement refusal (each has an English and a Dutch translation, lib/known-messages.ts). */
export const PLACEMENT_MESSAGES = {
  stale: "That bottle was moved by someone else. Nothing was changed.",
  taken: "That spot was just taken. Pick another.",
  outOfBounds: "That spot doesn't exist in this place.",
  unknownArrangement:
    "CELLR doesn't know how that place is arranged, so it can't put a bottle there.",
  depth: "More than one bottle per position isn't switched on yet.",
  behind: "Another bottle is in front of that spot.",
  compartmentFull: "That compartment is full.",
  ambiguous:
    "This bottle lies behind another one. It can be moved once moving at depth is switched on.",
  gone: "That bottle is no longer in the cellar.",
  notFound: "We couldn't find that bottle.",
  placeNotFound: "We couldn't find that place.",
  closed: "Moving bottles here isn't switched on yet.",
  sameCompartment: "Two bottles in one compartment can't trade places: a compartment has no order.",
  sameBottle: "A bottle can't trade places with itself.",
  swapStale: "One of these bottles was just moved by someone else. Nothing was changed.",
  swapGone: "One of these bottles is no longer in the cellar or has no place. Nothing was changed.",
} as const;

const PLACEMENT_REFUSAL: Record<PlacementProblem, () => DomainError> = {
  unknown_arrangement: () => new DomainError("CONFLICT", PLACEMENT_MESSAGES.unknownArrangement),
  out_of_bounds: () => new DomainError("VALIDATION", PLACEMENT_MESSAGES.outOfBounds),
  depth_not_enabled: () => new DomainError("CONFLICT", PLACEMENT_MESSAGES.depth),
  occupied: () => new DomainError("CONFLICT", PLACEMENT_MESSAGES.taken),
  behind_taken: () => new DomainError("CONFLICT", PLACEMENT_MESSAGES.behind),
  compartment_full: () => new DomainError("CONFLICT", PLACEMENT_MESSAGES.compartmentFull),
  // handled before: a move onto the spot the bottle is on is answered as "already there"
  same_spot: () => new DomainError("CONFLICT", PLACEMENT_MESSAGES.stale),
};

/**
 * The Smart Cellar API: places and their bottles in the new terms, and saving a layout. Only for the active
 * household of the signed-in person, as that person (row-level security). Nothing here moves a bottle.
 */
export function createSmartCellarService({
  repo,
  household,
  access,
  placement = PLACEMENT_CLOSED,
}: SmartCellarDeps) {
  /** Closed is "there is no such thing here": the same answer as a route that does not exist. */
  const requireReads = () => {
    if (!access.reads) throw new DomainError("NOT_FOUND");
  };
  const requireWrites = () => {
    requireReads();
    if (!access.writes)
      throw new DomainError("FORBIDDEN", "Changing a layout isn't switched on here yet.");
  };
  /** Placement is "not here" where its gate is closed; open but not writing, it says so (403). */
  const requirePlacementWrites = () => {
    requireReads();
    if (!placement.open) throw new DomainError("NOT_FOUND");
    if (!placement.canWrite || !access.writes)
      throw new DomainError("FORBIDDEN", PLACEMENT_MESSAGES.closed);
  };
  const place = async (householdId: string, id: string): Promise<StoredPlaceRow> => {
    const found = await repo.getPlace(householdId, id);
    if (!found) throw new DomainError("NOT_FOUND", "We couldn't find that place.");
    return found;
  };

  return {
    /**
     * Refuses before anything else is looked at when this deployment does not write layouts, so that a closed API
     * says nothing about a request (not even whether its body was well formed).
     */
    guardWrites(): void {
      requireWrites();
    },

    /** What this server offers. Asks the database whether the Smart Cellar step is there (narrowly: see repository). */
    async capabilities(): Promise<SmartCellarCapabilities> {
      requireReads();
      await household();
      return {
        version: SMART_CELLAR_API_VERSION,
        reads: true,
        writes: access.writes,
        depthPlacement: DEPTH_PLACEMENT_ENABLED,
        schema: await repo.schemaStatus(),
        catalogVersion: STORAGE_CATALOG_VERSION,
        appearanceVersion: STORAGE_APPEARANCE_VERSION,
        exportVersions: EXPORT_VERSIONS,
      };
    },

    async units(): Promise<SmartStorageUnitView[]> {
      requireReads();
      const { id } = await household();
      return (await repo.listPlaces(id)).map(toUnitView);
    },

    async unit(id: string): Promise<SmartStorageUnitView> {
      requireReads();
      const { id: householdId } = await household();
      return toUnitView(await place(householdId, id));
    },

    /** A place and every bottle on a spot in it, each with its whole spot (index included, never reduced). */
    async placements(id: string): Promise<SmartStoragePlacementsView> {
      requireReads();
      const { id: householdId } = await household();
      const [stored, placements] = await Promise.all([
        place(householdId, id),
        repo.placements(householdId, id),
      ]);
      return { unit: toUnitView(stored), placements };
    },

    /**
     * Replaces a place's layout, look and zones in ONE database call (save_storage_layout): all of it or none of it.
     * The template decides the kind and what an index means; neither is taken from the request. The checks here are
     * the database's own, made first so the person is told plainly; the database decides in the end (a bottle
     * placed between the check and the save is still caught there, and nothing is changed).
     * Two saves of one place at once are taken one after the other by the database; the later one is the result,
     * whole. There is no partial layout at any moment.
     *
     * `expectedRevision` (sprint 3): the revision the person's draft started from. When given and no longer the
     * place's, nothing is saved (409). This narrows lost updates; it does NOT close them: a save that lands between
     * this check and the database call still wins (last write wins under the row lock). Closing that needs the
     * revision compared inside the transaction, which is a migration (SPRINT-3-REPORT §11), not done here.
     */
    /**
     * Where one bottle is now, read from the database as the person (no cache anywhere): what a client asks after a
     * move, swap or take-off whose answer it did not get. Open wherever placement is open, also read-only; another
     * household's bottle, or none, is "not found".
     */
    async bottleSpot(bottleId: string): Promise<SmartBottleSpot> {
      requireReads();
      if (!placement.open) throw new DomainError("NOT_FOUND");
      const { id: householdId } = await household();
      const now = await repo.bottleSpot(householdId, bottleId);
      if (!now) throw new DomainError("NOT_FOUND", PLACEMENT_MESSAGES.notFound);
      return { bottleId, inCellar: now.inCellar, spot: now.spot };
    },

    /** Refuses before the body is read where placement does not write here (as guardWrites does for layouts). */
    guardPlacement(): void {
      requirePlacementWrites();
    },

    /**
     * Moves ONE bottle from the spot the caller SAW it on to `to` (both whole spots; null: no place). The rules of the
     * target place are checked first (its arrangement must be known, the spot must be one of its, free, in reach,
     * and not past index 1 while depth is off), then ONE conditional UPDATE does it, or nothing (repository). A repeat
     * of a move that already happened answers "already_there"; a bottle that is not where the caller saw it, or a
     * target taken meanwhile, changes nothing (409).
     */
    async moveBottle(bottleId: string, move: SmartMove): Promise<SmartMoveResult> {
      requirePlacementWrites();
      const { id: householdId } = await household();
      let to = move.to;
      if (to) {
        const target = await repo.getPlace(householdId, to.locationId);
        if (!target) throw new DomainError("NOT_FOUND", PLACEMENT_MESSAGES.placeNotFound);
        const resolved = resolvePlace(target);
        const occupants = await repo.occupants(householdId, to.locationId);
        // the place's rules first: bounds (422) before depth (409), so a spot past a cell is "doesn't exist"
        const problem = placementProblem(resolved, occupants, to, {
          movingId: bottleId,
          depthEnabled: placement.depth,
        });
        // "same_spot": the bottle is on the target now; the database is still asked (below), and decides between
        // "already there" and a stale source, so nothing is answered without it
        if (problem && problem !== "same_spot") throw PLACEMENT_REFUSAL[problem]();
        if (problem !== "same_spot") {
          // in a compartment a counter is not a place someone chose: its next free counter is used
          const landing = landingSpot(resolved, occupants, to, bottleId);
          if (!landing) throw new DomainError("CONFLICT", PLACEMENT_MESSAGES.compartmentFull);
          to = { ...to, index: landing.index };
        }
      }
      // never past index 1 while depth is off, whatever chose the index (the caller, or a compartment's counter)
      if (to && to.index > 1 && !placement.depth)
        throw new DomainError("CONFLICT", PLACEMENT_MESSAGES.depth);
      const outcome = await repo.moveBottle(householdId, bottleId, move.from, to);
      switch (outcome.kind) {
        case "moved":
          return { bottleId, outcome: "moved", from: move.from, to };
        case "already_there":
          return { bottleId, outcome: "already_there", from: move.from, to };
        case "stale":
          throw new DomainError("CONFLICT", PLACEMENT_MESSAGES.stale);
        case "taken":
          throw new DomainError("CONFLICT", PLACEMENT_MESSAGES.taken, { retryable: true });
        case "out_of_bounds":
          throw new DomainError("VALIDATION", PLACEMENT_MESSAGES.outOfBounds);
        case "ambiguous":
          throw new DomainError("CONFLICT", PLACEMENT_MESSAGES.ambiguous);
        case "gone":
          throw new DomainError("CONFLICT", PLACEMENT_MESSAGES.gone);
        case "not_found":
          throw new DomainError("NOT_FOUND", PLACEMENT_MESSAGES.notFound);
      }
    },

    /**
     * Two placed bottles trade their whole spots, both at once (swap_bottles_v2): only while each is still on the
     * spot the caller saw. Refused inside one compartment of counters, in a place whose arrangement is not known, and
     * past index 1 while depth is off. Undo is the same call with the two new spots.
     */
    async swapBottle(bottleId: string, swap: SmartSwap): Promise<SmartSwapResult> {
      requirePlacementWrites();
      const { id: householdId } = await household();
      if (swap.with === bottleId)
        throw new DomainError("VALIDATION", PLACEMENT_MESSAGES.sameBottle);
      const [placeA, placeB] = await Promise.all([
        repo.getPlace(householdId, swap.expected.self.locationId),
        repo.getPlace(householdId, swap.expected.other.locationId),
      ]);
      if (!placeA || !placeB) throw new DomainError("NOT_FOUND", PLACEMENT_MESSAGES.placeNotFound);
      const problem = swapProblem(
        {
          bottleId,
          spot: swap.expected.self,
          meaning: placementMeaning(resolvePlace(placeA)),
        },
        {
          bottleId: swap.with,
          spot: swap.expected.other,
          meaning: placementMeaning(resolvePlace(placeB)),
        },
        { depthEnabled: placement.depth },
      );
      if (problem === "same_bottle")
        throw new DomainError("VALIDATION", PLACEMENT_MESSAGES.sameBottle);
      if (problem === "unknown_arrangement")
        throw new DomainError("CONFLICT", PLACEMENT_MESSAGES.unknownArrangement);
      if (problem === "depth_not_enabled")
        throw new DomainError("CONFLICT", PLACEMENT_MESSAGES.depth);
      if (problem === "same_compartment")
        throw new DomainError("VALIDATION", PLACEMENT_MESSAGES.sameCompartment);
      const outcome = await repo.swapBottles(
        householdId,
        { bottleId, spot: swap.expected.self },
        { bottleId: swap.with, spot: swap.expected.other },
      );
      if (outcome === "not_found") throw new DomainError("NOT_FOUND", PLACEMENT_MESSAGES.notFound);
      if (outcome === "gone") throw new DomainError("CONFLICT", PLACEMENT_MESSAGES.swapGone);
      if (outcome === "stale") throw new DomainError("CONFLICT", PLACEMENT_MESSAGES.swapStale);
      if (outcome === "invalid")
        throw new DomainError("VALIDATION", PLACEMENT_MESSAGES.sameCompartment);
      return {
        self: { bottleId, spot: swap.expected.other },
        other: { bottleId: swap.with, spot: swap.expected.self },
      };
    },

    async saveLayout(
      id: string,
      config: StorageConfig,
      expectedRevision?: string | null,
    ): Promise<SmartStorageUnitView> {
      requireWrites();
      const { id: householdId } = await household();
      const current = await place(householdId, id);
      if (expectedRevision && expectedRevision !== current.revision)
        throw new DomainError("CONFLICT", STALE_LAYOUT_MESSAGE);
      const template = STORAGE_TEMPLATES[config.structure.template];
      const problem = layoutChangeProblem(
        {
          rows: current.rows,
          cols: current.cols,
          cellCapacity: current.cellCapacity,
          semantics: current.semantics,
        },
        config.structure,
        await repo.occupiedSpots(householdId, id),
      );
      if (problem) throw refusal(problem);
      const outcome = await repo.saveLayout(householdId, id, {
        kind: template.kind,
        template: template.id,
        semantics: template.semantics,
        rows: config.structure.rows,
        cols: config.structure.cols,
        cellCapacity: config.structure.cellCapacity,
        appearance: config.appearance,
        zones: config.structure.zones,
      });
      if (outcome !== "saved") throw refusal(outcome);
      return toUnitView(await place(householdId, id));
    },
  };
}

export type SmartCellarService = ReturnType<typeof createSmartCellarService>;
