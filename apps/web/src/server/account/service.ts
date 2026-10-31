import "server-only";
import { DomainError, type HouseholdDetail, type Me } from "@cellr/domain";

export interface AccountDeps {
  userId: string;
  email: string | null;
  me: () => Promise<Me>;
  household: (id: string) => Promise<HouseholdDetail>;
  /** Takes the household's photos out of storage. */
  purgePhotos: (householdId: string) => Promise<void>;
  /** Takes my profile photo out of storage. */
  purgeAvatar?: () => Promise<void>;
  deleteHousehold: (id: string) => Promise<void>;
  leaveHousehold: (id: string) => Promise<void>;
  /** False when this deployment has no way to delete a sign-in. */
  canDelete: () => boolean;
  deleteUser: (userId: string) => Promise<boolean>;
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Deleting yourself, without leaving anyone else's data in a mess: a household that only you were in goes
 * with you (photos included); one you share with others you simply leave — unless you are its only owner, in
 * which case it would be left with nobody in charge, so you are asked to sort that out first. Nothing is
 * touched until every household has been checked.
 */
export function createAccountService(deps: AccountDeps) {
  return {
    async delete(confirmEmail: string): Promise<void> {
      if (!deps.email || !same(confirmEmail, deps.email))
        throw new DomainError("VALIDATION", "Type your email address exactly to confirm.");
      if (!deps.canDelete())
        throw new DomainError("FORBIDDEN", "Deleting an account isn't switched on for this app.");

      const { households } = await deps.me();
      const alone: string[] = [];
      const leave: string[] = [];
      const stuck: string[] = [];
      for (const h of households) {
        const detail = await deps.household(h.id);
        const others = detail.members.filter((m) => m.userId !== deps.userId);
        const owners = detail.members.filter((m) => m.role === "owner");
        if (others.length === 0) alone.push(h.id);
        else if (h.role === "owner" && owners.length === 1) stuck.push(h.name);
        else leave.push(h.id);
      }
      if (stuck.length > 0)
        throw new DomainError(
          "CONFLICT",
          `You are the only owner of ${stuck.join(", ")}, which still has other people in it. Remove them or delete the household first.`,
        );

      for (const id of alone) {
        await deps.purgePhotos(id);
        await deps.deleteHousehold(id);
      }
      for (const id of leave) await deps.leaveHousehold(id);
      await deps.purgeAvatar?.();
      if (!(await deps.deleteUser(deps.userId)))
        throw new DomainError("INTERNAL", "We couldn't finish deleting your account. Try again.");
    },
  };
}

export type AccountService = ReturnType<typeof createAccountService>;
