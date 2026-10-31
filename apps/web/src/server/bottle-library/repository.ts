import "server-only";
import type { BottleArtRef } from "@cellr/domain";
import type { Db } from "@/server/db/clients";
import { isMissingTable, mapDbError } from "@/server/db/errors";

export interface BottleLibraryRepository {
  /** Records a photo the server has stored, as the sender (consent, ownership and reward are checked there). */
  submit(input: {
    vintageId: string;
    path: string;
    width: number;
    height: number;
    consent: boolean;
  }): Promise<{ id: string; points: number }>;
  /** My points (what the ledger holds for me). */
  points(): Promise<number>;
  /** The published 2D bottle picture of each of these wines that has one (household wines through their mapping). */
  art(wineIds: string[]): Promise<Map<string, BottleArtRef>>;
  /** A published picture's file. Null when it is not (or no longer) published. */
  artFile(artId: string): Promise<{ bytes: Uint8Array; type: string } | null>;
}

/** The database step not taken yet: the library is simply empty. */
const notThere = (e: { code?: string }) =>
  isMissingTable(e) || e.code === "PGRST202" || e.code === "42883";

/** The library as the signed-in person: row-level security and the storage policy apply to every read. */
export function createBottleLibraryRepository(db: Db): BottleLibraryRepository {
  return {
    async submit({ vintageId, path, width, height, consent }) {
      const { data, error } = await db.rpc("submit_bottle_photo", {
        p_vintage_id: vintageId,
        p_photo_path: path,
        p_width: width,
        p_height: height,
        p_consent: consent,
      });
      if (error) throw mapDbError(error);
      const result = data as { id: string; points: number };
      return { id: result.id, points: Number(result.points) || 0 };
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
          found.set(r.wine_id, { id: r.art_id, width: r.width, height: r.height });
      }
      return found;
    },

    async artFile(artId) {
      const { data: row, error } = await db
        .from("wine_bottle_art")
        .select("path, content_type")
        .eq("id", artId)
        .maybeSingle();
      if (error && notThere(error)) return null;
      if (error) throw mapDbError(error);
      if (!row) return null;
      const file = await db.storage.from("wine-labels").download(row.path);
      if (file.error || !file.data) return null;
      return { bytes: new Uint8Array(await file.data.arrayBuffer()), type: row.content_type };
    },
  };
}
