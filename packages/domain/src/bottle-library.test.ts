import { describe, expect, it } from "vitest";
import {
  BOTTLE_PHOTO_POINTS,
  BottlePhotoFieldsSchema,
  BottlePhotoRowSchema,
  contributionView,
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

describe("where a person stands with a wine's bottle photos", () => {
  const st = (status: "eligible" | "submitted" | "rejected" | "published", points = 0) => ({
    wineId: "00000000-0000-4000-8000-000000000001",
    status,
    points,
  });

  it("eligible and never rewarded: ask, promise the one-time reward, and may be invited", () => {
    expect(contributionView(st("eligible"))).toEqual({
      show: "ask",
      reward: BOTTLE_PHOTO_POINTS,
      earned: 0,
      invite: true,
    });
  });

  it("submitted: a quiet thank-you with the points actually earned, never another request", () => {
    expect(contributionView(st("submitted", 10))).toEqual({
      show: "received",
      reward: null,
      earned: 10,
      invite: false,
    });
    expect(contributionView(st("submitted", 0))).toMatchObject({ show: "received", earned: 0 });
  });

  it("rejected: new photos are welcome, but no second reward is promised and nobody is invited", () => {
    expect(contributionView(st("rejected", 10))).toEqual({
      show: "again",
      reward: null,
      earned: 10,
      invite: false,
    });
  });

  it("an eligible wine already rewarded (an older contribution) asks without promising points, and does not invite", () => {
    expect(contributionView(st("eligible", 10))).toMatchObject({ reward: null, invite: false });
  });

  it("published: nothing to ask", () => {
    expect(contributionView(st("published"))).toMatchObject({ show: "none", invite: false });
  });

  it("unknown (the database step not taken yet): ask as before, promising no number, inviting nobody", () => {
    expect(contributionView(null)).toEqual({ show: "ask", reward: null, earned: 0, invite: false });
  });
});

describe("the admin's bottle-photo rows: one contract with the database", () => {
  // The same list is checked against what admin_bottle_photos returns, in
  // supabase/tests/99_bottle_library_repair.test.sql. Production once returned rows without householdId and household
  // (an applied migration had been edited afterwards), and the admin page failed on this schema.
  const ROW_KEYS = [
    "artId",
    "canonicalName",
    "canonicalWineId",
    "consentAt",
    "createdAt",
    "height",
    "household",
    "householdId",
    "id",
    "note",
    "producer",
    "reviewedAt",
    "rewardAt",
    "rewardPoints",
    "sourceCanonical",
    "sourceWineId",
    "status",
    "submitter",
    "type",
    "userId",
    "width",
    "wine",
    "year",
  ];

  it("requires exactly the keys the database function returns", () => {
    expect(Object.keys(BottlePhotoRowSchema.shape).sort()).toEqual(ROW_KEYS);
  });

  it("a row without the household keys (the production failure) is refused, not silently accepted", () => {
    const row = {
      id: "6f1c2a8e-3b4d-4e5f-8a9b-0c1d2e3f4a5b",
      status: "pending",
      createdAt: "2026-11-01T15:00:00Z",
      userId: "7a2b3c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d",
      submitter: "Joost",
      producer: "Château X",
      wine: "Grand Vin",
      type: "red",
      year: 2018,
      sourceWineId: null,
      sourceCanonical: true,
      canonicalWineId: null,
      canonicalName: null,
      consentAt: "2026-11-01T15:00:00Z",
      rewardPoints: 10,
      rewardAt: "2026-11-01T15:00:00Z",
      width: 1200,
      height: 1600,
      artId: null,
      note: null,
      reviewedAt: null,
    };
    const failed = BottlePhotoRowSchema.safeParse(row);
    expect(failed.success).toBe(false);
    expect(failed.error?.issues.map((i) => i.path.join("."))).toEqual(["householdId", "household"]);
    expect(
      BottlePhotoRowSchema.safeParse({ ...row, householdId: null, household: null }).success,
    ).toBe(true);
  });
});
