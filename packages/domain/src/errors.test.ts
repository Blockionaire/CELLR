import { describe, expect, it } from "vitest";
import {
  DomainError,
  ERROR_CODES,
  ERROR_HTTP_STATUS,
  ERROR_MESSAGES,
  isDomainError,
} from "./errors";

describe("DomainError", () => {
  it("carries a code and defaults to non-retryable", () => {
    const e = new DomainError("FORBIDDEN");
    expect(isDomainError(e)).toBe(true);
    expect(e.code).toBe("FORBIDDEN");
    expect(e.retryable).toBe(false);
  });
  it("uses the human default message unless given one", () => {
    expect(new DomainError("NOT_FOUND").message).toBe(ERROR_MESSAGES.NOT_FOUND);
    expect(new DomainError("CONFLICT", "custom").message).toBe("custom");
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

describe("error contract", () => {
  it("every code has a status and a message", () => {
    for (const code of ERROR_CODES) {
      expect(ERROR_HTTP_STATUS[code]).toBeGreaterThanOrEqual(400);
      expect(ERROR_MESSAGES[code].length).toBeGreaterThan(10);
    }
  });
  it("messages never leak technical jargon", () => {
    for (const code of ERROR_CODES) {
      expect(ERROR_MESSAGES[code]).not.toMatch(
        /\b(500|404|403|401|exception|null|undefined|sql|postgres|supabase|jwt)\b/i,
      );
    }
  });
});
