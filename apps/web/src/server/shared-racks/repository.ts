import "server-only";
import {
  DomainError,
  SHARED_RACKS_NOT_SET_UP,
  SHARED_RACK_EVENT_TYPES,
  sharedRackInvitationState,
  type SharedRackEventType,
  type SharedRackEventView,
  type SharedRackPerson,
  type SharedRackRole,
  type SharedRackSpot,
  type SharedRackWineSnapshot,
  type StorageKind,
  type StoredSharedRack,
  type WineType,
} from "@cellr/domain";
import type { Db } from "@/server/db/clients";
import type { Database } from "@/server/db/database.types";
import { isMissingTable, mapDbError } from "@/server/db/errors";
import type { SharedRacksRepository } from "./types";

type Functions = Database["public"]["Functions"];
type RackRecord = Functions["shared_racks"]["Returns"][number];
type EventRecord = Functions["shared_rack_events"]["Returns"][number];

/**
 * A database without the shared-rack step (migration 0052): PostgREST cannot find the function. ONLY these codes
 * mean that; a permission error, a timeout or anything else is passed on as what it is.
 * PGRST202: no such function in the schema cache · 42883: Postgres itself does not have it.
 */
export const isSharedRacksSchemaMissing = (error: { code?: string | undefined }): boolean =>
  error.code === "PGRST202" || error.code === "42883" || isMissingTable(error);

/** Errors of the Shared Racks API's own calls. */
export function mapSharedRacksError(error: {
  code?: string | undefined;
  message?: string | undefined;
}): DomainError {
  if (isSharedRacksSchemaMissing(error))
    return new DomainError("NOT_FOUND", SHARED_RACKS_NOT_SET_UP, { cause: error });
  // Two writers that ran into each other (a deadlock, a serialisation failure, a lock that was not free): nothing was
  // changed, and trying again is the remedy.
  if (error.code === "40P01" || error.code === "40001" || error.code === "55P03")
    return new DomainError("CONFLICT", "Someone else was changing this rack. Try again.", {
      cause: error,
      retryable: true,
    });
  return mapDbError(error);
}

/** Pure: a row of public.shared_racks() in the domain's words, nothing interpreted. Unit-tested. */
export function toStoredRack(r: RackRecord): StoredSharedRack {
  return {
    id: r.id,
    name: r.name,
    role: r.my_role === "owner" ? "owner" : "member",
    archivedAt: r.archived_at ?? null,
    kind: r.kind as StorageKind,
    template: r.template,
    slotSemantics: r.slot_semantics,
    rows: r.grid_rows,
    cols: r.grid_cols,
    cellCapacity: r.cell_capacity,
    appearance: r.appearance,
    revision: String(r.revision),
    memberCount: r.member_count,
    bottleCount: r.bottle_count,
    myBottleCount: r.my_bottle_count,
    createdAt: r.created_at,
  };
}

const spotOf = (
  row: number | null,
  col: number | null,
  index: number | null,
): SharedRackSpot | null =>
  row === null || col === null || index === null ? null : { row, col, index };

const personOf = (id: string | null, name: string | null): SharedRackPerson | null =>
  id === null && name === null ? null : { userId: id, name };

const text = (value: unknown): string | null => (typeof value === "string" ? value : null);
const count = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/** Pure: the wine of an event as it was written then. Anything that is not such an object is no wine. */
export function toWineSnapshot(value: unknown): SharedRackWineSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const w = value as Record<string, unknown>;
  return {
    producer: text(w.producer),
    name: text(w.name),
    year: count(w.year),
    type: text(w.type),
    formatMl: count(w.format_ml),
  };
}

/** Pure: a row of public.shared_rack_events() in the domain's words. A type this server does not know is left out. */
export function toEvent(r: EventRecord): SharedRackEventView | null {
  if (!(SHARED_RACK_EVENT_TYPES as readonly string[]).includes(r.event_type)) return null;
  const detail =
    r.detail && typeof r.detail === "object" && !Array.isArray(r.detail)
      ? (r.detail as Record<string, unknown>)
      : null;
  return {
    seq: Number(r.seq),
    type: r.event_type as SharedRackEventType,
    occurredAt: r.occurred_at,
    actor: { userId: r.actor_id ?? null, name: r.actor_name ?? null },
    owner: personOf(r.owner_id ?? null, r.owner_name ?? null),
    subject: personOf(r.subject_id ?? null, r.subject_name ?? null),
    placementId: r.placement_id ?? null,
    bottleId: r.bottle_id ?? null,
    wine: toWineSnapshot(r.wine),
    from: spotOf(r.from_row ?? null, r.from_col ?? null, r.from_index ?? null),
    to: spotOf(r.to_row ?? null, r.to_col ?? null, r.to_index ?? null),
    detail,
  };
}

/**
 * Pure: the answer of a write function, read strictly. It must be an object whose `outcome` is one this server
 * knows for that function; anything else is not taken for a success or for a refusal: it is an error.
 */
export function readOutcome<T extends string>(
  data: unknown,
  known: readonly T[],
): { outcome: T; fields: Record<string, unknown> } {
  const fields =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : null;
  const outcome = fields?.outcome;
  if (!fields || typeof outcome !== "string" || !(known as readonly string[]).includes(outcome))
    throw new DomainError("INTERNAL", undefined, { cause: { answer: data }, retryable: false });
  return { outcome: outcome as T, fields };
}

const idField = (fields: Record<string, unknown>, key: string): string => {
  const value = fields[key];
  if (typeof value !== "string")
    throw new DomainError("INTERNAL", undefined, { cause: { answer: fields }, retryable: false });
  return value;
};

const nowOf = (fields: Record<string, unknown>): SharedRackSpot | null =>
  spotOf(count(fields.row), count(fields.col), count(fields.index));

const RENAME = ["renamed", "unchanged", "not_found", "forbidden", "archived"] as const;
const LAYOUT = [
  "saved",
  "not_found",
  "forbidden",
  "archived",
  "stale",
  "in_use",
  "semantics_change",
  "depth_not_enabled",
] as const;
const ARCHIVE = ["archived", "restored", "unchanged", "not_found", "forbidden"] as const;
const CREATE = ["created", "too_many", "depth_not_enabled"] as const;
const INVITE = [
  "invited",
  "already_invited",
  "not_found",
  "forbidden",
  "archived",
  "invalid",
  "no_such_user",
  "already_member",
  "recently_declined",
  "person_limit",
  "full",
  "too_many",
] as const;
const RESPOND = [
  "accepted",
  "declined",
  "not_found",
  "expired",
  "archived",
  "full",
  "too_many_racks",
  "already_accepted",
  "already_declined",
  "already_cancelled",
] as const;
const CANCEL = [
  "cancelled",
  "not_found",
  "forbidden",
  "already_accepted",
  "already_declined",
  "already_cancelled",
] as const;
const ROLE = [
  "changed",
  "unchanged",
  "not_found",
  "forbidden",
  "no_such_member",
  "last_owner",
] as const;
const REMOVE = ["removed", "not_found", "forbidden", "invalid", "no_such_member"] as const;
const LEAVE = ["left", "not_found", "last_owner"] as const;
const PLACE = [
  "placed",
  "already_there",
  "not_found",
  "archived",
  "bottle_not_found",
  "bottle_unavailable",
  "already_placed",
  "out_of_bounds",
  "depth_not_enabled",
  "taken",
] as const;
const MOVE = [
  "moved",
  "already_there",
  "stale",
  "not_found",
  "archived",
  "gone",
  "out_of_bounds",
  "depth_not_enabled",
  "taken",
] as const;
const TAKE_OUT = ["taken_out", "stale", "not_found", "gone"] as const;
const WITHDRAW = ["withdrawn", "not_found", "not_placed"] as const;

export function createSharedRacksRepository(db: Db): SharedRacksRepository {
  return {
    async listRacks(includeArchived) {
      const { data, error } = await db.rpc("shared_racks", { p_include_archived: includeArchived });
      if (error) throw mapSharedRacksError(error);
      return data.map(toStoredRack);
    },

    async getRack(id) {
      const { data, error } = await db.rpc("shared_racks", { p_rack: id });
      if (error) throw mapSharedRacksError(error);
      const row = data[0];
      return row ? toStoredRack(row) : null;
    },

    async members(rackId) {
      const { data, error } = await db.rpc("shared_rack_members", { p_rack: rackId });
      if (error) throw mapSharedRacksError(error);
      return data.map((m) => ({
        userId: m.user_id,
        displayName: m.display_name ?? null,
        handle: m.handle ?? null,
        role: (m.role === "owner" ? "owner" : "member") satisfies SharedRackRole,
        joinedAt: m.joined_at,
        bottleCount: m.bottle_count,
        isMe: m.is_me === true,
      }));
    },

    async bottles(rackId, owner) {
      const { data, error } = await db.rpc("shared_rack_bottles", {
        p_rack: rackId,
        ...(owner ? { p_owner: owner } : {}),
      });
      if (error) throw mapSharedRacksError(error);
      return data.map((b) => ({
        placementId: b.placement_id,
        bottleId: b.bottle_id ?? null,
        row: b.loc_row,
        col: b.loc_col,
        index: b.loc_index,
        owner: {
          userId: b.owner_user_id ?? null,
          name: b.owner_name ?? null,
          isMember: b.owner_is_member === true,
        },
        mine: b.is_mine === true,
        placedBy: b.placed_by_name ?? null,
        placedAt: b.placed_at,
        movedAt: b.moved_at ?? null,
        producer: b.producer,
        wineName: b.wine_name,
        year: b.year ?? null,
        type: b.wine_type as WineType,
        region: b.region ?? null,
        countryCode: b.country_code ?? null,
        formatMl: b.format_ml,
      }));
    },

    async events(rackId, query) {
      const { data, error } = await db.rpc("shared_rack_events", {
        p_rack: rackId,
        p_limit: query.limit,
        ...(query.before !== undefined ? { p_before: query.before } : {}),
        ...(query.owner ? { p_owner: query.owner } : {}),
        ...(query.actor ? { p_actor: query.actor } : {}),
        ...(query.placement ? { p_placement: query.placement } : {}),
        ...(query.bottle ? { p_bottle: query.bottle } : {}),
      });
      if (error) throw mapSharedRacksError(error);
      return data.flatMap((row) => {
        const event = toEvent(row);
        return event ? [event] : [];
      });
    },

    async rackInvitations(rackId) {
      const { data, error } = await db.rpc("shared_rack_invitations", { p_rack: rackId });
      if (error) throw mapSharedRacksError(error);
      const now = new Date();
      return data.map((i) => ({
        id: i.id,
        userId: i.invited_user_id,
        displayName: i.invited_name ?? null,
        handle: i.invited_handle ?? null,
        invitedBy: i.invited_by_name ?? null,
        // the database says "expired" itself; this only keeps an unknown word from being read as open
        state: sharedRackInvitationState(i.status, i.expires_at, now),
        createdAt: i.created_at,
        expiresAt: i.expires_at,
        respondedAt: i.responded_at ?? null,
      }));
    },

    async myInvitations() {
      const { data, error } = await db.rpc("my_shared_rack_invitations");
      if (error) throw mapSharedRacksError(error);
      return data.map((i) => ({
        id: i.id,
        rackId: i.rack_id,
        rackName: i.rack_name,
        invitedBy: i.invited_by_name ?? null,
        createdAt: i.created_at,
        expiresAt: i.expires_at,
      }));
    },

    async myBottles() {
      const { data, error } = await db.rpc("my_shared_rack_bottles");
      if (error) throw mapSharedRacksError(error);
      return data.map((b) => ({
        bottleId: b.bottle_id,
        placementId: b.placement_id,
        hasAccess: b.has_access === true,
        rackId: b.rack_id ?? null,
        rackName: b.rack_name ?? null,
        spot: spotOf(b.loc_row ?? null, b.loc_col ?? null, b.loc_index ?? null),
        placedAt: b.placed_at,
      }));
    },

    async create(name, layout) {
      const { data, error } = await db.rpc("shared_rack_create", {
        p_name: name,
        p_kind: layout.kind,
        p_template: layout.template,
        p_slot_semantics: layout.semantics,
        p_rows: layout.rows,
        p_cols: layout.cols,
        p_cell_capacity: layout.cellCapacity,
        p_appearance: layout.appearance,
      });
      if (error) throw mapSharedRacksError(error);
      const { outcome, fields } = readOutcome(data, CREATE);
      return outcome === "created" ? { outcome, rackId: idField(fields, "rack_id") } : { outcome };
    },

    async rename(rackId, name) {
      const { data, error } = await db.rpc("shared_rack_rename", { p_rack: rackId, p_name: name });
      if (error) throw mapSharedRacksError(error);
      return readOutcome(data, RENAME).outcome;
    },

    async saveLayout(rackId, layout, expectedRevision) {
      const { data, error } = await db.rpc("shared_rack_save_layout", {
        p_rack: rackId,
        p_kind: layout.kind,
        p_template: layout.template,
        p_slot_semantics: layout.semantics,
        p_rows: layout.rows,
        p_cols: layout.cols,
        p_cell_capacity: layout.cellCapacity,
        p_appearance: layout.appearance,
        // compared by the database, inside the transaction that saves
        ...(expectedRevision !== null ? { p_expected_revision: Number(expectedRevision) } : {}),
      });
      if (error) throw mapSharedRacksError(error);
      return { outcome: readOutcome(data, LAYOUT).outcome };
    },

    async setArchived(rackId, archived) {
      const { data, error } = await db.rpc("shared_rack_set_archived", {
        p_rack: rackId,
        p_archived: archived,
      });
      if (error) throw mapSharedRacksError(error);
      return readOutcome(data, ARCHIVE).outcome;
    },

    async invite(rackId, userId) {
      const { data, error } = await db.rpc("shared_rack_invite", {
        p_rack: rackId,
        p_user: userId,
      });
      if (error) throw mapSharedRacksError(error);
      const { outcome, fields } = readOutcome(data, INVITE);
      return outcome === "invited" || outcome === "already_invited"
        ? { outcome, invitationId: idField(fields, "invitation_id") }
        : { outcome };
    },

    async respond(invitationId, accept) {
      const { data, error } = await db.rpc("shared_rack_respond_invitation", {
        p_invitation: invitationId,
        p_accept: accept,
      });
      if (error) throw mapSharedRacksError(error);
      const { outcome, fields } = readOutcome(data, RESPOND);
      if (outcome === "accepted") return { outcome, rackId: idField(fields, "rack_id") };
      if (outcome === "already_accepted") return { outcome, rackId: text(fields.rack_id) };
      return { outcome };
    },

    async cancelInvitation(invitationId) {
      const { data, error } = await db.rpc("shared_rack_cancel_invitation", {
        p_invitation: invitationId,
      });
      if (error) throw mapSharedRacksError(error);
      return readOutcome(data, CANCEL).outcome;
    },

    async setRole(rackId, userId, role) {
      const { data, error } = await db.rpc("shared_rack_set_member_role", {
        p_rack: rackId,
        p_user: userId,
        p_role: role,
      });
      if (error) throw mapSharedRacksError(error);
      return readOutcome(data, ROLE).outcome;
    },

    async removeMember(rackId, userId) {
      const { data, error } = await db.rpc("shared_rack_remove_member", {
        p_rack: rackId,
        p_user: userId,
      });
      if (error) throw mapSharedRacksError(error);
      return readOutcome(data, REMOVE).outcome;
    },

    async leave(rackId) {
      const { data, error } = await db.rpc("shared_rack_leave", { p_rack: rackId });
      if (error) throw mapSharedRacksError(error);
      return readOutcome(data, LEAVE).outcome;
    },

    async place(rackId, bottleId, to) {
      // The bottle and the spot, and nothing else: whose it is and who places it are the session's, in the database.
      const { data, error } = await db.rpc("shared_rack_place", {
        p_rack: rackId,
        p_bottle: bottleId,
        p_row: to.row,
        p_col: to.col,
        p_index: to.index,
      });
      if (error) throw mapSharedRacksError(error);
      const { outcome, fields } = readOutcome(data, PLACE);
      return outcome === "placed" || outcome === "already_there"
        ? { outcome, placementId: idField(fields, "placement_id") }
        : { outcome };
    },

    async move(rackId, placementId, from, to) {
      const { data, error } = await db.rpc("shared_rack_move", {
        p_rack: rackId,
        p_placement: placementId,
        p_from_row: from.row,
        p_from_col: from.col,
        p_from_index: from.index,
        p_to_row: to.row,
        p_to_col: to.col,
        p_to_index: to.index,
      });
      if (error) throw mapSharedRacksError(error);
      const { outcome, fields } = readOutcome(data, MOVE);
      return outcome === "stale" ? { outcome, now: nowOf(fields) } : { outcome };
    },

    async takeOut(rackId, placementId, from) {
      const { data, error } = await db.rpc("shared_rack_take_out", {
        p_rack: rackId,
        p_placement: placementId,
        p_from_row: from.row,
        p_from_col: from.col,
        p_from_index: from.index,
      });
      if (error) throw mapSharedRacksError(error);
      const { outcome, fields } = readOutcome(data, TAKE_OUT);
      return outcome === "stale" ? { outcome, now: nowOf(fields) } : { outcome };
    },

    async withdraw(bottleId) {
      const { data, error } = await db.rpc("shared_rack_withdraw_bottle", { p_bottle: bottleId });
      if (error) throw mapSharedRacksError(error);
      return readOutcome(data, WITHDRAW).outcome;
    },
  };
}
