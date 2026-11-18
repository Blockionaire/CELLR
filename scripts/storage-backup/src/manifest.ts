// The backup manifest: the machine-readable record of what was backed up, from where, and how it was verified.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { SafetyError } from "./errors";
import type { BucketInfo, RemoteMd5Check } from "./storage-client";

export const MANIFEST_SCHEMA = "cellr-storage-backup/v1";
export const TOOL_VERSION = "1.0.0";

export type ObjectStatus = "ok" | "failed" | "vanished" | "changed";

export interface ManifestObject {
  bucket: string;
  key: string;
  localPath: string | null;
  size: number | null;
  sha256: string | null;
  md5: string | null;
  contentType: string | null;
  cacheControl: string | null;
  eTag: string | null;
  lastModified: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  remoteId: string;
  userMetadata: Record<string, unknown> | null;
  remoteMd5: RemoteMd5Check;
  status: ObjectStatus;
  attempts: number;
  error?: string;
}

export interface ManifestBucket extends BucketInfo {
  objectCount: number;
  bytes: number;
}

export interface Consistency {
  /** Present in the second inventory only: created while the backup ran, so not in it. */
  created: string[];
  /** Present in the first inventory only: deleted while the backup ran. */
  deleted: string[];
  /** Different id, size, ETag or timestamps between the two inventories, or between listing and download. */
  changed: string[];
  bucketsCreated: string[];
  bucketsDeleted: string[];
  bucketsChanged: string[];
}

export type VerificationStatus = "VERIFIED" | "FAILED";

export interface Verification {
  status: VerificationStatus;
  reasons: string[];
  warnings: string[];
  localIntegrity: { checked: number; passed: number; failed: number };
  remoteContentEquivalence: {
    md5Matched: number;
    md5Unavailable: number;
    md5Mismatched: number;
    notChecked: number;
  };
}

export interface Manifest {
  schema: typeof MANIFEST_SCHEMA;
  backupId: string;
  tool: { name: string; version: string; node: string; platform: string };
  source: { projectRef: string; origin: string };
  startedAt: string;
  finishedAt: string;
  inventory: { firstAt: string; secondAt: string | null };
  options: { concurrency: number; md5Policy: string; pageSize: number };
  buckets: ManifestBucket[];
  objects: ManifestObject[];
  totals: {
    buckets: number;
    objects: number;
    bytesListed: number;
    objectsDownloaded: number;
    bytesDownloaded: number;
  };
  errors: { bucket: string; key: string; kind: string; message: string }[];
  consistency: Consistency;
  requests: { total: number; retries: number; byMethod: Record<string, number> };
  verification: Verification;
  limitations: string[];
}

/** Stated in every manifest, so nobody reads more into a backup than it guarantees. */
export const LIMITATIONS: readonly string[] = [
  "Storage has no snapshot: objects are listed, downloaded one by one, and listed again. A change between the two listings fails the backup; a change that is undone between them cannot be seen.",
  "The database (including storage.objects metadata rows, Auth users and every table) is NOT in this backup. It is covered by Supabase's daily physical backups and, optionally, a logical dump (docs/BACKUP-RECOVERY.md §6).",
  "Remote content equivalence is proven only for objects whose ETag is a plain MD5 (single-part uploads). Others are verified locally (SHA-256) but not against the server's content.",
  "Object ownership (storage.objects.owner/owner_id) cannot be set through the Storage API on restore; CELLR's storage policies are path-based and do not use it.",
  "Custom user metadata is recorded only when the listing returns it.",
];

export async function readManifest(dir: string): Promise<Manifest> {
  let raw: string;
  try {
    raw = await readFile(path.join(dir, "manifest.json"), "utf8");
  } catch {
    throw new SafetyError(`${dir} has no manifest.json; it is not a backup made by this tool`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new SafetyError("manifest.json is not valid JSON");
  }
  const m = parsed as Partial<Manifest>;
  if (m.schema !== MANIFEST_SCHEMA)
    throw new SafetyError(`manifest.json has an unknown schema: ${String(m.schema)}`);
  if (!Array.isArray(m.objects) || !Array.isArray(m.buckets) || !m.source || !m.verification)
    throw new SafetyError("manifest.json is incomplete");
  for (const o of m.objects) {
    if (typeof o.bucket !== "string" || typeof o.key !== "string")
      throw new SafetyError("manifest.json has an object without bucket or key");
    if (
      o.status === "ok" &&
      (typeof o.localPath !== "string" ||
        typeof o.sha256 !== "string" ||
        typeof o.size !== "number")
    )
      throw new SafetyError(
        `manifest.json: object ${o.bucket}/${o.key} is "ok" but has no file, size or checksum`,
      );
  }
  return m as Manifest;
}

/** `sha256sum -c` / `Get-FileHash` compatible list of every file, relative to the backup folder. */
export function sha256sums(objects: readonly ManifestObject[]): string {
  return (
    objects
      .filter((o) => o.status === "ok" && o.localPath && o.sha256)
      .map((o) => `${o.sha256}  ${o.localPath}`)
      .sort((a, b) => (a.slice(66) < b.slice(66) ? -1 : 1))
      .join("\n") + "\n"
  );
}
