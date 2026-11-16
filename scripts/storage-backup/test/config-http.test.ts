import { chmod, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { classifyKey, loadKey, parseTarget } from "../src/config";
import { AuthError, GuardError, HttpError, SafetyError, UsageError } from "../src/errors";
import { StorageHttp, assertAllowed } from "../src/http";
import { StorageClient } from "../src/storage-client";
import { createLogger, redact, registerSecret } from "../src/log";
import { makeClient, tempDir, fakeKey } from "./helpers";
import { MockStorage } from "./mock-storage";

const jwt = (claims: Record<string, unknown>) =>
  `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.c2lnbmF0dXJl`;

describe("parseTarget", () => {
  it("accepts a hosted project only when the URL and the ref agree", () => {
    expect(
      parseTarget("https://abcdefghijklmnopqrst.supabase.co", "abcdefghijklmnopqrst").origin,
    ).toBe("https://abcdefghijklmnopqrst.supabase.co");
    expect(() =>
      parseTarget("https://abcdefghijklmnopqrst.supabase.co", "zzzzzzzzzzzzzzzzzzzz"),
    ).toThrow(SafetyError);
  });
  it("refuses plain http except for a local stack, paths, and credentials in the URL", () => {
    expect(() =>
      parseTarget("http://abcdefghijklmnopqrst.supabase.co", "abcdefghijklmnopqrst"),
    ).toThrow(UsageError);
    expect(parseTarget("http://127.0.0.1:54321", "localstacklocalstack1").isLoopback).toBe(true);
    expect(() =>
      parseTarget("https://abcdefghijklmnopqrst.supabase.co/storage/v1", "abcdefghijklmnopqrst"),
    ).toThrow(UsageError);
    expect(() =>
      parseTarget("https://u:p@abcdefghijklmnopqrst.supabase.co", "abcdefghijklmnopqrst"),
    ).toThrow(UsageError);
    expect(() => parseTarget(undefined, "x")).toThrow(UsageError);
  });
});

describe("classifyKey", () => {
  const target = parseTarget("https://abcdefghijklmnopqrst.supabase.co", "abcdefghijklmnopqrst");
  it("refuses keys that cannot see private buckets (the backup would silently be empty)", () => {
    expect(() => classifyKey(fakeKey("publishable", "abc123"), target)).toThrow(
      /publishable key cannot read private buckets/,
    );
    expect(() => classifyKey(jwt({ role: "anon", ref: "abcdefghijklmnopqrst" }), target)).toThrow(
      UsageError,
    );
    expect(() => classifyKey("not-a-key", target)).toThrow(UsageError);
  });
  it("refuses a service key of another project, and an expired one", () => {
    expect(() =>
      classifyKey(jwt({ role: "service_role", ref: "otherotherotherother" }), target),
    ).toThrow(SafetyError);
    expect(() => classifyKey(jwt({ role: "service_role", exp: 1 }), target)).toThrow(UsageError);
  });
  it("accepts secret keys and service_role keys", () => {
    expect(classifyKey(fakeKey("secret", "abc123"), target)).toBe("secret");
    expect(classifyKey(jwt({ role: "service_role", ref: "abcdefghijklmnopqrst" }), target)).toBe(
      "service_role_jwt",
    );
  });
});

describe("loadKey", () => {
  it("reads a private key file and refuses a world-readable one", async () => {
    const dir = await tempDir();
    const file = path.join(dir, "key");
    await writeFile(file, `${fakeKey("secret", "fromfile123")}\n`, { mode: 0o600 });
    expect(await loadKey({ env: {}, envName: "K", keyFile: file })).toBe(
      fakeKey("secret", "fromfile123"),
    );
    if (process.platform !== "win32") {
      await chmod(file, 0o644);
      await expect(loadKey({ env: {}, envName: "K", keyFile: file })).rejects.toThrow(SafetyError);
    }
  });
  it("falls back to the environment, then to the prompt, and fails without any", async () => {
    expect(await loadKey({ env: { K: fakeKey("secret", "env12345") }, envName: "K" })).toBe(
      fakeKey("secret", "env12345"),
    );
    expect(
      await loadKey({ env: {}, envName: "K", prompt: async () => fakeKey("secret", "typed1234") }),
    ).toBe(fakeKey("secret", "typed1234"));
    await expect(loadKey({ env: {}, envName: "K" })).rejects.toThrow(UsageError);
  });
});

describe("redaction", () => {
  it("never prints keys, tokens, signed URLs or connection-string passwords", () => {
    registerSecret("my-very-own-secret-value");
    const lines: string[] = [];
    const log = createLogger((l) => lines.push(l));
    const token = jwt({ role: "service_role" });
    const password = ["hun", "ter2"].join("");
    log.error(
      `key ${fakeKey("secret", "AbC123xyz")} and ${token} ` +
        `url https://x.supabase.co/storage/v1/object/sign/b/k.jpg?token=${token}&download= ` +
        `db ${["postgresql://postgres", password].join(":")}@db.x.supabase.co:5432/postgres ` +
        `header Authorization: Bearer abc.def apikey: ${fakeKey("secret", "zzz")} my-very-own-secret-value`,
    );
    const out = lines.join("\n");
    for (const secret of [
      "AbC123xyz",
      "eyJ",
      password,
      "abc.def",
      fakeKey("secret", "zzz"),
      "my-very-own-secret-value",
    ])
      expect(out).not.toContain(secret);
    expect(out).toContain("postgresql://postgres:<redacted>@db.x.supabase.co");
    expect(redact("plain text")).toBe("plain text");
  });
});

describe("the HTTP allowlist", () => {
  it("lets read mode list and download only", () => {
    expect(() => assertAllowed("read", "GET", "/storage/v1/bucket", {}, false)).not.toThrow();
    expect(() =>
      assertAllowed("read", "POST", "/storage/v1/object/list/bottle-images", {}, false),
    ).not.toThrow();
    expect(() =>
      assertAllowed("read", "GET", "/storage/v1/object/authenticated/b/a/b.jpg", {}, false),
    ).not.toThrow();
    for (const [m, p] of [
      ["DELETE", "/storage/v1/object/b"],
      ["DELETE", "/storage/v1/bucket/b"],
      ["PUT", "/storage/v1/object/b/a.jpg"],
      ["POST", "/storage/v1/object/b/a.jpg"],
      ["POST", "/storage/v1/bucket"],
      ["POST", "/storage/v1/bucket/b/empty"],
      ["POST", "/storage/v1/object/move"],
      ["POST", "/storage/v1/object/copy"],
      ["POST", "/storage/v1/object/sign/b/a.jpg"],
      ["GET", "/storage/v1/object/public/b/a.jpg"],
      ["GET", "/rest/v1/wines"],
      ["POST", "/rest/v1/rpc/anything"],
    ] as const)
      expect(() => assertAllowed("read", m, p, { "x-upsert": "false" }, false)).toThrow(GuardError);
  });

  it("lets restore mode upload only without upsert, unless overwriting was allowed", () => {
    expect(() =>
      assertAllowed(
        "restore",
        "POST",
        "/storage/v1/object/b/a.jpg",
        { "x-upsert": "false" },
        false,
      ),
    ).not.toThrow();
    expect(() =>
      assertAllowed("restore", "POST", "/storage/v1/object/b/a.jpg", { "x-upsert": "true" }, false),
    ).toThrow(GuardError);
    expect(() => assertAllowed("restore", "POST", "/storage/v1/object/b/a.jpg", {}, false)).toThrow(
      GuardError,
    );
    expect(() =>
      assertAllowed("restore", "POST", "/storage/v1/object/b/a.jpg", { "x-upsert": "true" }, true),
    ).not.toThrow();
    for (const [m, p] of [
      ["DELETE", "/storage/v1/object/b"],
      ["PUT", "/storage/v1/object/b/a.jpg"],
      ["PUT", "/storage/v1/bucket/b"],
      ["POST", "/storage/v1/object/move"],
      ["POST", "/storage/v1/object/sign/b/a.jpg"],
      ["POST", "/storage/v1/object/upload/sign/b/a.jpg"],
    ] as const)
      expect(() => assertAllowed("restore", m, p, { "x-upsert": "false" }, true)).toThrow(
        GuardError,
      );
  });
});

describe("talking to Storage", () => {
  let mock: MockStorage;
  beforeEach(async () => {
    mock = await new MockStorage().start();
    mock.put("bottle-images", "h/a.jpg", "abc");
  });
  afterEach(() => mock.stop());

  it("reads Storage's 400-with-statusCode errors: 403 is an auth failure and is not retried", async () => {
    const client = makeClient(mock, { key: fakeKey("secret", "wrongwrongwrong") });
    await expect(client.listBuckets()).rejects.toThrow(AuthError);
    expect(mock.requests).toHaveLength(1);
  });

  it("retries 503 and 429 (Retry-After honoured), then succeeds", async () => {
    mock.faults.push({
      when: (r) => r.route === "bucket",
      times: 1,
      action: { status: 503, body: { message: "down" } },
    });
    mock.faults.push({
      when: (r) => r.route === "bucket",
      times: 1,
      action: { status: 429, headers: { "retry-after": "0" } },
    });
    const client = makeClient(mock);
    expect((await client.listBuckets()).map((b) => b.id)).toEqual(["bottle-images"]);
    expect(client.http.stats.retries).toBe(2);
  });

  it("does not retry a plain 400", async () => {
    mock.faults.push({
      when: (r) => r.route === "bucket",
      times: 5,
      action: { status: 400, body: { statusCode: "400", error: "InvalidRequest", message: "bad" } },
    });
    const client = makeClient(mock);
    await expect(client.listBuckets()).rejects.toThrow(HttpError);
    expect(mock.requests).toHaveLength(1);
  });

  it("gives up after the configured attempts on a connection that keeps failing", async () => {
    mock.faults.push({ when: (r) => r.route === "bucket", times: 10, action: "reset" });
    const client = makeClient(mock, { attempts: 3 });
    await expect(client.listBuckets()).rejects.toThrow(/gave up after 3 attempts/);
    expect(mock.requests).toHaveLength(3);
  });

  it("a body shorter than its Content-Length is caught even when the connection ends cleanly", async () => {
    const shortFetch: typeof fetch = async (input, init) => {
      const res = await fetch(input, init);
      if (!String(input).includes("/object/authenticated/")) return res;
      const full = Buffer.from(await res.arrayBuffer());
      return new Response(full.subarray(0, 1), {
        status: 200,
        headers: { "content-length": String(full.length), etag: res.headers.get("etag") ?? "" },
      });
    };
    const target = { origin: mock.origin, projectRef: "testprojectref000001", isLoopback: true };
    const client = new StorageClient(
      new StorageHttp({
        target,
        key: mock.key,
        mode: "read",
        fetchImpl: shortFetch,
        retry: { attempts: 2, baseDelayMs: 1, maxDelayMs: 1 },
        sleep: async () => {},
      }),
    );
    const dir = await tempDir();
    await expect(
      client.download("bottle-images", "h/a.jpg", path.join(dir, "x"), {
        size: null,
        listedEtag: null,
        md5Policy: "off",
      }),
    ).rejects.toThrow(/received 1 bytes but the server announced 3/);
  });

  it("a read-mode client cannot write, even when asked directly", async () => {
    const client = makeClient(mock);
    await expect(
      client.upload("bottle-images", "x.jpg", Buffer.from("x"), {
        contentType: null,
        cacheControl: null,
        upsert: false,
      }),
    ).rejects.toThrow(GuardError);
    await expect(
      client.createBucket({
        id: "new",
        name: "new",
        public: false,
        type: null,
        fileSizeLimit: null,
        allowedMimeTypes: null,
        createdAt: null,
        updatedAt: null,
      }),
    ).rejects.toThrow(GuardError);
    expect(mock.requests).toHaveLength(0);
  });
});
