import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { createBottleLibraryService } = await import("./service");
type Repo = Parameters<typeof createBottleLibraryService>[0]["repo"];

/** A tiny but well-formed JPEG of the given size: what the browser would send. */
function jpeg(w: number, h: number): Uint8Array {
  const segment = (marker: number, data: number[]) => [
    0xff,
    marker,
    (data.length + 2) >> 8,
    (data.length + 2) & 0xff,
    ...data,
  ];
  return Uint8Array.from(
    [
      [0xff, 0xd8],
      segment(0xe1, [0x45, 0x78, 0x69, 0x66, 0, 0, 1, 2, 3]), // EXIF: must not be kept
      segment(0xc0, [8, h >> 8, h & 0xff, w >> 8, w & 0xff, 3, 1, 0x22, 0, 2, 0x11, 0, 3, 0x11, 0]),
      segment(0xdb, new Array(65).fill(1)),
      [0xff, 0xda, 0, 12, 3, 1, 0, 2, 0x11, 3, 0x11, 0, 63, 0],
      [0x12, 0x34, 0xff, 0xd9],
    ].flat(),
  );
}

const VINTAGE = "8b1f4c2e-3d5a-4e6f-9a7b-1c2d3e4f5a6b";

function fake(options: { failSubmit?: boolean; stored?: boolean; failPoints?: boolean } = {}) {
  const state = {
    stored: new Map<string, Uint8Array>(),
    removed: [] as string[],
    rewarded: new Set<string>(),
    points: 0,
    submits: 0,
  };
  const repo: Repo = {
    async submit({ vintageId, consent }) {
      if (options.failSubmit) throw new Error("db down");
      if (!consent) throw new Error("consent_required");
      state.submits++;
      const first = !state.rewarded.has(vintageId);
      state.rewarded.add(vintageId);
      if (first) state.points += 10;
      return { id: `s${state.submits}`, points: first ? 10 : 0 };
    },
    points: async () => {
      if (options.failPoints) throw new Error("points read failed");
      return state.points;
    },
    art: async () => new Map(),
    artFile: async () => null,
  };
  const service = createBottleLibraryService({
    repo,
    store: async (bytes) => {
      if (options.stored === false) return null;
      const path = `me/${state.stored.size}.jpg`;
      state.stored.set(path, bytes);
      return path;
    },
    remove: async (paths) => void state.removed.push(...paths),
  });
  return { service, state };
}

describe("sending a bottle photo", () => {
  it("keeps a clean photo (no EXIF), and the first one of a wine earns points", async () => {
    const { service, state } = fake();
    const first = await service.submit(VINTAGE, true, jpeg(1200, 1600));
    expect(first).toEqual({ id: "s1", points: 10, total: 10 });
    const kept = [...state.stored.values()][0]!;
    expect(new TextDecoder("latin1").decode(kept)).not.toContain("Exif");
  });

  it("a second photo of the same wine is welcome but earns nothing", async () => {
    const { service } = fake();
    await service.submit(VINTAGE, true, jpeg(1200, 1600));
    expect(await service.submit(VINTAGE, true, jpeg(1200, 1600))).toEqual({
      id: "s2",
      points: 0,
      total: 10,
    });
  });

  it("without consent nothing is stored or recorded", async () => {
    const { service, state } = fake();
    await expect(service.submit(VINTAGE, false, jpeg(1200, 1600))).rejects.toMatchObject({
      code: "VALIDATION",
    });
    expect(state.stored.size).toBe(0);
    expect(state.submits).toBe(0);
  });

  it("refuses what is not a photo, or too small a one", async () => {
    const { service, state } = fake();
    await expect(
      service.submit(VINTAGE, true, new TextEncoder().encode("<svg/>")),
    ).rejects.toMatchObject({ code: "UPLOAD_REJECTED" });
    await expect(service.submit(VINTAGE, true, jpeg(200, 300))).rejects.toMatchObject({
      code: "UPLOAD_REJECTED",
    });
    expect(state.stored.size).toBe(0);
  });

  it("when it cannot be recorded, the stored file goes again", async () => {
    const { service, state } = fake({ failSubmit: true });
    await expect(service.submit(VINTAGE, true, jpeg(1200, 1600))).rejects.toThrow();
    expect(state.removed).toEqual(["me/0.jpg"]);
  });

  it("a points total that can't be read never takes away a photo that was recorded", async () => {
    const { service, state } = fake({ failPoints: true });
    const sent = await service.submit(VINTAGE, true, jpeg(1200, 1600));
    expect(sent).toEqual({ id: "s1", points: 10, total: null });
    expect(state.removed).toEqual([]);
    expect(state.stored.size).toBe(1);
  });

  it("says so kindly when this deployment cannot keep photos", async () => {
    const { service } = fake({ stored: false });
    await expect(service.submit(VINTAGE, true, jpeg(1200, 1600))).rejects.toMatchObject({
      code: "INTERNAL",
    });
  });
});

describe("the library's pictures", () => {
  it("a library that cannot be read is simply empty, so the app keeps its own bottle", async () => {
    const service = createBottleLibraryService({
      repo: {
        submit: async () => ({ id: "x", points: 0 }),
        points: async () => 0,
        art: async () => {
          throw new Error("function missing");
        },
        artFile: async () => null,
      },
      store: async () => null,
      remove: async () => {},
    });
    expect((await service.art(["w1"])).size).toBe(0);
    await expect(service.artFile("a1")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
