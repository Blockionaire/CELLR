// Backup → verify → restore → verify, against REAL Supabase Storage: two local stacks (`supabase start`), synthetic
// files only. Proves the tool against the server it will meet in production, not just against the mock.
//
//   pnpm --filter @cellr/storage-backup real-stack
//
// Source: the repository's local stack (must be running). Target: a second, empty local stack that this script creates
// in a temporary folder and stops at the end (or an existing one: CELLR_RT_TARGET_DIR=<folder with supabase/config.toml>).
// Every write goes to a loopback address; anything else stops the script before it sends a request.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.join(here, "..");
const repo = path.join(pkg, "..", "..");
const supabaseBin = path.join(
  repo,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "supabase.cmd" : "supabase",
);

interface Stack {
  api: string;
  key: string;
  db: string;
}

function status(cwd: string): Stack {
  const res = spawnSync(supabaseBin, ["status", "-o", "env"], { cwd, encoding: "utf8" });
  const env = Object.fromEntries(
    res.stdout
      .split("\n")
      .map((l) => l.match(/^([A-Z_]+)="?(.*?)"?$/))
      .filter((m): m is RegExpMatchArray => m !== null)
      .map((m) => [m[1], m[2]]),
  );
  if (!env.API_URL || !env.SECRET_KEY || !env.DB_URL)
    throw new Error(`no running local stack in ${cwd}`);
  const api = new URL(env.API_URL);
  if (!["127.0.0.1", "localhost"].includes(api.hostname))
    throw new Error(`refusing a non-local stack: ${api.hostname}`);
  return { api: api.origin, key: env.SECRET_KEY, db: env.DB_URL };
}

const results: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

function storage(stack: Stack) {
  const headers = { apikey: stack.key, authorization: `Bearer ${stack.key}` };
  const enc = (key: string) => key.split("/").map(encodeURIComponent).join("/");
  return {
    async buckets(): Promise<
      {
        id: string;
        public: boolean;
        file_size_limit: number | null;
        allowed_mime_types: string[] | null;
      }[]
    > {
      return (await fetch(`${stack.api}/storage/v1/bucket`, { headers })).json() as never;
    },
    async upload(bucket: string, key: string, body: Uint8Array, type: string, upsert = false) {
      const r = await fetch(`${stack.api}/storage/v1/object/${bucket}/${enc(key)}`, {
        method: "POST",
        headers: {
          ...headers,
          "content-type": type,
          "x-upsert": String(upsert),
          "cache-control": "max-age=3600",
        },
        body,
      });
      if (!r.ok) throw new Error(`seed upload ${bucket}/${key}: ${r.status} ${await r.text()}`);
    },
    async download(bucket: string, key: string): Promise<Uint8Array | null> {
      const r = await fetch(`${stack.api}/storage/v1/object/authenticated/${bucket}/${enc(key)}`, {
        headers,
      });
      return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
    },
    /** Test-only cleanup of the TARGET stack (loopback, checked in status()). */
    async wipe() {
      for (const b of await this.buckets()) {
        await fetch(`${stack.api}/storage/v1/bucket/${b.id}/empty`, { method: "POST", headers });
        await fetch(`${stack.api}/storage/v1/bucket/${b.id}`, { method: "DELETE", headers });
      }
    },
  };
}

function cli(args: string[], env: Record<string, string>): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--import", "tsx", path.join(pkg, "cli.ts"), ...args], {
      cwd: pkg,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr.on("data", (d: Buffer) => (out += d.toString()));
    child.on("close", (code) => resolve({ code: code ?? -1, out }));
  });
}

function psql(db: string, sql: string): string {
  const r = spawnSync(
    "psql",
    [db, "-X", "-A", "-t", "-F", ",", "-v", "ON_ERROR_STOP=1", "-c", sql],
    { encoding: "utf8" },
  );
  if (r.status !== 0) throw new Error(`psql: ${r.stderr}`);
  return r.stdout;
}

async function startTarget(): Promise<{ dir: string; stop: () => void }> {
  if (process.env.CELLR_RT_TARGET_DIR)
    return { dir: process.env.CELLR_RT_TARGET_DIR, stop: () => {} };
  const dir = await mkdtemp(path.join(os.tmpdir(), "cellr-restore-target-"));
  spawnSync(supabaseBin, ["init", "--force"], { cwd: dir, stdio: "ignore" });
  const file = path.join(dir, "supabase", "config.toml");
  let toml = await readFile(file, "utf8");
  toml = toml.replace(/^project_id = .*$/m, 'project_id = "cellr-restore-target"');
  toml = toml.replace(
    /(port\s*=\s*)(54\d{3})\b/g,
    (_m, p: string, n: string) => `${p}${Number(n) - 28000}`, // 54321 -> 26321: below the ephemeral range
  );
  toml = toml.replace(/(inspector_port\s*=\s*)8083\b/, "$18093");
  await writeFile(file, toml);
  console.log("starting a second, empty local Supabase stack as the restore target ...");
  const started = spawnSync(
    supabaseBin,
    [
      "start",
      "-x",
      "realtime,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor",
    ],
    { cwd: dir, stdio: "inherit" },
  );
  if (started.status !== 0) throw new Error("could not start the restore-target stack");
  return {
    dir,
    stop: () => spawnSync(supabaseBin, ["stop", "--no-backup"], { cwd: dir, stdio: "inherit" }),
  };
}

async function main() {
  const source = status(repo);
  const targetStack = await startTarget();
  try {
    const target = status(targetStack.dir);
    if (source.api === target.api) throw new Error("source and target are the same stack");
    const src = storage(source);
    const dst = storage(target);
    await dst.wipe();

    // ---- synthetic files in every bucket, with the awkward names Storage accepts ---------------------------------
    const run = `roundtrip-${Date.now()}`;
    const jpeg = (n: number, size = 4096) =>
      new Uint8Array([
        0xff,
        0xd8,
        0xff,
        0xe0,
        ...Array.from({ length: size }, (_, i) => (i * 13 + n * 101) % 256),
        0xff,
        0xd9,
      ]);
    const keys = [
      `${run}/plain.jpg`,
      `${run}/deep/er/and/deeper/x.jpg`,
      `${run}/sp ace.jpg`,
      `${run}/a(1)&b$@=;:+,!'*.jpg`,
      `${run}/q?x.jpg`,
      `${run}/Case.jpg`,
      `${run}/case.jpg`,
      `${run}/CON.jpg`,
      `${run}/trail.jpg.`,
      `${run}/both`,
      `${run}/both/inside.jpg`,
    ];
    let n = 0;
    for (const b of await src.buckets()) {
      if (b.id === "catalog-labels") continue; // one bucket stays empty on purpose
      const type = (b.allowed_mime_types ?? ["image/jpeg"]).includes("image/jpeg")
        ? "image/jpeg"
        : (b.allowed_mime_types?.[0] ?? "image/jpeg");
      for (const k of b.id === "bottle-images" ? keys : keys.slice(0, 2))
        await src.upload(b.id, k, jpeg(n++), type);
    }
    // one larger file, to exercise streaming over several chunks
    await src.upload("bottle-images", `${run}/large.jpg`, jpeg(999, 3_500_000), "image/jpeg");
    check("seeded synthetic files into the source stack", true, `${n + 1} files`);

    const out = await mkdtemp(path.join(os.tmpdir(), "cellr-rt-backups-"));
    const srcEnv = { CELLR_BACKUP_SERVICE_KEY: source.key };
    const dstEnv = { CELLR_RESTORE_SERVICE_KEY: target.key };
    const srcArgs = ["--url", source.api, "--project-ref", "localsourcestack0001"];
    const dstArgs = ["--url", target.api, "--project-ref", "localtargetstack0001"];

    // ---- backup + verify ---------------------------------------------------------------------------------------------
    const backup = await cli(["backup", ...srcArgs, "--out", out], srcEnv);
    check(
      "backup exits 0 and reports VERIFIED",
      backup.code === 0 && /RESULT: VERIFIED/.test(backup.out),
      backup.out
        .split("\n")
        .filter((l) => l.startsWith("RESULT"))
        .join(" "),
    );
    const [id] = (await readdir(out)).filter((d) => /^\d{4}-/.test(d));
    const dir = path.join(out, id as string);
    const manifest = JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8")) as {
      objects: { bucket: string; key: string; sha256: string; status: string }[];
      buckets: { id: string; objectCount: number }[];
      verification: { remoteContentEquivalence: { md5Matched: number } };
    };
    const ours = manifest.objects.filter((o) => o.key.startsWith(run));
    check("every seeded file is in the manifest", ours.length === n + 1, `${ours.length}/${n + 1}`);
    check(
      "every file proven against the server's MD5 ETag",
      manifest.verification.remoteContentEquivalence.md5Matched === manifest.objects.length,
    );
    const sums = spawnSync("sha256sum", ["-c", "--quiet", "SHA256SUMS"], { cwd: dir });
    check(
      "SHA256SUMS passes with the standard sha256sum",
      sums.error ? true : sums.status === 0,
      sums.error ? "sha256sum not installed" : "",
    );

    // The documented independent count, from the database (docs/BACKUP-RECOVERY.md §4.3).
    const csv = psql(
      source.db,
      "select b.id, count(o.id), coalesce(sum((o.metadata->>'size')::bigint), 0) from storage.buckets b left join storage.objects o on o.bucket_id = b.id group by b.id order by b.id",
    );
    const csvFile = path.join(out, "db-inventory.csv");
    await writeFile(csvFile, `bucket,objects,bytes\n${csv}`);
    const verify = await cli(
      ["verify", dir, "--db-inventory", csvFile, "--remote", ...srcArgs],
      srcEnv,
    );
    check(
      "verify (files, database count, live drift) exits 0",
      verify.code === 0 && /still identical/.test(verify.out),
      verify.out.trim().split("\n").pop(),
    );

    // ---- restore -----------------------------------------------------------------------------------------------------
    const dry = await cli(["restore", dir, ...dstArgs], dstEnv);
    check(
      "restore dry run exits 0 and writes nothing",
      dry.code === 0 && (await dst.buckets()).length === 0,
    );
    const exec = await cli(["restore", dir, ...dstArgs, "--execute"], dstEnv);
    check(
      "restore --execute exits 0 (VERIFIED)",
      exec.code === 0 && /RESULT: VERIFIED/.test(exec.out),
      exec.out.trim().split("\n").pop(),
    );
    let same = 0;
    for (const o of manifest.objects) {
      const got = await dst.download(o.bucket, o.key);
      if (got && sha256(got) === o.sha256) same++;
    }
    check(
      "independent read-back: every object at the target has the backed-up SHA-256",
      same === manifest.objects.length,
      `${same}/${manifest.objects.length}`,
    );
    const sb = await src.buckets();
    const tb = await dst.buckets();
    const settings = (l: typeof sb) =>
      JSON.stringify(
        l.map((b) => [b.id, b.public, b.file_size_limit, b.allowed_mime_types]).sort(),
      );
    check("bucket names and settings are identical at the target", settings(sb) === settings(tb));
    const again = await cli(["restore", dir, ...dstArgs, "--execute"], dstEnv);
    const againReport = await reportOf(again.out);
    check(
      "a second restore changes nothing (resume-safe)",
      again.code === 0 &&
        againReport.items.every((i) => i.outcome === "already-identical") &&
        againReport.items.length === manifest.objects.length,
      summary(again),
    );

    // ---- existing content at the target is never overwritten without --overwrite ------------------------------------
    // The invariant: exit 1, the target keeps ITS content, and this run's own report says the object was skipped.
    const plainKey = `${run}/plain.jpg`;
    const backedUp = ours.find((o) => o.bucket === "bottle-images" && o.key === plainKey)?.sha256;
    await dst.upload("bottle-images", plainKey, jpeg(4242), "image/jpeg", true);
    const conflict = await cli(["restore", dir, ...dstArgs, "--execute"], dstEnv);
    const kept = await dst.download("bottle-images", plainKey);
    const conflictReport = await reportOf(conflict.out);
    check(
      "different content at the target is not overwritten (exit 1)",
      conflict.code === 1 &&
        !!kept &&
        sha256(kept) === sha256(jpeg(4242)) &&
        outcomeOf(conflictReport, "bottle-images", plainKey) === "skipped-conflict",
      `${summary(conflict)}; kept=${kept ? sha256(kept) === sha256(jpeg(4242)) : "unreadable"}; outcome=${outcomeOf(conflictReport, "bottle-images", plainKey)}`,
    );
    // Regression for CI run 43957996427: a restore whose report name is already taken (a run earlier in the same
    // second) must still give its own verdict and its own report, never exit 4 after having done its work.
    const now = Date.now();
    const taken: string[] = [];
    for (let d = 0; d < 10; d++) {
      const name = path.join(
        out,
        "restore-reports",
        `${id}--localtargetstack0001--${new Date(now + d * 1000)
          .toISOString()
          .replace(/\.\d{3}Z$/, "Z")
          .replace(/:/g, "-")}`,
      );
      if (!existsSync(name)) {
        await mkdir(name, { recursive: true });
        taken.push(name);
      }
    }
    const collided = await cli(["restore", dir, ...dstArgs, "--execute"], dstEnv);
    const collidedReport = await reportOf(collided.out);
    const stillKept = await dst.download("bottle-images", plainKey);
    check(
      "a restore whose report name is taken still reports its own conflict (exit 1, own report)",
      collided.code === 1 &&
        outcomeOf(collidedReport, "bottle-images", plainKey) === "skipped-conflict" &&
        !taken.includes(collidedReport.dir) &&
        !!stillKept &&
        sha256(stillKept) === sha256(jpeg(4242)),
      summary(collided),
    );
    for (const t of taken) await rm(t, { recursive: true, force: true });
    const forced = await cli(["restore", dir, ...dstArgs, "--execute", "--overwrite"], dstEnv);
    const replaced = await dst.download("bottle-images", plainKey);
    const forcedReport = await reportOf(forced.out);
    check(
      "--overwrite replaces it with the backed-up content (exit 0)",
      forced.code === 0 &&
        !!replaced &&
        sha256(replaced) === backedUp &&
        outcomeOf(forcedReport, "bottle-images", plainKey) === "overwritten",
      `${summary(forced)}; outcome=${outcomeOf(forcedReport, "bottle-images", plainKey)}`,
    );

    // ---- a database row without its file (what restoring the database into a new project leaves) --------------------
    psql(
      target.db,
      `update storage.objects set version = gen_random_uuid()::text where bucket_id = 'bottle-images' and name = '${run}/sp ace.jpg'`,
    );
    const missing = await dst.download("bottle-images", `${run}/sp ace.jpg`);
    const notFilled = await cli(["restore", dir, ...dstArgs, "--execute"], dstEnv);
    check(
      "a row without a file is detected and not touched by default (exit 1)",
      missing === null &&
        notFilled.code === 1 &&
        outcomeOf(await reportOf(notFilled.out), "bottle-images", `${run}/sp ace.jpg`) ===
          "skipped-metadata-only",
      summary(notFilled),
    );
    const filled = await cli(["restore", dir, ...dstArgs, "--execute", "--fill-missing"], dstEnv);
    const after = await dst.download("bottle-images", `${run}/sp ace.jpg`);
    check(
      "--fill-missing writes the file, verified by reading it back",
      filled.code === 0 &&
        !!after &&
        sha256(after) ===
          ours.find((o) => o.bucket === "bottle-images" && o.key === `${run}/sp ace.jpg`)?.sha256,
    );

    // ---- safety ------------------------------------------------------------------------------------------------------
    const prod = await cli(
      [
        "restore",
        dir,
        "--url",
        "https://vvelgyhbjfmjvxkzekyz.supabase.co",
        "--project-ref",
        "vvelgyhbjfmjvxkzekyz",
      ],
      {},
    );
    check("production is refused before any key is read (exit 4)", prod.code === 4);
    const toSource = await cli(
      ["restore", dir, ...srcArgs.slice(0, 2), "--project-ref", "localtargetstack0001"],
      { CELLR_RESTORE_SERVICE_KEY: source.key },
    );
    check("restoring into the source stack is refused (exit 4)", toSource.code === 4);

    // ---- encrypted archive -----------------------------------------------------------------------------------------
    if (!spawnSync("age", ["--version"]).error) {
      const identity = path.join(out, "identity.txt");
      spawnSync("age-keygen", ["-o", identity]);
      const recipient = spawnSync("age-keygen", ["-y", identity], {
        encoding: "utf8",
      }).stdout.trim();
      const arch = await cli(
        ["archive", dir, "--recipient", recipient, "--check-identity", identity],
        {},
      );
      check(
        "encrypted archive is written and decrypts to the full backup",
        arch.code === 0 && /decryption checked/.test(arch.out) && existsSync(`${dir}.tar.age`),
      );
    } else check("encrypted archive (age not installed: skipped)", true);
  } finally {
    targetStack.stop();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

interface RunReport {
  dir: string;
  items: { bucket: string; key: string; outcome: string }[];
}

/** The report of exactly this run: its folder is printed on the RESULT line ("report: <folder>"). */
async function reportOf(output: string): Promise<RunReport> {
  const m = /report: (.+)$/m.exec(output);
  if (!m) return { dir: "", items: [] };
  const dir = (m[1] as string).trim();
  try {
    const json = JSON.parse(
      await readFile(path.join(dir, "restore-report.json"), "utf8"),
    ) as RunReport;
    return { dir, items: json.items };
  } catch {
    return { dir, items: [] };
  }
}

/** The same key exists in several buckets: always look an object up by bucket AND key. */
const outcomeOf = (r: RunReport, bucket: string, key: string) =>
  r.items.find((i) => i.bucket === bucket && i.key === key)?.outcome ?? "none";

/** For a failing check: the exit code and the lines that say why. */
const summary = (r: { code: number; out: string }) =>
  `exit ${r.code}: ${r.out
    .split("\n")
    .filter((l) => /^(RESULT|ERROR)/.test(l))
    .slice(0, 3)
    .join(" | ")
    .slice(0, 300)}`;

main().catch((e: unknown) => {
  console.error(`FAIL  ${(e as Error).message}`);
  process.exit(1);
});
