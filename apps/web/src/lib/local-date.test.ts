import { describe, expect, it } from "vitest";
import { todayLocal } from "./local-date";

describe("todayLocal", () => {
  it("uses the local calendar day", () => {
    expect(todayLocal(new Date(2026, 0, 5, 0, 30))).toBe("2026-01-05");
    expect(todayLocal(new Date(2026, 11, 31, 23, 59))).toBe("2026-12-31");
  });
});
