import "server-only";
import { randomUUID } from "node:crypto";
import {
  WineMasterCountsSchema,
  WineMasterListSchema,
  WineMasterRecordSchema,
  parseMasterResult,
  type BottleArtType,
  type MasterFlag,
  type MasterResult,
  type WineDetails,
  type WineMasterCounts,
  type WineMasterList,
  type WineMasterRecord,
  type WineVisualScope,
} from "@cellr/domain";
import { assertAdmin, type AdminSession } from "@/server/admin/access";
import { logError } from "@/server/log";
import { createServiceClient } from "./client";

/**
 * The Wine Master Database's privileged side (migration 20261107000030_wine_master.sql). Every function takes the
 * session only verifyAdmin issues and checks it again; every change is one database function that validates, refuses
 * stale or duplicate edits and writes the audit in the same transaction. Curated labels live in their own private
 * bucket (catalog-labels), written only from here; household label photos are only ever read, for the admin's eyes.
 * "missing" = the migration is not applied yet; null = no service role.
 */
const LABELS = "catalog-labels";
const HOUSEHOLD_IMAGES = "bottle-images";

type Result<T> = Promise<T | "missing" | null>;

const missing = (e: { code?: string }) =>
  e.code === "PGRST202" || e.code === "42883" || e.code === "PGRST205" || e.code === "42P01";

type Rpc = (
  f: string,
  a: Record<string, unknown>,
) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;

async function rpc<T>(
  fn: string,
  args: Record<string, unknown>,
  parse: (d: unknown) => T,
): Result<T> {
  const db = createServiceClient();
  if (!db) return null;
  const { data, error } = await (db.rpc as unknown as Rpc)(fn, args);
  if (error) {
    if (missing(error)) return "missing";
    throw error;
  }
  return parse(data);
}

const change = (fn: string, args: Record<string, unknown>) => rpc(fn, args, parseMasterResult);

// ---- Reads -------------------------------------------------------------------------------------------------------

export function readWineMaster(
  session: AdminSession,
  scope: WineVisualScope,
  flags: MasterFlag[],
  query: string,
  limit: number,
  offset: number,
): Result<WineMasterList> {
  assertAdmin(session);
  return rpc(
    "admin_wine_master",
    { p_scope: scope, p_flags: flags, p_query: query, p_limit: limit, p_offset: offset },
    (d) => WineMasterListSchema.parse(d),
  );
}

export function readWineMasterCounts(session: AdminSession): Result<WineMasterCounts> {
  assertAdmin(session);
  return rpc("admin_wine_master_counts", {}, (d) => WineMasterCountsSchema.parse(d));
}

export function readWineMasterRecord(
  session: AdminSession,
  wineId: string,
): Result<WineMasterRecord | "none"> {
  assertAdmin(session);
  return rpc("admin_wine_master_record", { p_wine: wineId }, (d) =>
    d === null ? "none" : WineMasterRecordSchema.parse(d),
  );
}

// ---- Edits -------------------------------------------------------------------------------------------------------

export function updateWineDetails(
  session: AdminSession,
  wineId: string,
  expected: string,
  details: WineDetails,
): Result<MasterResult> {
  assertAdmin(session);
  const { reason, ...fields } = details;
  return change("admin_wine_update", {
    p_wine: wineId,
    p_expected: expected,
    p_fields: fields,
    p_reason: reason,
    p_actor: session.userId,
  });
}

export function updateProducer(
  session: AdminSession,
  producerId: string,
  expected: string,
  edit: { name: string; country: string; reason: string; confirmWines: number | null },
): Result<MasterResult> {
  assertAdmin(session);
  return change("admin_producer_update", {
    p_producer: producerId,
    p_expected: expected,
    p_name: edit.name,
    p_country: edit.country,
    p_confirm_wines: edit.confirmWines,
    p_reason: edit.reason,
    p_actor: session.userId,
  });
}

export function reassignProducer(
  session: AdminSession,
  wineId: string,
  expected: string,
  producerId: string,
  reason: string,
): Result<MasterResult> {
  assertAdmin(session);
  return change("admin_wine_reassign_producer", {
    p_wine: wineId,
    p_expected: expected,
    p_producer: producerId,
    p_reason: reason,
    p_actor: session.userId,
  });
}

export function setAliases(
  session: AdminSession,
  wineId: string,
  aliases: string[],
  reason: string,
): Result<MasterResult> {
  assertAdmin(session);
  return change("admin_wine_set_aliases", {
    p_wine: wineId,
    p_aliases: aliases,
    p_reason: reason,
    p_actor: session.userId,
  });
}

export function setGrapes(
  session: AdminSession,
  wineId: string,
  grapes: { grape: string; pct: number | null }[],
  reason: string,
): Result<MasterResult> {
  assertAdmin(session);
  return change("admin_wine_set_grapes", {
    p_wine: wineId,
    p_grapes: grapes,
    p_reason: reason,
    p_actor: session.userId,
  });
}

export function createVintage(
  session: AdminSession,
  wineId: string,
  v: { year: number | null; abv: number | null; reason: string },
): Result<MasterResult> {
  assertAdmin(session);
  return change("admin_vintage_create", {
    p_wine: wineId,
    p_year: v.year,
    p_abv: v.abv,
    p_reason: v.reason,
    p_actor: session.userId,
  });
}

export function updateVintage(
  session: AdminSession,
  vintageId: string,
  v: { year: number | null; abv: number | null; reason: string },
): Result<MasterResult> {
  assertAdmin(session);
  return change("admin_vintage_update", {
    p_vintage: vintageId,
    p_year: v.year,
    p_abv: v.abv,
    p_reason: v.reason,
    p_actor: session.userId,
  });
}

export function deleteVintage(
  session: AdminSession,
  vintageId: string,
  reason: string,
): Result<MasterResult> {
  assertAdmin(session);
  return change("admin_vintage_delete", {
    p_vintage: vintageId,
    p_reason: reason,
    p_actor: session.userId,
  });
}

export function linkWine(
  session: AdminSession,
  sourceWineId: string,
  canonicalWineId: string,
  reason: string,
): Result<MasterResult> {
  assertAdmin(session);
  return change("admin_wine_link", {
    p_source: sourceWineId,
    p_target: canonicalWineId,
    p_reason: reason,
    p_actor: session.userId,
  });
}

export function unlinkWine(
  session: AdminSession,
  sourceWineId: string,
  reason: string,
): Result<MasterResult> {
  assertAdmin(session);
  return change("admin_wine_unlink", {
    p_source: sourceWineId,
    p_reason: reason,
    p_actor: session.userId,
  });
}

// ---- Curated catalogue labels ------------------------------------------------------------------------------------

/**
 * Stores a checked label image for a catalogue wine as a draft. Its id; "gone" when the wine is not a catalogue wine
 * (or the vintage is not its own): the file is removed again, so nothing is left behind.
 */
export async function addCatalogLabel(
  session: AdminSession,
  wineId: string,
  label: {
    bytes: Uint8Array;
    type: BottleArtType;
    width: number;
    height: number;
    side: "front" | "back";
    vintageId: string | null;
    source: string;
  },
): Promise<string | "gone" | "missing" | null> {
  assertAdmin(session);
  const db = createServiceClient();
  if (!db) return null;
  const path = `${wineId}/${randomUUID()}.${label.type === "image/png" ? "png" : "jpg"}`;
  const { error } = await db.storage
    .from(LABELS)
    .upload(path, label.bytes, { contentType: label.type, upsert: false });
  if (error) throw new Error(`catalog label upload failed: ${error.message}`);
  const drop = () =>
    db.storage
      .from(LABELS)
      .remove([path])
      .then(
        () => {},
        (e: unknown) => logError("catalog_label_cleanup_failed", e),
      );
  try {
    const id = await rpc(
      "admin_add_catalog_label",
      {
        p_wine: wineId,
        p_vintage: label.vintageId,
        p_side: label.side,
        p_path: path,
        p_type: label.type,
        p_width: label.width,
        p_height: label.height,
        p_source: label.source,
        p_actor: session.userId,
      },
      (d) => (typeof d === "string" ? d : null),
    );
    if (typeof id === "string" && id !== "missing") return id;
    await drop();
    return id === "missing" ? "missing" : "gone";
  } catch (e) {
    await drop();
    throw e;
  }
}

export function publishCatalogLabel(session: AdminSession, labelId: string): Result<boolean> {
  assertAdmin(session);
  return rpc(
    "admin_publish_catalog_label",
    { p_label: labelId, p_actor: session.userId },
    (d) => d === true,
  );
}

export function unpublishCatalogLabel(session: AdminSession, labelId: string): Result<boolean> {
  assertAdmin(session);
  return rpc(
    "admin_unpublish_catalog_label",
    { p_label: labelId, p_actor: session.userId },
    (d) => d === true,
  );
}

/** Removes a curated label, then its file. Household photos are never touched. */
export async function removeCatalogLabel(session: AdminSession, labelId: string): Result<boolean> {
  assertAdmin(session);
  const path = await rpc(
    "admin_remove_catalog_label",
    { p_label: labelId, p_actor: session.userId },
    (d) => (typeof d === "string" ? d : null),
  );
  if (path === "missing" || path === null) return path === "missing" ? "missing" : false;
  const db = createServiceClient();
  const removed = await db?.storage.from(LABELS).remove([path]);
  if (removed?.error) logError("catalog_label_remove_failed", removed.error);
  return true;
}

async function download(bucket: string, path: string) {
  const db = createServiceClient();
  if (!db) return null;
  const { data, error } = await db.storage.from(bucket).download(path);
  if (error || !data) return null;
  return new Uint8Array(await data.arrayBuffer());
}

/** A curated label's file (a draft too), for the admin's preview. */
export async function readCatalogLabelFile(
  session: AdminSession,
  wineId: string,
  labelId: string,
): Promise<{ bytes: Uint8Array; type: string } | null> {
  assertAdmin(session);
  const file = await rpc("admin_catalog_label_file", { p_label: labelId }, (d) =>
    d && typeof d === "object" ? (d as { path: string; type: string }) : null,
  );
  if (!file || file === "missing" || !file.path.startsWith(`${wineId}/`)) return null;
  const bytes = await download(LABELS, file.path);
  return bytes ? { bytes, type: file.type } : null;
}

/** A household's label photo of a bottle of this wine, for the admin's eyes only (never shared by this). */
export async function readHouseholdLabelFile(
  session: AdminSession,
  wineId: string,
  imageId: string,
): Promise<Uint8Array | null> {
  assertAdmin(session);
  const path = await rpc("admin_household_label_path", { p_wine: wineId, p_image: imageId }, (d) =>
    typeof d === "string" ? d : null,
  );
  if (!path || path === "missing") return null;
  return download(HOUSEHOLD_IMAGES, path);
}
