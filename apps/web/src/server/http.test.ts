import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { DomainError, ERROR_MESSAGES } from "@cellr/domain";

vi.mock("./context", () => ({
  requireContext: vi.fn(async (request?: Request) => {
    if (request?.headers.get("x-test-anon")) throw new DomainError("UNAUTHENTICATED");
    return { userId: "u1", email: "a@b.co", db: {}, via: "cookie" as const };
  }),
}));

import {
  authed,
  checkOrigin,
  created,
  errorResponse,
  MAX_BODY_BYTES,
  open,
  readJson,
} from "./http";

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("https://cellr.test/api/v1/x", {
    method: "POST",
    headers: {
      host: "cellr.test",
      origin: "https://cellr.test",
      "content-type": "application/json",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

describe("checkOrigin (CSRF)", () => {
  it("lets safe methods through without an origin", () => {
    expect(() => checkOrigin(new Request("https://cellr.test/x", { method: "GET" }))).not.toThrow();
  });
  it("accepts same-origin mutations", () => {
    expect(() => checkOrigin(post({}))).not.toThrow();
  });
  it("honours x-forwarded-host (reverse proxies)", () => {
    expect(() =>
      checkOrigin(post({}, { host: "internal:3000", "x-forwarded-host": "cellr.test" })),
    ).not.toThrow();
  });
  it("rejects a cross-site origin", () => {
    expect(() => checkOrigin(post({}, { origin: "https://evil.test" }))).toThrow(DomainError);
  });
  it("rejects a mutation with no origin (cookie-authenticated CSRF)", () => {
    const req = new Request("https://cellr.test/x", {
      method: "POST",
      headers: { host: "cellr.test" },
    });
    expect(() => checkOrigin(req)).toThrow(DomainError);
  });
  it("rejects a malformed origin", () => {
    expect(() => checkOrigin(post({}, { origin: "not a url" }))).toThrow(DomainError);
  });
  it("rejects a look-alike host", () => {
    expect(() => checkOrigin(post({}, { origin: "https://cellr.test.evil.test" }))).toThrow(
      DomainError,
    );
  });
  it("exempts bearer-token callers (not cookie-authenticated)", () => {
    const req = new Request("https://cellr.test/x", {
      method: "DELETE",
      headers: { authorization: "Bearer abc.def.ghi" },
    });
    expect(() => checkOrigin(req)).not.toThrow();
  });
});

describe("readJson", () => {
  const schema = z.object({ n: z.number().default(1) });
  it("parses and validates", async () => {
    expect(await readJson(post({ n: 5 }), schema)).toEqual({ n: 5 });
  });
  it("applies defaults for an empty body when optional", async () => {
    const req = new Request("https://cellr.test/x", { method: "POST" });
    expect(await readJson(req, schema, { optional: true })).toEqual({ n: 1 });
  });
  it("requires a body unless optional", async () => {
    await expect(
      readJson(new Request("https://cellr.test/x", { method: "POST" }), schema),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
  it("rejects a non-JSON content type", async () => {
    await expect(
      readJson(post("n=1", { "content-type": "text/plain" }), schema),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
  it("rejects malformed JSON", async () => {
    await expect(readJson(post("{nope"), schema)).rejects.toMatchObject({ code: "VALIDATION" });
  });
  it("rejects schema violations", async () => {
    await expect(readJson(post({ n: "five" }), schema)).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });
  it("rejects oversized bodies, declared or actual", async () => {
    await expect(
      readJson(post({}, { "content-length": String(MAX_BODY_BYTES + 1) }), schema),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      readJson(post({ pad: "x".repeat(MAX_BODY_BYTES + 10) }), schema),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("error responses", () => {
  it("map a DomainError to its status and a human message", async () => {
    const res = errorResponse(new DomainError("RATE_LIMITED", undefined, { retryable: true }));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({
      error: { code: "RATE_LIMITED", message: ERROR_MESSAGES.RATE_LIMITED, retryable: true },
    });
  });
  it("hide the details of unexpected errors", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = errorResponse(new Error("password=hunter2 at db.internal:5432"));
    const body = JSON.stringify(await res.json());
    expect(res.status).toBe(500);
    expect(body).not.toMatch(/hunter2|db\.internal/);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
  it("are never cacheable", () => {
    expect(errorResponse(new DomainError("NOT_FOUND")).headers.get("cache-control")).toBe(
      "no-store",
    );
  });
});

describe("route wrappers", () => {
  const ctxFor = (id = "abc") => ({ params: Promise.resolve({ id }) });

  it("authed: returns JSON for plain results", async () => {
    const handler = authed<{ id: string }>(async ({ ctx, params }) => ({
      user: ctx.userId,
      id: params.id,
    }));
    const res = await handler(new Request("https://cellr.test/x"), ctxFor("42"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ user: "u1", id: "42" });
  });
  it("authed: 204 for undefined, passes a Response through", async () => {
    expect(
      (
        await authed<{ id: string }>(async () => undefined)(
          new Request("https://cellr.test/x"),
          ctxFor(),
        )
      ).status,
    ).toBe(204);
    expect(
      (
        await authed<{ id: string }>(async () => created({ id: 1 }))(
          new Request("https://cellr.test/x"),
          ctxFor(),
        )
      ).status,
    ).toBe(201);
  });
  it("authed: 401 when nobody is signed in, and the handler never runs", async () => {
    const run = vi.fn();
    const res = await authed<{ id: string }>(async () => run())(
      new Request("https://cellr.test/x", { headers: { "x-test-anon": "1" } }),
      ctxFor(),
    );
    expect(res.status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });
  it("authed: CSRF check runs before anything else", async () => {
    const run = vi.fn();
    const res = await authed<{ id: string }>(async () => run())(
      post({}, { origin: "https://evil.test" }),
      ctxFor(),
    );
    expect(res.status).toBe(403);
    expect(run).not.toHaveBeenCalled();
  });
  it("authed: a thrown DomainError becomes its HTTP error", async () => {
    const res = await authed<{ id: string }>(async () => {
      throw new DomainError("CONFLICT", "nope");
    })(new Request("https://cellr.test/x"), ctxFor());
    expect(res.status).toBe(409);
    expect((await res.json()).error.message).toBe("nope");
  });
  it("open: does not require a session but still checks the origin", async () => {
    const handler = open<{ id: string }>(async () => ({ ok: true }));
    expect((await handler(post({}), ctxFor())).status).toBe(200);
    expect((await handler(post({}, { origin: "https://evil.test" }), ctxFor())).status).toBe(403);
  });
});
