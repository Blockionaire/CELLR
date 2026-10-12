import { describe, expect, it } from "vitest";
import type { HouseholdDetail, Me } from "@cellr/domain";
import { createAccountService, type AccountDeps } from "./service";

const member = (userId: string, role: "owner" | "member") => ({
  userId,
  displayName: userId,
  role,
  joinedAt: "2026-01-01T00:00:00Z",
  isYou: userId === "me",
});

function setup(
  households: Array<{
    id: string;
    name: string;
    role: "owner" | "member";
    members: Array<["owner" | "member", string]>;
  }>,
  options: { canDelete?: boolean; deleteWorks?: boolean; email?: string | null } = {},
) {
  const log: string[] = [];
  const deps: AccountDeps = {
    userId: "me",
    email: options.email === undefined ? "joost@example.com" : options.email,
    me: async () =>
      ({
        households: households.map((h) => ({
          id: h.id,
          name: h.name,
          currency: "EUR",
          role: h.role,
          memberCount: h.members.length,
        })),
      }) as unknown as Me,
    household: async (id) => {
      const h = households.find((x) => x.id === id)!;
      return {
        id,
        name: h.name,
        members: h.members.map(([role, userId]) => member(userId, role)),
      } as unknown as HouseholdDetail;
    },
    purgePhotos: async (id) => void log.push(`purge ${id}`),
    deleteHousehold: async (id) => void log.push(`delete ${id}`),
    leaveHousehold: async (id) => void log.push(`leave ${id}`),
    canDelete: () => options.canDelete ?? true,
    deleteUser: async (id) => {
      log.push(`user ${id}`);
      return options.deleteWorks ?? true;
    },
  };
  return { service: createAccountService(deps), log };
}

describe("deleting your account", () => {
  it("takes a household only you were in with you, photos first, then leaves the others, then the sign-in", async () => {
    const { service, log } = setup([
      { id: "alone", name: "Mine", role: "owner", members: [["owner", "me"]] },
      {
        id: "shared",
        name: "Ours",
        role: "member",
        members: [
          ["owner", "other"],
          ["member", "me"],
        ],
      },
      {
        id: "co-owned",
        name: "Theirs",
        role: "owner",
        members: [
          ["owner", "me"],
          ["owner", "other"],
        ],
      },
    ]);
    await service.delete("joost@example.com");
    expect(log).toEqual([
      "purge alone",
      "delete alone",
      "leave shared",
      "leave co-owned",
      "user me",
    ]);
  });

  it("asks for your own email, any way you type it", async () => {
    const { service } = setup([]);
    await expect(service.delete("someone@else.com")).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(service.delete("")).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(service.delete("  Joost@Example.COM ")).resolves.toBeUndefined();
    await expect(setup([], { email: null }).service.delete("anything")).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });

  it("will not leave a household with other people and nobody in charge", async () => {
    const { service, log } = setup([
      { id: "alone", name: "Mine", role: "owner", members: [["owner", "me"]] },
      {
        id: "busy",
        name: "Busy House",
        role: "owner",
        members: [
          ["owner", "me"],
          ["member", "other"],
        ],
      },
    ]);
    await expect(service.delete("joost@example.com")).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining("Busy House"),
    });
    // Nothing at all was touched, not even the household that could have gone.
    expect(log).toEqual([]);
  });

  it("does nothing when this app has no way to delete a sign-in", async () => {
    const { service, log } = setup(
      [{ id: "alone", name: "Mine", role: "owner", members: [["owner", "me"]] }],
      { canDelete: false },
    );
    await expect(service.delete("joost@example.com")).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(log).toEqual([]);
  });

  it("says so when the last step fails, so it can be tried again", async () => {
    const { service } = setup([], { deleteWorks: false });
    await expect(service.delete("joost@example.com")).rejects.toMatchObject({ code: "INTERNAL" });
  });
});
