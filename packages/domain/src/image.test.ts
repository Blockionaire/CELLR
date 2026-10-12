import { describe, expect, it } from "vitest";
import { IMAGE_LIMITS, sanitizeJpeg } from "./image";

const bytes = (...parts: Array<number | number[] | string>) =>
  Uint8Array.from(
    parts.flatMap((p) =>
      typeof p === "number" ? [p] : typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p,
    ),
  );
const segment = (marker: number, body: number[] | string) => {
  const data = typeof body === "string" ? [...body].map((c) => c.charCodeAt(0)) : body;
  const length = data.length + 2;
  return [0xff, marker, length >> 8, length & 0xff, ...data];
};
const frame = (w: number, h: number, components = 3, marker = 0xc0) =>
  segment(marker, [
    8,
    h >> 8,
    h & 0xff,
    w >> 8,
    w & 0xff,
    components,
    1,
    0x22,
    0,
    2,
    0x11,
    0,
    3,
    0x11,
    0,
  ]);
const scan = [0xff, 0xda, 0, 12, 3, 1, 0, 2, 0x11, 3, 0x11, 0, 63, 0];
/** Compressed data with an escaped 0xFF, a restart marker and a 0xFF that is not a marker. */
const entropy = [0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd0, 0x78, 0x9a];

const jpeg = (...middle: number[][]) =>
  bytes(
    [0xff, 0xd8],
    ...middle,
    frame(640, 480),
    segment(0xdb, new Array(65).fill(1)),
    scan,
    entropy,
    [0xff, 0xd9],
  );

describe("cleaning a photo", () => {
  it("keeps the picture and drops the EXIF block, the GPS position and comments", () => {
    const exif = segment(0xe1, "Exif\0\0GPS 52.37N 4.89E Serial 12345");
    const xmp = segment(0xe1, "http://ns.adobe.com/xap/1.0/\0<x:xmpmeta/>");
    const comment = segment(0xfe, "taken at home");
    const dirty = jpeg(segment(0xe0, "JFIF\0\x01\x01\0\0\x01\0\x01\0\0"), exif, xmp, comment);
    const result = sanitizeJpeg(dirty);
    expect(result).toMatchObject({ ok: true, width: 640, height: 480 });
    if (!result.ok) return;
    const text = new TextDecoder("latin1").decode(result.bytes);
    expect(text).not.toContain("Exif");
    expect(text).not.toContain("GPS");
    expect(text).not.toContain("xmpmeta");
    expect(text).not.toContain("taken at home");
    expect(text).toContain("JFIF"); // the plain header stays
    // Everything that draws the picture is still there, in order: frame, tables, scan header, data.
    const kept = Buffer.from(result.bytes);
    for (const marker of [0xc0, 0xdb, 0xda])
      expect(kept.includes(Buffer.from([0xff, marker]))).toBe(true);
    // The compressed picture data is untouched, byte for byte.
    expect(Buffer.from(result.bytes).includes(Buffer.from(entropy))).toBe(true);
    expect(result.bytes.at(-2)).toBe(0xff);
    expect(result.bytes.at(-1)).toBe(0xd9);
  });

  it("keeps a colour profile and the Adobe flag, which change how it looks", () => {
    const result = sanitizeJpeg(
      jpeg(segment(0xe2, "ICC_PROFILE\0\x01\x01profile"), segment(0xee, "Adobe\0\x64\0\0\0\0\x01")),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const text = new TextDecoder("latin1").decode(result.bytes);
    expect(text).toContain("ICC_PROFILE");
    expect(text).toContain("Adobe");
  });

  it("drops the multi-picture index some phones add (it can hold a second, uncropped photo)", () => {
    const result = sanitizeJpeg(jpeg(segment(0xe2, "MPF\0second picture")));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(new TextDecoder("latin1").decode(result.bytes)).not.toContain("MPF");
  });

  it("is idempotent: cleaning a clean photo changes nothing", () => {
    const once = sanitizeJpeg(jpeg(segment(0xe1, "Exif\0\0x")));
    if (!once.ok) throw new Error("expected ok");
    const twice = sanitizeJpeg(once.bytes);
    expect(twice.ok && Buffer.from(twice.bytes).equals(Buffer.from(once.bytes))).toBe(true);
  });

  it("accepts progressive files with several scans, and grey ones", () => {
    const progressive = bytes(
      [0xff, 0xd8],
      frame(100, 80, 3, 0xc2),
      scan,
      entropy,
      scan,
      entropy,
      [0xff, 0xd9],
    );
    expect(sanitizeJpeg(progressive)).toMatchObject({ ok: true, width: 100, height: 80 });
    const grey = bytes([0xff, 0xd8], frame(100, 80, 1), scan, entropy, [0xff, 0xd9]);
    expect(sanitizeJpeg(grey).ok).toBe(true);
  });

  it("refuses what is not a JPEG, plainly", () => {
    expect(sanitizeJpeg(bytes("GIF89a....")).ok).toBe(false);
    expect(sanitizeJpeg(bytes([0x89], "PNG\r\n\x1a\n")).ok).toBe(false);
    expect(sanitizeJpeg(bytes("<svg onload=alert(1)>")).ok).toBe(false);
    expect(sanitizeJpeg(new Uint8Array(0))).toEqual({ ok: false, reason: "not-jpeg" });
    // HEIC photos start with a different signature: the app converts them to JPEG before upload.
    expect(sanitizeJpeg(bytes([0, 0, 0, 0x18], "ftypheic")).ok).toBe(false);
  });

  it("refuses a file that is cut short or has no picture in it", () => {
    const whole = jpeg();
    expect(sanitizeJpeg(whole.subarray(0, whole.length - 8))).toMatchObject({
      ok: false,
      reason: "corrupt",
    });
    expect(sanitizeJpeg(bytes([0xff, 0xd8], [0xff, 0xd9]))).toMatchObject({
      ok: false,
      reason: "corrupt",
    });
    // A segment that claims to be longer than the file.
    expect(sanitizeJpeg(bytes([0xff, 0xd8], [0xff, 0xe1, 0xff, 0xff, 1, 2, 3]))).toMatchObject({
      ok: false,
      reason: "corrupt",
    });
    // Two frame headers: ambiguous, so refused.
    expect(
      sanitizeJpeg(bytes([0xff, 0xd8], frame(10, 10), frame(20, 20), scan, entropy, [0xff, 0xd9]))
        .ok,
    ).toBe(false);
  });

  it("refuses kinds it cannot vouch for: arithmetic coding, CMYK", () => {
    expect(
      sanitizeJpeg(bytes([0xff, 0xd8], frame(10, 10, 3, 0xc9), scan, entropy, [0xff, 0xd9])),
    ).toMatchObject({
      ok: false,
      reason: "unsupported",
    });
    expect(
      sanitizeJpeg(bytes([0xff, 0xd8], frame(10, 10, 4), scan, entropy, [0xff, 0xd9])),
    ).toMatchObject({
      ok: false,
      reason: "unsupported",
    });
  });

  it("refuses a picture that would be enormous once opened, however small the file", () => {
    const bomb = bytes([0xff, 0xd8], frame(65535, 65535), scan, entropy, [0xff, 0xd9]);
    expect(sanitizeJpeg(bomb)).toMatchObject({ ok: false, reason: "too-big" });
    const wide = bytes(
      [0xff, 0xd8],
      frame(IMAGE_LIMITS.maxEdge + 1, 10),
      scan,
      entropy,
      [0xff, 0xd9],
    );
    expect(sanitizeJpeg(wide)).toMatchObject({ ok: false, reason: "too-big" });
    const manyPixels = bytes([0xff, 0xd8], frame(4000, 4000), scan, entropy, [0xff, 0xd9]);
    expect(sanitizeJpeg(manyPixels).ok).toBe(true); // exactly 16 000 000: allowed
    expect(
      sanitizeJpeg(bytes([0xff, 0xd8], frame(4096, 4096), scan, entropy, [0xff, 0xd9])).ok,
    ).toBe(false);
  });

  it("refuses a file over the byte limit before reading it", () => {
    const big = new Uint8Array(IMAGE_LIMITS.thumbBytes + 1);
    big.set([0xff, 0xd8, 0xff]);
    expect(sanitizeJpeg(big, IMAGE_LIMITS.thumbBytes)).toEqual({ ok: false, reason: "too-big" });
  });
});
