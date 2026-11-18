// An encrypted copy of a verified backup: tar | age. The key is never stored with the archive: age encrypts to a public
// recipient (the private identity lives in a password manager or offline), or asks for a passphrase in the terminal.
import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { LocalIOError, SafetyError, UsageError } from "./errors";
import { hashFile, writeNewFile } from "./fsutil";
import type { Logger } from "./log";
import { verifyBackup } from "./verify";

export interface ArchiveOptions {
  dir: string;
  /** age1... public keys; or a file with one per line. */
  recipients?: string[] | undefined;
  recipientsFile?: string | undefined;
  passphrase?: boolean | undefined;
  /** Optional: decrypt the result again with this identity file and compare the file list. */
  checkIdentity?: string | undefined;
  allowUnverified?: boolean | undefined;
  logger: Logger;
  ageBinary?: string;
  tarBinary?: string;
}

export interface ArchiveResult {
  archive: string;
  sha256: string;
  bytes: number;
  checked: boolean;
}

function requireTool(binary: string, hint: string): void {
  const res = spawnSync(binary, ["--version"], { encoding: "utf8" });
  if (res.error) throw new UsageError(`${binary} was not found. ${hint}`);
}

function waitFor(child: ReturnType<typeof spawn>, name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    child.on("error", (e) => reject(new LocalIOError(`${name}: ${e.message}`)));
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new LocalIOError(`${name} exited with ${code}`)),
    );
  });
}

export async function createArchive(options: ArchiveOptions): Promise<ArchiveResult> {
  const age = options.ageBinary ?? "age";
  const tar = options.tarBinary ?? "tar";
  const dir = path.resolve(options.dir);
  const recipientArgs: string[] = [];
  for (const r of options.recipients ?? []) {
    if (!/^age1[0-9a-z]{58}$/.test(r) && !/^ssh-(ed25519|rsa) /.test(r))
      throw new UsageError(
        `"${r.slice(0, 12)}..." is not an age recipient (age1...) or SSH public key`,
      );
    recipientArgs.push("-r", r);
  }
  if (options.recipientsFile) recipientArgs.push("-R", options.recipientsFile);
  if (recipientArgs.length === 0 && !options.passphrase)
    throw new UsageError(
      "give --recipient age1... (recommended), --recipients-file, or --passphrase",
    );
  if (recipientArgs.length > 0 && options.passphrase)
    throw new UsageError("use recipients or a passphrase, not both");
  requireTool(
    age,
    "Install age (https://age-encryption.org; Windows: winget install FiloSottile.age).",
  );
  requireTool(tar, "tar ships with Windows 10 and later, macOS and Linux.");

  const check = await verifyBackup({ dir });
  if (check.problems.length && !options.allowUnverified)
    throw new SafetyError(`the backup does not verify (${check.problems[0]}); fix that first`);

  const archive = `${dir}.tar.age`;
  if (existsSync(archive))
    throw new SafetyError(`${archive} already exists; it is not overwritten`);
  options.logger.info(`encrypting ${path.basename(dir)} into ${archive}`);

  const tarProc = spawn(tar, ["-cf", "-", "-C", path.dirname(dir), path.basename(dir)], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  // With a passphrase age reads it from the terminal itself, never from us.
  const ageProc = spawn(age, [...(options.passphrase ? ["-p"] : recipientArgs)], {
    stdio: ["pipe", "pipe", "inherit"],
  });
  const out = createWriteStream(archive, { flags: "wx", mode: 0o600 });
  tarProc.stdout?.pipe(ageProc.stdin as NodeJS.WritableStream);
  ageProc.stdout?.pipe(out);
  const written = new Promise<void>((resolve, reject) => {
    out.on("finish", resolve);
    out.on("error", (e) => reject(new LocalIOError(`cannot write the archive: ${e.message}`)));
  });
  try {
    await Promise.all([waitFor(tarProc, "tar"), waitFor(ageProc, "age"), written]);
  } catch (e) {
    await rm(archive, { force: true });
    throw e;
  }
  const h = await hashFile(archive);
  await writeNewFile(`${archive}.sha256`, `${h.sha256}  ${path.basename(archive)}\n`);

  let checked = false;
  if (options.checkIdentity) {
    const listing = spawnSync(
      process.platform === "win32" ? "cmd" : "sh",
      process.platform === "win32"
        ? ["/c", `${age} -d -i "${options.checkIdentity}" "${archive}" | ${tar} -tf -`]
        : ["-c", `"$0" -d -i "$1" "$2" | "$3" -tf -`, age, options.checkIdentity, archive, tar],
      { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
    );
    if (listing.status !== 0)
      throw new LocalIOError("the archive could not be decrypted and listed with that identity");
    const inArchive = new Set(
      listing.stdout
        .split(/\r?\n/)
        .filter(Boolean)
        .map((l) => l.replace(/^\.\//, "").replace(/\/$/, "")),
    );
    const base = path.basename(dir);
    const missing = check.manifest.objects
      .filter((o) => o.localPath)
      .filter((o) => !inArchive.has(`${base}/${o.localPath}`));
    if (missing.length || !inArchive.has(`${base}/manifest.json`))
      throw new LocalIOError(`the decrypted archive lacks ${missing.length} file(s) of the backup`);
    checked = true;
  }
  return { archive, sha256: h.sha256, bytes: h.bytes, checked };
}
