import { describe, expect, it } from "vitest";
import { DomainError } from "@cellr/domain";
import { createImageService } from "./service";
import type { ImageRepository, ImageRow, NewImage } from "./types";

const segment = (marker: number, body: number[] | string) => {
  const data = typeof body === "string" ? [...body].map((c) => c.charCodeAt(0)) : body;
  return [0xff, marker, (data.length + 2) >> 8, (data.length + 2) & 0xff, ...data];
};
/** A photo with the structure of a real one, and a GPS position hidden in it. */
const photo = (w = 640, h = 480, extra: number[][] = [segment(0xe1, "Exif\0\0GPS 52.37N 4.89E")]) =>
  Uint8Array.from([
    0xff,
    0xd8,
    ...extra.flat(),
    ...segment(0xdb, new Array(65).fill(1)),
    ...segment(0xc0, [
      8,
      h >> 8,
      h & 0xff,
      w >> 8,
      w & 0xff,
      3,
      1,
      0x22,
      0,
      2,
      0x11,
      0,
      3,
      0x11,
      0,
    ]),
    ...[0xff, 0xda, 0, 12, 3, 1, 0, 2, 0x11, 3, 0x11, 0, 63, 0],
    0x12,
    0x34,
    0xff,
    0xd9,
  ]);

function fakeRepo(options: { failInsert?: boolean } = {}) {
  const state = {
    files: new Map<string, Uint8Array>(),
    rows: [] as NewImage[],
    removed: [] as string[],
  };
  const repo: ImageRepository = {
    async upload(path, bytes) {
      state.files.set(path, bytes);
    },
    async download(path) {
      return state.files.get(path) ?? null;
    },
    async remove(paths) {
      state.removed.push(...paths);
      for (const p of paths) state.files.delete(p);
    },
    async insertImage(row) {
      if (options.failInsert) throw new DomainError("INTERNAL");
      state.rows.push(row);
      return {
        id: `img${state.rows.length}`,
        side: row.side,
        photoPath: row.photoPath,
        thumbPath: row.thumbPath,
        width: row.width,
        height: row.height,
        blurColor: row.blurColor,
      };
    },
    async listPaths() {
      return state.rows.flatMap((r) => (r.thumbPath ? [r.photoPath, r.thumbPath] : [r.photoPath]));
    },
    async getImage(id): Promise<ImageRow | null> {
      const n = Number(id.replace("img", ""));
      const row = state.rows[n - 1];
      return row
        ? {
            id,
            side: row.side,
            photoPath: row.photoPath,
            thumbPath: row.thumbPath,
            width: row.width,
            height: row.height,
            blurColor: row.blurColor,
          }
        : null;
    },
  };
  return { repo, state };
}

const household = async () => ({ id: "11111111-1111-4111-8111-111111111111", currency: "EUR" });

describe("keeping a label photo", () => {
  it("stores a clean copy under the household's own folder, and records its size", async () => {
    const { repo, state } = fakeRepo();
    const result = await createImageService(repo, household).upload({
      side: "front",
      photo: photo(),
      thumb: photo(300, 400),
      blurColor: "#A1B2C3",
    });
    expect(result).toEqual({
      id: "img1",
      side: "front",
      blurColor: "#a1b2c3",
      width: 640,
      height: 480,
    });
    const [row] = state.rows;
    expect(row!.photoPath).toMatch(
      /^11111111-1111-4111-8111-111111111111\/[0-9a-f-]{36}\/photo\.jpg$/,
    );
    expect(row!.thumbPath).toMatch(/\/thumb\.jpg$/);
    // Nothing the client wrote ends up in a path, and nothing hidden in the photo is kept.
    for (const bytes of state.files.values()) {
      const text = new TextDecoder("latin1").decode(bytes);
      expect(text).not.toContain("GPS");
      expect(text).not.toContain("Exif");
    }
  });

  it("works without a small copy (the photo is then used for both)", async () => {
    const { repo, state } = fakeRepo();
    const service = createImageService(repo, household);
    const result = await service.upload({ side: "back", photo: photo() });
    expect(result).toMatchObject({ side: "back", blurColor: null });
    expect(state.rows[0]!.thumbPath).toBeNull();
    const thumb = await service.file(result.id, "thumb");
    const full = await service.file(result.id, "photo");
    expect(Buffer.from(thumb).equals(Buffer.from(full))).toBe(true);
  });

  it("ignores a colour that is not a colour instead of storing it", async () => {
    const { repo } = fakeRepo();
    const result = await createImageService(repo, household).upload({
      side: "front",
      photo: photo(),
      blurColor: "red; drop table",
    });
    expect(result.blurColor).toBeNull();
  });

  it("refuses what is not a JPEG, and a file that is too big, and keeps nothing", async () => {
    const { repo, state } = fakeRepo();
    const service = createImageService(repo, household);
    await expect(
      service.upload({ side: "front", photo: new TextEncoder().encode("<svg onload=alert(1)>") }),
    ).rejects.toMatchObject({ code: "UPLOAD_REJECTED" });
    await expect(
      service.upload({ side: "front", photo: photo(), thumb: new TextEncoder().encode("GIF89a") }),
    ).rejects.toMatchObject({ code: "UPLOAD_REJECTED" });
    const huge = new Uint8Array(3 * 1024 * 1024 + 1);
    huge.set([0xff, 0xd8, 0xff]);
    await expect(service.upload({ side: "front", photo: huge })).rejects.toMatchObject({
      code: "UPLOAD_REJECTED",
      message: "That photo is too large. Try a smaller one.",
    });
    expect(state.files.size).toBe(0);
    expect(state.rows).toHaveLength(0);
  });

  it("takes the files away again when the record cannot be made", async () => {
    const { repo, state } = fakeRepo({ failInsert: true });
    await expect(
      createImageService(repo, household).upload({
        side: "front",
        photo: photo(),
        thumb: photo(300, 400),
      }),
    ).rejects.toMatchObject({ code: "INTERNAL" });
    expect(state.removed).toHaveLength(2);
    expect(state.files.size).toBe(0);
  });

  it("says 'not found' for a photo that is not there or cannot be read", async () => {
    const { repo, state } = fakeRepo();
    const service = createImageService(repo, household);
    await expect(service.file("img9", "photo")).rejects.toMatchObject({ code: "NOT_FOUND" });
    const { id } = await service.upload({ side: "front", photo: photo() });
    state.files.clear(); // the file is gone from storage, or is not ours to read
    await expect(service.file(id, "photo")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("deleting a household's photos", () => {
  it("takes every file of the household out of storage", async () => {
    const { repo, state } = fakeRepo();
    const service = createImageService(repo, household);
    await service.upload({ side: "front", photo: photo(), thumb: photo(300, 400) });
    await service.upload({ side: "back", photo: photo() });
    expect(state.files.size).toBe(3);
    await service.purge("11111111-1111-4111-8111-111111111111");
    expect(state.files.size).toBe(0);
  });

  it("stops if storage refuses, so the delete can be tried again instead of orphaning the photos", async () => {
    const { repo } = fakeRepo();
    const failing: ImageRepository = {
      ...repo,
      remove: async () => {
        throw new Error("storage down");
      },
      listPaths: async () => ["a/b.jpg"],
    };
    await expect(createImageService(failing, household).purge("h")).rejects.toThrow("storage down");
  });
});
