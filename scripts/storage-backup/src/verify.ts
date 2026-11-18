// Checks an existing backup folder without trusting anything in it: every file is hashed again, every path is
// recomputed from the keys, and nothing outside the manifest may be there. Never writes into the backup.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { EXIT } from "./errors";
import { hashFile, listFiles } from "./fsutil";
import { readManifest, sha256sums, type Manifest } from "./manifest";
import { assertSafeKey, objectId, planLocalPaths, resolveInside } from "./paths";
import { normalizeEtag, type StorageClient } from "./storage-client";

export interface VerifyOptions {
  dir: string;
  /** Read-only comparison with the project as it is now (drift since the backup). */
  client?: StorageClient | undefined;
  /** CSV "bucket,objects,bytes" exported from the SQL Editor (docs/BACKUP-RECOVERY.md §4.3): an independent count. */
  dbInventoryCsv?: string | undefined;
  onProgress?: ((done: number, total: number) => void) | undefined;
}

export interface VerifyResult {
  manifest: Manifest;
  problems: string[];
  notes: string[];
  /** objectId()s of objects whose file is missing, altered or misplaced. */
  broken: string[];
  filesChecked: number;
  exitCode: number;
}

export function parseInventoryCsv(text: string): Map<string, { objects: number; bytes: number }> {
  const out = new Map<string, { objects: number; bytes: number }>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const cells = line.split(/[,;\t]/).map((c) => c.trim().replace(/^"(.*)"$/, "$1"));
    if (cells.length < 3)
      throw new Error(`the inventory CSV has a line with fewer than 3 columns: ${line}`);
    const [bucket, objects, bytes] = cells as [string, string, string];
    if (!/^\d+$/.test(objects) || !/^\d+$/.test(bytes)) {
      if (out.size === 0) continue; // the header line
      throw new Error(`the inventory CSV has a line that is not "bucket,objects,bytes": ${line}`);
    }
    out.set(bucket, { objects: Number(objects), bytes: Number(bytes) });
  }
  return out;
}

export async function verifyBackup(options: VerifyOptions): Promise<VerifyResult> {
  const dir = path.resolve(options.dir);
  const manifest = await readManifest(dir);
  const problems: string[] = [];
  const notes: string[] = [];

  if (manifest.verification.status !== "VERIFIED")
    problems.push(
      `the backup was recorded as ${manifest.verification.status}: ${manifest.verification.reasons.join("; ")}`,
    );

  // Paths are recomputed from the keys: an edited manifest cannot point a file anywhere else.
  const safe = manifest.objects.filter((o) => {
    try {
      assertSafeKey(o.key);
      return true;
    } catch {
      return false;
    }
  });
  const plan = planLocalPaths(safe);
  const expected = new Set<string>();
  const broken: string[] = [];
  let filesChecked = 0;
  const withFiles = manifest.objects.filter((o) => o.localPath);
  for (const o of withFiles) {
    const label = `${o.bucket}/${o.key}`;
    const planned = plan.get(objectId(o.bucket, o.key));
    if (o.localPath !== planned) {
      problems.push(`${label}: the manifest's file path is not the one its key maps to`);
      broken.push(objectId(o.bucket, o.key));
      continue;
    }
    expected.add(o.localPath as string);
    let full: string;
    try {
      full = resolveInside(dir, o.localPath as string);
    } catch (e) {
      problems.push(`${label}: ${(e as Error).message}`);
      broken.push(objectId(o.bucket, o.key));
      continue;
    }
    try {
      const h = await hashFile(full);
      filesChecked++;
      if (h.bytes !== o.size || h.sha256 !== o.sha256) {
        broken.push(objectId(o.bucket, o.key));
        problems.push(
          h.bytes !== o.size
            ? `${label}: ${h.bytes} bytes on disk, ${o.size} in the manifest`
            : `${label}: SHA-256 differs from the manifest (the file changed)`,
        );
      }
    } catch {
      broken.push(objectId(o.bucket, o.key));
      problems.push(`${label}: the file is missing or unreadable`);
    }
    options.onProgress?.(filesChecked, withFiles.length);
  }
  if (manifest.objects.some((o) => o.status === "ok" && !o.localPath))
    problems.push("the manifest lists objects as ok without a file");

  for (const file of await listFiles(dir, path.join(dir, "objects")))
    if (!expected.has(file))
      problems.push(`an unexpected file that is not in the manifest: ${file}`);

  try {
    const sums = await readFile(path.join(dir, "SHA256SUMS"), "utf8");
    if (sums !== sha256sums(manifest.objects))
      problems.push("SHA256SUMS does not match the manifest");
  } catch {
    problems.push("SHA256SUMS is missing");
  }

  const count = manifest.objects.length;
  if (manifest.totals.objects !== count)
    problems.push("the manifest's object total does not match its object list");
  for (const b of manifest.buckets) {
    const own = manifest.objects.filter((o) => o.bucket === b.id);
    if (own.length !== b.objectCount)
      problems.push(`bucket ${b.id}: object count does not match its object list`);
  }

  if (options.dbInventoryCsv !== undefined) {
    const before = problems.length;
    const db = parseInventoryCsv(options.dbInventoryCsv);
    for (const b of manifest.buckets) {
      const row = db.get(b.id);
      if (!row) problems.push(`bucket ${b.id} is in the backup but not in the database inventory`);
      else if (row.objects !== b.objectCount || row.bytes !== b.bytes)
        problems.push(
          `bucket ${b.id}: the database counts ${row.objects} objects / ${row.bytes} bytes, the backup ${b.objectCount} / ${b.bytes}`,
        );
    }
    for (const bucket of db.keys())
      if (!manifest.buckets.some((b) => b.id === bucket))
        problems.push(`bucket ${bucket} is in the database inventory but not in the backup`);
    if (problems.length === before)
      notes.push("the database inventory matches the backup, bucket by bucket");
  }

  if (options.client) {
    const client = options.client;
    const remote = new Map<string, { size: number | null; eTag: string | null }>();
    for (const b of await client.listBuckets())
      for (const o of await client.listAllObjects(b.id)) remote.set(objectId(o.bucket, o.key), o);
    let added = 0;
    let removed = 0;
    let changed = 0;
    const local = new Map(manifest.objects.map((o) => [objectId(o.bucket, o.key), o]));
    for (const [id, r] of remote) {
      const l = local.get(id);
      if (!l) added++;
      else if (r.size !== l.size || normalizeEtag(r.eTag) !== normalizeEtag(l.eTag)) changed++;
    }
    for (const id of local.keys()) if (!remote.has(id)) removed++;
    notes.push(
      added + removed + changed === 0
        ? "the project's Storage is still identical to this backup (same keys, sizes and ETags)"
        : `drift since the backup: ${added} new, ${removed} deleted, ${changed} changed object(s) in the project`,
    );
  }

  return {
    manifest,
    problems,
    notes,
    broken,
    filesChecked,
    exitCode: problems.length ? EXIT.failed : EXIT.ok,
  };
}
