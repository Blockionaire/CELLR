import { describe, expect, it, vi } from "vitest";
import { parseAdminAllowlist } from "@cellr/domain";
import { assertAdmin, verifyAdmin, type AdminCheckDeps } from "./access";

vi.mock("server-only", () => ({}));

const ADMIN = "0b6f2c1e-6a1d-4f7e-9a3b-2c4d5e6f7a8b";
const OTHER = "1c7a3d2f-7b2e-4a8f-8b4c-3d5e6f7a8b9c";

const deps = (over: Partial<AdminCheckDeps> = {}): AdminCheckDeps => ({
  session: async () => ({ userId: ADMIN }),
  confirm: async () => ADMIN,
  allowlist: () => parseAdminAllowlist(ADMIN),
  ...over,
});

describe("the admin check", () => {
  it("admits a verified session on the allowlist, confirmed by the auth server", async () => {
    const s = await verifyAdmin(deps());
    expect(s).toEqual({ userId: ADMIN });
    expect(() => assertAdmin(s)).not.toThrow();
  });

  it("anonymous: no", async () => {
    expect(await verifyAdmin(deps({ session: async () => null }))).toBeNull();
  });

  it("a signed-in non-admin: no, and the auth server is not even asked", async () => {
    const confirm = vi.fn(async () => OTHER);
    expect(
      await verifyAdmin(deps({ session: async () => ({ userId: OTHER }), confirm })),
    ).toBeNull();
    expect(confirm).not.toHaveBeenCalled();
  });

  it("a token the auth server does not confirm (deleted user, another id): no", async () => {
    expect(await verifyAdmin(deps({ confirm: async () => null }))).toBeNull();
    expect(await verifyAdmin(deps({ confirm: async () => OTHER }))).toBeNull();
    expect(
      await verifyAdmin(
        deps({
          confirm: async () => {
            throw new Error("auth down");
          },
        }),
      ),
    ).toBeNull();
  });

  it("fails closed with an empty, missing or malformed allowlist", async () => {
    for (const raw of [undefined, "", `${ADMIN},oops`, "admin@cellr.app"])
      expect(await verifyAdmin(deps({ allowlist: () => parseAdminAllowlist(raw) }))).toBeNull();
    expect(
      await verifyAdmin(
        deps({
          allowlist: () => {
            throw new Error("env unreadable");
          },
        }),
      ),
    ).toBeNull();
  });

  it("an email, a role or a look-alike id is never an admin id", async () => {
    for (const userId of ["admin@cellr.app", "service_role", ADMIN.toUpperCase() + "x", ""])
      expect(await verifyAdmin(deps({ session: async () => ({ userId }) }))).toBeNull();
  });

  it("a hand-made session object does not pass the second lock", () => {
    expect(() => assertAdmin({ userId: ADMIN })).toThrow("admin session required");
    expect(() => assertAdmin(null)).toThrow();
  });
});
