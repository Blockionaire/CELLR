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
