import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Target } from "../src/config";
import { StorageHttp, type Mode } from "../src/http";
import { silentLogger } from "../src/log";
import type { Manifest } from "../src/manifest";
import { StorageClient } from "../src/storage-client";
import type { MockStorage } from "./mock-storage";

export const REF = "testprojectref000001";

/** Key-shaped test values are put together at run time, so no secret scanner mistakes the source for a leak. */
export const fakeKey = (kind: "secret" | "publishable", label: string): string =>
  ["sb", kind, label].join("_");
export const TARGET_REF = "restoretargetref0001";
export const logger = silentLogger;

export function makeClient(
  mock: MockStorage,
  opts: { mode?: Mode; allowUpsert?: boolean; key?: string; attempts?: number; ref?: string } = {},
): StorageClient {
  const target: Target = { origin: mock.origin, projectRef: opts.ref ?? REF, isLoopback: true };
  return new StorageClient(
    new StorageHttp({
      target,
      key: opts.key ?? mock.key,
      mode: opts.mode ?? "read",
      allowUpsert: opts.allowUpsert ?? false,
      retry: { attempts: opts.attempts ?? 4, baseDelayMs: 1, maxDelayMs: 5 },
      sleep: async () => {},
      requestTimeoutMs: 3000,
      idleTimeoutMs: 3000,
    }),
  );
}

/** A folder outside the repository (os.tmpdir()), so the Git check does not interfere unless a test wants it to. */
export const tempDir = (label = "cellr-backup-test-") => mkdtemp(path.join(os.tmpdir(), label));

/** A clock that moves one second per call: every run gets its own backup id. */
export function clock(start = Date.UTC(2026, 10, 16, 12, 0, 0)) {
  let t = start;
  return () => new Date((t += 1000));
}

export const readManifestFile = async (dir: string): Promise<Manifest> =>
  JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8")) as Manifest;

/** Synthetic picture bytes, different per seed. */
export const bytes = (seed: number, size = 2048) =>
  Buffer.from(Array.from({ length: size }, (_, i) => (i * 31 + seed * 7) % 256));
