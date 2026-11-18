import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createArchive } from "../src/archive";
import { runBackup } from "../src/backup";
import { SafetyError } from "../src/errors";
import { bytes, clock, logger, makeClient, REF, tempDir, fakeKey } from "./helpers";
import { MockStorage } from "./mock-storage";

const here = path.dirname(fileURLToPath(import.meta.url));
const hasAge =
  !spawnSync("age", ["--version"]).error && !spawnSync("age-keygen", ["--version"]).error;

describe.skipIf(!hasAge)("archive (tar | age)", () => {
  let mock: MockStorage;
  beforeAll(async () => {
    mock = await new MockStorage().start();
    mock.put("bottle-images", "h/a b.jpg", bytes(1));
    mock.put("user-avatars", "u/x.jpg", bytes(2));
  });
  afterAll(() => mock.stop());

  it("encrypts to a recipient, checks that it decrypts, and refuses to overwrite", async () => {
    const out = await tempDir();
    const r = await runBackup({
      client: makeClient(mock),
      outRoot: out,
      projectRef: REF,
      concurrency: 2,
      md5Policy: "strict",
      logger,
      now: clock(),
    });
    const keys = await tempDir("cellr-age-");
    const identity = path.join(keys, "identity.txt");
    spawnSync("age-keygen", ["-o", identity]);
    const recipient = spawnSync("age-keygen", ["-y", identity], { encoding: "utf8" }).stdout.trim();
    const a = await createArchive({
      dir: r.dir,
      recipients: [recipient],
      checkIdentity: identity,
      logger,
    });
    expect(a.checked).toBe(true);
    expect(a.archive).toBe(`${r.dir}.tar.age`);
    expect(await readFile(`${a.archive}.sha256`, "utf8")).toContain(a.sha256);
    // the archive is not readable without the identity
    expect((await readFile(a.archive)).subarray(0, 21).toString()).toBe("age-encryption.org/v1");
    // decrypt and extract elsewhere: same bytes
    const dest = await tempDir("cellr-extract-");
    const ok = spawnSync("sh", [
      "-c",
      `age -d -i "$0" "$1" | tar -xf - -C "$2"`,
      identity,
      a.archive,
      dest,
    ]);
    expect(ok.status).toBe(0);
    const base = path.basename(r.dir);
    expect(await readFile(path.join(dest, base, "manifest.json"))).toEqual(
      await readFile(path.join(r.dir, "manifest.json")),
    );
    await expect(createArchive({ dir: r.dir, recipients: [recipient], logger })).rejects.toThrow(
      SafetyError,
    );
  });

  it("refuses a backup that does not verify, and a malformed recipient", async () => {
    const out = await tempDir();
    const r = await runBackup({
      client: makeClient(mock),
      outRoot: out,
      projectRef: REF,
      concurrency: 2,
      md5Policy: "strict",
      logger,
      now: clock(),
    });
    await expect(
      createArchive({ dir: r.dir, recipients: ["age1notvalid"], logger }),
    ).rejects.toThrow(/not an age recipient/);
    const objects = path.join(r.dir, "objects", "bottle-images", "h");
    const [file] = await readdir(objects);
    await import("node:fs/promises").then((fs) =>
      fs.writeFile(path.join(objects, file as string), "x"),
    );
    await expect(createArchive({ dir: r.dir, passphrase: true, logger })).rejects.toThrow(
      SafetyError,
    );
    expect(existsSync(`${r.dir}.tar.age`)).toBe(false);
  });
});

function cli(
  args: string[],
  env: Record<string, string>,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", path.join(here, "..", "cli.ts"), ...args],
      {
        cwd: path.join(here, ".."),
        env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

describe("the command line", () => {
  let mock: MockStorage;
  beforeAll(async () => {
    mock = await new MockStorage().start();
    mock.put("bottle-images", "h/a.jpg", bytes(1));
  });
  afterAll(() => mock.stop());

  it("exit codes: 0 verified, 2 usage, 3 key refused, 4 refused for safety; the key is never printed", async () => {
    const out = await tempDir();
    const base = ["--url", mock.origin, "--project-ref", REF];
    const ok = await cli(["backup", ...base, "--out", out], { CELLR_BACKUP_SERVICE_KEY: mock.key });
    expect(ok.code).toBe(0);
    expect(ok.stdout).toMatch(/RESULT: VERIFIED {2}1\/1 objects/);

    const wrong = await cli(["backup", ...base, "--out", await tempDir()], {
      CELLR_BACKUP_SERVICE_KEY: fakeKey("secret", "wrongkeywrongkey99"),
    });
    expect(wrong.code).toBe(3);

    const publishable = await cli(["inventory", ...base], {
      CELLR_BACKUP_SERVICE_KEY: fakeKey("publishable", "abcdefabcdef"),
    });
    expect(publishable.code).toBe(2);

    const noOut = await cli(["backup", ...base], { CELLR_BACKUP_SERVICE_KEY: mock.key });
    expect(noOut.code).toBe(2);

    const prod = await cli(
      [
        "restore",
        out,
        "--url",
        "https://vvelgyhbjfmjvxkzekyz.supabase.co",
        "--project-ref",
        "vvelgyhbjfmjvxkzekyz",
      ],
      {},
    );
    expect(prod.code).toBe(4);

    for (const r of [ok, wrong, publishable, noOut, prod]) {
      for (const secret of [
        mock.key,
        fakeKey("secret", "wrongkeywrongkey99"),
        fakeKey("publishable", "abcdefabcdef"),
      ]) {
        expect(r.stdout).not.toContain(secret);
        expect(r.stderr).not.toContain(secret);
      }
    }
    const [dir] = (await readdir(out)).filter((d) => /^\d{4}-/.test(d));
    const written = await Promise.all(
      ["manifest.json", "SUMMARY.md", "VERIFICATION.md", "verification-report.json"].map((f) =>
        readFile(path.join(out, dir as string, f), "utf8"),
      ),
    );
    for (const text of written) expect(text).not.toContain(mock.key);
  });

  it("inventory is read-only and prints counts", async () => {
    const before = mock.requests.length;
    const r = await cli(["inventory", "--url", mock.origin, "--project-ref", REF], {
      CELLR_BACKUP_SERVICE_KEY: mock.key,
    });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("bottle-images,1,2048");
    expect(
      mock.requests
        .slice(before)
        .every((q) => q.method === "GET" || q.path.includes("/object/list/")),
    ).toBe(true);
  });
});
