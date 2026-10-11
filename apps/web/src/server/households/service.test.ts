import { describe, expect, it } from "vitest";
import { DomainError } from "@cellr/domain";
import { assembleSummaries, createHouseholdService } from "./service";
import type { HouseholdRepository, HouseholdRow, MemberRow, ProfileRow } from "./types";

/** In-memory repository that behaves like RLS for one signed-in user. */
function fakeRepo(
  me: string,
  seed: { households?: HouseholdRow[]; members?: MemberRow[]; profiles?: ProfileRow[] } = {},
) {
  const state = {
    households: [...(seed.households ?? [])],
    members: [...(seed.members ?? [])],
    profiles: [
      ...(seed.profiles ?? [{ id: me, displayName: null, locale: "en", activeHouseholdId: null }]),
    ],
    invites: new Map<string, string>(),
    calls: [] as string[],
  };
  const myIds = () => state.members.filter((m) => m.userId === me).map((m) => m.householdId);
  let n = 0;
  const repo: HouseholdRepository = {
    async getProfile(id) {
      return state.profiles.find((p) => p.id === id) ?? null;
    },
    async updateProfile(id, patch) {
      state.calls.push("updateProfile");
      const p = state.profiles.find((x) => x.id === id);
      if (!p) return null;
      Object.assign(p, patch);
      return p;
    },
    async listHouseholds() {
      return state.households.filter((h) => myIds().includes(h.id));
    },
    async listMembers(ids) {
      return state.members.filter(
        (m) => ids.includes(m.householdId) && myIds().includes(m.householdId),
      );
    },
    async getDisplayNames(ids) {
      return new Map(
        ids.map((id) => [id, state.profiles.find((p) => p.id === id)?.displayName ?? null]),
      );
    },
    async createHousehold(name, currency) {
      const id = `h${++n}`;
      state.households.push({ id, name, currency });
      state.members.push({
        householdId: id,
        userId: me,
        role: "owner",
        joinedAt: "2026-01-01T00:00:00Z",
      });
      return id;
    },
    async updateHousehold(id, patch) {
      state.calls.push("updateHousehold");
      const h = state.households.find((x) => x.id === id);
      if (!h) return null;
      Object.assign(h, patch);
      return h;
    },
    async deleteHousehold(id) {
      state.calls.push("deleteHousehold");
      const before = state.households.length;
      state.households = state.households.filter((h) => h.id !== id);
      return state.households.length < before;
    },
    async createInvite(hid) {
      state.calls.push("createInvite");
      state.invites.set("abcdef012345", hid);
      return "abcdef012345";
    },
    async joinHousehold(code) {
      const hid = state.invites.get(code);
      if (!hid) return null;
      state.members.push({
        householdId: hid,
        userId: me,
        role: "member",
        joinedAt: "2026-02-01T00:00:00Z",
      });
      return hid;
    },
    async removeMember(hid, uid) {
      state.calls.push("removeMember");
      const before = state.members.length;
      state.members = state.members.filter((m) => !(m.householdId === hid && m.userId === uid));
      return state.members.length < before;
    },
  };
  return { repo, state };
}

const H1: HouseholdRow = { id: "h1", name: "Alice & Bob", currency: "EUR" };
const member = (
  householdId: string,
  userId: string,
  role: "owner" | "member",
  joinedAt = "2026-01-01T00:00:00Z",
): MemberRow => ({ householdId, userId, role, joinedAt });

describe("assembleSummaries", () => {
  it("shows the caller's role and counts members", () => {
    const out = assembleSummaries(
      [H1],
      [member("h1", "me", "member"), member("h1", "other", "owner")],
      "me",
    );
    expect(out).toEqual([
      { id: "h1", name: "Alice & Bob", currency: "EUR", role: "member", memberCount: 2 },
    ]);
  });
  it("never invents a role for a household the caller is not in", () => {
    expect(assembleSummaries([H1], [member("h1", "other", "owner")], "me")).toEqual([]);
  });
});

describe("household service", () => {
  const deps = (userId = "me") => ({
    userId,
    email: "me@example.test",
    now: () => new Date("2026-03-01T12:00:00Z"),
  });

  it("creating a household makes the caller its owner and returns the summary", async () => {
    const { repo } = fakeRepo("me");
    const svc = createHouseholdService(repo, deps());
    const h = await svc.createHousehold({ name: "Joost & Merel", currency: "EUR" });
    expect(h).toMatchObject({ name: "Joost & Merel", role: "owner", memberCount: 1 });
  });

  it("me() reports profile, households and a valid active household", async () => {
    const { repo } = fakeRepo("me", {
      households: [H1],
      members: [member("h1", "me", "owner")],
      profiles: [{ id: "me", displayName: "Joost", locale: "nl", activeHouseholdId: "h1" }],
    });
    const me = await createHouseholdService(repo, deps()).me();
    expect(me).toMatchObject({
      userId: "me",
      email: "me@example.test",
      displayName: "Joost",
      locale: "nl",
      activeHouseholdId: "h1",
    });
    expect(me.households).toHaveLength(1);
  });

  it("me() ignores an active household the caller no longer belongs to", async () => {
    const { repo } = fakeRepo("me", {
      profiles: [{ id: "me", displayName: "J", locale: "en", activeHouseholdId: "gone" }],
    });
    expect((await createHouseholdService(repo, deps()).me()).activeHouseholdId).toBeNull();
  });

  it("getHousehold lists owners first and flags the caller", async () => {
    const { repo } = fakeRepo("me", {
      households: [H1],
      members: [
        member("h1", "z-member", "member", "2026-01-01T00:00:00Z"),
        member("h1", "me", "owner", "2026-01-02T00:00:00Z"),
      ],
      profiles: [{ id: "me", displayName: "Joost", locale: "en", activeHouseholdId: null }],
    });
    const detail = await createHouseholdService(repo, deps()).getHousehold("h1");
    expect(detail.members.map((m) => [m.userId, m.role, m.isYou])).toEqual([
      ["me", "owner", true],
      ["z-member", "member", false],
    ]);
    expect(detail.members[0]?.displayName).toBe("Joost");
  });

  it("someone else's household is simply 'not found' (no existence leak)", async () => {
    const { repo } = fakeRepo("me", {
      households: [H1],
      members: [member("h1", "other", "owner")],
    });
    await expect(createHouseholdService(repo, deps()).getHousehold("h1")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  describe("owner-only actions", () => {
    const setup = () =>
      fakeRepo("me", {
        households: [H1],
        members: [member("h1", "me", "member"), member("h1", "boss", "owner")],
      });

    it.each([
      [
        "rename",
        (s: ReturnType<typeof createHouseholdService>) => s.updateHousehold("h1", { name: "x" }),
      ],
      ["delete", (s: ReturnType<typeof createHouseholdService>) => s.deleteHousehold("h1")],
      [
        "invite",
        (s: ReturnType<typeof createHouseholdService>) =>
          s.createInvite("h1", { ttlHours: 24, maxUses: 1 }),
      ],
      [
        "remove another member",
        (s: ReturnType<typeof createHouseholdService>) => s.removeMember("h1", "boss"),
      ],
    ])("a plain member cannot %s — and the repository is never touched", async (_name, act) => {
      const { repo, state } = setup();
      await expect(act(createHouseholdService(repo, deps()))).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(state.calls).toEqual([]);
    });

    it("an owner can rename, invite and remove", async () => {
      const { repo, state } = fakeRepo("me", {
        households: [H1],
        members: [member("h1", "me", "owner"), member("h1", "pal", "member")],
      });
      const svc = createHouseholdService(repo, deps());
      expect((await svc.updateHousehold("h1", { name: "New name" })).name).toBe("New name");
      await svc.removeMember("h1", "pal");
      expect(state.members.map((m) => m.userId)).toEqual(["me"]);
      await svc.deleteHousehold("h1");
      expect(state.households).toEqual([]);
    });

    it("invites carry the plain code, a readable format and an expiry derived from the TTL", async () => {
      const { repo } = fakeRepo("me", { households: [H1], members: [member("h1", "me", "owner")] });
      const invite = await createHouseholdService(repo, deps()).createInvite("h1", {
        ttlHours: 24,
        maxUses: 3,
      });
      expect(invite).toEqual({
        code: "abcdef012345",
        formattedCode: "abcd-ef01-2345",
        expiresAt: "2026-03-02T12:00:00.000Z",
        maxUses: 3,
      });
    });
  });

  it("anyone may leave a household they belong to", async () => {
    const { repo, state } = fakeRepo("me", {
      households: [H1],
      members: [member("h1", "me", "member"), member("h1", "boss", "owner")],
    });
    await createHouseholdService(repo, deps()).removeMember("h1", "me");
    expect(state.members.map((m) => m.userId)).toEqual(["boss"]);
  });

  it("leaving a household you are not in is 'not found'", async () => {
    const { repo } = fakeRepo("me", { households: [H1], members: [member("h1", "boss", "owner")] });
    await expect(
      createHouseholdService(repo, deps()).removeMember("h1", "me"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  describe("joining", () => {
    it("a valid code joins and returns the household", async () => {
      const { repo, state } = fakeRepo("me", {
        households: [H1],
        members: [member("h1", "boss", "owner")],
      });
      state.invites.set("abcdef012345", "h1");
      const joined = await createHouseholdService(repo, deps()).join("abcdef012345");
      expect(joined).toMatchObject({ id: "h1", role: "member", memberCount: 2 });
    });
    it("an unknown code is INVITE_INVALID", async () => {
      const { repo } = fakeRepo("me");
      const err = await createHouseholdService(repo, deps())
        .join("000000000000")
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(DomainError);
      expect(err).toMatchObject({ code: "INVITE_INVALID" });
    });
  });

  it("setActiveHousehold requires membership", async () => {
    const { repo } = fakeRepo("me", { households: [H1], members: [member("h1", "boss", "owner")] });
    await expect(
      createHouseholdService(repo, deps()).setActiveHousehold("h1"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("setActiveHousehold switches the active household", async () => {
    const { repo } = fakeRepo("me", { households: [H1], members: [member("h1", "me", "member")] });
    expect(
      (await createHouseholdService(repo, deps()).setActiveHousehold("h1")).activeHouseholdId,
    ).toBe("h1");
  });

  it("updateProfile only sends the fields that were given", async () => {
    const { repo, state } = fakeRepo("me");
    await createHouseholdService(repo, deps()).updateProfile({ displayName: "Joost" });
    expect(state.profiles[0]).toMatchObject({ displayName: "Joost", locale: "en" });
  });
});
