import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn<(name: string, args: Record<string, unknown>) => Promise<unknown>>();
let db: { rpc: typeof rpc } | null = null;

vi.mock("server-only", () => ({}));
vi.mock("./client", () => ({ createServiceClient: () => db }));

const { noteScanRead } = await import("./catalog-reads");

const read = {
  imageId: "img-1",
  householdId: "hh-1",
  userId: "user-1",
  producer: "Domaine Exemple",
  name: "Cuvée Alpha",
  type: "red",
};

beforeEach(() => {
  rpc.mockReset();
  db = { rpc };
});

describe("noting what a scan read, for catalogue learning", () => {
  it("names the signed-in person, so the database can apply their own choice", async () => {
    rpc.mockResolvedValueOnce({ data: true, error: null });
    await noteScanRead(read);
    expect(rpc).toHaveBeenCalledWith("catalog_note_scan_read", {
      p_image_id: "img-1",
      p_household_id: "hh-1",
      p_user_id: "user-1",
      p_producer: "Domaine Exemple",
      p_name: "Cuvée Alpha",
      p_type: "red",
    });
  });

  it("never fails the scan: no service role, or the database refuses", async () => {
    db = null;
    await expect(noteScanRead(read)).resolves.toBeUndefined();
    db = { rpc };
    rpc.mockRejectedValueOnce(new Error("down"));
    await expect(noteScanRead(read)).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("notes what was proposed next to the reading: the catalogue wine, or the AI's own reading", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    await noteScanRead({ ...read, proposal: { kind: "catalog", wineId: "cw-1", year: 2018 } });
    expect(rpc).toHaveBeenLastCalledWith("catalog_note_scan_proposal", {
      p_image_id: "img-1",
      p_user_id: "user-1",
      p_wine_id: "cw-1",
      p_ai: null,
      p_year: 2018,
    });
    const ai = { producer: "P", name: "N", type: "red", country: "FR", region: null };
    await noteScanRead({ ...read, proposal: { kind: "ai", ai, year: null } });
    expect(rpc).toHaveBeenLastCalledWith("catalog_note_scan_proposal", {
      p_image_id: "img-1",
      p_user_id: "user-1",
      p_wine_id: null,
      p_ai: ai,
      p_year: null,
    });
  });

  it("a proposal from the printed label text says so; a vision proposal says nothing new (older databases)", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    await noteScanRead({
      ...read,
      proposal: { kind: "catalog", wineId: "cw-1", year: null },
      source: "text",
    });
    expect(rpc).toHaveBeenLastCalledWith("catalog_note_scan_proposal", {
      p_image_id: "img-1",
      p_user_id: "user-1",
      p_wine_id: "cw-1",
      p_ai: null,
      p_year: null,
      p_source: "text",
    });
    await noteScanRead({
      ...read,
      proposal: { kind: "catalog", wineId: "cw-1", year: 2018 },
      source: "vision",
    });
    expect(rpc.mock.lastCall?.[1]).not.toHaveProperty("p_source");
  });

  it("no proposal is noted when the reading itself was refused", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42501" } });
    await noteScanRead({ ...read, proposal: { kind: "catalog", wineId: "cw-1", year: 2018 } });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
