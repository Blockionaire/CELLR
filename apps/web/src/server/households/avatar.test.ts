import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { createAvatarService } = await import("./avatar");
type Repo = Parameters<typeof createAvatarService>[0];

/** A tiny but well-formed JPEG of the given size (header, tables, one scan): what the browser would send. */
function jpeg(w: number, h: number, padTo = 0): Uint8Array {
  const segment = (marker: number, data: number[]) => [
    0xff,
    marker,
    (data.length + 2) >> 8,
    (data.length + 2) & 0xff,
    ...data,
  ];
  const parts = [
    [0xff, 0xd8],
    segment(0xc0, [8, h >> 8, h & 0xff, w >> 8, w & 0xff, 3, 1, 0x22, 0, 2, 0x11, 0, 3, 0x11, 0]),
    segment(0xdb, new Array(65).fill(1)),
    [0xff, 0xda, 0, 12, 3, 1, 0, 2, 0x11, 3, 0x11, 0, 63, 0],
    new Array(Math.max(0, padTo - 120)).fill(0x12),
    [0x12, 0x34, 0xff, 0xd9],
  ];
  return Uint8Array.from(parts.flat());
}

function fake(me = "me", others: Record<string, string | null> = {}) {
  const state = {
    paths: new Map<string, string | null>([[me, null], ...Object.entries(others)]),
    files: new Map<string, Uint8Array>(),
    removed: [] as string[],
    failSet: false,
  };
  const repo: Repo = {
    async getPath(id) {
      return state.paths.get(id) ?? null;
    },
    async setPath(id, path) {
      if (state.failSet) throw new Error("db down");
      if (id !== me) return false; // RLS: only my own profile
      state.paths.set(id, path);
      return true;
    },
    async upload(path, bytes) {
      if (!path.startsWith(`${me}/`)) throw new Error("storage policy: not your folder");
      state.files.set(path, bytes);
    },
    async download(path) {
      return state.files.get(path) ?? null;
    },
    async remove(paths) {
      for (const p of paths) {
        state.removed.push(p);
        state.files.delete(p);
      }
    },
  };
  return { service: createAvatarService(repo, me), state };
}

describe("a profile photo", () => {
  it("is kept under my own folder, with a fresh name, and served back", async () => {
    const { service, state } = fake();
    await service.set(jpeg(512, 512));
    const path = state.paths.get("me")!;
    expect(path).toMatch(/^me\/[0-9a-f-]{36}\.jpg$/);
    expect((await service.file("me")).byteLength).toBeGreaterThan(0);
  });

  it("replacing it removes the old file; removing it goes back to the initials and deletes the file", async () => {
    const { service, state } = fake();
    await service.set(jpeg(512, 512));
    const first = state.paths.get("me")!;
    await service.set(jpeg(400, 400));
    const second = state.paths.get("me")!;
    expect(second).not.toBe(first);
    expect(state.removed).toEqual([first]);
    await service.remove();
    expect(state.paths.get("me")).toBeNull();
    expect(state.removed).toEqual([first, second]);
    await expect(service.file("me")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("refuses what is not a JPEG, too large a file, too large or too small a picture", async () => {
    const { service, state } = fake();
    await expect(service.set(new TextEncoder().encode("<svg/>"))).rejects.toMatchObject({
      code: "UPLOAD_REJECTED",
    });
    await expect(service.set(jpeg(512, 512, 600 * 1024))).rejects.toMatchObject({
      code: "UPLOAD_REJECTED",
      message: "That photo is too large. Try a smaller one.",
    });
    await expect(service.set(jpeg(4000, 3000))).rejects.toMatchObject({ code: "UPLOAD_REJECTED" });
    await expect(service.set(jpeg(20, 20))).rejects.toMatchObject({ code: "UPLOAD_REJECTED" });
    expect(state.files.size).toBe(0);
    expect(state.paths.get("me")).toBeNull();
  });

  it("when the profile can't be pointed at the new photo, the uploaded file goes again", async () => {
    const { service, state } = fake();
    state.failSet = true;
    await expect(service.set(jpeg(512, 512))).rejects.toThrow();
    expect(state.files.size).toBe(0);
  });

  it("someone I can't see, or a path outside their own folder, is simply not found", async () => {
    const { service } = fake("me", { stranger: null, sneaky: "me/elsewhere.jpg" });
    await expect(service.file("stranger")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(service.file("sneaky")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("deleting my account takes my photo out of storage", async () => {
    const { service, state } = fake();
    await service.set(jpeg(512, 512));
    const path = state.paths.get("me")!;
    await service.purge();
    expect(state.removed).toContain(path);
  });
});
