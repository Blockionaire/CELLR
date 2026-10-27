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
});
