// One backup run: list everything, download everything, list everything again, re-read everything from disk, and only
// then call it VERIFIED. Any doubt makes the run FAILED, with a non-zero exit code and the reasons in the report.
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { AuthError, EXIT, LocalIOError, NotFoundError, SafetyError, exitCodeFor } from "./errors";
import {
  assertNotSyncedFolder,
  assertNotTrackedByGit,
  createNewDir,
  ensurePrivateDir,
  hashFile,
  restrictWindowsAcl,
  writeNewFile,
  writeOwnFile,
} from "./fsutil";
import { RunAbortedError } from "./http";
import { formatBytes, type Logger } from "./log";
import {
  LIMITATIONS,
  MANIFEST_SCHEMA,
  TOOL_VERSION,
  sha256sums,
  type Consistency,
  type Manifest,
  type ManifestBucket,
  type ManifestObject,
  type Verification,
} from "./manifest";
import { assertSafeKey, objectId, planLocalPaths, resolveInside } from "./paths";
import { renderRestoreGuide, renderSummary, renderVerification } from "./report";
import {
  fingerprint,
  normalizeEtag,
  type BucketInfo,
  type Md5Policy,
  type RemoteObject,
  type StorageClient,
} from "./storage-client";

export interface BackupOptions {
  client: StorageClient;
  outRoot: string;
  projectRef: string;
  concurrency: number;
  md5Policy: Md5Policy;
  pageSize?: number;
  /** A project without any bucket is almost certainly the wrong key or project; accepted only when asked. */
  allowEmpty?: boolean;
  allowSyncedFolder?: boolean;
  logger: Logger;
  now?: () => Date;
  signal?: AbortSignal;
  /** Test hook: runs after the downloads and before every file is re-read from disk. */
  beforeReread?: (dir: string) => Promise<void>;
}

export interface BackupResult {
  dir: string;
  manifest: Manifest;
  exitCode: number;
}

export function formatBackupId(d: Date): string {
  return d
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/:/g, "-");
}

export async function runPool<T>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<void>,
) {
  let next = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length)) },
    async () => {
      while (next < items.length) {
        const index = next++;
        await fn(items[index] as T, index);
      }
    },
  );
  await Promise.all(workers);
}

interface Inventory {
  at: string;
  buckets: BucketInfo[];
  objects: RemoteObject[];
}

async function takeInventory(
  client: StorageClient,
  pageSize: number,
  now: () => Date,
): Promise<Inventory> {
  const at = now().toISOString();
  const buckets = await client.listBuckets();
  const objects: RemoteObject[] = [];
  for (const b of buckets) objects.push(...(await client.listAllObjects(b.id, pageSize)));
  return { at, buckets, objects };
}

const bucketSettings = (b: BucketInfo) =>
  JSON.stringify([b.public, b.fileSizeLimit, [...(b.allowedMimeTypes ?? [])].sort(), b.type]);

export function compareInventories(first: Inventory, second: Inventory): Consistency {
  const c: Consistency = {
    created: [],
    deleted: [],
    changed: [],
    bucketsCreated: [],
    bucketsDeleted: [],
    bucketsChanged: [],
  };
  const b1 = new Map(first.buckets.map((b) => [b.id, b]));
  const b2 = new Map(second.buckets.map((b) => [b.id, b]));
  for (const [id, b] of b2) {
    const before = b1.get(id);
    if (!before) c.bucketsCreated.push(id);
    else if (bucketSettings(before) !== bucketSettings(b)) c.bucketsChanged.push(id);
  }
  for (const id of b1.keys()) if (!b2.has(id)) c.bucketsDeleted.push(id);
  const o1 = new Map(first.objects.map((o) => [objectId(o.bucket, o.key), o]));
  const o2 = new Map(second.objects.map((o) => [objectId(o.bucket, o.key), o]));
  const label = (o: RemoteObject) => `${o.bucket}/${o.key}`;
  for (const [id, o] of o2) {
    const before = o1.get(id);
    if (!before) c.created.push(label(o));
    else if (fingerprint(before) !== fingerprint(o)) c.changed.push(label(o));
  }
  for (const [id, o] of o1) if (!o2.has(id)) c.deleted.push(label(o));
  return c;
}

export async function runBackup(options: BackupOptions): Promise<BackupResult> {
  const { client, logger, md5Policy } = options;
  const now = options.now ?? (() => new Date());
  const pageSize = options.pageSize ?? 1000;
  const concurrency = Math.max(1, Math.min(16, options.concurrency));
  const outRoot = path.resolve(options.outRoot);

  if (!options.allowSyncedFolder) assertNotSyncedFolder(outRoot);
  assertNotTrackedByGit(outRoot);

  const startedAt = now();
  const backupId = formatBackupId(startedAt);
  const dir = path.join(outRoot, backupId);
  await createNewDir(dir);
  restrictWindowsAcl(dir, logger);
  await writeOwnFile(
    path.join(dir, "STATUS"),
    "IN_PROGRESS\nThis backup was interrupted if this file still says so.\n",
  );
  const staging = path.join(dir, ".staging");
  await ensurePrivateDir(staging);
  logger.info(`backup ${backupId} of project ${options.projectRef} into ${dir}`);

  const reasons: string[] = [];
  const warnings: string[] = [];
  const errors: Manifest["errors"] = [];
  const records = new Map<string, ManifestObject>();
  let fatal: Error | undefined;
  let first: Inventory | undefined;
  let second: Inventory | undefined;
  let consistency: Consistency = {
    created: [],
    deleted: [],
    changed: [],
    bucketsCreated: [],
    bucketsDeleted: [],
    bucketsChanged: [],
  };

  try {
    // ---- 1. First inventory ----------------------------------------------------------------------------------------
    logger.info("listing buckets and objects (first inventory)");
    first = await takeInventory(client, pageSize, now);
    logger.info(
      `found ${first.buckets.length} buckets, ${first.objects.length} objects, ` +
        formatBytes(first.objects.reduce((s, o) => s + (o.size ?? 0), 0)),
    );
    if (first.buckets.length === 0 && !options.allowEmpty)
      reasons.push(
        "the project has no buckets at all: wrong project or a key without access (use --allow-empty if expected)",
      );

    // ---- 2. Local paths (unsafe keys are recorded, never downloaded) -----------------------------------------------
    const safe: RemoteObject[] = [];
    for (const o of first.objects) {
      const base = baseRecord(o);
      try {
        assertSafeKey(o.key);
        safe.push(o);
        records.set(objectId(o.bucket, o.key), base);
      } catch (e) {
        const message = (e as Error).message;
        records.set(objectId(o.bucket, o.key), { ...base, status: "failed", error: message });
        errors.push({ bucket: o.bucket, key: o.key, kind: "unsafe-key", message });
      }
    }
    const plan = planLocalPaths(safe);

    // ---- 3. Downloads ----------------------------------------------------------------------------------------------
    let done = 0;
    let doneBytes = 0;
    let lastReport = Date.now();
    await runPool(safe, concurrency, async (o, index) => {
      const id = objectId(o.bucket, o.key);
      const record = records.get(id) as ManifestObject;
      if (fatal || options.signal?.aborted) {
        record.status = "failed";
        record.error = "not attempted: the run was stopped";
        return;
      }
      const staged = path.join(staging, `${index}.part`);
      try {
        const r = await client.download(o.bucket, o.key, staged, {
          size: o.size,
          listedEtag: o.eTag,
          md5Policy,
        });
        const localPath = plan.get(id) as string;
        const final = resolveInside(dir, localPath);
        await mkdir(path.dirname(final), { recursive: true, mode: 0o700 });
        await rename(staged, final).catch((e: NodeJS.ErrnoException) => {
          throw new LocalIOError(`cannot move the download into place: ${e.code}`);
        });
        const listed = normalizeEtag(o.eTag);
        const served = normalizeEtag(r.etag);
        Object.assign(record, {
          localPath,
          size: r.bytes,
          sha256: r.sha256,
          md5: r.md5,
          contentType: o.mimetype ?? r.contentType,
          cacheControl: o.cacheControl ?? r.cacheControl,
          eTag: o.eTag ?? r.etag,
          remoteMd5: r.remoteMd5,
          attempts: r.attempts,
          status: listed !== null && served !== null && listed !== served ? "changed" : "ok",
        } satisfies Partial<ManifestObject>);
        delete record.error;
        if (record.status === "changed") consistency.changed.push(`${o.bucket}/${o.key}`);
        done++;
        doneBytes += r.bytes;
      } catch (e) {
        await rm(staged, { force: true });
        record.status = e instanceof NotFoundError ? "vanished" : "failed";
        record.error = (e as Error).message;
        errors.push({
          bucket: o.bucket,
          key: o.key,
          kind: e instanceof NotFoundError ? "vanished" : (e as Error).name,
          message: (e as Error).message,
        });
        if (
          e instanceof AuthError ||
          e instanceof LocalIOError ||
          e instanceof RunAbortedError ||
          e instanceof SafetyError
        )
          fatal ??= e;
      }
      if (Date.now() - lastReport > 5000 || done === safe.length) {
        lastReport = Date.now();
        logger.info(`downloaded ${done}/${safe.length} objects (${formatBytes(doneBytes)})`);
      }
    });

    // ---- 4. Second inventory: did anything change while we were downloading? --------------------------------------
    if (!fatal && !options.signal?.aborted) {
      logger.info("listing everything again (second inventory)");
      second = await takeInventory(client, pageSize, now);
      const diff = compareInventories(first, second);
      consistency = {
        ...diff,
        changed: [...new Set([...consistency.changed, ...diff.changed])].sort(),
      };
      for (const label of consistency.changed) {
        const slash = label.indexOf("/");
        const rec = records.get(objectId(label.slice(0, slash), label.slice(slash + 1)));
        if (rec && rec.status === "ok") rec.status = "changed";
      }
    }
  } catch (e) {
    fatal ??= e as Error;
  }

  // ---- 5. Re-read every file from disk -----------------------------------------------------------------------------
  await options.beforeReread?.(dir);
  const local = { checked: 0, passed: 0, failed: 0 };
  for (const rec of records.values()) {
    if (!rec.localPath || !rec.sha256) continue;
    local.checked++;
    try {
      const h = await hashFile(resolveInside(dir, rec.localPath));
      if (h.sha256 === rec.sha256 && h.bytes === rec.size) local.passed++;
      else {
        local.failed++;
        rec.status = "failed";
        rec.error = "the file on disk differs from what was downloaded";
        errors.push({
          bucket: rec.bucket,
          key: rec.key,
          kind: "local-integrity",
          message: rec.error,
        });
      }
    } catch (e) {
      local.failed++;
      rec.status = "failed";
      rec.error = (e as Error).message;
      errors.push({
        bucket: rec.bucket,
        key: rec.key,
        kind: "local-integrity",
        message: rec.error,
      });
    }
  }
  await rm(staging, { recursive: true, force: true });

  // ---- 6. Verdict --------------------------------------------------------------------------------------------------
  const objects = [...records.values()].sort((a, b) =>
    a.bucket === b.bucket ? (a.key < b.key ? -1 : 1) : a.bucket < b.bucket ? -1 : 1,
  );
  if (fatal) reasons.push(`the run stopped: ${fatal.message}`);
  if (!first) reasons.push("the first inventory could not be taken");
  else if (!second && !fatal) reasons.push("the second inventory could not be taken");
  const byStatus = (s: ManifestObject["status"]) => objects.filter((o) => o.status === s).length;
  if (byStatus("failed")) reasons.push(`${byStatus("failed")} object(s) could not be backed up`);
  if (byStatus("vanished"))
    reasons.push(`${byStatus("vanished")} object(s) were deleted during the backup`);
  if (consistency.created.length)
    reasons.push(
      `${consistency.created.length} object(s) were created during the backup and are not in it`,
    );
  if (consistency.deleted.length)
    reasons.push(`${consistency.deleted.length} object(s) were deleted during the backup`);
  if (consistency.changed.length)
    reasons.push(`${consistency.changed.length} object(s) changed during the backup`);
  for (const k of ["bucketsCreated", "bucketsDeleted", "bucketsChanged"] as const)
    if (consistency[k].length)
      reasons.push(
        `buckets ${k.replace("buckets", "").toLowerCase()} during the backup: ${consistency[k].join(", ")}`,
      );
  if (local.failed) reasons.push(`${local.failed} file(s) failed the re-read from disk`);

  const rce = { md5Matched: 0, md5Unavailable: 0, md5Mismatched: 0, notChecked: 0 };
  for (const o of objects) {
    if (o.status !== "ok" && o.status !== "changed") continue;
    if (o.remoteMd5 === "match") rce.md5Matched++;
    else if (o.remoteMd5 === "mismatch") rce.md5Mismatched++;
    else if (o.remoteMd5 === "unavailable") rce.md5Unavailable++;
    else rce.notChecked++;
  }
  if (rce.md5Mismatched)
    reasons.push(`${rce.md5Mismatched} object(s) do not match the server's MD5 ETag`);
  if (rce.md5Unavailable)
    warnings.push(
      `${rce.md5Unavailable} object(s) have no MD5 ETag: verified locally (SHA-256), remote equivalence NOT verified`,
    );
  if (rce.notChecked)
    warnings.push(
      `${rce.notChecked} object(s) were not compared with the server's MD5 (--md5 off)`,
    );
  const sizeless = first?.objects.filter((o) => o.size === null).length ?? 0;
  if (sizeless)
    warnings.push(
      `${sizeless} object(s) have no size in the listing; their size was checked against Content-Length only`,
    );

  const verification: Verification = {
    status: reasons.length === 0 ? "VERIFIED" : "FAILED",
    reasons,
    warnings,
    localIntegrity: local,
    remoteContentEquivalence: rce,
  };

  const bucketList: ManifestBucket[] = (first?.buckets ?? []).map((b) => {
    const own = objects.filter((o) => o.bucket === b.id);
    return { ...b, objectCount: own.length, bytes: own.reduce((s, o) => s + (o.size ?? 0), 0) };
  });
  const downloaded = objects.filter(
    (o) => (o.status === "ok" || o.status === "changed") && o.localPath,
  );
  const stats = client.http.stats;
  const manifest: Manifest = {
    schema: MANIFEST_SCHEMA,
    backupId,
    tool: {
      name: "@cellr/storage-backup",
      version: TOOL_VERSION,
      node: process.version,
      platform: process.platform,
    },
    source: { projectRef: options.projectRef, origin: client.http.target.origin },
    startedAt: startedAt.toISOString(),
    finishedAt: now().toISOString(),
    inventory: { firstAt: first?.at ?? startedAt.toISOString(), secondAt: second?.at ?? null },
    options: { concurrency, md5Policy, pageSize },
    buckets: bucketList,
    objects,
    totals: {
      buckets: bucketList.length,
      objects: objects.length,
      bytesListed: (first?.objects ?? []).reduce((s, o) => s + (o.size ?? 0), 0),
      objectsDownloaded: downloaded.length,
      bytesDownloaded: downloaded.reduce((s, o) => s + (o.size ?? 0), 0),
    },
    errors,
    consistency,
    requests: { total: stats.requests, retries: stats.retries, byMethod: { ...stats.byMethod } },
    verification,
    limitations: [...LIMITATIONS],
  };

  await writeNewFile(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  await writeNewFile(path.join(dir, "SHA256SUMS"), sha256sums(objects));
  await writeNewFile(
    path.join(dir, "verification-report.json"),
    JSON.stringify({ backupId, verification, consistency, errors }, null, 2) + "\n",
  );
  await writeNewFile(path.join(dir, "VERIFICATION.md"), renderVerification(manifest));
  await writeNewFile(path.join(dir, "SUMMARY.md"), renderSummary(manifest));
  await writeNewFile(path.join(dir, "RESTORE.md"), renderRestoreGuide(manifest));
  await writeOwnFile(path.join(dir, "STATUS"), `${verification.status}\n`);

  const exitCode =
    verification.status === "VERIFIED"
      ? EXIT.ok
      : fatal
        ? Math.max(exitCodeFor(fatal), EXIT.failed)
        : EXIT.failed;
  return { dir, manifest, exitCode };
}

function baseRecord(o: RemoteObject): ManifestObject {
  return {
    bucket: o.bucket,
    key: o.key,
    localPath: null,
    size: o.size,
    sha256: null,
    md5: null,
    contentType: o.mimetype,
    cacheControl: o.cacheControl,
    eTag: o.eTag,
    lastModified: o.lastModified,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    remoteId: o.id,
    userMetadata: o.userMetadata,
    remoteMd5: "not-checked",
    status: "failed",
    attempts: 0,
    error: "not attempted",
  };
}
