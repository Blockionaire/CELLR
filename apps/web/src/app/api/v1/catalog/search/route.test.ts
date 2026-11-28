import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogSearchQuery, CatalogSearchResponse } from "@cellr/domain";

vi.mock("@/server/context", () => ({
  requireContext: vi.fn(async () => ({ userId: "me", email: "a@b.co", db: {}, via: "cookie" })),
}));
const search =
  vi.fn<(input: CatalogSearchQuery, signal?: AbortSignal) => Promise<CatalogSearchResponse>>();
vi.mock("@/server/services", () => ({ servicesFor: () => ({ catalogSearch: { search } }) }));
const logError = vi.fn();
vi.mock("@/server/log", () => ({ logError, logWarn: vi.fn() }));

const { GET } = await import("./route");

const get = (signal?: AbortSignal) =>
  GET(
    new Request(
      "https://cellr.test/api/v1/catalog/search?q=muga&limit=20",
      signal ? { signal } : {},
    ),
    { params: Promise.resolve({}) },
  );

beforeEach(() => {
  search.mockReset();
  logError.mockReset();
});

describe("GET /api/v1/catalog/search", () => {
  it("hands the request's own signal to the search, and answers as before", async () => {
    search.mockResolvedValueOnce({ query: "muga", results: [], available: true });
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ query: "muga", results: [], available: true });
    expect(search.mock.calls[0]![0]).toMatchObject({ q: "muga", limit: 20 });
    expect(search.mock.calls[0]![1]).toBeInstanceOf(AbortSignal);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("a search the caller cancelled ends with an empty, uncacheable answer and is not logged as an error", async () => {
    const gone = new AbortController();
    let seen: boolean | undefined;
    search.mockImplementationOnce(async (_input, signal) => {
      gone.abort();
      seen = signal?.aborted; // the signal the route passed on follows the caller
      throw new Error("search cancelled by the caller"); // what the service throws once the caller is gone
    });
    const res = await get(gone.signal);
    expect(seen).toBe(true);
    expect(res.status).toBe(499);
    expect(await res.text()).toBe("");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(logError).not.toHaveBeenCalled();
  });

  it("a failure while the caller is still there is still an error, and is logged", async () => {
    search.mockRejectedValueOnce(new Error("boom"));
    const res = await get();
    expect(res.status).toBe(500);
    expect(logError).toHaveBeenCalled();
  });
});

/**
 * On Vercel, `request.signal` follows a disconnecting caller only for functions that opt in (`supportsCancellation`
 * in vercel.json), and every function that opts in is terminated when its caller goes away, whatever its code does.
 * So exactly this read-only route opts in: never a glob, which could cut a route that writes in the middle of it.
 */
describe("vercel.json: cancellation for the search route only", () => {
  const web = path.resolve(import.meta.dirname, "../../../../../..");
  const config = JSON.parse(fs.readFileSync(path.join(web, "vercel.json"), "utf8")) as {
    regions?: string[];
    functions?: Record<string, Record<string, unknown>>;
  };
  const functions = Object.entries(config.functions ?? {});

  it("names this route's own file, relative to the project root (apps/web), and nothing else", () => {
    const cancellable = functions.filter(([, options]) => options.supportsCancellation === true);
    expect(cancellable.map(([key]) => key)).toEqual(["src/app/api/v1/catalog/search/route.ts"]);
    expect(path.join(web, cancellable[0]![0])).toBe(path.join(import.meta.dirname, "route.ts"));
    expect(fs.existsSync(path.join(web, cancellable[0]![0]))).toBe(true);
  });

  it("every functions entry is one existing file (no glob) with options Vercel documents", () => {
    const known = new Set(["supportsCancellation", "maxDuration", "regions"]);
    for (const [key, options] of functions) {
      expect(key, "a glob would reach other routes").not.toMatch(/[*?[\]{}!]/);
      expect(fs.existsSync(path.join(web, key)), key).toBe(true);
      for (const option of Object.keys(options)) expect(known.has(option), option).toBe(true);
    }
    expect(config.regions).toEqual(["fra1"]); // the register's evidence for the region
  });

  it("the route only reads: it exports GET and nothing that writes", async () => {
    const route = await import("./route");
    expect(Object.keys(route).sort()).toEqual(["GET"]);
  });
});
