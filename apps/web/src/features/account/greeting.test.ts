import { describe, expect, it } from "vitest";
import { partOfDay } from "./greeting";

describe("partOfDay", () => {
  it.each([
    [0, "Morning"],
    [5, "Morning"],
    [11, "Morning"],
    [12, "Afternoon"],
    [17, "Afternoon"],
    [18, "Evening"],
    [23, "Evening"],
  ] as const)("%d:00 → %s", (hour, part) => {
    expect(partOfDay(hour)).toBe(part);
  });
});
