import { describe, expect, it } from "vitest";
import { jsonResponse as viaHttp } from "./http";
import { baseHeaders, jsonResponse } from "./http-response";

describe("the JSON response shape", () => {
  it("is private, uncacheable and never content-sniffed, with the body and status asked for", async () => {
    const res = jsonResponse({ ok: true }, 503);
    expect(res.status).toBe(503);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
    expect(await res.json()).toEqual({ ok: true });
  });

  it("keeps its two headers whatever extra headers are given", () => {
    const h = baseHeaders({ "Cache-Control": "public, max-age=60", "X-Content-Type-Options": "" });
    expect(h.get("Cache-Control")).toBe("no-store");
    expect(h.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("is the same function route handlers get from server/http", () => {
    expect(viaHttp).toBe(jsonResponse);
  });
});
