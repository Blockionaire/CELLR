import "server-only";
import type {
  BottleArtRef,
  BottlePhotoInvite,
  ContributionState,
  ContributionStatus,
  WineType,
} from "@cellr/domain";
import type { Db } from "@/server/db/clients";
import { isMissingTable, mapDbError } from "@/server/db/errors";

export interface BottleLibraryRepository {
  /**
   * Records one contribution of 1 to 3 photos the server has stored, as the sender (consent, ownership, the number
   * of photos and the reward are checked there, all or nothing).
   */
  submit(input: {
    vintageId: string;
    photos: { path: string; width: number; height: number }[];
    consent: boolean;
  }): Promise<{ id: string; points: number }>;
  /** My points (what the ledger holds for me). */
  points(): Promise<number>;
  /**
   * Where I stand with each of these wines (only wines I can see come back). Null when the database step
   * (20261110000033) has not been taken yet.
   */
  status(wineIds: string[]): Promise<ContributionState[] | null>;
  /** The one wine of this household's cellar Home may invite me to picture, if any (null also before that step). */
  invite(householdId: string): Promise<BottlePhotoInvite | null>;
  /** "Not now" for Home's invitation (30 days, on every device). */
  dismissInvite(): Promise<void>;
  /** The published 2D bottle picture of each of these wines that has one (household wines through their mapping). */
  art(wineIds: string[]): Promise<Map<string, BottleArtRef>>;
  /**
   * A published picture's file, read as the person: the storage policy lets it through only while it is the published
   * picture of a wine they can see. Null otherwise. `shared` = a catalogue wine's picture.
   */
  artFile(artId: string): Promise<{ bytes: Uint8Array; type: string; shared: boolean } | null>;
}

/** The database step not taken yet: the library is simply empty. */
const notThere = (e: { code?: string }) =>
  isMissingTable(e) || e.code === "PGRST202" || e.code === "42883";

/** The library as the signed-in person: row-level security and the storage policy apply to every read. */
export function createBottleLibraryRepository(db: Db): BottleLibraryRepository {
  return {
    async submit({ vintageId, photos, consent }) {
      const { data, error } = await db.rpc("submit_bottle_photos", {
        p_vintage_id: vintageId,
        p_photos: photos,
        p_consent: consent,
      });
      if (error) throw mapDbError(error);
      const result = data as { id: string; points: number };
      return { id: result.id, points: Number(result.points) || 0 };
    },

    async status(wineIds) {
      const ids = [...new Set(wineIds)].slice(0, 100);
      if (ids.length === 0) return [];
      const { data, error } = await db.rpc("bottle_photo_status", { p_wine_ids: ids });
      if (error && notThere(error)) return null;
      if (error) throw mapDbError(error);
      return (data ?? []).map((r) => ({
        wineId: r.wine_id,
        status: r.status as ContributionStatus,
        points: Number(r.points) || 0,
      }));
    },

    async invite(householdId) {
      const { data, error } = await db.rpc("bottle_photo_invite", { p_household_id: householdId });
      if (error && notThere(error)) return null;
      if (error) throw mapDbError(error);
      const r = data?.[0];
      return r && r.vintage_id
        ? {
            wineId: r.wine_id,
            vintageId: r.vintage_id,
            producer: r.producer,
            wineName: r.name,
            type: r.wine_type as WineType,
            year: r.year ?? null,
          }
        : null;
    },

    async dismissInvite() {
      const { error } = await db.rpc("dismiss_bottle_photo_invite");
      if (error && !notThere(error)) throw mapDbError(error);
    },

    async points() {
      const { data, error } = await db.from("account_points").select("points");
      if (error && notThere(error)) return 0;
      if (error) throw mapDbError(error);
      return (data ?? []).reduce((sum, r) => sum + r.points, 0);
    },

    async art(wineIds) {
      const found = new Map<string, BottleArtRef>();
      const ids = [...new Set(wineIds)];
      if (ids.length === 0) return found;
      for (let i = 0; i < ids.length; i += 500) {
        const { data, error } = await db.rpc("wine_bottle_art_for", {
          p_wine_ids: ids.slice(i, i + 500),
        });
        if (error && notThere(error)) return found;
        if (error) throw mapDbError(error);
        for (const r of data ?? [])
          found.set(r.wine_id, {
            id: r.art_id,
            width: r.width,
            height: r.height,
            shared: r.shared,
          });
      }
      return found;
    },

    async artFile(artId) {
      const { data: row, error } = await db
        .from("wine_bottle_art")
        .select("path, content_type, wine_id")
        .eq("id", artId)
        .maybeSingle();
      if (error && notThere(error)) return null;
      if (error) throw mapDbError(error);
      if (!row) return null;
      const [file, wine] = await Promise.all([
        db.storage.from("bottle-art").download(row.path),
        db.from("wines").select("status").eq("id", row.wine_id).maybeSingle(),
      ]);
      if (file.error || !file.data || !wine.data) return null;
      return {
        bytes: new Uint8Array(await file.data.arrayBuffer()),
        type: row.content_type,
        shared: wine.data.status === "canonical",
      };
    },
  };
}
