// CELLR Storage backup, verification and restore. Usage: pnpm storage-backup <command> --help
// Full procedure: docs/BACKUP-RECOVERY.md.
import path from "node:path";
import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { createArchive } from "./src/archive";
import { runBackup } from "./src/backup";
import {
  PROTECTED_PROJECT_REFS,
  classifyKey,
  loadKey,
  parseTarget,
  promptHidden,
  type Target,
} from "./src/config";
import { EXIT, SafetyError, UsageError, exitCodeFor } from "./src/errors";
import { DEFAULT_RETRY, StorageHttp, type Mode } from "./src/http";
import { createLogger, formatBytes, redact } from "./src/log";
import { runRestore, type OnExisting } from "./src/restore";
import { StorageClient, type Md5Policy } from "./src/storage-client";
import { verifyBackup } from "./src/verify";

const HELP = `CELLR Storage backup (docs/BACKUP-RECOVERY.md)

  inventory  --url <https://ref.supabase.co> --project-ref <ref>
             Read-only: counts objects and bytes per bucket. Downloads nothing, writes nothing.
  backup     --url ... --project-ref ... --out <folder>  [--concurrency 4] [--md5 strict|off]
             Downloads every object of every bucket into <folder>/<UTC timestamp>/ and verifies it.
  verify     <backup folder>  [--db-inventory <file.csv>]  [--remote --url ... --project-ref ...]
             Re-hashes every file against the manifest. --remote compares with the project now (read-only).
  restore    <backup folder> --url <test project> --project-ref <test ref>  [--execute]
             [--fill-missing | --overwrite] [--bucket <id>]... [--report-dir <folder>]
             Dry run unless --execute. Refuses production and the source project.
  archive    <backup folder> (--recipient age1... | --recipients-file <file> | --passphrase) [--check-identity <file>]
             Writes <backup folder>.tar.age and its .sha256 next to it.

Keys are never arguments. Source (inventory/backup/verify --remote): CELLR_BACKUP_SERVICE_KEY, --key-file, or a hidden
prompt. Restore target: CELLR_RESTORE_SERVICE_KEY, --key-file, or a hidden prompt.
URL and ref may also come from CELLR_BACKUP_SUPABASE_URL / CELLR_BACKUP_PROJECT_REF (restore: CELLR_RESTORE_...).

Exit codes: 0 verified, 1 failed or incomplete, 2 usage, 3 key refused, 4 refused for safety.`;

const logger = createLogger();
const baseDir = process.env.INIT_CWD ?? process.cwd(); // pnpm runs the script in its package folder
const resolvePath = (p: string) => path.resolve(baseDir, p);

function int(
  value: string | undefined,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max)
    throw new UsageError(`--${name} must be a whole number from ${min} to ${max}`);
  return n;
}

async function connect(
  values: Record<string, string | boolean | string[] | undefined>,
  role: "source" | "target",
  mode: Mode,
  signal: AbortSignal,
  allowUpsert = false,
): Promise<{ client: StorageClient; target: Target }> {
  const prefix = role === "source" ? "CELLR_BACKUP" : "CELLR_RESTORE";
  const target = parseTarget(
    (values.url as string | undefined) ?? process.env[`${prefix}_SUPABASE_URL`],
    (values["project-ref"] as string | undefined) ?? process.env[`${prefix}_PROJECT_REF`],
  );
  // A restore target is checked against the protected list before any key is even read.
  if (role === "target" && PROTECTED_PROJECT_REFS.includes(target.projectRef))
    throw new SafetyError(
      `project ${target.projectRef} is protected (production): a test restore never goes there (docs/BACKUP-RECOVERY.md §7.5)`,
    );
  const keyFile = values["key-file"] as string | undefined;
  const key = await loadKey({
    env: process.env,
    envName: `${prefix}_SERVICE_KEY`,
    keyFile: keyFile ? resolvePath(keyFile) : undefined,
    prompt: () =>
      promptHidden(
        `${role === "source" ? "Source" : "Restore target"} secret key for ${target.projectRef} (input hidden): `,
      ),
  });
  classifyKey(key, target);
  const retries = int(
    values.retries as string | undefined,
    "retries",
    DEFAULT_RETRY.attempts,
    1,
    10,
  );
  const http = new StorageHttp({
    target,
    key,
    mode,
    allowUpsert,
    signal,
    retry: { ...DEFAULT_RETRY, attempts: retries },
    requestTimeoutMs: int(values.timeout as string | undefined, "timeout", 30, 5, 600) * 1000,
  });
  return { client: new StorageClient(http), target };
}

const common = {
  url: { type: "string" },
  "project-ref": { type: "string" },
  "key-file": { type: "string" },
  retries: { type: "string" },
  timeout: { type: "string" },
  help: { type: "boolean", short: "h" },
} as const;

async function main(argv: string[], signal: AbortSignal): Promise<number> {
  const [command, ...rest] = argv;
  if (!command || command === "--help" || command === "-h" || command === "help") {
    process.stdout.write(`${HELP}\n`);
    return command ? EXIT.ok : EXIT.usage;
  }

  if (command === "inventory") {
    const { values } = parseArgs({ args: rest, options: { ...common }, strict: true });
    if (values.help) return (process.stdout.write(`${HELP}\n`), EXIT.ok);
    const { client, target } = await connect(values, "source", "read", signal);
    const buckets = await client.listBuckets();
    let total = 0;
    let bytes = 0;
    process.stdout.write(`project ${target.projectRef}\nbucket,objects,bytes\n`);
    for (const b of buckets) {
      const objects = await client.listAllObjects(b.id);
      const size = objects.reduce((s, o) => s + (o.size ?? 0), 0);
      total += objects.length;
      bytes += size;
      process.stdout.write(`${b.id},${objects.length},${size}\n`);
    }
    process.stdout.write(`TOTAL,${total},${bytes}\n`);
    logger.info(
      `${buckets.length} buckets, ${total} objects, ${formatBytes(bytes)} (read-only; nothing downloaded)`,
    );
    if (buckets.length === 0) logger.warn("no buckets: wrong project, or a key without access?");
    return EXIT.ok;
  }

  if (command === "backup") {
    const { values } = parseArgs({
      args: rest,
      options: {
        ...common,
        out: { type: "string" },
        concurrency: { type: "string" },
        md5: { type: "string" },
        "page-size": { type: "string" },
        "allow-empty": { type: "boolean" },
        "allow-synced-folder": { type: "boolean" },
      },
      strict: true,
    });
    if (values.help) return (process.stdout.write(`${HELP}\n`), EXIT.ok);
    if (!values.out)
      throw new UsageError(
        "--out <folder> is required: choose where the private backup goes (not in the repository)",
      );
    const md5 = (values.md5 ?? "strict") as Md5Policy;
    if (!["strict", "off"].includes(md5)) throw new UsageError("--md5 must be strict or off");
    const { client, target } = await connect(values, "source", "read", signal);
    const result = await runBackup({
      client,
      outRoot: resolvePath(values.out),
      projectRef: target.projectRef,
      concurrency: int(values.concurrency, "concurrency", 4, 1, 16),
      md5Policy: md5,
      pageSize: int(values["page-size"], "page-size", 1000, 10, 1000),
      allowEmpty: values["allow-empty"] === true,
      allowSyncedFolder: values["allow-synced-folder"] === true,
      logger,
      signal,
    });
    const v = result.manifest.verification;
    for (const w of v.warnings) logger.warn(w);
    for (const r of v.reasons) logger.error(r);
    process.stdout.write(
      `RESULT: ${v.status}  ${result.manifest.totals.objectsDownloaded}/${result.manifest.totals.objects} objects, ` +
        `${formatBytes(result.manifest.totals.bytesDownloaded)}  ${result.dir}\n`,
    );
    return result.exitCode;
  }

  if (command === "verify") {
    const { values, positionals } = parseArgs({
      args: rest,
      options: { ...common, remote: { type: "boolean" }, "db-inventory": { type: "string" } },
      allowPositionals: true,
      strict: true,
    });
    if (values.help) return (process.stdout.write(`${HELP}\n`), EXIT.ok);
    if (positionals.length !== 1) throw new UsageError("verify <backup folder>");
    const client = values.remote
      ? (await connect(values, "source", "read", signal)).client
      : undefined;
    const dbInventory = values["db-inventory"]
      ? await readFile(resolvePath(values["db-inventory"]), "utf8")
      : undefined;
    const result = await verifyBackup({
      dir: resolvePath(positionals[0] as string),
      client,
      dbInventoryCsv: dbInventory,
    });
    for (const n of result.notes) logger.info(n);
    for (const p of result.problems.slice(0, 50)) logger.error(p);
    if (result.problems.length > 50) logger.error(`... and ${result.problems.length - 50} more`);
    process.stdout.write(
      `RESULT: ${result.problems.length ? "FAILED" : "VERIFIED"}  ${result.filesChecked} files re-hashed, ${result.problems.length} problem(s)\n`,
    );
    return result.exitCode;
  }

  if (command === "restore") {
    const { values, positionals } = parseArgs({
      args: rest,
      options: {
        ...common,
        execute: { type: "boolean" },
        "fill-missing": { type: "boolean" },
        overwrite: { type: "boolean" },
        bucket: { type: "string", multiple: true },
        "report-dir": { type: "string" },
        concurrency: { type: "string" },
        "allow-unverified-backup": { type: "boolean" },
      },
      allowPositionals: true,
      strict: true,
    });
    if (values.help) return (process.stdout.write(`${HELP}\n`), EXIT.ok);
    if (positionals.length !== 1)
      throw new UsageError("restore <backup folder> --url ... --project-ref ...");
    if (values["fill-missing"] && values.overwrite)
      throw new UsageError("--overwrite already includes --fill-missing");
    const onExisting: OnExisting = values.overwrite
      ? "overwrite"
      : values["fill-missing"]
        ? "fill-missing"
        : "skip";
    const execute = values.execute === true;
    // A dry run gets a read-only client: it cannot write even by mistake.
    const { client, target } = await connect(
      values,
      "target",
      execute ? "restore" : "read",
      signal,
      execute && onExisting !== "skip",
    );
    const dir = resolvePath(positionals[0] as string);
    const result = await runRestore({
      dir,
      client,
      target,
      execute,
      onExisting,
      allowUnverifiedBackup: values["allow-unverified-backup"] === true,
      buckets: values.bucket,
      concurrency: int(values.concurrency, "concurrency", 4, 1, 16),
      reportRoot: values["report-dir"]
        ? resolvePath(values["report-dir"])
        : path.join(path.dirname(dir), "restore-reports"),
      logger,
      signal,
    });
    for (const n of result.notes.slice(0, 20)) logger.info(n);
    for (const p of result.problems.slice(0, 50)) logger.error(p);
    const label = execute
      ? result.problems.length
        ? "FAILED"
        : "VERIFIED"
      : result.exitCode
        ? "DRY RUN (attention needed)"
        : "DRY RUN";
    process.stdout.write(`RESULT: ${label}  report: ${result.reportDir}\n`);
    return result.exitCode;
  }

  if (command === "archive") {
    const { values, positionals } = parseArgs({
      args: rest,
      options: {
        help: { type: "boolean", short: "h" },
        recipient: { type: "string", multiple: true },
        "recipients-file": { type: "string" },
        passphrase: { type: "boolean" },
        "check-identity": { type: "string" },
        "allow-unverified": { type: "boolean" },
      },
      allowPositionals: true,
      strict: true,
    });
    if (values.help) return (process.stdout.write(`${HELP}\n`), EXIT.ok);
    if (positionals.length !== 1)
      throw new UsageError("archive <backup folder> --recipient age1...");
    const result = await createArchive({
      dir: resolvePath(positionals[0] as string),
      recipients: values.recipient,
      recipientsFile: values["recipients-file"]
        ? resolvePath(values["recipients-file"])
        : undefined,
      passphrase: values.passphrase,
      checkIdentity: values["check-identity"] ? resolvePath(values["check-identity"]) : undefined,
      allowUnverified: values["allow-unverified"],
      logger,
    });
    process.stdout.write(
      `RESULT: ENCRYPTED  ${result.archive} (${formatBytes(result.bytes)}, sha256 ${result.sha256})` +
        `${result.checked ? ", decryption checked" : ", decryption NOT checked (--check-identity)"}\n`,
    );
    return EXIT.ok;
  }

  throw new UsageError(`unknown command "${command}"; see --help`);
}

const controller = new AbortController();
let interrupts = 0;
process.on("SIGINT", () => {
  interrupts++;
  if (interrupts > 1) process.exit(130);
  logger.warn(
    "stopping: finishing the report (press Ctrl+C again to quit at once; the run will then stay IN_PROGRESS)",
  );
  controller.abort();
});

main(process.argv.slice(2), controller.signal).then(
  (code) => process.exit(code),
  (error: unknown) => {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    logger.error(redact(message));
    process.exit(exitCodeFor(error));
  },
);
