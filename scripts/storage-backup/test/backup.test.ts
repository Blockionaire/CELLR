import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runBackup, type BackupOptions } from "../src/backup";
import { SafetyError } from "../src/errors";
import {
  bytes,
  clock,
  logger,
  makeClient,
  readManifestFile,
  REF,
  tempDir,
  fakeKey,
} from "./helpers";
import { MockStorage } from "./mock-storage";

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

function seed(mock: MockStorage) {
  mock.addBucket("bottle-images", { file_size_limit: 4194304, allowed_mime_types: ["image/jpeg"] });
  mock.addBucket("bottle-art", { allowed_mime_types: ["image/png", "image/jpeg"] });
  mock.addBucket("user-avatars");
  mock.addBucket("catalog-labels"); // empty
  mock.addBucket("wine-labels"); // empty
  mock.put("bottle-images", "household-1/bottle-1.jpg", bytes(1));
  mock.put("bottle-images", "household-1/bottle-2.jpg", bytes(2));
  mock.put("bottle-images", "household-2/deep/er/still/bottle-3.jpg", bytes(3));
  mock.put("bottle-art", "wine-1/front.png", bytes(4), { contentType: "image/png" });
  mock.put("user-avatars", "user-1/avatar.jpg", bytes(5, 512));
}

describe("backup", () => {
  let mock: MockStorage;
  let out: string;
  let options: (over?: Partial<BackupOptions>) => BackupOptions;

  beforeEach(async () => {
    mock = await new MockStorage().start();
    seed(mock);
    out = await tempDir();
    const now = clock();
    options = (over = {}) => ({
      client: makeClient(mock),
      outRoot: out,
      projectRef: REF,
      concurrency: 3,
      md5Policy: "strict",
      pageSize: 2, // small pages: pagination is exercised on every run
      logger,
      now,
      ...over,
    });
  });
  afterEach(() => mock.stop());

  it("backs up every bucket, verifies it, and writes the manifest, checksums and reports", async () => {
    const r = await runBackup(options());
    expect(r.exitCode).toBe(0);
    const m = await readManifestFile(r.dir);
    expect(m.verification.status).toBe("VERIFIED");
    expect(m.verification.reasons).toEqual([]);
    expect(m.totals).toMatchObject({ buckets: 5, objects: 5, objectsDownloaded: 5 });
    expect(m.verification.remoteContentEquivalence.md5Matched).toBe(5);
    expect(m.buckets.find((b) => b.id === "catalog-labels")?.objectCount).toBe(0);
    expect(m.buckets.find((b) => b.id === "bottle-images")).toMatchObject({
      objectCount: 3,
      fileSizeLimit: 4194304,
      allowedMimeTypes: ["image/jpeg"],
    });
    for (const o of m.objects) {
      const remote = mock.get(o.bucket, o.key)?.bytes as Buffer;
      expect(o.sha256).toBe(sha(remote));
      expect(await readFile(path.join(r.dir, o.localPath as string))).toEqual(remote);
    }
    expect(m.objects.find((o) => o.key === "wine-1/front.png")?.contentType).toBe("image/png");
    const sums = (await readFile(path.join(r.dir, "SHA256SUMS"), "utf8")).trim().split("\n");
    expect(sums).toHaveLength(5);
    expect(await readFile(path.join(r.dir, "STATUS"), "utf8")).toBe("VERIFIED\n");
    for (const f of [
      "manifest.json",
      "verification-report.json",
      "VERIFICATION.md",
      "SUMMARY.md",
      "RESTORE.md",
    ])
      expect(existsSync(path.join(r.dir, f))).toBe(true);
    expect(existsSync(path.join(r.dir, ".staging"))).toBe(false);
    // SUMMARY.md is the shareable one: counts, no object paths
    const summary = await readFile(path.join(r.dir, "SUMMARY.md"), "utf8");
    expect(summary).not.toContain("household-1");
    expect(summary).not.toContain(mock.key);
    // only reads went out
    expect(new Set(mock.requests.map((q) => q.method))).toEqual(new Set(["GET", "POST"]));
    expect(
      mock.requests
        .filter((q) => q.method === "POST")
        .every((q) => q.path.startsWith("/storage/v1/object/list/")),
    ).toBe(true);
    // independent check with the standard tool, where it exists
    const check = spawnSync("sha256sum", ["-c", "--quiet", "SHA256SUMS"], { cwd: r.dir });
    if (!check.error) expect(check.status).toBe(0);
  });

  it("keeps files private (0700 folders, 0600 files)", async () => {
    if (process.platform === "win32") return;
    const r = await runBackup(options());
    expect((await stat(r.dir)).mode & 0o777).toBe(0o700);
    expect((await stat(path.join(r.dir, "manifest.json"))).mode & 0o777).toBe(0o600);
    const m = await readManifestFile(r.dir);
    expect((await stat(path.join(r.dir, m.objects[0]?.localPath as string))).mode & 0o777).toBe(
      0o600,
    );
  });

  it("handles nested paths, special characters, case and object/folder collisions", async () => {
    const keys = [
      "h/sp ace.jpg",
      "h/a(1)&b$@=;:+,!'*.jpg",
      "h/q?x.jpg",
      "h/été.jpg",
      "h/A.jpg",
      "h/a.jpg",
      "h/CON.jpg",
      "h/trail.jpg.",
      "h",
      "h/100%.jpg",
    ];
    keys.forEach((k, i) => mock.put("bottle-images", k, bytes(100 + i)));
    const r = await runBackup(options());
    expect(r.exitCode).toBe(0);
    const m = await readManifestFile(r.dir);
    for (const k of keys) {
      const o = m.objects.find((x) => x.bucket === "bottle-images" && x.key === k);
      expect(o?.status).toBe("ok");
      expect(await readFile(path.join(r.dir, o?.localPath as string))).toEqual(
        mock.get("bottle-images", k)?.bytes,
      );
    }
    const lower = m.objects.map((o) => (o.localPath as string).toLowerCase());
    expect(new Set(lower).size).toBe(lower.length);
  });

  it("an empty bucket is fine; a project without any bucket fails unless expected", async () => {
    const empty = await new MockStorage().start();
    try {
      const r = await runBackup(options({ client: makeClient(empty) }));
      expect(r.exitCode).toBe(1);
      expect(r.manifest.verification.reasons.join()).toMatch(/no buckets/);
      const ok = await runBackup(options({ client: makeClient(empty), allowEmpty: true }));
      expect(ok.exitCode).toBe(0);
    } finally {
      await empty.stop();
    }
  });

  it("a wrong or expired key stops the run with exit 3 and a FAILED manifest", async () => {
    const r = await runBackup(
      options({ client: makeClient(mock, { key: fakeKey("secret", "expiredexpired") }) }),
    );
    expect(r.exitCode).toBe(3);
    expect(r.manifest.verification.status).toBe("FAILED");
    expect(await readFile(path.join(r.dir, "STATUS"), "utf8")).toBe("FAILED\n");
    expect(mock.requests).toHaveLength(1); // not retried
  });

  it("a key that expires halfway stops the remaining downloads", async () => {
    mock.onDownload = (_b, _k, n) => {
      if (n === 2) mock.key = fakeKey("secret", "rotatedrotated");
    };
    const r = await runBackup(options({ concurrency: 1 }));
    expect(r.exitCode).toBe(3);
    const m = r.manifest;
    expect(m.objects.filter((o) => o.status === "ok")).toHaveLength(2);
    expect(
      m.objects.filter((o) => o.error === "not attempted: the run was stopped").length,
    ).toBeGreaterThan(0);
  });

  it("retries an interrupted transfer and a dropped connection, then verifies", async () => {
    mock.faults.push({
      when: (q) => q.route === "download" && q.key === "household-1/bottle-1.jpg",
      times: 2,
      action: "truncate",
    });
    mock.faults.push({
      when: (q) => q.route === "download" && q.key === "household-1/bottle-2.jpg",
      times: 1,
      action: "reset",
    });
    mock.faults.push({ when: (q) => q.route === "list", times: 1, action: { status: 503 } });
    const r = await runBackup(options());
    expect(r.exitCode).toBe(0);
    expect(r.manifest.objects.find((o) => o.key === "household-1/bottle-1.jpg")?.attempts).toBe(3);
    expect(r.manifest.requests.retries).toBeGreaterThanOrEqual(4);
  });

  it("a transfer that keeps breaking fails the backup but not the other objects", async () => {
    mock.faults.push({
      when: (q) => q.route === "download" && q.key === "household-1/bottle-1.jpg",
      times: 99,
      action: "truncate",
    });
    const r = await runBackup(options());
    expect(r.exitCode).toBe(1);
    const m = r.manifest;
    expect(m.objects.find((o) => o.key === "household-1/bottle-1.jpg")).toMatchObject({
      status: "failed",
      localPath: null,
    });
    expect(m.objects.filter((o) => o.status === "ok")).toHaveLength(4);
    expect(m.verification.reasons.join()).toMatch(/1 object\(s\) could not be backed up/);
    expect(m.errors[0]?.message).toMatch(/gave up after 4 attempts/);
  });

  it("a non-retryable error is not retried", async () => {
    mock.faults.push({
      when: (q) => q.route === "download" && q.key === "user-1/avatar.jpg",
      times: 99,
      action: { status: 400, body: { statusCode: "400", error: "InvalidKey", message: "bad key" } },
    });
    const r = await runBackup(options());
    expect(r.exitCode).toBe(1);
    expect(mock.requests.filter((q) => q.path.endsWith("/user-1/avatar.jpg"))).toHaveLength(1);
  });

  it("detects corrupt downloads by MD5: retried, and a persistent mismatch fails", async () => {
    mock.faults.push({
      when: (q) => q.route === "download" && q.key === "household-1/bottle-2.jpg",
      times: 1,
      action: "corrupt",
    });
    const ok = await runBackup(options());
    expect(ok.exitCode).toBe(0);
    mock.faults.push({
      when: (q) => q.route === "download" && q.key === "household-1/bottle-2.jpg",
      times: 99,
      action: "corrupt",
    });
    const bad = await runBackup(options());
    expect(bad.exitCode).toBe(1);
    expect(bad.manifest.errors[0]?.message).toMatch(/MD5/);
  });

  it("with --md5 off a corrupt file cannot be detected, and the report says remote equivalence was not verified", async () => {
    const r = await runBackup(options({ md5Policy: "off" }));
    expect(r.exitCode).toBe(0);
    expect(r.manifest.verification.remoteContentEquivalence.notChecked).toBe(5);
    expect(r.manifest.verification.warnings.join()).toMatch(/not compared/);
  });

  it("an object without an MD5 ETag (multipart upload) is verified locally and reported as not proven remotely", async () => {
    mock.put("bottle-images", "household-1/multipart.jpg", bytes(12), {
      etag: '"0123456789abcdef0123456789abcdef-3"',
    });
    const r = await runBackup(options());
    expect(r.exitCode).toBe(0);
    const v = r.manifest.verification;
    expect(v.remoteContentEquivalence).toMatchObject({
      md5Matched: 5,
      md5Unavailable: 1,
      md5Mismatched: 0,
    });
    expect(v.warnings.join()).toMatch(
      /1 object\(s\) have no MD5 ETag: verified locally \(SHA-256\), remote equivalence NOT verified/,
    );
    expect(r.manifest.objects.find((o) => o.key === "household-1/multipart.jpg")?.remoteMd5).toBe(
      "unavailable",
    );
    expect(await readFile(path.join(r.dir, "SUMMARY.md"), "utf8")).toMatch(/1 unavailable/);
  });

  it("a size that does not match the listing (wrong count of bytes) fails", async () => {
    mock.faults.push({
      when: (q) => q.route === "download" && q.key === "user-1/avatar.jpg",
      times: 99,
      action: "short",
    });
    const r = await runBackup(options({ md5Policy: "off" }));
    expect(r.exitCode).toBe(1);
    expect(r.manifest.errors[0]?.message).toMatch(/listing says 512/);
  });

  it("an object created during the backup fails it (it is not in the backup)", async () => {
    mock.onDownload = (_b, _k, n) => {
      if (n === 1) mock.put("bottle-images", "household-9/new.jpg", bytes(9));
    };
    const r = await runBackup(options());
    expect(r.exitCode).toBe(1);
    expect(r.manifest.consistency.created).toEqual(["bottle-images/household-9/new.jpg"]);
  });

  it("an object deleted during the backup fails it", async () => {
    mock.onDownload = (_b, _k, n) => {
      if (n === 1) mock.remove("user-avatars", "user-1/avatar.jpg");
    };
    const r = await runBackup(options({ concurrency: 1 }));
    expect(r.exitCode).toBe(1);
    expect(r.manifest.objects.find((o) => o.key === "user-1/avatar.jpg")?.status).toBe("vanished");
    expect(r.manifest.consistency.deleted).toEqual(["user-avatars/user-1/avatar.jpg"]);
  });

  it("an object changed after it was listed but before its download fails the backup (ETag differs)", async () => {
    mock.onDownload = (_b, _k, n) => {
      if (n === 1)
        mock.put("bottle-art", "wine-1/front.png", bytes(44), { contentType: "image/png" });
    };
    const r = await runBackup(options({ concurrency: 1 }));
    expect(r.exitCode).toBe(1);
    expect(r.manifest.consistency.changed).toContain("bottle-art/wine-1/front.png");
    expect(r.manifest.objects.find((o) => o.key === "wine-1/front.png")?.status).toBe("changed");
  });

  it("an object changed after its own download is caught by the second inventory", async () => {
    mock.onDownload = (_b, key) => {
      if (key === "user-1/avatar.jpg")
        mock.put("user-avatars", "user-1/avatar.jpg", bytes(55, 512));
    };
    const r = await runBackup(options({ concurrency: 1 }));
    expect(r.exitCode).toBe(1);
    expect(r.manifest.consistency.changed).toEqual(["user-avatars/user-1/avatar.jpg"]);
    expect(r.manifest.verification.reasons.join()).toMatch(/changed during the backup/);
  });

  it("never downloads a key with a path-traversal segment", async () => {
    mock.put("bottle-images", "a/../escape.jpg", bytes(66));
    const r = await runBackup(options());
    expect(r.exitCode).toBe(1);
    const o = r.manifest.objects.find((x) => x.key === "a/../escape.jpg");
    expect(o).toMatchObject({ status: "failed", localPath: null });
    expect(r.manifest.errors.find((e) => e.kind === "unsafe-key")).toBeDefined();
    expect(mock.requests.some((q) => q.path.includes("escape"))).toBe(false);
    expect(existsSync(path.join(out, "escape.jpg"))).toBe(false);
  });

  it("repeat runs make new folders and never touch an earlier backup", async () => {
    const first = await runBackup(options());
    const before = await readFile(path.join(first.dir, "manifest.json"));
    mock.put("bottle-images", "household-1/bottle-1.jpg", bytes(77));
    const second = await runBackup(options());
    expect(second.dir).not.toBe(first.dir);
    expect(await readFile(path.join(first.dir, "manifest.json"))).toEqual(before);
    expect((await readdir(out)).filter((d) => !d.startsWith("."))).toHaveLength(2);
    // the same second twice: refused, nothing overwritten
    const fixed = () => new Date(Date.UTC(2026, 10, 16, 12, 0, 1));
    await expect(runBackup(options({ now: fixed }))).rejects.toThrow(SafetyError);
    expect(await readFile(path.join(first.dir, "manifest.json"))).toEqual(before);
  });

  it("a file that changes on disk after its download fails the re-read", async () => {
    const r = await runBackup(
      options({
        beforeReread: async (dir) => {
          const f = path.join(dir, "objects", "user-avatars", "user-1", "avatar.jpg");
          await writeFile(f, Buffer.concat([await readFile(f), Buffer.from("x")]));
        },
      }),
    );
    expect(r.exitCode).toBe(1);
    expect(r.manifest.verification.localIntegrity).toEqual({ checked: 5, passed: 4, failed: 1 });
    expect(r.manifest.verification.reasons.join()).toMatch(/failed the re-read from disk/);
  });

  it("a stopped run (Ctrl+C) is recorded as FAILED, with what it did get", async () => {
    const controller = new AbortController();
    mock.onDownload = (_b, _k, n) => {
      if (n === 1) controller.abort();
    };
    const r = await runBackup(options({ concurrency: 1, signal: controller.signal }));
    expect(r.exitCode).toBe(1);
    expect(r.manifest.verification.status).toBe("FAILED");
    expect(r.manifest.objects.filter((o) => o.status === "ok").length).toBeGreaterThanOrEqual(1);
  });

  it("refuses a destination inside a Git working tree that does not ignore it, and a synced folder", async () => {
    const repo = await tempDir();
    spawnSync("git", ["init", "-q"], { cwd: repo });
    await writeFile(path.join(repo, ".gitignore"), "backups/\n");
    await expect(runBackup(options({ outRoot: path.join(repo, "elsewhere") }))).rejects.toThrow(
      /not ignored by Git/,
    );
    const ok = await runBackup(options({ outRoot: path.join(repo, "backups", "cellr") }));
    expect(ok.exitCode).toBe(0);
    const synced = path.join(await tempDir(), "OneDrive - Personal", "x");
    await mkdir(path.dirname(synced), { recursive: true });
    await expect(runBackup(options({ outRoot: synced }))).rejects.toThrow(/cloud-synced/);
    expect((await runBackup(options({ outRoot: synced, allowSyncedFolder: true }))).exitCode).toBe(
      0,
    );
  });
});
