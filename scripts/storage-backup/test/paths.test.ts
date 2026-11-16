import { describe, expect, it } from "vitest";
import { SafetyError } from "../src/errors";
import {
  assertSafeKey,
  encodeSegment,
  objectId,
  planLocalPaths,
  resolveInside,
} from "../src/paths";

describe("encodeSegment", () => {
  it("keeps CELLR's ordinary names readable", () => {
    expect(encodeSegment("3f1c2a9e-4b7d-4c1e-9f00-1234567890ab.jpg")).toBe(
      "3f1c2a9e-4b7d-4c1e-9f00-1234567890ab.jpg",
    );
    expect(encodeSegment(".emptyFolderPlaceholder")).toBe(".emptyFolderPlaceholder");
  });

  it("encodes spaces, specials, unicode and % reversibly", () => {
    expect(encodeSegment("sp ace.jpg")).toBe("sp%20ace.jpg");
    expect(encodeSegment("a(1)&b$@=;:+,!'*.jpg")).toBe(
      "a%281%29%26b%24%40%3D%3B%3A%2B%2C%21%27%2A.jpg",
    );
    expect(encodeSegment("été.jpg")).toBe("%C3%A9t%C3%A9.jpg");
    expect(encodeSegment("100%.jpg")).toBe("100%25.jpg");
    expect(decodeURIComponent(encodeSegment("a b%c é?.jpg"))).toBe("a b%c é?.jpg");
  });

  it("makes Windows-hostile names safe", () => {
    expect(encodeSegment("CON.jpg")).toBe("%43ON.jpg");
    expect(encodeSegment("nul")).toBe("%6Eul");
    expect(encodeSegment("com1.txt")).toBe("%63om1.txt");
    expect(encodeSegment("trail.jpg.")).toBe("trail.jpg%2E");
    expect(encodeSegment("back\\slash")).toBe("back%5Cslash");
    expect(encodeSegment("..")).toBe("%2E%2E");
  });

  it("shortens long segments without cutting an escape in half, and keeps them distinct", () => {
    const a = encodeSegment("é".repeat(100));
    const b = encodeSegment("é".repeat(101));
    expect(a.length).toBeLessThanOrEqual(120);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^(%[0-9A-F]{2})+~[0-9a-f]{16}$/);
  });
});

describe("assertSafeKey", () => {
  it.each(["../etc/passwd", "a/../b", "./a", "a//b", "/a", "a/", "", "a/\u0000b"])(
    "refuses %j",
    (key) => {
      expect(() => assertSafeKey(key)).toThrow(SafetyError);
    },
  );
  it("accepts dots inside names", () => {
    expect(() => assertSafeKey("a/..b/c..d/.e")).not.toThrow();
  });
});

describe("planLocalPaths", () => {
  it("resolves case collisions and object-vs-folder collisions deterministically", () => {
    const objects = [
      { bucket: "b", key: "h2/A.jpg" },
      { bucket: "b", key: "h2/a.jpg" },
      { bucket: "b", key: "h1" },
      { bucket: "b", key: "h1/x.jpg" },
      { bucket: "b", key: "H1/y.jpg" },
    ];
    const plan = planLocalPaths(objects);
    const again = planLocalPaths([...objects].reverse());
    expect([...plan.entries()].sort()).toEqual([...again.entries()].sort());
    const paths = [...plan.values()].map((p) => p.toLowerCase());
    expect(new Set(paths).size).toBe(paths.length);
    // a file never has the name of a folder (case-insensitively)
    const dirs = new Set(
      paths.flatMap((p) =>
        p
          .split("/")
          .slice(0, -1)
          .map((_, i, a) => a.slice(0, i + 1).join("/")),
      ),
    );
    for (const p of paths) expect(dirs.has(p)).toBe(false);
    expect(plan.get(objectId("b", "h1/x.jpg"))).toBe("objects/b/h1/x.jpg");
    expect(plan.get(objectId("b", "h1"))).toMatch(/^objects\/b\/h1~[0-9a-f]{12}$/);
    expect(plan.get(objectId("b", "h2/A.jpg"))).toBe("objects/b/h2/A.jpg");
    expect(plan.get(objectId("b", "h2/a.jpg"))).toMatch(/^objects\/b\/h2\/a~[0-9a-f]{12}\.jpg$/);
  });

  it("keeps buckets apart and refuses unsafe keys", () => {
    const plan = planLocalPaths([
      { bucket: "one", key: "x.jpg" },
      { bucket: "two", key: "x.jpg" },
    ]);
    expect(plan.get(objectId("one", "x.jpg"))).toBe("objects/one/x.jpg");
    expect(plan.get(objectId("two", "x.jpg"))).toBe("objects/two/x.jpg");
    expect(() => planLocalPaths([{ bucket: "b", key: "../x" }])).toThrow(SafetyError);
  });
});

describe("resolveInside", () => {
  it("refuses paths that leave the folder", () => {
    for (const p of ["../x", "objects/../../x", "/etc/passwd", "objects\\..\\x", "objects//x"])
      expect(() => resolveInside("/tmp/backup", p)).toThrow(SafetyError);
    expect(resolveInside("/tmp/backup", "objects/b/x.jpg")).toBe("/tmp/backup/objects/b/x.jpg");
  });
});
