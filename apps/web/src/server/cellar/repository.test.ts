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
