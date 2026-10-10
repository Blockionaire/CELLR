import { describe, expect, it } from "vitest";
import { DomainError, isDomainError } from "./errors";

describe("DomainError", () => {
  it("carries a code and defaults to non-retryable", () => {
    const e = new DomainError("FORBIDDEN", "nope");
    expect(isDomainError(e)).toBe(true);
    expect(e.code).toBe("FORBIDDEN");
    expect(e.retryable).toBe(false);
  });

  it("keeps the cause for logging", () => {
    const cause = new Error("db down");
    const e = new DomainError("INTERNAL", "boom", { retryable: true, cause });
    expect(e.cause).toBe(cause);
    expect(e.retryable).toBe(true);
  });

  it("is not confused with a plain Error", () => {
    expect(isDomainError(new Error("x"))).toBe(false);
  });
});
