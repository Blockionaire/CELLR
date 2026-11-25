import { describe, expect, it } from "vitest";
import { revisionFromIfMatch } from "./revision";

describe("the revision a layout save names (If-Match)", () => {
  const REVISION = "2026-11-29T10:00:00.123456+00:00";

  it("is passed on to the microsecond, quoted, weak or bare", () => {
    for (const header of [`"${REVISION}"`, `W/"${REVISION}"`, REVISION, `  "${REVISION}"  `])
      expect(revisionFromIfMatch(header)).toBe(REVISION);
  });

  it("keeps every form PostgREST writes (trailing zeros left out, whole seconds) exactly as written", () => {
    for (const r of [
      "2026-11-29T10:00:00.1+00:00",
      "2026-11-29T10:00:00.12345+00:00",
      "2026-11-29T10:00:00+00:00",
    ])
      expect(revisionFromIfMatch(`"${r}"`)).toBe(r);
  });

  it("a revision that would lose its microseconds as a JavaScript Date is still a different text", () => {
    // what Date would make of it: the same millisecond, another revision. Nothing here may go through Date.
    expect(new Date(REVISION).toISOString()).toBe("2026-11-29T10:00:00.123Z");
    expect(revisionFromIfMatch(`"${REVISION}"`)).not.toBe(new Date(REVISION).toISOString());
  });

  it("names none for anything that is not one entity tag", () => {
    for (const header of [null, "", "*", '"a", "b"', '""', `"${"x".repeat(65)}"`])
      expect(revisionFromIfMatch(header)).toBeNull();
  });
});
