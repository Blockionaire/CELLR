import { describe, expect, it, vi } from "vitest";
import { parseAdminAllowlist } from "@cellr/domain";
import { verifyAdmin } from "@/server/admin/access";

vi.mock("server-only", () => ({}));
const rpc = vi.fn(async () => ({ data: [], error: null }) as { data: unknown; error: unknown });
vi.mock("./client", () => ({ createServiceClient: () => ({ rpc }) }));

const { readUserDirectory, readAiCosts, readActivity } = await import("./admin");
const ADMIN = "0b6f2c1e-6a1d-4f7e-9a3b-2c4d5e6f7a8b";

describe("privileged admin reads", () => {
  it("refuse to run without a real admin session: the database is never asked", async () => {
    rpc.mockClear();
    const forged = { userId: ADMIN };
    await expect(readUserDirectory(forged, 1, 25)).rejects.toThrow("admin session required");
    await expect(readAiCosts(forged, new Date(0), new Date())).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("with one, ask for one bounded page and window", async () => {
    const s = (await verifyAdmin({
      session: async () => ({ userId: ADMIN }),
      confirm: async () => ADMIN,
      allowlist: () => parseAdminAllowlist(ADMIN),
    }))!;
    rpc.mockClear();
    await readUserDirectory(s, 3, 25);
    expect(rpc).toHaveBeenCalledWith("admin_user_directory", { p_limit: 25, p_offset: 50 });
    rpc.mockResolvedValueOnce({ data: null, error: { code: "PGRST202" } });
    expect(await readActivity(s, 7, new Date())).toBe("missing");
  });
});
