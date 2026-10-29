import "server-only";
import type { HouseholdRole } from "@cellr/domain";

export interface HouseholdRow {
  id: string;
  name: string;
  currency: string;
}

export interface MemberRow {
  householdId: string;
  userId: string;
  role: HouseholdRole;
  joinedAt: string;
}

export interface ProfileRow {
  id: string;
  displayName: string | null;
  locale: string;
  activeHouseholdId: string | null;
  /** The profile photo in the private `user-avatars` bucket (`{userId}/…`), or null. */
  avatarPath?: string | null;
}

export interface ProfilePatch {
  displayName?: string;
  locale?: string;
  activeHouseholdId?: string | null;
}

/**
 * Data access for households. Every call runs AS the signed-in user, so row-level security is the
 * final authority: a call that policy forbids returns no rows (or throws FORBIDDEN), it never leaks.
 */
export interface HouseholdRepository {
  getProfile(userId: string): Promise<ProfileRow | null>;
  updateProfile(userId: string, patch: ProfilePatch): Promise<ProfileRow | null>;
  /** The caller's households (RLS filters to memberships). */
  listHouseholds(): Promise<HouseholdRow[]>;
  /** Members of the given households (RLS: only households the caller belongs to). */
  listMembers(householdIds: string[]): Promise<MemberRow[]>;
  getDisplayNames(userIds: string[]): Promise<Map<string, string | null>>;
  /** Their profile photos' paths (RLS: yourself and people you share a household with). */
  getAvatarPaths(userIds: string[]): Promise<Map<string, string | null>>;
  createHousehold(name: string, currency: string): Promise<string>;
  updateHousehold(
    id: string,
    patch: { name?: string; currency?: string },
  ): Promise<HouseholdRow | null>;
  deleteHousehold(id: string): Promise<boolean>;
  createInvite(householdId: string, ttlHours: number, maxUses: number): Promise<string>;
  /** Returns the household id, or null for an unknown / expired / used-up code. */
  joinHousehold(code: string): Promise<string | null>;
  removeMember(householdId: string, userId: string): Promise<boolean>;
}
