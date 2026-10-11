import { describe, expect, it } from "vitest";
import { readThemeCookie } from "./theme-cookie";

describe("readThemeCookie", () => {
  it("accepts only an explicit light or dark", () => {
    expect(readThemeCookie("light")).toBe("light");
    expect(readThemeCookie("dark")).toBe("dark");
  });
  it.each([undefined, "", "system", "DARK", "blue", "<script>"])(
    "treats %j as 'follow the system'",
    (v) => {
      expect(readThemeCookie(v)).toBeUndefined();
    },
  );
});
