// An in-process HTTP server that behaves like Supabase Storage where the tool depends on it (checked against a real
// local stack, see docs/BACKUP-RECOVERY.md §8): folder-by-folder listing with id: null folders, errors as HTTP 400 with
// the real status in the body, MD5 ETags, x-upsert. Faults can be injected per request. Only synthetic data.
import { createHash, randomUUID } from "node:crypto";
import http from "node:http";
import { fakeKey } from "./helpers";
import type { AddressInfo } from "node:net";

export interface MockObject {
  bytes: Buffer;
  id: string;
  contentType: string;
  cacheControl: string;
  createdAt: string;
  updatedAt: string;
  /** A database row without a file (what a database restore leaves behind). */
  metadataOnly?: boolean;
  /** An ETag that is not the content's MD5, as for multipart uploads ("<md5>-<parts>"). */
  etag?: string;
}

export interface MockBucket {
  id: string;
  public: boolean;
  file_size_limit: number | null;
  allowed_mime_types: string[] | null;
}

export type FaultAction =
  | "reset" // close the connection before answering
  | "truncate" // announce the full length, send half, cut the connection
  | "corrupt" // flip a byte, keep the headers (ETag) of the real content
  | "short" // send a shorter body with a matching Content-Length
  | { status: number; body?: unknown; headers?: Record<string, string> };

export interface Fault {
  when: (req: { method: string; route: string; bucket?: string; key?: string }) => boolean;
  times: number;
  action: FaultAction;
}

export interface RecordedRequest {
  method: string;
  path: string;
  upsert?: string | undefined;
}

const md5 = (b: Buffer) => createHash("md5").update(b).digest("hex");
const storageError = (statusCode: number, error: string, message: string) => ({
  statusCode: String(statusCode),
  error,
  message,
});

export class MockStorage {
  readonly buckets = new Map<string, MockBucket>();
  readonly objects = new Map<string, Map<string, MockObject>>();
  readonly requests: RecordedRequest[] = [];
  readonly faults: Fault[] = [];
  key = fakeKey("secret", "mocktestkey0000000000");
  /** Called after each successful download; lets a test change the project while a backup runs. */
  onDownload?: (bucket: string, key: string, count: number) => void;
  private downloads = 0;
  private server?: http.Server;
  origin = "";

  addBucket(id: string, settings: Partial<MockBucket> = {}): this {
    this.buckets.set(id, {
      id,
      public: false,
      file_size_limit: null,
      allowed_mime_types: null,
      ...settings,
    });
    this.objects.set(id, this.objects.get(id) ?? new Map());
    return this;
  }

  put(
    bucket: string,
    key: string,
    content: string | Buffer,
    extra: Partial<MockObject> = {},
  ): this {
    if (!this.buckets.has(bucket)) this.addBucket(bucket);
    const now = new Date().toISOString();
    (this.objects.get(bucket) as Map<string, MockObject>).set(key, {
      bytes: Buffer.isBuffer(content) ? content : Buffer.from(content),
      id: randomUUID(),
      contentType: "image/jpeg",
      cacheControl: "max-age=3600",
      createdAt: now,
      updatedAt: now,
      ...extra,
    });
    return this;
  }

  remove(bucket: string, key: string): void {
    this.objects.get(bucket)?.delete(key);
  }

  get(bucket: string, key: string): MockObject | undefined {
    return this.objects.get(bucket)?.get(key);
  }

  count(): number {
    let n = 0;
    for (const m of this.objects.values()) n += m.size;
    return n;
  }

  async start(): Promise<this> {
    this.server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => this.handle(req, res, Buffer.concat(chunks)));
    });
    await new Promise<void>((resolve) => this.server?.listen(0, "127.0.0.1", resolve));
    this.origin = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this;
  }

  async stop(): Promise<void> {
    this.server?.closeAllConnections();
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
  }

  private json(
    res: http.ServerResponse,
    status: number,
    body: unknown,
    headers: Record<string, string> = {},
  ) {
    res.writeHead(status, { "content-type": "application/json", ...headers });
    res.end(JSON.stringify(body));
  }

  private takeFault(info: {
    method: string;
    route: string;
    bucket?: string;
    key?: string;
  }): FaultAction | undefined {
    const fault = this.faults.find((f) => f.times > 0 && f.when(info));
    if (!fault) return undefined;
    fault.times--;
    return fault.action;
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse, body: Buffer) {
    const url = new URL(req.url ?? "/", "http://x");
    const method = req.method ?? "GET";
    const upsert = req.headers["x-upsert"];
    this.requests.push({
      method,
      path: url.pathname,
      upsert: Array.isArray(upsert) ? upsert[0] : upsert,
    });

    if (req.headers.apikey !== this.key)
      return this.json(res, 400, {
        ...storageError(403, "Unauthorized", "Invalid Compact JWS"),
        code: "AccessDenied",
      });

    const parts = url.pathname.split("/").slice(1); // storage, v1, ...
    if (parts[0] !== "storage" || parts[1] !== "v1")
      return this.json(res, 404, { message: "no route" });
    const route = parts.slice(2);
    const decode = (segs: string[]) => segs.map(decodeURIComponent).join("/");

    // GET /bucket, POST /bucket
    if (route.length === 1 && route[0] === "bucket") {
      const fault = this.takeFault({ method, route: "bucket" });
      if (fault) return this.applySimpleFault(res, fault);
      if (method === "GET")
        return this.json(
          res,
          200,
          [...this.buckets.values()].map((b) => ({
            ...b,
            name: b.id,
            type: "STANDARD",
            created_at: "2026-10-10T00:00:00.000Z",
            updated_at: "2026-10-10T00:00:00.000Z",
          })),
        );
      if (method === "POST") {
        const b = JSON.parse(body.toString()) as MockBucket;
        if (this.buckets.has(b.id))
          return this.json(res, 400, {
            ...storageError(409, "Duplicate", "The resource already exists"),
            code: "BucketAlreadyExists",
          });
        this.addBucket(b.id, b);
        return this.json(res, 200, { name: b.id });
      }
    }

    // POST /object/list/:bucket
    if (method === "POST" && route[0] === "object" && route[1] === "list" && route.length === 3) {
      const bucket = decodeURIComponent(route[2] as string);
      const fault = this.takeFault({ method, route: "list", bucket });
      if (fault) return this.applySimpleFault(res, fault);
      const opts = JSON.parse(body.toString()) as {
        prefix?: string;
        limit?: number;
        offset?: number;
      };
      const store = this.objects.get(bucket);
      if (!store) return this.json(res, 200, []);
      let prefix = opts.prefix ?? "";
      if (prefix && !prefix.endsWith("/")) prefix += "/";
      const files: { name: string; o: MockObject }[] = [];
      const folders = new Set<string>();
      for (const [key, o] of store) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        const slash = rest.indexOf("/");
        if (slash === -1) files.push({ name: rest, o });
        else folders.add(rest.slice(0, slash));
      }
      const entries = [
        ...files.map(({ name, o }) => ({
          name,
          id: o.id,
          updated_at: o.updatedAt,
          created_at: o.createdAt,
          last_accessed_at: o.updatedAt,
          metadata: {
            eTag: o.etag ?? `"${md5(o.bytes)}"`,
            size: o.bytes.length,
            mimetype: o.contentType,
            cacheControl: o.cacheControl,
            lastModified: o.updatedAt,
            contentLength: o.bytes.length,
            httpStatusCode: 200,
          },
        })),
        ...[...folders].map((name) => ({
          name,
          id: null,
          updated_at: null,
          created_at: null,
          last_accessed_at: null,
          metadata: null,
        })),
      ].sort((a, b) => (a.name === b.name ? (a.id === null ? 1 : -1) : a.name < b.name ? -1 : 1));
      const offset = opts.offset ?? 0;
      return this.json(res, 200, entries.slice(offset, offset + (opts.limit ?? 100)));
    }

    // GET /object/authenticated/:bucket/*key
    if (
      method === "GET" &&
      route[0] === "object" &&
      route[1] === "authenticated" &&
      route.length >= 4
    ) {
      const bucket = decodeURIComponent(route[2] as string);
      const key = decode(route.slice(3));
      const o = this.get(bucket, key);
      const fault = this.takeFault({ method, route: "download", bucket, key });
      if (fault && typeof fault !== "string") return this.applySimpleFault(res, fault);
      if (fault === "reset") return req.socket.destroy();
      if (!o)
        return this.json(res, 400, {
          ...storageError(404, "not_found", "Object not found"),
          code: "NoSuchKey",
        });
      if (o.metadataOnly)
        return this.json(res, 500, {
          ...storageError(500, "Internal", "Internal Server Error"),
          code: "InternalError",
        });
      const headers = {
        "content-type": o.contentType,
        "cache-control": o.cacheControl,
        etag: o.etag ?? `"${md5(o.bytes)}"`,
        "last-modified": new Date(o.updatedAt).toUTCString(),
      };
      if (fault === "truncate") {
        res.writeHead(200, { ...headers, "content-length": String(o.bytes.length) });
        res.write(o.bytes.subarray(0, Math.floor(o.bytes.length / 2)));
        setTimeout(() => res.socket?.destroy(), 5);
        return;
      }
      let out = o.bytes;
      if (fault === "corrupt") {
        out = Buffer.from(o.bytes);
        out[0] = (out[0] as number) ^ 0xff;
      }
      if (fault === "short") out = o.bytes.subarray(0, Math.max(0, o.bytes.length - 1));
      res.writeHead(200, { ...headers, "content-length": String(out.length) });
      res.end(out);
      this.downloads++;
      this.onDownload?.(bucket, key, this.downloads);
      return;
    }

    // POST /object/:bucket/*key (upload)
    if (method === "POST" && route[0] === "object" && route.length >= 3) {
      const bucket = decodeURIComponent(route[1] as string);
      const key = decode(route.slice(2));
      const fault = this.takeFault({ method, route: "upload", bucket, key });
      if (fault && typeof fault !== "string") return this.applySimpleFault(res, fault);
      if (fault === "reset") return req.socket.destroy();
      if (!this.buckets.has(bucket))
        return this.json(res, 400, {
          ...storageError(404, "Bucket not found", "Bucket not found"),
        });
      const existing = this.get(bucket, key);
      if (existing && req.headers["x-upsert"] !== "true")
        return this.json(res, 400, {
          ...storageError(409, "Duplicate", "The resource already exists"),
          code: "KeyAlreadyExists",
        });
      this.put(bucket, key, body, {
        contentType: String(req.headers["content-type"] ?? "application/octet-stream"),
        cacheControl: String(req.headers["cache-control"] ?? "no-cache"),
        ...(existing ? { id: existing.id, createdAt: existing.createdAt } : {}),
      });
      return this.json(res, 200, { Key: `${bucket}/${key}`, Id: this.get(bucket, key)?.id });
    }

    // Anything else (DELETE, PUT, move, copy, ...): recorded, refused.
    return this.json(
      res,
      405,
      storageError(
        405,
        "MethodNotAllowed",
        `the mock does not implement ${method} ${url.pathname}`,
      ),
    );
  }

  private applySimpleFault(res: http.ServerResponse, fault: FaultAction) {
    if (typeof fault === "string") {
      res.socket?.destroy();
      return;
    }
    this.json(res, fault.status, fault.body ?? {}, fault.headers);
  }
}
