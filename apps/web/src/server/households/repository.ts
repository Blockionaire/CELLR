import "server-only";
import { type HouseholdRole } from "@cellr/domain";
import type { Db } from "@/server/db/clients";
import type { Database } from "@/server/db/database.types";
import { mapDbError } from "@/server/db/errors";
import type {
  HouseholdRepository,
  HouseholdRow,
  MemberRow,
  ProfilePatch,
  ProfileRow,
} from "./types";

type Tables = Database["public"]["Tables"];

// ---- Pure row mappers (unit-tested) ---------------------------------------------------------------
export const toHousehold = (
  r: Pick<Tables["households"]["Row"], "id" | "name" | "currency">,
): HouseholdRow => ({
  id: r.id,
  name: r.name,
  currency: r.currency,
});

export const toMember = (r: Tables["household_members"]["Row"]): MemberRow => ({
  householdId: r.household_id,
  userId: r.user_id,
  role: r.role as HouseholdRole,
  joinedAt: r.joined_at,
});

export const toProfile = (
  r: Pick<Tables["profiles"]["Row"], "id" | "display_name" | "locale" | "active_household_id">,
): ProfileRow => ({
  id: r.id,
  displayName: r.display_name,
  locale: r.locale,
  activeHouseholdId: r.active_household_id,
});

const PROFILE_COLUMNS = "id, display_name, locale, active_household_id";
const HOUSEHOLD_COLUMNS = "id, name, currency";

export function createHouseholdRepository(db: Db): HouseholdRepository {
  return {
    async getProfile(userId) {
      const { data, error } = await db
        .from("profiles")
        .select(PROFILE_COLUMNS)
        .eq("id", userId)
        .maybeSingle();
      if (error) throw mapDbError(error);
      return data ? toProfile(data) : null;
    },

    async updateProfile(userId, patch: ProfilePatch) {
      const update: Tables["profiles"]["Update"] = {};
      if (patch.displayName !== undefined) update.display_name = patch.displayName;
      if (patch.locale !== undefined) update.locale = patch.locale;
      if (patch.activeHouseholdId !== undefined)
        update.active_household_id = patch.activeHouseholdId;
      const { data, error } = await db
        .from("profiles")
        .update(update)
        .eq("id", userId)
        .select(PROFILE_COLUMNS)
        .maybeSingle();
      if (error) throw mapDbError(error);
      return data ? toProfile(data) : null;
    },

    async listHouseholds() {
      const { data, error } = await db
        .from("households")
        .select(HOUSEHOLD_COLUMNS)
        .order("created_at", { ascending: true });
      if (error) throw mapDbError(error);
      return (data ?? []).map(toHousehold);
    },

    async listMembers(householdIds) {
      if (householdIds.length === 0) return [];
      const { data, error } = await db
        .from("household_members")
        .select("*")
        .in("household_id", householdIds);
      if (error) throw mapDbError(error);
      return (data ?? []).map(toMember);
    },

    async getDisplayNames(userIds) {
      const names = new Map<string, string | null>();
      if (userIds.length === 0) return names;
      // RLS lets you read your own profile and those of people you share a household with.
      const { data, error } = await db
        .from("profiles")
        .select("id, display_name")
        .in("id", userIds);
      if (error) throw mapDbError(error);
      for (const row of data ?? []) names.set(row.id, row.display_name);
      return names;
    },

    async createHousehold(name, currency) {
      const { data, error } = await db.rpc("create_household", {
        p_name: name,
        p_currency: currency,
      });
      if (error) throw mapDbError(error);
      return data;
    },

    async updateHousehold(id, patch) {
      const update: Tables["households"]["Update"] = {};
      if (patch.name !== undefined) update.name = patch.name;
      if (patch.currency !== undefined) update.currency = patch.currency;
      const { data, error } = await db
        .from("households")
        .update(update)
        .eq("id", id)
        .select(HOUSEHOLD_COLUMNS)
        .maybeSingle();
      if (error) throw mapDbError(error);
      return data ? toHousehold(data) : null;
    },

    async deleteHousehold(id) {
      const { data, error } = await db.from("households").delete().eq("id", id).select("id");
      if (error) throw mapDbError(error);
      return (data?.length ?? 0) > 0;
    },

    async createInvite(householdId, ttlHours, maxUses) {
      const { data, error } = await db.rpc("create_invite", {
        p_household: householdId,
        p_ttl_hours: ttlHours,
        p_max_uses: maxUses,
      });
      if (error) throw mapDbError(error);
      return data;
    },

    async joinHousehold(code) {
      const { data, error } = await db.rpc("join_household", { p_code: code });
      if (error) throw mapDbError(error);
      // The database returns NULL for an unknown/expired/used-up code; the generated type cannot say so.
      return (data as string | null) ?? null;
    },

    async removeMember(householdId, userId) {
      const { data, error } = await db
        .from("household_members")
        .delete()
        .eq("household_id", householdId)
        .eq("user_id", userId)
        .select("user_id");
      if (error) throw mapDbError(error);
      return (data?.length ?? 0) > 0;
    },
  };
}
