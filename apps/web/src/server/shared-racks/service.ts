import "server-only";
import {
  DEPTH_PLACEMENT_ENABLED,
  DomainError,
  SHARED_RACKS_API_VERSION,
  STALE_LAYOUT_MESSAGE,
  STORAGE_TEMPLATES,
  checkSlot,
  placementProblem,
  resolveSharedRack,
  toSharedRackView,
  type MySharedRackBottleView,
  type MySharedRackInvitationView,
  type PlacementProblem,
  type SharedRackBottlesView,
  type SharedRackCreate,
  type SharedRackEventsQuery,
  type SharedRackEventsView,
  type SharedRackInvitationView,
  type SharedRackLayout,
  type SharedRackMemberView,
  type SharedRackMove,
  type SharedRackMoveResult,
  type SharedRackPlace,
  type SharedRackPlaceResult,
  type SharedRackRole,
  type SharedRackSpot,
  type SharedRackTakeOut,
  type SharedRackView,
} from "@cellr/domain";
import type { SharedRacksAccess } from "@/lib/shared-racks-gate";
import type { RackLayoutWrite, SharedRacksRepository } from "./types";

/** The words of every refusal (each has an English and a Dutch translation, lib/known-messages.ts). */
export const SHARED_RACK_MESSAGES = {
  closed: "Changing shared racks isn't switched on here yet.",
  rackNotFound: "We couldn't find that shared rack.",
  ownerOnly: "Only an owner of this rack can do that.",
  archived: "This rack is archived. Restore it first.",
  tooMany: "You're in as many shared racks as there can be. Leave or archive one first.",
  depth: "More than one bottle per position isn't switched on yet.",
  inUse: "There are still bottles in the part you're removing. Move them first.",
  semantics: "There are still bottles in it. Move them out first.",
  inviteSelf: "You can't invite yourself.",
  personNotFound: "We couldn't find that person.",
  alreadyMember: "They're already in this rack.",
  recentlyDeclined: "They declined a little while ago. Try again later.",
  full: "This rack is full.",
  tooManyInvitations: "There are too many open invitations. Cancel one first.",
  invitationNotFound: "That invitation is no longer there.",
  invitationExpired: "That invitation has expired. Ask for a new one.",
  invitationClosed: "That invitation is no longer open.",
  alreadyAccepted: "You already accepted that invitation. Leave the rack instead.",
  notMember: "They're not in this rack.",
  needsOwner: "A rack needs an owner. Make someone else an owner first.",
  removeSelf: "To leave a rack yourself, use Leave.",
  lastOwner: "You're the last owner. Make someone else an owner first, or archive the rack.",
  taken: "That spot was just taken. Pick another.",
  stale: "That bottle was moved by someone else. Nothing was changed.",
  gone: "That bottle is no longer in this rack.",
  outOfBounds: "That spot doesn't exist in this place.",
  unknownArrangement:
    "CELLR doesn't know how that place is arranged, so it can't put a bottle there.",
  behind: "Another bottle is in front of that spot.",
  compartmentFull: "That compartment is full.",
  bottleNotFound: "We couldn't find that bottle.",
  bottleUnavailable: "That bottle is no longer in the cellar.",
  alreadyPlaced: "That bottle is already in a shared rack. Take it out first.",
  notPlaced: "That bottle isn't in a shared rack.",
} as const;

const M = SHARED_RACK_MESSAGES;

/** The refusals every write to a rack shares. `not_found` is also what a non-member gets: never 403 for them. */
function refuse(outcome: "not_found" | "forbidden" | "archived"): DomainError {
  switch (outcome) {
    case "not_found":
      return new DomainError("NOT_FOUND", M.rackNotFound);
    case "forbidden":
      return new DomainError("FORBIDDEN", M.ownerOnly);
    case "archived":
      return new DomainError("CONFLICT", M.archived);
  }
}

const SPOT_REFUSAL: Record<PlacementProblem, () => DomainError> = {
  unknown_arrangement: () => new DomainError("CONFLICT", M.unknownArrangement),
  out_of_bounds: () => new DomainError("VALIDATION", M.outOfBounds),
  depth_not_enabled: () => new DomainError("CONFLICT", M.depth),
  occupied: () => new DomainError("CONFLICT", M.taken, { retryable: true }),
  behind_taken: () => new DomainError("CONFLICT", M.behind),
  compartment_full: () => new DomainError("CONFLICT", M.compartmentFull),
  // a move onto the spot the bottle is on: the database answers that one ("already there", or stale)
  same_spot: () => new DomainError("CONFLICT", M.stale),
};

/** The layout as the database takes it: the template decides the kind and what an index means, never the request. */
function layoutWrite(layout: SharedRackLayout): RackLayoutWrite {
  const template = STORAGE_TEMPLATES[layout.structure.template];
  return {
    kind: template.kind,
    template: template.id,
    semantics: template.semantics,
    rows: layout.structure.rows,
    cols: layout.structure.cols,
    cellCapacity: layout.structure.cellCapacity,
    appearance: layout.appearance,
  };
}

export interface SharedRacksDeps {
  repo: SharedRacksRepository;
  /** Whether this deployment answers and writes (lib/shared-racks-gate.ts). */
  access: SharedRacksAccess;
}

/**
 * The Shared Racks API (ADR-010). Everything is done AS the signed-in person by one function of the database each,
 * which takes the person from the session and checks their membership itself: this service passes no identity, and
 * decides nothing about who may do what. It translates: requests into the database's arguments, the database's
 * answers into views and plain refusals.
 *
 * Anything the person is not a member of is "not found" (404), never "forbidden": an id says nothing about what
 * exists. 403 is only for a member who is not an owner, and for a deployment that reads but does not write.
 */
export function createSharedRacksService({ repo, access }: SharedRacksDeps) {
  /** Closed is "there is no such thing here": the same answer as a route that does not exist. */
  const requireOpen = () => {
    if (!access.open) throw new DomainError("NOT_FOUND");
  };
  const requireWrites = () => {
    requireOpen();
    if (!access.writes) throw new DomainError("FORBIDDEN", M.closed);
  };
  const view = async (id: string): Promise<SharedRackView> => {
    const stored = await repo.getRack(id);
    if (!stored) throw new DomainError("NOT_FOUND", M.rackNotFound);
    return toSharedRackView(stored);
  };

  /**
   * The rules of the place for a target spot, checked before the database is asked so a person is told plainly: its
   * arrangement must be known, the spot must be one of its, and not past index 1 while depth is off. Whether the
   * spot is free is the database's to say (it is asked next, behind the rack's lock). Only a rack more than one
   * deep needs the bottles read first (a spot behind a taken front).
   */
  const checkTarget = async (
    rack: SharedRackView,
    to: SharedRackSpot,
    movingPlacementId: string | null,
  ): Promise<void> => {
    const resolved = resolveSharedRack(rack);
    if (!resolved.arrangementKnown) throw SPOT_REFUSAL.unknown_arrangement();
    if (checkSlot(resolved.layout, to) !== null) throw SPOT_REFUSAL.out_of_bounds();
    if (to.index > 1 && !DEPTH_PLACEMENT_ENABLED) throw SPOT_REFUSAL.depth_not_enabled();
    if (rack.cellCapacity <= 1) return;
    const occupants = (await repo.bottles(rack.id)).map((b) => ({
      bottleId: b.placementId,
      row: b.row,
      col: b.col,
      index: b.index,
    }));
    const problem = placementProblem(resolved, occupants, to, {
      movingId: movingPlacementId,
      depthEnabled: DEPTH_PLACEMENT_ENABLED,
    });
    if (problem && problem !== "same_spot") throw SPOT_REFUSAL[problem]();
  };

  return {
    /** Refuses before a request's body is read where this deployment is closed (404). */
    guard(): void {
      requireOpen();
    },
    /** ...or does not write (403): a closed API says nothing about a request, not even whether it was well formed. */
    guardWrites(): void {
      requireWrites();
    },

    /** My racks, and what this server offers. */
    async list(includeArchived = false): Promise<{
      version: typeof SHARED_RACKS_API_VERSION;
      writes: boolean;
      depthPlacement: boolean;
      racks: SharedRackView[];
    }> {
      requireOpen();
      return {
        version: SHARED_RACKS_API_VERSION,
        writes: access.writes,
        depthPlacement: DEPTH_PLACEMENT_ENABLED,
        racks: (await repo.listRacks(includeArchived)).map(toSharedRackView),
      };
    },

    async rack(id: string): Promise<SharedRackView> {
      requireOpen();
      return view(id);
    },

    async create(input: SharedRackCreate): Promise<SharedRackView> {
      requireWrites();
      const made = await repo.create(
        input.name,
        layoutWrite({ structure: input.structure, appearance: input.appearance }),
      );
      if (made.outcome !== "created")
        throw new DomainError("CONFLICT", made.outcome === "too_many" ? M.tooMany : M.depth);
      return view(made.rackId);
    },

    async rename(id: string, name: string): Promise<SharedRackView> {
      requireWrites();
      const outcome = await repo.rename(id, name);
      if (outcome !== "renamed" && outcome !== "unchanged") throw refuse(outcome);
      return view(id);
    },

    /**
     * Replaces the rack's whole layout and look in ONE database call, or changes nothing. `expectedRevision`
     * (If-Match) is compared by the database inside that transaction, behind the rack's lock: of two saves from the
     * same version, exactly one is applied.
     */
    async saveLayout(
      id: string,
      layout: SharedRackLayout,
      expectedRevision: string | null = null,
    ): Promise<SharedRackView> {
      requireWrites();
      // a revision is a whole number; anything else names no version this rack ever had
      if (expectedRevision !== null && !/^\d{1,15}$/.test(expectedRevision))
        throw new DomainError("CONFLICT", STALE_LAYOUT_MESSAGE);
      const { outcome } = await repo.saveLayout(id, layoutWrite(layout), expectedRevision);
      switch (outcome) {
        case "saved":
          return view(id);
        case "stale":
          throw new DomainError("CONFLICT", STALE_LAYOUT_MESSAGE);
        case "in_use":
          throw new DomainError("CONFLICT", M.inUse);
        case "semantics_change":
          throw new DomainError("CONFLICT", M.semantics);
        case "depth_not_enabled":
          throw new DomainError("CONFLICT", M.depth);
        default:
          throw refuse(outcome);
      }
    },

    /** Archived: read-only, except that bottles can still be taken out. Restoring puts it back as it was. */
    async setArchived(id: string, archived: boolean): Promise<SharedRackView> {
      requireWrites();
      const outcome = await repo.setArchived(id, archived);
      if (outcome === "not_found" || outcome === "forbidden") throw refuse(outcome);
      return view(id);
    },

    async members(id: string): Promise<{ members: SharedRackMemberView[] }> {
      requireOpen();
      const [, members] = await Promise.all([view(id), repo.members(id)]);
      return { members };
    },

    /** The owner role moves only like this: explicitly, by an owner, and never away from the last one. */
    async setRole(
      id: string,
      userId: string,
      role: SharedRackRole,
    ): Promise<{ userId: string; role: SharedRackRole }> {
      requireWrites();
      const outcome = await repo.setRole(id, userId, role);
      switch (outcome) {
        case "changed":
        case "unchanged":
          return { userId, role };
        case "no_such_member":
          throw new DomainError("NOT_FOUND", M.notMember);
        case "last_owner":
          throw new DomainError("CONFLICT", M.needsOwner);
        default:
          throw refuse(outcome);
      }
    },

    /** Their access ends at once. Their bottles stay theirs, and stay where they stand until someone takes them out. */
    async removeMember(id: string, userId: string): Promise<void> {
      requireWrites();
      const outcome = await repo.removeMember(id, userId);
      switch (outcome) {
        case "removed":
          return;
        case "invalid":
          throw new DomainError("VALIDATION", M.removeSelf);
        case "no_such_member":
          throw new DomainError("NOT_FOUND", M.notMember);
        default:
          throw refuse(outcome);
      }
    },

    async leave(id: string): Promise<void> {
      requireWrites();
      const outcome = await repo.leave(id);
      if (outcome === "last_owner") throw new DomainError("CONFLICT", M.lastOwner);
      if (outcome === "not_found") throw refuse(outcome);
    },

    /** The rack's invitations: owners only (a member is told so, anyone else that there is no such rack). */
    async invitations(id: string): Promise<{ invitations: SharedRackInvitationView[] }> {
      requireOpen();
      const rack = await view(id);
      if (rack.role !== "owner") throw refuse("forbidden");
      return { invitations: await repo.rackInvitations(id) };
    },

    /** Invites one existing person by id (the id comes from the existing exact search; there is no other lookup). */
    async invite(
      id: string,
      userId: string,
    ): Promise<{ invitationId: string; outcome: "invited" | "already_invited" }> {
      requireWrites();
      const answer = await repo.invite(id, userId);
      switch (answer.outcome) {
        case "invited":
        case "already_invited":
          return { invitationId: answer.invitationId, outcome: answer.outcome };
        case "invalid":
          throw new DomainError("VALIDATION", M.inviteSelf);
        case "no_such_user":
          throw new DomainError("NOT_FOUND", M.personNotFound);
        case "already_member":
          throw new DomainError("CONFLICT", M.alreadyMember);
        case "recently_declined":
          throw new DomainError("CONFLICT", M.recentlyDeclined);
        case "full":
          throw new DomainError("CONFLICT", M.full);
        case "too_many":
          throw new DomainError("CONFLICT", M.tooManyInvitations);
        default:
          throw refuse(answer.outcome);
      }
    },

    async myInvitations(): Promise<{ invitations: MySharedRackInvitationView[] }> {
      requireOpen();
      return { invitations: await repo.myInvitations() };
    },

    /**
     * Yes or no to an invitation sent to me. Accepting again after it was accepted answers the same (a repeat whose
     * first answer was lost); an invitation that is spent never lets someone back in who was removed since.
     */
    async respond(
      invitationId: string,
      accept: boolean,
    ): Promise<{ outcome: "accepted" | "declined"; rackId: string | null }> {
      requireWrites();
      const answer = await repo.respond(invitationId, accept);
      switch (answer.outcome) {
        case "accepted":
          return { outcome: "accepted", rackId: answer.rackId };
        case "declined":
          return { outcome: "declined", rackId: null };
        case "already_accepted":
          if (accept) return { outcome: "accepted", rackId: answer.rackId };
          throw new DomainError("CONFLICT", M.alreadyAccepted);
        case "not_found":
          throw new DomainError("NOT_FOUND", M.invitationNotFound);
        case "expired":
          throw new DomainError("CONFLICT", M.invitationExpired);
        case "archived":
          throw new DomainError("CONFLICT", M.invitationClosed);
        case "full":
          throw new DomainError("CONFLICT", M.full);
        case "already_declined":
        case "already_cancelled":
          throw new DomainError("CONFLICT", M.invitationClosed);
      }
    },

    async cancelInvitation(invitationId: string): Promise<void> {
      requireWrites();
      const outcome = await repo.cancelInvitation(invitationId);
      switch (outcome) {
        case "cancelled":
          return;
        case "not_found":
          throw new DomainError("NOT_FOUND", M.invitationNotFound);
        case "forbidden":
          throw refuse(outcome);
        default:
          throw new DomainError("CONFLICT", M.invitationClosed);
      }
    },

    /** The rack and every bottle in it as every member sees them (the projection), optionally one owner's. */
    async bottles(id: string, owner?: string): Promise<SharedRackBottlesView> {
      requireOpen();
      const [rack, bottles] = await Promise.all([view(id), repo.bottles(id, owner)]);
      return { rack, bottles };
    },

    /**
     * Puts a bottle of MY household on a free spot. I am its owner in the rack; the request cannot say otherwise
     * (there is nothing in it that could). A bottle of another household is "not found", like one that does not exist.
     */
    async place(id: string, input: SharedRackPlace): Promise<SharedRackPlaceResult> {
      requireWrites();
      await checkTarget(await view(id), input.to, null);
      const answer = await repo.place(id, input.bottleId, input.to);
      switch (answer.outcome) {
        case "placed":
        case "already_there":
          return { placementId: answer.placementId, outcome: answer.outcome, to: input.to };
        case "bottle_not_found":
          throw new DomainError("NOT_FOUND", M.bottleNotFound);
        case "bottle_unavailable":
          throw new DomainError("CONFLICT", M.bottleUnavailable);
        case "already_placed":
          throw new DomainError("CONFLICT", M.alreadyPlaced);
        case "out_of_bounds":
          throw new DomainError("VALIDATION", M.outOfBounds);
        case "taken":
          throw new DomainError("CONFLICT", M.taken, { retryable: true });
        default:
          throw refuse(answer.outcome);
      }
    },

    /**
     * Moves any bottle of the rack from the spot the caller SAW it on to a free spot of the same rack. A repeat of a
     * move that already happened answers "already_there"; a bottle that is not where it was seen, or a target taken
     * meanwhile, changes nothing (409). Whose bottle it is does not change.
     */
    async move(
      id: string,
      placementId: string,
      move: SharedRackMove,
    ): Promise<SharedRackMoveResult> {
      requireWrites();
      await checkTarget(await view(id), move.to, placementId);
      const answer = await repo.move(id, placementId, move.from, move.to);
      switch (answer.outcome) {
        case "moved":
        case "already_there":
          return { placementId, outcome: answer.outcome, from: move.from, to: move.to };
        case "stale":
          throw new DomainError("CONFLICT", M.stale);
        case "gone":
          throw new DomainError("CONFLICT", M.gone);
        case "taken":
          throw new DomainError("CONFLICT", M.taken, { retryable: true });
        case "out_of_bounds":
          throw new DomainError("VALIDATION", M.outOfBounds);
        default:
          throw refuse(answer.outcome);
      }
    },

    /**
     * Records that I took a bottle out of the rack: the placement ends and the history names me and its owner.
     * It is NOT consumed: the owner's bottle is not touched, and what became of it is theirs to say.
     */
    async takeOut(
      id: string,
      placementId: string,
      input: SharedRackTakeOut,
    ): Promise<{ placementId: string; outcome: "taken_out" }> {
      requireWrites();
      const answer = await repo.takeOut(id, placementId, input.from);
      switch (answer.outcome) {
        case "taken_out":
          return { placementId, outcome: "taken_out" };
        case "stale":
          throw new DomainError("CONFLICT", M.stale);
        case "gone":
          throw new DomainError("CONFLICT", M.gone);
        case "not_found":
          throw refuse(answer.outcome);
      }
    },

    /** The history of a rack, newest first, a page at a time. */
    async events(id: string, query: SharedRackEventsQuery): Promise<SharedRackEventsView> {
      requireOpen();
      const [, events] = await Promise.all([view(id), repo.events(id, query)]);
      const last = events.at(-1);
      // a full page may have more behind it; a short one is the end
      return { events, nextBefore: last && events.length >= query.limit ? last.seq : null };
    },

    /** Which bottles of my own households stand in a shared rack (for my own cellar's screens). */
    async myBottles(): Promise<{ bottles: MySharedRackBottleView[] }> {
      requireOpen();
      return { bottles: await repo.myBottles() };
    },

    /**
     * "My bottle is no longer in that rack": for the bottle's own household, with or without access to the rack.
     * So leaving a rack, or being removed, never leaves someone unable to get their own bottle's record back.
     */
    async withdraw(bottleId: string): Promise<void> {
      requireWrites();
      const outcome = await repo.withdraw(bottleId);
      if (outcome === "not_found") throw new DomainError("NOT_FOUND", M.bottleNotFound);
      if (outcome === "not_placed") throw new DomainError("CONFLICT", M.notPlaced);
    },
  };
}

export type SharedRacksService = ReturnType<typeof createSharedRacksService>;
