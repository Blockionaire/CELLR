import "server-only";
import { z } from "zod";
import {
  DomainError,
  type CatalogSourceRef,
  type SourceNotice,
  type WineSourcesData,
} from "@cellr/domain";
import type { Db } from "@/server/db/clients";
import { mapDbError } from "@/server/db/errors";

/**
 * WHAT A WINE PAGE MAY CREDIT (Wine Intelligence WI-05): the pages CELLR's own catalogue check of a wine rests on,
 * and the external sources whose record an admin verifiably linked to it AND that are cleared and shown to people
 * right now. Everything is read as the signed-in person: the wine under row-level security, the notices through
 * `public.wine_source_notices` (which checks membership and the source's rights at the moment of the call).
 *
 * A household's own wine has neither: nothing is looked up and nothing is invented for it.
 */
export interface WineSourcesRepository {
  /** Whether the wine is visible to the person and of the shared catalogue; null = not visible (or not there). */
  wineKind(wineId: string): Promise<"catalog" | "household" | null>;
  catalogSources(wineId: string): Promise<CatalogSourceRef[]>;
  /** Null before the database step for this has been taken. */
  notices(householdId: string, wineId: string): Promise<unknown[] | null>;
}

/** One notice as the database gives it: checked here, so a malformed row is dropped instead of shown. */
const NoticeSchema = z.object({
  providerId: z.string().min(1).max(64),
  providerName: z.string().min(1).max(120),
  license: z.string().min(1).max(80),
  licenseUrl: z.string().max(500).nullable(),
  attribution: z.string().max(500).nullable(),
  legalNotice: z.string().max(4000).nullable(),
  modified: z.boolean(),
  modificationNotice: z.string().max(500).nullable(),
  modifications: z.array(z.string().max(80)).max(12),
  externalId: z.string().min(1).max(64),
  sourceUrl: z.string().max(500).nullable(),
  retrievedAt: z.string().nullable(),
  datasetVersion: z.string().max(120).nullable(),
  // only a source shown to people is ever credited to people
  scope: z.literal("public"),
});

export function createWineSourcesRepository(db: Db): WineSourcesRepository {
  return {
    async wineKind(wineId) {
      const { data, error } = await db
        .from("wines")
        .select("id, status")
        .eq("id", wineId)
        .maybeSingle();
      if (error) throw mapDbError(error);
      if (!data) return null;
      return data.status === "canonical" ? "catalog" : "household";
    },
    async catalogSources(wineId) {
      const { data, error } = await db
        .from("wine_sources")
        .select("source_name, url, retrieved_at")
        .eq("wine_id", wineId)
        .order("retrieved_at", { ascending: true })
        .limit(10);
      if (error) throw mapDbError(error);
      return (data ?? []).map((s) => ({
        name: s.source_name,
        url: s.url,
        retrievedAt: s.retrieved_at,
      }));
    },
    async notices(householdId, wineId) {
      const { data, error } = await db.rpc("wine_source_notices", {
        p_household_id: householdId,
        p_wine_id: wineId,
      });
      // Before 20261117000040 the function does not exist: no external source is credited, nothing fails.
      if (error && (error.code === "PGRST202" || error.code === "42883")) return null;
      if (error) throw mapDbError(error);
      return Array.isArray(data) ? data : [];
    },
  };
}

export function createWineSourcesService(deps: {
  repo: WineSourcesRepository;
  householdId: () => Promise<string>;
}) {
  return {
    async get(wineId: string): Promise<WineSourcesData> {
      const kind = await deps.repo.wineKind(wineId);
      if (kind === null) throw new DomainError("NOT_FOUND");
      if (kind === "household") return { catalog: false, catalogSources: [], external: [] };
      const [catalogSources, raw] = await Promise.all([
        deps.repo.catalogSources(wineId),
        // a failing or missing lookup credits nobody; it never takes the page down
        deps.repo.notices(await deps.householdId(), wineId).catch(() => null),
      ]);
      const external: SourceNotice[] = [];
      for (const row of raw ?? []) {
        const parsed = NoticeSchema.safeParse(row);
        if (parsed.success) external.push(parsed.data);
      }
      return { catalog: true, catalogSources, external };
    },
  };
}
