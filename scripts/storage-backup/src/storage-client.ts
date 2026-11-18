// What the tool needs from the Storage API, on top of the guarded HTTP layer: buckets, a complete recursive listing,
// and a streaming download that hashes as it writes.
import { createWriteStream } from "node:fs";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { HttpError, IntegrityError, LocalIOError, RetryableError } from "./errors";
import { encodeKeyForUrl, type StorageHttp } from "./http";

export interface BucketInfo {
  id: string;
  name: string;
  public: boolean;
  type: string | null;
  fileSizeLimit: number | null;
  allowedMimeTypes: string[] | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface RemoteObject {
  bucket: string;
  key: string;
  id: string;
  size: number | null;
  eTag: string | null;
  mimetype: string | null;
  cacheControl: string | null;
  lastModified: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  userMetadata: Record<string, unknown> | null;
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** "\"abc\"" and W/"abc" → abc. */
export function normalizeEtag(etag: string | null | undefined): string | null {
  if (!etag) return null;
  return etag.replace(/^W\//, "").replace(/^"(.*)"$/, "$1");
}

/** A single-part upload's ETag is the MD5 of the content. A multipart one ("<md5>-<parts>") is not. */
export function md5FromEtag(etag: string | null): string | null {
  const e = normalizeEtag(etag);
  return e && /^[0-9a-f]{32}$/i.test(e) ? e.toLowerCase() : null;
}

/** What identifies one version of an object. last_accessed_at is left out: a download changes it. */
export function fingerprint(o: RemoteObject): string {
  return [
    o.id,
    o.size ?? "?",
    normalizeEtag(o.eTag) ?? "?",
    o.updatedAt ?? "?",
    o.lastModified ?? "?",
  ].join("|");
}

/**
 * strict (default): a downloaded file whose MD5 differs from the server's MD5 ETag is retried, then fails the backup.
 * off: not compared; remote content equivalence is then reported as not verified. There is deliberately no mode in
 * which a mismatch is accepted: a backup with bytes the server does not recognise is never VERIFIED.
 */
export type Md5Policy = "strict" | "off";
export type RemoteMd5Check = "match" | "mismatch" | "unavailable" | "not-checked";

export interface DownloadResult {
  bytes: number;
  sha256: string;
  md5: string;
  etag: string | null;
  remoteMd5: RemoteMd5Check;
  contentType: string | null;
  cacheControl: string | null;
  lastModified: string | null;
  attempts: number;
}

export class StorageClient {
  constructor(readonly http: StorageHttp) {}

  async listBuckets(): Promise<BucketInfo[]> {
    const raw = await this.http.json("GET", "/storage/v1/bucket");
    if (!Array.isArray(raw)) throw new RetryableError("the bucket list is not a list");
    return raw.map((b: Record<string, unknown>) => {
      const id = str(b.id);
      if (!id) throw new HttpError("a bucket without an id in the bucket list", 200);
      return {
        id,
        name: str(b.name) ?? id,
        public: b.public === true,
        type: str(b.type),
        fileSizeLimit: num(b.file_size_limit),
        allowedMimeTypes: Array.isArray(b.allowed_mime_types)
          ? b.allowed_mime_types.filter((m): m is string => typeof m === "string")
          : null,
        createdAt: str(b.created_at),
        updatedAt: str(b.updated_at),
      };
    });
  }

  /**
   * Every object of a bucket. The list endpoint returns one folder level at a time: entries with an id are objects,
   * entries without one are folders, which are walked in turn. An object and a folder may share a name ("a" next to
   * "a/b"), so both are kept. Pages are read until a short page; a key seen twice (a page boundary moving while objects
   * are added) is kept once. Changes during the walk are caught by the second inventory, not here.
   */
  async listAllObjects(bucket: string, pageSize = 1000): Promise<RemoteObject[]> {
    const found = new Map<string, RemoteObject>();
    const queue: string[] = [""];
    const seenPrefixes = new Set<string>([""]);
    while (queue.length > 0) {
      const prefix = queue.shift() as string;
      for (let offset = 0; ; offset += pageSize) {
        const page = await this.http.json(
          "POST",
          `/storage/v1/object/list/${encodeURIComponent(bucket)}`,
          {
            prefix,
            limit: pageSize,
            offset,
            sortBy: { column: "name", order: "asc" },
          },
        );
        if (!Array.isArray(page))
          throw new RetryableError(`the listing of ${bucket} is not a list`);
        for (const entry of page as Record<string, unknown>[]) {
          const name = str(entry.name);
          if (name === null || name === "" || name.includes("/"))
            throw new HttpError(
              `the listing of ${bucket} returned an entry with an unusable name`,
              200,
            );
          const key = prefix ? `${prefix}/${name}` : name;
          if (entry.id === null || entry.id === undefined) {
            if (!seenPrefixes.has(key)) {
              seenPrefixes.add(key);
              queue.push(key);
            }
            continue;
          }
          const meta = (entry.metadata ?? {}) as Record<string, unknown>;
          found.set(key, {
            bucket,
            key,
            id: String(entry.id),
            size: num(meta.size) ?? num(meta.contentLength),
            eTag: str(meta.eTag),
            mimetype: str(meta.mimetype),
            cacheControl: str(meta.cacheControl),
            lastModified: str(meta.lastModified),
            createdAt: str(entry.created_at),
            updatedAt: str(entry.updated_at),
            userMetadata:
              entry.user_metadata && typeof entry.user_metadata === "object"
                ? (entry.user_metadata as Record<string, unknown>)
                : null,
          });
        }
        if (page.length < pageSize) break;
        if (offset > 10_000_000)
          throw new HttpError(`the listing of ${bucket}/${prefix} does not end`, 200);
      }
    }
    return [...found.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }

  /**
   * Streams one object to `dest` (a new file; an existing one is never replaced) and hashes it on the way. The file is
   * complete only if the byte count matches Content-Length and the listed size; anything else is retried from scratch.
   */
  async download(
    bucket: string,
    key: string,
    dest: string,
    expect: { size: number | null; listedEtag: string | null; md5Policy: Md5Policy },
  ): Promise<DownloadResult> {
    return this.http.request(
      "GET",
      `/storage/v1/object/authenticated/${encodeURIComponent(bucket)}/${encodeKeyForUrl(key)}`,
      {},
      async (res, attempt) => {
        if (!res.body) throw new RetryableError("the download has no body");
        const sha256 = createHash("sha256");
        const md5 = createHash("md5");
        let bytes = 0;
        // "w" truncates the attempt before; the staging file belongs to this run only.
        const out = createWriteStream(dest, { flags: "w", mode: 0o600 });
        const outError = once(out, "error").then(([e]) => {
          throw new LocalIOError(
            `cannot write the downloaded file: ${(e as NodeJS.ErrnoException).code ?? e}`,
          );
        });
        outError.catch(() => {});
        try {
          const reader = res.body.getReader();
          for (;;) {
            const chunk = await reader.read().catch(() => {
              throw new RetryableError("the connection broke during the download");
            });
            if (chunk.done) break;
            attempt.touch();
            bytes += chunk.value.byteLength;
            sha256.update(chunk.value);
            md5.update(chunk.value);
            if (!out.write(chunk.value)) await Promise.race([once(out, "drain"), outError]);
          }
          out.end();
          await Promise.race([once(out, "finish"), outError]);
        } catch (error) {
          out.destroy();
          throw error;
        }
        const declared = res.headers.get("content-length");
        if (declared !== null && Number(declared) !== bytes)
          throw new IntegrityError(`received ${bytes} bytes but the server announced ${declared}`);
        const etag = res.headers.get("etag");
        const digest = md5.digest("hex");
        // Transport integrity: the bytes must be the ones the server's own ETag describes. A mismatch is retried.
        const serverMd5 = md5FromEtag(etag);
        let remoteMd5: RemoteMd5Check = "not-checked";
        if (expect.md5Policy === "strict") {
          remoteMd5 = serverMd5 ? "match" : "unavailable";
          if (serverMd5 && serverMd5 !== digest)
            throw new IntegrityError("the downloaded bytes do not match the server's MD5 ETag");
        }
        // Same version as listed (same ETag): then the size must be the listed size too. A different ETag means the
        // object changed after it was listed; the caller records that as an inconsistency, retrying cannot fix it.
        const sameVersion = normalizeEtag(etag) === normalizeEtag(expect.listedEtag);
        if (sameVersion && expect.size !== null && expect.size !== bytes)
          throw new IntegrityError(`received ${bytes} bytes but the listing says ${expect.size}`);
        return {
          bytes,
          sha256: sha256.digest("hex"),
          md5: digest,
          etag,
          remoteMd5,
          contentType: res.headers.get("content-type"),
          cacheControl: res.headers.get("cache-control"),
          lastModified: res.headers.get("last-modified"),
          attempts: attempt.attempt,
        };
      },
    );
  }

  /** Reads an object completely and returns its SHA-256 (restore round-trip check). Nothing is written to disk. */
  async hashRemote(
    bucket: string,
    key: string,
    attempts?: number,
  ): Promise<{ sha256: string; bytes: number; contentType: string | null }> {
    return this.http.request(
      "GET",
      `/storage/v1/object/authenticated/${encodeURIComponent(bucket)}/${encodeKeyForUrl(key)}`,
      attempts === undefined ? {} : { attempts },
      async (res, attempt) => {
        if (!res.body) throw new RetryableError("the download has no body");
        const sha256 = createHash("sha256");
        let bytes = 0;
        const reader = res.body.getReader();
        for (;;) {
          const chunk = await reader.read().catch(() => {
            throw new RetryableError("the connection broke during the download");
          });
          if (chunk.done) break;
          attempt.touch();
          bytes += chunk.value.byteLength;
          sha256.update(chunk.value);
        }
        const declared = res.headers.get("content-length");
        if (declared !== null && Number(declared) !== bytes)
          throw new IntegrityError(`received ${bytes} bytes but the server announced ${declared}`);
        return {
          sha256: sha256.digest("hex"),
          bytes,
          contentType: res.headers.get("content-type"),
        };
      },
    );
  }

  /** Restore only (the HTTP layer refuses it in read mode). */
  async createBucket(bucket: BucketInfo): Promise<void> {
    await this.http.json("POST", "/storage/v1/bucket", {
      id: bucket.id,
      name: bucket.name,
      public: bucket.public,
      file_size_limit: bucket.fileSizeLimit,
      allowed_mime_types: bucket.allowedMimeTypes,
    });
  }

  /** Restore only. `upsert` is honoured only when the HTTP layer was created with allowUpsert. */
  async upload(
    bucket: string,
    key: string,
    body: Uint8Array,
    meta: { contentType: string | null; cacheControl: string | null; upsert: boolean },
  ): Promise<void> {
    const headers: Record<string, string> = {
      "content-type": meta.contentType ?? "application/octet-stream",
      "x-upsert": meta.upsert ? "true" : "false",
    };
    if (meta.cacheControl) headers["cache-control"] = meta.cacheControl;
    await this.http.request(
      "POST",
      `/storage/v1/object/${encodeURIComponent(bucket)}/${encodeKeyForUrl(key)}`,
      { body, headers },
      async (res) => {
        await res.text();
      },
    );
  }
}
