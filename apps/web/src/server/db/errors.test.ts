import { describe, expect, it } from "vitest";
import { mapDbError } from "./errors";

describe("mapDbError", () => {
  it.each([
    [{ code: "42501", message: "permission denied for table x" }, "FORBIDDEN"],
    [
      { code: "42501", message: 'new row violates row-level security policy for table "bottles"' },
      "FORBIDDEN",
    ],
    [{ code: "54000", message: "rate_limited" }, "RATE_LIMITED"],
    [{ code: "P0001", message: "last_owner" }, "CONFLICT"],
    [{ code: "23514", message: "slot_out_of_bounds" }, "VALIDATION"],
    [{ code: "23514", message: "location_in_use" }, "CONFLICT"],
    [{ code: "23505", message: "duplicate key value" }, "CONFLICT"],
    [{ code: "23503", message: "violates foreign key constraint" }, "CONFLICT"],
    [{ code: "23514", message: "violates check constraint" }, "VALIDATION"],
    [{ code: "22023", message: "invalid_arguments" }, "VALIDATION"],
    [
      { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" },
      "NOT_FOUND",
    ],
    [{ code: "PGRST301", message: "JWT expired" }, "UNAUTHENTICATED"],
    [{ code: "XX000", message: "something exploded" }, "INTERNAL"],
    [{}, "INTERNAL"],
  ])("%j → %s", (input, code) => {
    expect(mapDbError(input).code).toBe(code);
  });

  it("marks rate limiting as retryable and keeps the cause only for unexpected errors", () => {
    expect(mapDbError({ code: "54000" }).retryable).toBe(true);
    expect(mapDbError({ code: "XX000", message: "boom" }).cause).toBeDefined();
  });

  it("gives the last-owner conflict a message that says what to do", () => {
    expect(mapDbError({ code: "P0001", message: "last_owner" }).message).toMatch(/last owner/i);
  });

  it("never exposes database wording to people", () => {
    for (const e of [
      { code: "42501", message: "permission denied for table households" },
      { code: "XX000", message: 'relation "public.x" does not exist' },
    ]) {
      expect(mapDbError(e).message).not.toMatch(/permission denied|relation|households|public\./i);
    }
  });
});
