import { appendFile, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runBackup } from "../src/backup";
import { SafetyError } from "../src/errors";
import type { Manifest } from "../src/manifest";
import { runRestore, type RestoreOptions } from "../src/restore";
import { verifyBackup } from "../src/verify";
import {
  bytes,
  clock,
  logger,
  makeClient,
  readManifestFile,
  REF,
  TARGET_REF,
  tempDir,
  fakeKey,
} from "./helpers";
import { MockStorage } from "./mock-storage";

async function backupOf(mock: MockStorage) {
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
  expect(r.exitCode).toBe(0);
  return r.dir;
}

function seed(mock: MockStorage) {
  mock.addBucket("bottle-images", { file_size_limit: 4194304, allowed_mime_types: ["image/jpeg"] });
  mock.addBucket("bottle-art", { allowed_mime_types: ["image/png", "image/jpeg"] });
  mock.addBucket("wine-labels"); // empty
  mock.put("bottle-images", "household-1/a.jpg", bytes(1), { cacheControl: "max-age=3600" });
  mock.put("bottle-images", "household-1/sub/b c.jpg", bytes(2));
  mock.put("bottle-images", "household-1", bytes(3)); // an object next to a folder of the same name
  mock.put("bottle-art", "wine-1/front.png", bytes(4), {
    contentType: "image/png",
    cacheControl: "max-age=60",
  });
}

describe("verify", () => {
  let mock: MockStorage;
  let dir: string;
  let m: Manifest;
  beforeEach(async () => {
    mock = await new MockStorage().start();
    seed(mock);
    dir = await backupOf(mock);
    m = await readManifestFile(dir);
  });
  afterEach(() => mock.stop());
  const file = (key: string) =>
    path.join(dir, m.objects.find((o) => o.key === key)?.localPath as string);

  it("passes on an intact backup and never writes into it", async () => {
    const before = await readFile(path.join(dir, "manifest.json"));
    const r = await verifyBackup({ dir });
    expect(r.problems).toEqual([]);
    expect(r.filesChecked).toBe(4);
    expect(r.exitCode).toBe(0);
    expect(await readFile(path.join(dir, "manifest.json"))).toEqual(before);
  });

  it("finds a changed byte, a missing file and an unexpected file", async () => {
    const a = file("household-1/a.jpg");
    const content = await readFile(a);
    content[10] = (content[10] as number) ^ 1;
    await writeFile(a, content);
    await rm(file("wine-1/front.png"));
    await writeFile(path.join(dir, "objects", "bottle-images", "planted.jpg"), "x");
    const r = await verifyBackup({ dir });
    expect(r.exitCode).toBe(1);
    expect(r.problems.join("\n")).toMatch(/household-1\/a\.jpg: SHA-256 differs/);
    expect(r.problems.join("\n")).toMatch(/wine-1\/front\.png: the file is missing/);
    expect(r.problems.join("\n")).toMatch(/unexpected file.*planted\.jpg/);
  });

  it("refuses a manifest edited to point outside the backup folder", async () => {
    const edited = await readManifestFile(dir);
    (edited.objects[0] as { localPath: string }).localPath = "../../../etc/passwd";
    await writeFile(path.join(dir, "manifest.json"), JSON.stringify(edited));
    const r = await verifyBackup({ dir });
    expect(r.exitCode).toBe(1);
    expect(r.problems.join()).toMatch(/not the one its key maps to/);
  });

  it("finds an edited SHA256SUMS and a backup recorded as FAILED", async () => {
    await appendFile(path.join(dir, "SHA256SUMS"), "0000  objects/x\n");
    const failed = await readManifestFile(dir);
    failed.verification.status = "FAILED";
    failed.verification.reasons = ["test"];
    await writeFile(path.join(dir, "manifest.json"), JSON.stringify(failed));
    const r = await verifyBackup({ dir });
    expect(r.problems.join("\n")).toMatch(/SHA256SUMS does not match/);
    expect(r.problems.join("\n")).toMatch(/recorded as FAILED/);
  });

  it("compares with an independent database count (CSV from the SQL Editor)", async () => {
    const good =
      '"bucket","objects","bytes"\nbottle-images,3,6144\nbottle-art,1,2048\nwine-labels,0,0\n';
    expect((await verifyBackup({ dir, dbInventoryCsv: good })).problems).toEqual([]);
    const bad =
      "bucket,objects,bytes\nbottle-images,4,8192\nbottle-art,1,2048\nwine-labels,0,0\nnew-bucket,1,1\n";
    const r = await verifyBackup({ dir, dbInventoryCsv: bad });
    expect(r.exitCode).toBe(1);
    expect(r.problems.join("\n")).toMatch(/bottle-images: the database counts 4 objects/);
    expect(r.problems.join("\n")).toMatch(
      /new-bucket is in the database inventory but not in the backup/,
    );
  });

  it("reports drift against the live project, read-only", async () => {
    mock.put("bottle-images", "household-2/new.jpg", bytes(9));
    const requestsBefore = mock.requests.length;
    const r = await verifyBackup({ dir, client: makeClient(mock) });
    expect(r.exitCode).toBe(0);
    expect(r.notes.join()).toMatch(/1 new, 0 deleted, 0 changed/);
    expect(
      mock.requests
        .slice(requestsBefore)
        .every((q) => q.method === "GET" || q.path.includes("/object/list/")),
    ).toBe(true);
  });
});

describe("restore", () => {
  let source: MockStorage;
  let target: MockStorage;
  let dir: string;
  let reportRoot: string;
  let restore: (over?: Partial<RestoreOptions>) => ReturnType<typeof runRestore>;

  beforeEach(async () => {
    source = await new MockStorage().start();
    seed(source);
    dir = await backupOf(source);
    target = await new MockStorage().start();
    target.key = fakeKey("secret", "targetkey00000000000");
    reportRoot = await tempDir("cellr-restore-reports-");
    const now = clock(Date.UTC(2026, 10, 17));
    restore = (over = {}) => {
      const execute = over.execute ?? false;
      const onExisting = over.onExisting ?? "skip";
      return runRestore({
        dir,
        client: makeClient(target, {
          ref: TARGET_REF,
          mode: execute ? "restore" : "read",
          allowUpsert: execute && onExisting !== "skip",
        }),
        target: { origin: target.origin, projectRef: TARGET_REF, isLoopback: true },
        execute,
        onExisting,
        concurrency: 2,
        reportRoot,
        logger,
        now,
        ...over,
      });
    };
  });
  afterEach(async () => {
    await source.stop();
    await target.stop();
  });

  it("a dry run reads the target and writes nothing", async () => {
    const r = await restore();
    expect(r.exitCode).toBe(0);
    expect(r.items.every((i) => i.action === "upload" && i.outcome === "planned")).toBe(true);
    expect(
      target.requests.every((q) => q.method === "GET" || q.path.includes("/object/list/")),
    ).toBe(true);
    expect(target.count()).toBe(0);
    expect(await readFile(path.join(r.reportDir, "RESTORE-REPORT.md"), "utf8")).toMatch(/DRY RUN/);
  });

  it("restores buckets, files and metadata into an empty target, and proves it by reading everything back", async () => {
    const r = await restore({ execute: true });
    expect(r.problems).toEqual([]);
    expect(r.exitCode).toBe(0);
    expect(target.buckets.get("bottle-images")).toMatchObject({
      file_size_limit: 4194304,
      allowed_mime_types: ["image/jpeg"],
    });
    expect(target.buckets.has("wine-labels")).toBe(true);
    for (const [bucket, objects] of source.objects)
      for (const [key, o] of objects) {
        const t = target.get(bucket, key);
        expect(t?.bytes).toEqual(o.bytes);
        expect(t?.contentType).toBe(o.contentType);
        expect(t?.cacheControl).toBe(o.cacheControl);
      }
    expect(
      r.items.every(
        (i) =>
          i.outcome === "restored" && i.roundTrip === "verified" && i.metadata === "consistent",
      ),
    ).toBe(true);
    expect(
      target.requests
        .filter(
          (q) =>
            q.method === "POST" && !q.path.includes("/list/") && q.path !== "/storage/v1/bucket",
        )
        .every((q) => q.upsert === "false"),
    ).toBe(true);
  });

  it("is safe to run again (resume after a partial restore): identical objects are skipped", async () => {
    target.faults.push({
      when: (q) => q.route === "upload" && q.key === "household-1/a.jpg",
      times: 99,
      action: "reset",
    });
    const partial = await restore({ execute: true });
    expect(partial.exitCode).toBe(1);
    expect(partial.items.find((i) => i.key === "household-1/a.jpg")?.outcome).toBe("failed");
    target.faults.length = 0;
    const uploadsBefore = target.requests.filter(
      (q) => q.method === "POST" && q.upsert !== undefined,
    ).length;
    const resumed = await restore({ execute: true });
    expect(resumed.exitCode).toBe(0);
    expect(resumed.items.filter((i) => i.outcome === "already-identical")).toHaveLength(3);
    expect(resumed.items.find((i) => i.key === "household-1/a.jpg")?.outcome).toBe("restored");
    expect(
      target.requests.filter((q) => q.method === "POST" && q.upsert !== undefined).length -
        uploadsBefore,
    ).toBe(1);
  });

  it("never overwrites different content unless --overwrite", async () => {
    target.put("bottle-images", "household-1/a.jpg", bytes(99));
    const skipped = await restore({ execute: true });
    expect(skipped.exitCode).toBe(1);
    expect(skipped.items.find((i) => i.key === "household-1/a.jpg")?.outcome).toBe(
      "skipped-conflict",
    );
    expect(target.get("bottle-images", "household-1/a.jpg")?.bytes).toEqual(bytes(99));
    const forced = await restore({ execute: true, onExisting: "overwrite" });
    expect(forced.exitCode).toBe(0);
    expect(target.get("bottle-images", "household-1/a.jpg")?.bytes).toEqual(bytes(1));
  });

  // CI run 43957996427: two restores finished within the same second. The report folder was named to the second and
  // created only AFTER the restore, so the second run's conflict report was lost and it exited 4 ("refused") instead
  // of 1 ("conflict, not overwritten"). Every run now gets its own report folder, made before anything is written.
  it("two restores in the same second: each keeps its own report and its own verdict (CI 43957996427)", async () => {
    const sameSecond = () => new Date(Date.UTC(2026, 10, 17, 9, 0, 0));
    const first = await restore({ execute: true, now: sameSecond });
    expect(first.exitCode).toBe(0);
    target.put("bottle-images", "household-1/a.jpg", bytes(99));
    const conflict = await restore({ execute: true, now: sameSecond });
    expect(conflict.exitCode).toBe(1);
    expect(conflict.items.find((i) => i.key === "household-1/a.jpg")?.outcome).toBe(
      "skipped-conflict",
    );
    expect(target.get("bottle-images", "household-1/a.jpg")?.bytes).toEqual(bytes(99));
    expect(conflict.reportDir).not.toBe(first.reportDir);
    const report = JSON.parse(
      await readFile(path.join(conflict.reportDir, "restore-report.json"), "utf8"),
    ) as {
      totals: Record<string, number>;
    };
    expect(report.totals["skipped-conflict"]).toBe(1);
    // the first report is untouched
    const firstReport = JSON.parse(
      await readFile(path.join(first.reportDir, "restore-report.json"), "utf8"),
    ) as {
      totals: Record<string, number>;
    };
    expect(firstReport.totals.restored).toBe(4);
    const forced = await restore({ execute: true, onExisting: "overwrite", now: sameSecond });
    expect(forced.exitCode).toBe(0);
    expect(target.get("bottle-images", "household-1/a.jpg")?.bytes).toEqual(bytes(1));
    expect(new Set([first.reportDir, conflict.reportDir, forced.reportDir]).size).toBe(3);
  });

  it("a report folder that cannot be created stops the restore before anything is written", async () => {
    const { chmod } = await import("node:fs/promises");
    if (process.platform === "win32" || process.getuid?.() === 0) return; // root ignores directory permissions
    await chmod(reportRoot, 0o500);
    try {
      await expect(restore({ execute: true })).rejects.toThrow();
      expect(
        target.requests.filter((q) => q.method === "POST" && !q.path.includes("/list/")),
      ).toHaveLength(0);
    } finally {
      await chmod(reportRoot, 0o700);
    }
  });

  it("fills a database row that has no file only with --fill-missing", async () => {
    target.put("bottle-images", "household-1/a.jpg", bytes(1), { metadataOnly: true });
    const skipped = await restore({ execute: true });
    expect(skipped.exitCode).toBe(1);
    expect(skipped.items.find((i) => i.key === "household-1/a.jpg")?.outcome).toBe(
      "skipped-metadata-only",
    );
    const filled = await restore({ execute: true, onExisting: "fill-missing" });
    expect(filled.exitCode).toBe(0);
    expect(filled.items.find((i) => i.key === "household-1/a.jpg")).toMatchObject({
      outcome: "filled",
      roundTrip: "verified",
    });
  });

  it("reports rows at the target that neither have a file nor are in the backup", async () => {
    target.put("bottle-images", "household-7/ghost.jpg", bytes(7), { metadataOnly: true });
    const r = await restore({ execute: true });
    expect(r.exitCode).toBe(1);
    expect(r.problems.join()).toMatch(
      /household-7\/ghost\.jpg: a row at the target without a file/,
    );
  });

  it("refuses production and the source project before touching anything", async () => {
    await expect(
      restore({
        target: {
          origin: "https://vvelgyhbjfmjvxkzekyz.supabase.co",
          projectRef: "vvelgyhbjfmjvxkzekyz",
          isLoopback: false,
        },
      }),
    ).rejects.toThrow(/protected/);
    await expect(
      restore({ target: { origin: target.origin, projectRef: REF, isLoopback: true } }),
    ).rejects.toThrow(/taken from/);
    await expect(
      restore({ target: { origin: source.origin, projectRef: TARGET_REF, isLoopback: true } }),
    ).rejects.toThrow(/taken from/);
    expect(target.requests).toHaveLength(0);
  });

  it("refuses a damaged backup, or restores only its intact files when explicitly allowed", async () => {
    const m = await readManifestFile(dir);
    const f = path.join(
      dir,
      m.objects.find((o) => o.key === "wine-1/front.png")?.localPath as string,
    );
    await writeFile(f, "tampered");
    await expect(restore({ execute: true })).rejects.toThrow(SafetyError);
    expect(target.requests).toHaveLength(0);
    const r = await restore({ execute: true, allowUnverifiedBackup: true });
    expect(r.items.map((i) => i.key).sort()).toEqual([
      "household-1",
      "household-1/a.jpg",
      "household-1/sub/b c.jpg",
    ]);
    expect(target.get("bottle-art", "wine-1/front.png")).toBeUndefined();
    expect(r.notes.join()).toMatch(/does not fully verify/);
  });

  it("restores one bucket only when asked", async () => {
    const r = await restore({ execute: true, buckets: ["bottle-art"] });
    expect(r.exitCode).toBe(0);
    expect([...target.buckets.keys()]).toEqual(["bottle-art"]);
  });
});
