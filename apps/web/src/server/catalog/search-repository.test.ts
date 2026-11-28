import { describe, expect, it, vi } from "vitest";
import type { Db } from "@/server/db/clients";
import { createCatalogSearchRepository } from "./search-repository";

/** A database client whose `rpc` returns a query builder that resolves to `answer`, and records `.abortSignal`. */
function fakeDb(answer: { data: unknown; error: unknown }) {
  const abortSignal = vi.fn();
  const builder = {
    abortSignal(signal: AbortSignal) {
      abortSignal(signal);
      return builder;
    },
    then<T>(resolve: (value: typeof answer) => T) {
      return Promise.resolve(answer).then(resolve);
    },
  };
  const rpc = vi.fn(() => builder);
  return { db: { rpc } as unknown as Db, rpc, abortSignal };
}

const args = {
  householdId: "h1",
  query: "muga",
  type: null,
  country: null,
  region: null,
  limit: 20,
};

describe("catalog search repository", () => {
  it("hands the request's signal to the database call, so a cancelled caller stops the wait", async () => {
    const { db, rpc, abortSignal } = fakeDb({ data: [], error: null });
    const signal = new AbortController().signal;
    expect(await createCatalogSearchRepository(db).search(args, signal)).toEqual([]);
    expect(rpc).toHaveBeenCalledWith(
      "catalog_search",
      expect.objectContaining({ p_query: "muga" }),
    );
    expect(abortSignal).toHaveBeenCalledWith(signal);
  });

  it("without a signal the call is made as before", async () => {
    const { db, abortSignal } = fakeDb({ data: [], error: null });
    expect(await createCatalogSearchRepository(db).search(args)).toEqual([]);
    expect(abortSignal).not.toHaveBeenCalled();
  });
});
