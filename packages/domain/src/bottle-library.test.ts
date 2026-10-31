import { describe, expect, it } from "vitest";
import {
  BottlePhotoFieldsSchema,
  BottlePhotoReviewSchema,
  cleanBottleArt,
  parseBottlePhotoFilter,
  sanitizePng,
} from "./bottle-library";

const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const chunk = (type: string, data: number[]) => [
  ...u32(data.length),
  ...type.split("").map((c) => c.charCodeAt(0)),
  ...data,
  0,
  0,
  0,
  0, // CRC (not checked: the structure is what matters here)
];
/** A small, well-formed PNG of the given size, with a text chunk that must not survive. */
function png(w: number, h: number, extra: number[][] = []): Uint8Array {
  return Uint8Array.from([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...chunk("IHDR", [...u32(w), ...u32(h), 8, 6, 0, 0, 0]),
    ...chunk("tEXt", [..."Author\0Somebody".split("").map((c) => c.charCodeAt(0))]),
    ...extra.flat(),
    ...chunk("IDAT", [1, 2, 3, 4]),
    ...chunk("IEND", []),
  ]);
}

describe("a finished 2D bottle picture", () => {
  it("is a PNG kept without its text chunks, with its size", () => {
    const r = cleanBottleArt(png(600, 1800));
    expect(r).toMatchObject({ ok: true, width: 600, height: 1800, type: "image/png" });
    if (!r.ok) throw new Error();
    expect(new TextDecoder().decode(r.bytes)).not.toContain("Somebody");
    expect(new TextDecoder().decode(r.bytes)).toContain("IDAT");
  });

  it("refuses what is not a picture, a broken file, too small or too large", () => {
    expect(cleanBottleArt(new TextEncoder().encode("<svg/>"))).toMatchObject({
      ok: false,
      reason: "not-image",
    });
    expect(sanitizePng(png(600, 1800).slice(0, 40), 1e6)).toMatchObject({ ok: false });
    expect(cleanBottleArt(png(100, 150))).toMatchObject({ ok: false, reason: "unsupported" });
    expect(cleanBottleArt(png(5000, 5000))).toMatchObject({ ok: false, reason: "too-big" });
    expect(sanitizePng(png(600, 1800), 20)).toMatchObject({ ok: false, reason: "too-big" });
  });

  it("a PNG without picture data is broken", () => {
    const noData = Uint8Array.from([
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a,
      ...chunk("IHDR", [...u32(600), ...u32(1800), 8, 6, 0, 0, 0]),
      ...chunk("IEND", []),
    ]);
    expect(sanitizePng(noData, 1e6)).toMatchObject({ ok: false, reason: "corrupt" });
  });
});

describe("sending a bottle photo", () => {
  it("needs the explicit yes", () => {
    const vintageId = "8b1f4c2e-3d5a-4e6f-9a7b-1c2d3e4f5a6b";
    expect(BottlePhotoFieldsSchema.safeParse({ vintageId, consent: "true" }).success).toBe(true);
    expect(BottlePhotoFieldsSchema.safeParse({ vintageId, consent: "false" }).success).toBe(false);
    expect(BottlePhotoFieldsSchema.safeParse({ vintageId }).success).toBe(false);
  });
});

describe("the admin's review", () => {
  it("reads a status filter safely and an empty target as none", () => {
    expect(parseBottlePhotoFilter("used")).toBe("used");
    expect(parseBottlePhotoFilter("drop table")).toBe("pending");
    expect(
      BottlePhotoReviewSchema.parse({ status: "approved", canonicalWineId: "", note: " ok " }),
    ).toEqual({ status: "approved", canonicalWineId: null, note: "ok" });
  });
});
