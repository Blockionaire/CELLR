import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseAdminAllowlist } from "@cellr/domain";
import { verifyAdmin, type AdminSession } from "@/server/admin/access";
import { MissingDependencyError, isMissingStep, missingDependency } from "./db-errors";

vi.mock("server-only", () => ({}));
const answer = vi.fn();
vi.mock("./client", () => ({ createServiceClient: () => ({ rpc: answer }) }));
const logged = vi.fn();
vi.mock("@/server/log", () => ({ logError: (...a: unknown[]) => logged(...a), logWarn: vi.fn() }));

// the error production returned (read-only check, 2026-11-02): migration 0013 was never run
const DRINK_NOTICES = {
  code: "42P01",
  message: 'relation "public.drink_notices" does not exist',
};

describe("what a failed database call means", () => {
  it("a function or table that is not there: its migration is still to be run", () => {
    expect(isMissingStep({ code: "PGRST202", message: "Could not find the function" })).toBe(true);
    expect(isMissingStep({ code: "PGRST205" })).toBe(true);
    expect(
      isMissingStep(
        { code: "42883", message: "function public.admin_wine_master_record(uuid) does not exist" },
        "admin_wine_master_record",
      ),
    ).toBe(true);
  });
  it("something the called function uses is not there: a missing dependency, named", () => {
    expect(isMissingStep(DRINK_NOTICES, "admin_wine_master_record")).toBe(false);
    expect(missingDependency(DRINK_NOTICES, "admin_wine_master_record")).toBe(
      "public.drink_notices",
    );
    const inner = {
      code: "42883",
      message: "function private.vintage_in_use(uuid) does not exist",
    };
    expect(isMissingStep(inner, "admin_wine_master_record")).toBe(false);
    expect(missingDependency(inner, "admin_wine_master_record")).toBe("private.vintage_in_use");
  });
  it("anything else is neither", () => {
    expect(missingDependency({ code: "23505", message: "duplicate key" })).toBeNull();
    expect(isMissingStep({ code: "42501" })).toBe(false);
  });
});

describe("the Wine Master Database's reads and edits on a database without migration 0013", () => {
  let session: AdminSession;
  beforeEach(async () => {
    answer.mockReset();
    logged.mockReset();
    const id = "0b6f2c1e-6a1d-4f7e-9a3b-2c4d5e6f7a8b";
    session = (await verifyAdmin({
      session: async () => ({ userId: id }),
      confirm: async () => id,
      allowlist: () => parseAdminAllowlist(id),
    }))!;
  });

  it("opening a wine reports the missing table, logged, instead of 'run the Wine Master migration'", async () => {
    const { readWineMasterRecord } = await import("./wine-master");
    answer.mockResolvedValue({ data: null, error: DRINK_NOTICES });
    const read = readWineMasterRecord(session, "0b6f2c1e-6a1d-4f7e-9a3b-2c4d5e6f7a8b");
    await expect(read).rejects.toBeInstanceOf(MissingDependencyError);
    await expect(read).rejects.toMatchObject({
      called: "admin_wine_master_record",
      object: "public.drink_notices",
      code: "42P01",
    });
    expect(logged).toHaveBeenCalledWith(
      "db_dependency_missing",
      DRINK_NOTICES,
      expect.objectContaining({ fn: "admin_wine_master_record", object: "public.drink_notices" }),
    );
  });

  it("removing a vintage answers 'dependency', not 'missing'", async () => {
    const { deleteVintage } = await import("./wine-master");
    answer.mockResolvedValue({ data: null, error: DRINK_NOTICES });
    expect(await deleteVintage(session, "0b6f2c1e-6a1d-4f7e-9a3b-2c4d5e6f7a8b", "x")).toBe(
      "dependency",
    );
  });

  it("a Wine Master function that is not there is still 'missing' (run its migration)", async () => {
    const { readWineMasterRecord } = await import("./wine-master");
    answer.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "not found" } });
    expect(await readWineMasterRecord(session, "0b6f2c1e-6a1d-4f7e-9a3b-2c4d5e6f7a8b")).toBe(
      "missing",
    );
    expect(logged).not.toHaveBeenCalled();
  });
});
