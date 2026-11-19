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
}

/**
 * The Smart Cellar API: places and their bottles in the new terms, and saving a layout. Only for the active
 * household of the signed-in person, as that person (row-level security). Nothing here moves a bottle.
 */
export function createSmartCellarService({ repo, household, access }: SmartCellarDeps) {
  /** Closed is "there is no such thing here": the same answer as a route that does not exist. */
  const requireReads = () => {
    if (!access.reads) throw new DomainError("NOT_FOUND");
  };
  const requireWrites = () => {
    requireReads();
    if (!access.writes)
      throw new DomainError("FORBIDDEN", "Changing a layout isn't switched on here yet.");
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
