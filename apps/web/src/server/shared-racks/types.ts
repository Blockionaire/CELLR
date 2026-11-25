import "server-only";
import type {
  MySharedRackBottleView,
  MySharedRackInvitationView,
  SharedRackBottleView,
  SharedRackEventView,
  SharedRackEventsQuery,
  SharedRackInvitationView,
  SharedRackMemberView,
  SharedRackRole,
  SharedRackSpot,
  StorageAppearance,
  StorageKind,
  StoredSharedRack,
} from "@cellr/domain";

/**
 * What each function of migration 0056 can answer. An outcome that is not the success is a refusal: the database
 * changed nothing. `not_found` is its answer to anyone who is not an active member, and to an id that does not exist.
 */
export type CreateOutcome =
  { outcome: "created"; rackId: string } | { outcome: "too_many" | "depth_not_enabled" };

export type RenameOutcome = "renamed" | "unchanged" | "not_found" | "forbidden" | "archived";

export type LayoutOutcome =
  | { outcome: "saved" }
  | {
      outcome:
        | "not_found"
        | "forbidden"
        | "archived"
        | "stale"
        | "in_use"
        | "semantics_change"
        | "depth_not_enabled";
    };

export type ArchiveOutcome = "archived" | "restored" | "unchanged" | "not_found" | "forbidden";

export type InviteOutcome =
  | { outcome: "invited" | "already_invited"; invitationId: string }
  | {
      outcome:
        | "not_found"
        | "forbidden"
        | "archived"
        | "invalid"
        | "no_such_user"
        | "already_member"
        | "recently_declined"
        /** Three open invitations from this person to that one already (over all racks). */
        | "person_limit"
        | "full"
        | "too_many";
    };

export type RespondOutcome =
  | { outcome: "accepted"; rackId: string }
  | { outcome: "already_accepted"; rackId: string | null }
  | {
      outcome:
        | "declined"
        | "not_found"
        | "expired"
        | "archived"
        | "full"
        /** The person is in as many racks as there can be; the invitation stays open. */
        | "too_many_racks"
        | "already_declined"
        | "already_cancelled";
    };

export type CancelInvitationOutcome =
  | "cancelled"
  | "not_found"
  | "forbidden"
  | "already_accepted"
  | "already_declined"
  | "already_cancelled";

export type RoleOutcome =
  "changed" | "unchanged" | "not_found" | "forbidden" | "no_such_member" | "last_owner";

export type RemoveOutcome = "removed" | "not_found" | "forbidden" | "invalid" | "no_such_member";

export type LeaveOutcome = "left" | "not_found" | "last_owner";

export type PlaceOutcome =
  | { outcome: "placed" | "already_there"; placementId: string }
  | {
      outcome:
        | "not_found"
        | "archived"
        | "bottle_not_found"
        | "bottle_unavailable"
        | "already_placed"
        | "out_of_bounds"
        | "depth_not_enabled"
        | "taken";
    };

export type MoveOutcome =
  | { outcome: "moved" | "already_there" }
  /** The bottle is not where the caller saw it; `now` is where it is. Nothing changed. */
  | { outcome: "stale"; now: SharedRackSpot | null }
  | {
      outcome: "not_found" | "archived" | "gone" | "out_of_bounds" | "depth_not_enabled" | "taken";
    };

export type TakeOutOutcome =
  | { outcome: "taken_out" }
  | { outcome: "stale"; now: SharedRackSpot | null }
  | { outcome: "not_found" | "gone" };

export type WithdrawOutcome = "withdrawn" | "not_found" | "not_placed";

/** The whole layout shared_rack_save_layout replaces, in one transaction. */
export interface RackLayoutWrite {
  kind: StorageKind;
  template: string;
  semantics: string;
  rows: number;
  cols: number;
  cellCapacity: number;
  appearance: StorageAppearance;
}

/**
 * Data access for the Shared Racks API: ONE function of migration 0056 per method, called AS the signed-in person
 * (the request's own Supabase client, never the service role). The database takes the person from the session and
 * checks their membership itself; nothing here passes an identity. The tables are not reachable at all.
 * A database without the migration is answered with a "not set up" error, never by guessing.
 */
export interface SharedRacksRepository {
  listRacks(includeArchived: boolean): Promise<StoredSharedRack[]>;
  /** Null: no such rack, or not a member of it (the two are never told apart). */
  getRack(id: string): Promise<StoredSharedRack | null>;
  members(rackId: string): Promise<SharedRackMemberView[]>;
  bottles(rackId: string, owner?: string): Promise<SharedRackBottleView[]>;
  /** Newest first, at most `query.limit`. */
  events(rackId: string, query: SharedRackEventsQuery): Promise<SharedRackEventView[]>;
  rackInvitations(rackId: string): Promise<SharedRackInvitationView[]>;
  myInvitations(): Promise<MySharedRackInvitationView[]>;
  myBottles(): Promise<MySharedRackBottleView[]>;

  create(name: string, layout: RackLayoutWrite): Promise<CreateOutcome>;
  rename(rackId: string, name: string): Promise<RenameOutcome>;
  saveLayout(
    rackId: string,
    layout: RackLayoutWrite,
    expectedRevision: string | null,
  ): Promise<LayoutOutcome>;
  setArchived(rackId: string, archived: boolean): Promise<ArchiveOutcome>;
  invite(rackId: string, userId: string): Promise<InviteOutcome>;
  respond(invitationId: string, accept: boolean): Promise<RespondOutcome>;
  cancelInvitation(invitationId: string): Promise<CancelInvitationOutcome>;
  setRole(rackId: string, userId: string, role: SharedRackRole): Promise<RoleOutcome>;
  removeMember(rackId: string, userId: string): Promise<RemoveOutcome>;
  leave(rackId: string): Promise<LeaveOutcome>;
  place(rackId: string, bottleId: string, to: SharedRackSpot): Promise<PlaceOutcome>;
  move(
    rackId: string,
    placementId: string,
    from: SharedRackSpot,
    to: SharedRackSpot,
  ): Promise<MoveOutcome>;
  takeOut(rackId: string, placementId: string, from: SharedRackSpot): Promise<TakeOutOutcome>;
  withdraw(bottleId: string): Promise<WithdrawOutcome>;
}
