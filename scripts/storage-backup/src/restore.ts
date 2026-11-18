// Restores a backup into an ISOLATED project. Never production, never the source, never over an existing file without
// being told to. A dry run (the default) is made with a read-only HTTP client, so it physically cannot write.
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { PROTECTED_PROJECT_REFS, type Target } from "./config";
import {
  AuthError,
  ConflictError,
  EXIT,
  LocalIOError,
  NotFoundError,
  RetryableError,
  SafetyError,
} from "./errors";
import { createUniqueDir, writeNewFile } from "./fsutil";
import { RunAbortedError } from "./http";
import { formatBytes, type Logger } from "./log";
import type { Manifest, ManifestObject } from "./manifest";
import { objectId, resolveInside } from "./paths";
import { formatBackupId, runPool } from "./backup";
import { verifyBackup } from "./verify";
import {
  md5FromEtag,
  type BucketInfo,
  type RemoteObject,
  type StorageClient,
} from "./storage-client";

/**
 * skip: an existing object is left alone (identical ones count as restored, others are reported).
 * fill-missing: also write the file of an object whose database row exists without a file (after a database restore).
 * overwrite: also replace objects whose content differs. Only on explicit request.
 */
export type OnExisting = "skip" | "fill-missing" | "overwrite";

export type PlanAction =
  | "upload" // not at the target
  | "identical" // at the target, same SHA-256: nothing to do
  | "metadata-only" // a row at the target without a readable file
  | "conflict"; // at the target with different content

export type Outcome =
  | "restored"
  | "filled"
  | "overwritten"
  | "already-identical"
  | "skipped-conflict"
  | "skipped-metadata-only"
  | "failed"
  | "planned";

export interface RestoreItem {
  bucket: string;
  key: string;
  bytes: number;
  action: PlanAction;
  outcome: Outcome;
  roundTrip: "verified" | "mismatch" | "not-checked";
  metadata: "consistent" | "inconsistent" | "not-checked";
  error?: string;
}

export interface RestoreOptions {
  dir: string;
  manifest?: Manifest;
  client: StorageClient;
  target: Target;
  execute: boolean;
  onExisting: OnExisting;
  allowUnverifiedBackup?: boolean;
  buckets?: string[] | undefined;
  concurrency: number;
  reportRoot: string;
  logger: Logger;
  now?: () => Date;
  signal?: AbortSignal;
}

export interface RestoreResult {
  reportDir: string;
  items: RestoreItem[];
  problems: string[];
  notes: string[];
  exitCode: number;
}

/** The rules that keep a test restore away from production. Checked before any request to the target. */
export function assertRestoreTargetAllowed(manifest: Manifest, target: Target): void {
  if (PROTECTED_PROJECT_REFS.includes(target.projectRef))
    throw new SafetyError(
      `project ${target.projectRef} is protected (production). This tool only restores into an isolated project; ` +
        "a production recovery is the owner-only procedure in docs/BACKUP-RECOVERY.md §7.5",
    );
  if (target.projectRef === manifest.source.projectRef || target.origin === manifest.source.origin)
    throw new SafetyError(
      "the restore target is the project this backup was taken from; restore into another project",
    );
}

const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

async function readTarget(
  client: StorageClient,
  buckets: string[],
): Promise<{ buckets: Map<string, BucketInfo>; objects: Map<string, RemoteObject> }> {
  const existing = new Map((await client.listBuckets()).map((b) => [b.id, b]));
  const objects = new Map<string, RemoteObject>();
  for (const b of buckets)
    if (existing.has(b))
      for (const o of await client.listAllObjects(b)) objects.set(objectId(o.bucket, o.key), o);
  return { buckets: existing, objects };
}

/**
 * Reads the target object completely. "missing" = the server says the bytes are not there: 404, or the 500 that Storage
 * answers (twice in a row) for a row whose file does not exist. A connection error is not "missing": it fails the item,
 * so a file that merely could not be read is never treated as absent and filled over.
 */
async function probe(
  client: StorageClient,
  bucket: string,
  key: string,
): Promise<{ sha256: string } | "missing"> {
  try {
    return await client.hashRemote(bucket, key, 2);
  } catch (e) {
    if (e instanceof NotFoundError) return "missing";
    if (e instanceof RetryableError && e.status === 500) return "missing";
    throw e;
  }
}

export async function runRestore(options: RestoreOptions): Promise<RestoreResult> {
  const { client, logger } = options;
  const now = options.now ?? (() => new Date());
  const dir = path.resolve(options.dir);

  // ---- 1. The backup must be intact (every file re-hashed) before anything is sent -----------------------------------
  const check = await verifyBackup({ dir });
  const manifest = options.manifest ?? check.manifest;
  assertRestoreTargetAllowed(manifest, options.target);
  if (check.problems.length && !options.allowUnverifiedBackup)
    throw new SafetyError(
      `the backup does not verify (${check.problems.length} problem(s), first: ${check.problems[0]}). ` +
        "Use --allow-unverified-backup only in an emergency, to restore what is intact",
    );
  const brokenFiles = new Set(check.broken);

  // The report folder is made now, before the target is read or written: a run that cannot record what it did must
  // not start, and every run gets a folder of its own (two runs in the same second used to collide on the name, after
  // the restore had already run: CI run 43957996427).
  const reportDir = await createUniqueDir(
    path.join(
      path.resolve(options.reportRoot),
      `${manifest.backupId}--${options.target.projectRef}--${formatBackupId(now())}${options.execute ? "" : "--dry-run"}`,
    ),
  );

  const wanted = options.buckets?.length ? new Set(options.buckets) : undefined;
  if (wanted)
    for (const b of wanted)
      if (!manifest.buckets.some((m) => m.id === b))
        throw new SafetyError(`bucket ${b} is not in this backup`);
  const objects = manifest.objects.filter(
    (o): o is ManifestObject & { localPath: string; sha256: string; size: number } =>
      (o.status === "ok" || o.status === "changed") &&
      !!o.localPath &&
      !!o.sha256 &&
      typeof o.size === "number" &&
      (!wanted || wanted.has(o.bucket)) &&
      !brokenFiles.has(objectId(o.bucket, o.key)),
  );
  const buckets = manifest.buckets.filter((b) => !wanted || wanted.has(b.id));

  // ---- 2. What is at the target already ---------------------------------------------------------------------------
  logger.info(`reading the target ${options.target.origin} (${options.target.projectRef})`);
  const before = await readTarget(
    client,
    buckets.map((b) => b.id),
  );
  const problems: string[] = [];
  const notes: string[] = [];
  const bucketsToCreate = buckets.filter((b) => !before.buckets.has(b.id));
  for (const b of buckets) {
    const t = before.buckets.get(b.id);
    if (t && (t.public !== b.public || t.fileSizeLimit !== b.fileSizeLimit))
      notes.push(
        `bucket ${b.id} exists at the target with other settings (public/size limit); it is not changed`,
      );
  }

  const items: RestoreItem[] = [];
  for (const o of objects) {
    const existing = before.objects.get(objectId(o.bucket, o.key));
    let action: PlanAction = "upload";
    if (existing) {
      const p = await probe(client, o.bucket, o.key);
      action = p === "missing" ? "metadata-only" : p.sha256 === o.sha256 ? "identical" : "conflict";
    }
    items.push({
      bucket: o.bucket,
      key: o.key,
      bytes: o.size,
      action,
      outcome: "planned",
      roundTrip: "not-checked",
      metadata: "not-checked",
    });
  }
  const count = (a: PlanAction) => items.filter((i) => i.action === a).length;
  logger.info(
    `plan: ${bucketsToCreate.length} bucket(s) to create, ${count("upload")} to upload ` +
      `(${formatBytes(items.filter((i) => i.action === "upload").reduce((s, i) => s + i.bytes, 0))}), ` +
      `${count("identical")} already identical, ${count("metadata-only")} without a file, ${count("conflict")} different`,
  );

  // ---- 3. Execute ---------------------------------------------------------------------------------------------------
  if (options.execute) {
    for (const b of bucketsToCreate) {
      try {
        await client.createBucket(b);
        logger.info(`created bucket ${b.id}`);
      } catch (e) {
        if (!(e instanceof ConflictError)) throw e;
      }
    }
    const byId = new Map(objects.map((o) => [objectId(o.bucket, o.key), o]));
    let fatal: Error | undefined;
    await runPool(items, options.concurrency, async (item) => {
      if (fatal || options.signal?.aborted) return;
      const o = byId.get(objectId(item.bucket, item.key)) as ManifestObject & {
        localPath: string;
        sha256: string;
      };
      const write =
        item.action === "upload" ||
        (item.action === "metadata-only" && options.onExisting !== "skip") ||
        (item.action === "conflict" && options.onExisting === "overwrite");
      if (!write) {
        item.outcome =
          item.action === "identical"
            ? "already-identical"
            : item.action === "conflict"
              ? "skipped-conflict"
              : "skipped-metadata-only";
        return;
      }
      try {
        const body = await readFile(resolveInside(dir, o.localPath)).catch(
          (e: NodeJS.ErrnoException) => {
            throw new LocalIOError(`cannot read ${o.localPath}: ${e.code}`);
          },
        );
        if (sha256(body) !== o.sha256)
          throw new LocalIOError("the backup file changed since it was verified");
        const meta = { contentType: o.contentType, cacheControl: o.cacheControl };
        try {
          await client.upload(o.bucket, o.key, body, { ...meta, upsert: item.action !== "upload" });
          item.outcome =
            item.action === "upload"
              ? "restored"
              : item.action === "metadata-only"
                ? "filled"
                : "overwritten";
        } catch (e) {
          if (!(e instanceof ConflictError)) throw e;
          // Created at the target since the plan was made: look again, never overwrite on the way.
          const p = await probe(client, o.bucket, o.key);
          item.action =
            p === "missing" ? "metadata-only" : p.sha256 === o.sha256 ? "identical" : "conflict";
          item.outcome =
            item.action === "identical"
              ? "already-identical"
              : item.action === "conflict"
                ? "skipped-conflict"
                : "skipped-metadata-only";
        }
      } catch (e) {
        item.outcome = "failed";
        item.error = (e as Error).message;
        if (e instanceof AuthError || e instanceof LocalIOError || e instanceof RunAbortedError)
          fatal ??= e;
      }
    });
    if (fatal) problems.push(`the restore stopped: ${fatal.message}`);

    // ---- 4. Round trip: every object that should now be there is read back and compared ---------------------------
    logger.info("verifying the target: reading every restored object back");
    const after = await readTarget(
      client,
      buckets.map((b) => b.id),
    );
    for (const item of items) {
      if (!["restored", "filled", "overwritten", "already-identical"].includes(item.outcome))
        continue;
      const o = byId.get(objectId(item.bucket, item.key)) as ManifestObject;
      const p = await probe(client, item.bucket, item.key);
      item.roundTrip = p !== "missing" && p.sha256 === o.sha256 ? "verified" : "mismatch";
      // Storage's own metadata row must describe the same bytes: size, type and (when it is one) the MD5 ETag.
      const row = after.objects.get(objectId(item.bucket, item.key));
      const rowMd5 = md5FromEtag(row?.eTag ?? null);
      item.metadata =
        row &&
        row.size === o.size &&
        (!o.contentType || row.mimetype === o.contentType) &&
        (!rowMd5 || rowMd5 === o.md5)
          ? "consistent"
          : "inconsistent";
    }
    // Rows at the target that this backup does not explain: a file the backup never had, or a row without a file.
    const restoredIds = new Set(objects.map((o) => objectId(o.bucket, o.key)));
    let extraReadable = 0;
    let extraWithoutFile = 0;
    for (const [id, row] of after.objects) {
      if (restoredIds.has(id)) continue;
      if ((await probe(client, row.bucket, row.key)) === "missing") {
        extraWithoutFile++;
        problems.push(
          `${row.bucket}/${row.key}: a row at the target without a file, and the backup has no file for it`,
        );
      } else extraReadable++;
    }
    if (extraReadable)
      notes.push(
        `${extraReadable} object(s) at the target are not in this backup (left untouched)`,
      );
    if (extraWithoutFile)
      notes.push(`${extraWithoutFile} row(s) at the target have no file and none in this backup`);
  }

  // ---- 5. Verdict and report ------------------------------------------------------------------------------------------
  for (const item of items) {
    const label = `${item.bucket}/${item.key}`;
    if (item.outcome === "failed") problems.push(`${label}: ${item.error}`);
    if (item.outcome === "skipped-conflict")
      problems.push(`${label}: different content at the target, not overwritten (--overwrite)`);
    if (item.outcome === "skipped-metadata-only")
      problems.push(`${label}: a row without a file at the target, not filled (--fill-missing)`);
    if (item.roundTrip === "mismatch")
      problems.push(`${label}: read back from the target, the SHA-256 differs`);
    if (item.metadata === "inconsistent")
      problems.push(`${label}: the target's metadata row does not describe the restored file`);
    if (!options.execute && item.action === "conflict")
      notes.push(`${label}: different content at the target`);
  }
  if (!options.execute)
    notes.push("dry run: nothing was written. Run again with --execute to restore");
  if (check.problems.length)
    notes.push(
      `restored from a backup that does not fully verify: ${check.problems.length} problem(s)`,
    );

  const report = {
    backupId: manifest.backupId,
    source: manifest.source,
    target: { origin: options.target.origin, projectRef: options.target.projectRef },
    at: now().toISOString(),
    execute: options.execute,
    onExisting: options.onExisting,
    bucketsCreated: options.execute ? bucketsToCreate.map((b) => b.id) : [],
    bucketsToCreate: bucketsToCreate.map((b) => b.id),
    totals: Object.fromEntries(
      [
        "restored",
        "filled",
        "overwritten",
        "already-identical",
        "skipped-conflict",
        "skipped-metadata-only",
        "failed",
        "planned",
      ].map((k) => [k, items.filter((i) => i.outcome === k).length]),
    ),
    roundTripVerified: items.filter((i) => i.roundTrip === "verified").length,
    problems,
    notes,
    items,
  };
  await writeNewFile(
    path.join(reportDir, "restore-report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  await writeNewFile(
    path.join(reportDir, "RESTORE-REPORT.md"),
    [
      `# Restore of ${manifest.backupId} into ${options.target.projectRef}: ${options.execute ? (problems.length ? "FAILED" : "VERIFIED") : "DRY RUN"}`,
      "",
      `Target ${options.target.origin}. Existing objects: ${options.onExisting}.`,
      "",
      ...Object.entries(report.totals).map(([k, v]) => `- ${k}: ${v}`),
      `- read back and SHA-256 verified: ${report.roundTripVerified}`,
      "",
      problems.length ? `## Problems\n\n${problems.map((p) => `- ${p}`).join("\n")}\n` : "",
      notes.length ? `## Notes\n\n${notes.map((p) => `- ${p}`).join("\n")}\n` : "",
    ].join("\n"),
  );

  const dryRunBlocked =
    !options.execute &&
    items.some(
      (i) =>
        i.action === "conflict" || (i.action === "metadata-only" && options.onExisting === "skip"),
    );
  const exitCode = problems.length || dryRunBlocked ? EXIT.failed : EXIT.ok;
  return { reportDir, items, problems, notes, exitCode };
}
