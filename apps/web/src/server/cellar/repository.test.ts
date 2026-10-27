import { describe, expect, it } from "vitest";
import { isMissingTable } from "./repository";

describe("a database that has not had the tastings step yet", () => {
  it("is recognised from what PostgREST and Postgres say", () => {
    expect(isMissingTable({ code: "PGRST205" })).toBe(true); // "Could not find the table … in the schema cache"
    expect(isMissingTable({ code: "42P01" })).toBe(true); // "relation … does not exist"
    expect(isMissingTable({ code: "PGRST200" })).toBe(true); // no relationship to it, when joined from another query
  });
  it("is not confused with other trouble", () => {
    for (const code of ["42501", "23505", "PGRST116", "PGRST301", "", undefined])
      expect(isMissingTable({ code })).toBe(false);
  });
});

describe("a back label before the attach-if-empty step has been run", () => {
  it("is never put on unconditionally: the missing function is an error, and no bottle is written", async () => {
    const { createCellarRepository } = await import("./repository");
    for (const code of ["PGRST202", "42883"]) {
      const writes: string[] = [];
      const db = {
        rpc: async () => ({ data: null, error: { code, message: "function not found" } }),
        from: (table: string) => {
          writes.push(table);
          throw new Error(`must not touch ${table}`);
        },
      };
      const repo = createCellarRepository(
        db as unknown as Parameters<typeof createCellarRepository>[0],
      );
      await expect(repo.attachBackIfEmpty("h1", "v1", "img1")).rejects.toBeTruthy();
      expect(writes).toEqual([]);
    }
  });
});
