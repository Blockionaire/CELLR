// Local file handling: private permissions, no overwriting, and refusing destinations where private photos would leak
// (a Git working tree that does not ignore the folder, a cloud-synced folder).
import { spawnSync } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { LocalIOError, SafetyError } from "./errors";
import type { Logger } from "./log";

export async function ensurePrivateDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 }).catch((e: NodeJS.ErrnoException) => {
    throw new LocalIOError(`cannot create ${dir}: ${e.code ?? e.message}`);
  });
}

/** Creates `dir`, which must not exist yet: an earlier backup is never written into or replaced. */
export async function createNewDir(dir: string): Promise<void> {
  await ensurePrivateDir(path.dirname(dir));
  try {
    await mkdir(dir, { mode: 0o700 });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST")
      throw new SafetyError(`${dir} already exists; an existing backup is never overwritten`);
    throw new LocalIOError(`cannot create ${dir}: ${(e as NodeJS.ErrnoException).code}`);
  }
}

/** Writes a new file atomically (temporary name, then rename) with owner-only permissions. Refuses to replace one. */
export async function writeNewFile(file: string, content: string | Uint8Array): Promise<void> {
  if (existsSync(file)) throw new SafetyError(`${file} already exists; it is not overwritten`);
  const tmp = `${file}.tmp-${randomBytes(6).toString("hex")}`;
  try {
    await writeFile(tmp, content, { mode: 0o600, flag: "wx" });
    await rename(tmp, file);
  } catch (e) {
    await rm(tmp, { force: true });
    throw new LocalIOError(`cannot write ${file}: ${(e as NodeJS.ErrnoException).code ?? e}`);
  }
}

/** Writes or replaces a file that belongs to the current run only (its status, while the run is going). */
export async function writeOwnFile(file: string, content: string): Promise<void> {
  const tmp = `${file}.tmp-${randomBytes(6).toString("hex")}`;
  try {
    await writeFile(tmp, content, { mode: 0o600, flag: "wx" });
    await rename(tmp, file);
  } catch (e) {
    await rm(tmp, { force: true });
    throw new LocalIOError(`cannot write ${file}: ${(e as NodeJS.ErrnoException).code ?? e}`);
  }
}

export function hashFile(file: string): Promise<{ sha256: string; md5: string; bytes: number }> {
  return new Promise((resolve, reject) => {
    const sha256 = createHash("sha256");
    const md5 = createHash("md5");
    let bytes = 0;
    createReadStream(file)
      .on("data", (chunk) => {
        const b = chunk as Buffer;
        bytes += b.byteLength;
        sha256.update(b);
        md5.update(b);
      })
      .on("error", (e: NodeJS.ErrnoException) =>
        reject(new LocalIOError(`cannot read ${file}: ${e.code ?? e}`)),
      )
      .on("end", () => resolve({ sha256: sha256.digest("hex"), md5: md5.digest("hex"), bytes }));
  });
}

/** Every file under `dir`, as POSIX paths relative to `root`. */
export async function listFiles(root: string, dir = root): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true }).catch((e: NodeJS.ErrnoException) => {
    if (e.code === "ENOENT") return [];
    throw new LocalIOError(`cannot read ${dir}: ${e.code}`);
  });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(root, full)));
    else out.push(path.relative(root, full).split(path.sep).join("/"));
  }
  return out;
}

function findGitRoot(start: string): string | undefined {
  let dir = path.resolve(start);
  for (;;) {
    if (existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * A backup holds private photos. Inside a Git working tree it is accepted only when Git ignores it (the repository
 * ignores backups/), so a `git add .` can never pick it up.
 */
export function assertNotTrackedByGit(dir: string): void {
  const root = findGitRoot(dir);
  if (!root) return;
  const probe = path.join(path.resolve(dir), "probe-file");
  const res = spawnSync("git", ["check-ignore", "-q", "--no-index", probe], {
    cwd: root,
    encoding: "utf8",
  });
  if (res.error)
    throw new SafetyError(
      `${dir} is inside a Git working tree and Git is not available to check that it is ignored`,
    );
  if (res.status !== 0)
    throw new SafetyError(
      `${dir} is inside the Git working tree ${root} and is not ignored by Git. Choose a folder outside the repository ` +
        "(recommended) or one that .gitignore covers (backups/)",
    );
}

const SYNCED = [
  /^onedrive\b/i,
  /^dropbox$/i,
  /^google ?drive$/i,
  /^my drive$/i,
  /^icloud ?drive$/i,
  /^mobile documents$/i,
  /^pcloud/i,
  /^box$/i,
  /^nextcloud$/i,
];

/** A folder that a sync client uploads would copy private photos to a third party. Refused unless explicitly allowed. */
export function assertNotSyncedFolder(dir: string): void {
  const segments = path.resolve(dir).split(/[\\/]+/);
  const hit = segments.find((s) => SYNCED.some((re) => re.test(s)));
  if (hit)
    throw new SafetyError(
      `${dir} looks like a cloud-synced folder ("${hit}"): its contents would be uploaded to a third party. ` +
        "Use a local folder, or pass --allow-synced-folder if that upload is intended and approved",
    );
}

/** On Windows chmod does little: give the backup folder an ACL for the current user only (best effort). */
export function restrictWindowsAcl(dir: string, logger: Logger): void {
  if (process.platform !== "win32") return;
  const user = process.env.USERDOMAIN
    ? `${process.env.USERDOMAIN}\\${process.env.USERNAME}`
    : process.env.USERNAME;
  if (!user) {
    logger.warn(
      "could not determine the Windows user; the backup folder keeps its inherited permissions",
    );
    return;
  }
  const res = spawnSync("icacls", [dir, "/inheritance:r", "/grant:r", `${user}:(OI)(CI)F`], {
    encoding: "utf8",
  });
  if (res.status !== 0)
    logger.warn(
      "icacls could not restrict the backup folder to your account; check its permissions by hand",
    );
}
