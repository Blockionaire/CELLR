import "server-only";
import {
  avatarUrl,
  DomainError,
  formatInviteCode,
  type CreateHousehold,
  type CreateInvite,
  type HouseholdDetail,
  type HouseholdSummary,
  type InviteView,
  type Me,
  type UpdateHousehold,
  type UpdateProfile,
} from "@cellr/domain";
import type { HouseholdRepository, HouseholdRow, MemberRow } from "./types";

export interface HouseholdServiceDeps {
  userId: string;
  email: string | null;
  now?: () => Date;
  /** After a household is deleted: clean up files its rows pointed to. */
  afterDelete?: () => Promise<void>;
}

/** Joins households with their members into the caller-centric read model. Pure; unit-tested. */
export function assembleSummaries(
  households: HouseholdRow[],
  members: MemberRow[],
  userId: string,
): HouseholdSummary[] {
  const summaries: HouseholdSummary[] = [];
  for (const h of households) {
    const mine = members.find((m) => m.householdId === h.id && m.userId === userId);
    if (!mine) continue; // not a member (should not happen under RLS) — never invent a role
    summaries.push({
      id: h.id,
      name: h.name,
      currency: h.currency,
      role: mine.role,
      memberCount: members.filter((m) => m.householdId === h.id).length,
    });
  }
  return summaries;
}

export function createHouseholdService(repo: HouseholdRepository, deps: HouseholdServiceDeps) {
  const { userId, email } = deps;
  const now = deps.now ?? (() => new Date());

  async function summaries(): Promise<HouseholdSummary[]> {
    const households = await repo.listHouseholds();
    const members = await repo.listMembers(households.map((h) => h.id));
    return assembleSummaries(households, members, userId);
  }

  /** Looks the household up among the caller's own; anything else is "not found" (never leak existence). */
  async function mine(id: string): Promise<HouseholdSummary> {
    const found = (await summaries()).find((h) => h.id === id);
    if (!found) throw new DomainError("NOT_FOUND");
    return found;
  }

  async function owned(id: string): Promise<HouseholdSummary> {
    const h = await mine(id);
    if (h.role !== "owner")
      throw new DomainError("FORBIDDEN", "Only the household's owner can do that.");
    return h;
  }

  return {
    async me(): Promise<Me> {
      const [profile, households] = await Promise.all([repo.getProfile(userId), summaries()]);
      const active = profile?.activeHouseholdId ?? null;
      return {
        userId,
        email,
        displayName: profile?.displayName ?? null,
        avatarUrl: avatarUrl(userId, profile?.avatarPath ?? null),
        locale: profile?.locale ?? "en",
        activeHouseholdId: active && households.some((h) => h.id === active) ? active : null,
        households,
      };
    },

    async updateProfile(patch: UpdateProfile): Promise<Me> {
      const update: { displayName?: string; locale?: string } = {};
      if (patch.displayName !== undefined) update.displayName = patch.displayName;
      if (patch.locale !== undefined) update.locale = patch.locale;
      if (!(await repo.updateProfile(userId, update))) throw new DomainError("NOT_FOUND");
      return this.me();
    },

    listHouseholds: summaries,

    async getHousehold(id: string): Promise<HouseholdDetail> {
      const summary = await mine(id);
      const members = (await repo.listMembers([id])).filter((m) => m.householdId === id);
      const ids = members.map((m) => m.userId);
      const [names, avatars] = await Promise.all([
        repo.getDisplayNames(ids),
        repo.getAvatarPaths(ids),
      ]);
      return {
        ...summary,
        members: members
          .map((m) => ({
            userId: m.userId,
            displayName: names.get(m.userId) ?? null,
            avatarUrl: avatarUrl(m.userId, avatars.get(m.userId) ?? null),
            role: m.role,
            joinedAt: m.joinedAt,
            isYou: m.userId === userId,
          }))
          // owners first, then by who joined first
          .sort((a, b) =>
            a.role === b.role ? a.joinedAt.localeCompare(b.joinedAt) : a.role === "owner" ? -1 : 1,
          ),
      };
    },

    async createHousehold(input: CreateHousehold): Promise<HouseholdSummary> {
      const id = await repo.createHousehold(input.name, input.currency);
      return mine(id);
    },

    async updateHousehold(id: string, patch: UpdateHousehold): Promise<HouseholdSummary> {
      await owned(id);
      const update: { name?: string; currency?: string } = {};
      if (patch.name !== undefined) update.name = patch.name;
      if (patch.currency !== undefined) update.currency = patch.currency;
      if (!(await repo.updateHousehold(id, update))) throw new DomainError("NOT_FOUND");
      return mine(id);
    },

    /** Throws unless the caller owns this household (anything else is "not found"). */
    async assertOwner(id: string): Promise<void> {
      await owned(id);
    },

    async deleteHousehold(id: string): Promise<void> {
      await owned(id);
      if (!(await repo.deleteHousehold(id))) throw new DomainError("NOT_FOUND");
      // files the household's deletion left behind (its wines' 2D pictures); best effort, they are unreadable anyway
      await deps.afterDelete?.().catch(() => {});
    },

    async createInvite(id: string, input: CreateInvite): Promise<InviteView> {
      await owned(id);
      const code = await repo.createInvite(id, input.ttlHours, input.maxUses);
      return {
        code,
        formattedCode: formatInviteCode(code),
        expiresAt: new Date(now().getTime() + input.ttlHours * 3_600_000).toISOString(),
        maxUses: input.maxUses,
      };
    },

    /** Joins by invite code. Unknown, expired and used-up codes are one indistinguishable answer. */
    async join(code: string): Promise<HouseholdSummary> {
      const id = await repo.joinHousehold(code);
      if (!id) throw new DomainError("INVITE_INVALID");
      return mine(id);
    },

    /** Leave a household yourself, or (owner) remove someone else. */
    async removeMember(householdId: string, targetUserId: string): Promise<void> {
      if (targetUserId === userId) await mine(householdId);
      else await owned(householdId);
      if (!(await repo.removeMember(householdId, targetUserId))) throw new DomainError("NOT_FOUND");
    },

    async setActiveHousehold(householdId: string): Promise<Me> {
      await mine(householdId);
      if (!(await repo.updateProfile(userId, { activeHouseholdId: householdId })))
        throw new DomainError("NOT_FOUND");
      return this.me();
    },
  };
}

export type HouseholdService = ReturnType<typeof createHouseholdService>;
