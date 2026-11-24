import { z } from "zod";
import { type StorageKind, type WineType } from "./cellar";
import { indexMeaningOf, type IndexMeaning } from "./smart-cellar";
import { resolveStorage, type ResolvedStorage, type StorageFallback } from "./storage-compat";
import {
  StorageAppearanceSchema,
  StorageStructureSchema,
  unsupportedStyle,
  type StorageAppearance,
} from "./storage-config";
import {
  STORAGE_LIMITS,
  getStorageTemplate,
  type LayoutFamily,
  type StorageTemplateId,
} from "./storage-templates";

/**
 * SHARED RACKS (ADR-010): one physical rack that people of several households use together, while every bottle in it
 * stays one person's own. This file is the contract between the server and its clients, and the rules both follow.
 *
 * Four identities that are never one another:
 * - household membership: who shares a cellar (unchanged, and nothing here touches it);
 * - rack membership: who may use this rack, per PERSON (`SharedRackRole`);
 * - the bottle's owner in the rack: the member who put it there (`SharedRackBottleView.owner`);
 * - the actor: who did a thing (`SharedRackEventView.actor`). The taker of a bottle is the actor of
 *   `bottle_taken_out`; the consumer is the actor of `bottle_opened`.
 *
 * Nothing here writes. The database decides in the end (migration 0052): these rules exist so that a screen can
 * show what is possible and a person is told plainly, before the database is asked.
 */

/** The version of this representation. A client that does not know a newer one must not guess it. */
export const SHARED_RACKS_API_VERSION = 1;

/** The limits the database enforces (0052). Here so a screen can say them. */
export const SHARED_RACK_LIMITS = {
  nameLength: 60,
  members: 12,
  pendingInvitations: 20,
  racksPerPerson: 20,
  invitationDays: 14,
  /**
   * After a decline that person is not asked again for this long: not for that rack by anyone, and not by the same
   * inviter for any rack.
   */
  declineCoolDownDays: 7,
  /** Open invitations one person may have to one other person, over all racks. */
  openInvitationsPerPerson: 3,
  eventsPerPage: 100,
} as const;

// ---- People and roles ---------------------------------------------------------------------------------------------

export const SHARED_RACK_ROLES = ["owner", "member"] as const;
export type SharedRackRole = (typeof SHARED_RACK_ROLES)[number];

/** What a person may do in a rack. Whether the rack is archived is part of the answer. */
export interface SharedRackPermissions {
  /** Rename, change the layout. */
  manageRack: boolean;
  /** Archive (owner, not archived) or restore (owner, archived). */
  archive: boolean;
  restore: boolean;
  /** Invite, cancel invitations, change roles, remove members. */
  manageMembers: boolean;
  invite: boolean;
  /** Put a bottle of one's own household in. */
  place: boolean;
  /** Move any bottle to a free spot. */
  move: boolean;
  /** Record taking any bottle out. Stays possible in an archived rack. */
  takeOut: boolean;
}

/**
 * The permission matrix of ADR-010 §4, as one pure function. A plain member reorganises the rack and records what
 * physically happened; only an owner manages the rack and its people; nobody can change whose bottle it is (there is
 * no permission for it, because there is no such action).
 */
export function sharedRackPermissions(
  role: SharedRackRole,
  archived: boolean,
): SharedRackPermissions {
  const owner = role === "owner";
  return {
    manageRack: owner && !archived,
    archive: owner && !archived,
    restore: owner && archived,
    manageMembers: owner,
    invite: owner && !archived,
    place: !archived,
    move: !archived,
    takeOut: true,
  };
}

/** Why someone cannot leave, or null when they can. The last owner hands the role over first, or archives the rack. */
export function sharedRackLeaveProblem(
  role: SharedRackRole,
  otherOwners: number,
): "last_owner" | null {
  return role === "owner" && otherOwners < 1 ? "last_owner" : null;
}

/** Why a role cannot be changed like this, or null when it can. There is always at least one owner. */
export function sharedRackRoleChangeProblem(change: {
  from: SharedRackRole;
  to: SharedRackRole;
  /** Owners of the rack other than the person whose role changes. */
  otherOwners: number;
}): "unchanged" | "last_owner" | null {
  if (change.from === change.to) return "unchanged";
  if (change.to === "member" && change.otherOwners < 1) return "last_owner";
  return null;
}

// ---- Invitations --------------------------------------------------------------------------------------------------

export const SHARED_RACK_INVITATION_STATES = [
  "pending",
  "accepted",
  "declined",
  "cancelled",
  "expired",
] as const;
export type SharedRackInvitationState = (typeof SHARED_RACK_INVITATION_STATES)[number];

/** The state of an invitation as a reader may rely on it: a pending one past its date is expired. */
export function sharedRackInvitationState(
  stored: string,
  expiresAt: string,
  now: Date,
): SharedRackInvitationState {
  if (stored === "pending")
    return new Date(expiresAt).getTime() <= now.getTime() ? "expired" : "pending";
  return stored === "accepted" ||
    stored === "declined" ||
    stored === "cancelled" ||
    stored === "expired"
    ? stored
    : "cancelled";
}

/** An invitation as the rack's owners see it. */
export interface SharedRackInvitationView {
  id: string;
  userId: string;
  displayName: string | null;
  handle: string | null;
  invitedBy: string | null;
  state: SharedRackInvitationState;
  createdAt: string;
  expiresAt: string;
  respondedAt: string | null;
}

/** An invitation as the invited person sees it: the rack's name and who asked. Nothing else before accepting. */
export interface MySharedRackInvitationView {
  id: string;
  rackId: string;
  rackName: string;
  invitedBy: string | null;
  createdAt: string;
  expiresAt: string;
}

// ---- The rack -----------------------------------------------------------------------------------------------------

/**
 * A rack as its members see it: the same words as a place of one's own cellar (`SmartStorageUnitView`), read through
 * `resolveStorage`, so the same renderer draws it (`resolveSharedRack`).
 */
export interface SharedRackView {
  id: string;
  name: string;
  role: SharedRackRole;
  archived: boolean;
  archivedAt: string | null;
  kind: StorageKind;
  /** As stored. An id this server does not know is returned as it is, and `arrangementKnown` is then false. */
  templateId: string;
  layoutTemplateId: StorageTemplateId;
  family: LayoutFamily;
  rows: number;
  cols: number;
  cellCapacity: number;
  /** As stored, so a client reading the rack with `resolveStorage` reaches the server's result. */
  slotSemantics: string;
  indexMeaning: IndexMeaning;
  appearance: StorageAppearance;
  capacity: number;
  occupied: number;
  free: number;
  arrangementKnown: boolean;
  fallbacks: StorageFallback[];
  /** Goes up with every change of the rack. A layout save may send it back (If-Match). */
  revision: string;
  memberCount: number;
  /** Bottles in it that are mine (I put them there). */
  myBottleCount: number;
  createdAt: string;
  permissions: SharedRackPermissions;
}

/** The rack as `resolveStorage` reads it: what the 3D renderer and the placement rules take. */
export function resolveSharedRack(
  rack: Pick<
    SharedRackView,
    "kind" | "rows" | "cols" | "templateId" | "cellCapacity" | "slotSemantics" | "appearance"
  >,
): ResolvedStorage {
  return resolveStorage({
    kind: rack.kind,
    rows: rack.rows,
    cols: rack.cols,
    template: rack.templateId,
    cellCapacity: rack.cellCapacity,
    semantics: rack.slotSemantics,
    appearance: rack.appearance,
  });
}

/** A rack as the database holds it, before anything is interpreted. */
export interface StoredSharedRack {
  id: string;
  name: string;
  role: SharedRackRole;
  archivedAt: string | null;
  kind: StorageKind;
  template: string;
  slotSemantics: string;
  rows: number;
  cols: number;
  cellCapacity: number;
  /** Unread: it may be of another version, or not a look at all. */
  appearance: unknown;
  revision: string;
  memberCount: number;
  bottleCount: number;
  myBottleCount: number;
  createdAt: string;
}

/** Pure: a stored rack as the API shows it. All interpreting is `resolveStorage`'s. */
export function toSharedRackView(stored: StoredSharedRack): SharedRackView {
  const resolved = resolveStorage({
    kind: stored.kind,
    rows: stored.rows,
    cols: stored.cols,
    template: stored.template,
    cellCapacity: stored.cellCapacity,
    semantics: stored.slotSemantics,
    appearance: stored.appearance,
  });
  const capacity = stored.rows * stored.cols * stored.cellCapacity;
  const archived = stored.archivedAt !== null;
  return {
    id: stored.id,
    name: stored.name,
    role: stored.role,
    archived,
    archivedAt: stored.archivedAt,
    kind: stored.kind,
    templateId: stored.template,
    layoutTemplateId: resolved.template.id,
    family: resolved.layout.family,
    rows: stored.rows,
    cols: stored.cols,
    cellCapacity: stored.cellCapacity,
    slotSemantics: stored.slotSemantics,
    indexMeaning: indexMeaningOf(resolved),
    appearance: resolved.appearance,
    capacity,
    occupied: stored.bottleCount,
    free: Math.max(0, capacity - stored.bottleCount),
    arrangementKnown: resolved.arrangementKnown,
    fallbacks: resolved.fallbacks,
    revision: stored.revision,
    memberCount: stored.memberCount,
    myBottleCount: stored.myBottleCount,
    createdAt: stored.createdAt,
    permissions: sharedRackPermissions(stored.role, archived),
  };
}

export interface SharedRackMemberView {
  userId: string;
  displayName: string | null;
  handle: string | null;
  role: SharedRackRole;
  joinedAt: string;
  /** Bottles in the rack that are this person's. */
  bottleCount: number;
  isMe: boolean;
}

// ---- Bottles: the projection --------------------------------------------------------------------------------------

/** A spot within a rack: the whole of it. The index is 1 while more than one bottle per position is off. */
export const SharedRackSpotSchema = z.strictObject({
  row: z.number().int().min(1).max(STORAGE_LIMITS.rows),
  col: z.number().int().min(1).max(STORAGE_LIMITS.cols),
  index: z.number().int().min(1).max(STORAGE_LIMITS.cellCapacity).default(1),
});
export type SharedRackSpot = z.infer<typeof SharedRackSpotSchema>;

/** Someone named in a rack: by the account while it exists, by the name as it read when it no longer does. */
export interface SharedRackPerson {
  /** Null once the account is deleted. */
  userId: string | null;
  name: string | null;
}

/**
 * ONE BOTTLE AS EVERY MEMBER SEES IT: what someone standing at the rack sees, and nothing more. Never a price, where
 * or when it was bought, a note, a rating, a photo, the household, or the ids of the wine and vintage.
 */
export interface SharedRackBottleView {
  /** The handle every member uses for this bottle in this rack (move, take out, history). */
  placementId: string;
  /** The bottle's own id: only for the bottle's own household. Null for everyone else. */
  bottleId: string | null;
  row: number;
  col: number;
  index: number;
  /** Whose bottle it is: the member who put it there. `isMember` false: they left or were removed; it is still theirs. */
  owner: SharedRackPerson & { isMember: boolean };
  /** I put it there. */
  mine: boolean;
  placedBy: string | null;
  placedAt: string;
  movedAt: string | null;
  producer: string;
  wineName: string;
  year: number | null;
  type: WineType;
  region: string | null;
  countryCode: string | null;
  formatMl: number;
}

export interface SharedRackBottlesView {
  rack: SharedRackView;
  bottles: SharedRackBottleView[];
}

/** A bottle of MY households that stands in a shared rack, for my own cellar's screens. */
export interface MySharedRackBottleView {
  bottleId: string;
  placementId: string;
  /** False: I am not (or no longer) a member of that rack. The rack and the spot are then not named. */
  hasAccess: boolean;
  rackId: string | null;
  rackName: string | null;
  spot: SharedRackSpot | null;
  placedAt: string;
}

// ---- History ------------------------------------------------------------------------------------------------------

export const SHARED_RACK_EVENT_TYPES = [
  "rack_created",
  "rack_renamed",
  "rack_layout_changed",
  "rack_archived",
  "rack_restored",
  "member_joined",
  "member_left",
  "member_removed",
  "member_role_changed",
  "bottle_placed",
  "bottle_moved",
  "bottle_taken_out",
  "bottle_withdrawn",
  "bottle_relocated",
  "bottle_opened",
  "bottle_gifted",
  "bottle_removed",
] as const;
export type SharedRackEventType = (typeof SHARED_RACK_EVENT_TYPES)[number];

/**
 * The events that end a placement, and what each says about the bottle:
 * - `bottle_taken_out`: a member took it out of the rack. NOT consumed: its owner's record is untouched.
 * - `bottle_withdrawn`: its owner said, from their own side, that it is no longer in the rack.
 * - `bottle_relocated`: its household gave it a place in their own cellar. Still a bottle.
 * - `bottle_opened`: its household opened it. This, and only this, is "consumed".
 * - `bottle_gifted`, `bottle_removed`: its household gave it away, or removed or deleted the record.
 */
export const SHARED_RACK_ENDING_EVENTS = [
  "bottle_taken_out",
  "bottle_withdrawn",
  "bottle_relocated",
  "bottle_opened",
  "bottle_gifted",
  "bottle_removed",
] as const satisfies readonly SharedRackEventType[];

export const isSharedRackEndingEvent = (type: SharedRackEventType): boolean =>
  (SHARED_RACK_ENDING_EVENTS as readonly string[]).includes(type);

/** Whether an event says the bottle was drunk. Leaving the rack never means that by itself. */
export const isSharedRackConsumedEvent = (type: SharedRackEventType): boolean =>
  type === "bottle_opened";

/** The wine of an event as it read when it happened. */
export interface SharedRackWineSnapshot {
  producer: string | null;
  name: string | null;
  year: number | null;
  type: string | null;
  formatMl: number | null;
}

export interface SharedRackEventView {
  /** The order, and the paging cursor (`before`). */
  seq: number;
  type: SharedRackEventType;
  occurredAt: string;
  /**
   * Who did it: named only when that person is in the rack. A change made in the owner's own cellar by someone of
   * that household who is not in the rack has no actor here (both fields null): see `sharedRackEventByHousehold`.
   */
  actor: SharedRackPerson;
  /** Whose bottle it was (bottle events). */
  owner: SharedRackPerson | null;
  /** Whom it is about (membership events). */
  subject: SharedRackPerson | null;
  placementId: string | null;
  /** Only on my own bottles. */
  bottleId: string | null;
  wine: SharedRackWineSnapshot | null;
  from: SharedRackSpot | null;
  to: SharedRackSpot | null;
  /** Small extras: a reason, a role, a name. Never anything private. */
  detail: Record<string, unknown> | null;
}

/**
 * Whether a change was made in the bottle's own household by someone who is not in the rack. The rack's members are
 * told that it happened and whose bottle it was ("by Ann's household"), never who in that household did it.
 */
export const sharedRackEventByHousehold = (event: Pick<SharedRackEventView, "detail">): boolean =>
  event.detail?.by === "owners_household";

export interface SharedRackEventsView {
  /** Newest first. */
  events: SharedRackEventView[];
  /** Pass as `before` for the next (older) page; null when there is none. */
  nextBefore: number | null;
}

/**
 * Replays a history (in any order: it is sorted by `seq`) into the occupancy it describes: placement → spot.
 * Returns null when the history contradicts itself (a move from where the bottle was not, a second bottle on a
 * spot, an ending of something that was not there): a lost or doubled line. The database's concurrency rehearsal
 * holds the real history to the same rule.
 */
export function replaySharedRackEvents(
  events: readonly Pick<SharedRackEventView, "seq" | "type" | "placementId" | "from" | "to">[],
): Map<string, SharedRackSpot> | null {
  const key = (s: SharedRackSpot) => `${s.row}:${s.col}:${s.index}`;
  const same = (a: SharedRackSpot, b: SharedRackSpot) => key(a) === key(b);
  const where = new Map<string, SharedRackSpot>();
  const taken = new Set<string>();
  for (const e of [...events].sort((a, b) => a.seq - b.seq)) {
    if (!e.type.startsWith("bottle_")) continue;
    if (!e.placementId) return null;
    const now = where.get(e.placementId);
    if (e.type === "bottle_placed") {
      if (now || !e.to || taken.has(key(e.to))) return null;
      where.set(e.placementId, e.to);
      taken.add(key(e.to));
    } else if (e.type === "bottle_moved") {
      if (!now || !e.from || !e.to || !same(now, e.from) || taken.has(key(e.to))) return null;
      taken.delete(key(now));
      where.set(e.placementId, e.to);
      taken.add(key(e.to));
    } else {
      if (!now || !e.from || !same(now, e.from)) return null;
      taken.delete(key(now));
      where.delete(e.placementId);
    }
  }
  return where;
}

// ---- What the API takes -------------------------------------------------------------------------------------------

const RackNameSchema = z
  .string()
  .trim()
  .min(1, "Give it a name.")
  .max(SHARED_RACK_LIMITS.nameLength);

/**
 * The layout of a shared rack as it may be WRITTEN: a place's structure and look under the catalogue's own rules
 * (`StorageStructureSchema`, `StorageAppearanceSchema`), without temperature zones (not part of a shared rack yet).
 * The template decides the kind and what an index means; neither is taken from a request.
 */
export const SharedRackLayoutSchema = z
  .strictObject({
    structure: StorageStructureSchema,
    appearance: StorageAppearanceSchema,
  })
  .superRefine((config, ctx) => {
    if (config.structure.zones.length > 0)
      ctx.addIssue({
        code: "custom",
        path: ["structure", "zones"],
        message: "A shared rack has no temperature zones.",
      });
    const template = getStorageTemplate(config.structure.template);
    if (!template) return;
    for (const field of unsupportedStyle(template, config.appearance))
      ctx.addIssue({
        code: "custom",
        path: ["appearance", field],
        message: "This kind of place does not come like that.",
      });
  });
export type SharedRackLayout = z.infer<typeof SharedRackLayoutSchema>;

/** POST /shared-racks */
export const SharedRackCreateSchema = z
  .strictObject({
    name: RackNameSchema,
    structure: StorageStructureSchema,
    appearance: StorageAppearanceSchema,
  })
  .superRefine((body, ctx) => {
    const layout = SharedRackLayoutSchema.safeParse({
      structure: body.structure,
      appearance: body.appearance,
    });
    if (!layout.success)
      for (const issue of layout.error.issues)
        ctx.addIssue({ code: "custom", path: issue.path, message: issue.message });
  });
export type SharedRackCreate = z.infer<typeof SharedRackCreateSchema>;

/** PATCH /shared-racks/:id */
export const SharedRackRenameSchema = z.strictObject({ name: RackNameSchema });

/** POST /shared-racks/:id/invitations: the id comes from the existing exact search (GET /friends/search). */
export const SharedRackInviteSchema = z.strictObject({ userId: z.uuid() });

/** POST /shared-racks/invitations/:id */
export const SharedRackRespondSchema = z.strictObject({ accept: z.boolean() });

/** PATCH /shared-racks/:id/members/:userId */
export const SharedRackRoleSchema = z.strictObject({ role: z.enum(SHARED_RACK_ROLES) });

/**
 * POST /shared-racks/:id/bottles: a bottle of MY household onto a spot. There is no owner in it: the owner is the
 * person who places it. (A strict object: an `ownerId`, an `actorId` or anything else unknown is refused.)
 */
export const SharedRackPlaceSchema = z.strictObject({
  bottleId: z.uuid(),
  to: SharedRackSpotSchema,
});
export type SharedRackPlace = z.infer<typeof SharedRackPlaceSchema>;

/** POST …/bottles/:placementId/move: from the spot the caller SAW it on, to a free spot of the same rack. */
export const SharedRackMoveSchema = z.strictObject({
  from: SharedRackSpotSchema,
  to: SharedRackSpotSchema,
});
export type SharedRackMove = z.infer<typeof SharedRackMoveSchema>;

/** POST …/bottles/:placementId/take-out: from the spot the caller SAW it on. */
export const SharedRackTakeOutSchema = z.strictObject({ from: SharedRackSpotSchema });
export type SharedRackTakeOut = z.infer<typeof SharedRackTakeOutSchema>;

const optionalUuid = z.preprocess(
  (v) => (v === null || v === "" ? undefined : v),
  z.uuid().optional(),
);

/** GET /shared-racks/:id/bottles?owner= */
export const SharedRackBottlesQuerySchema = z.strictObject({ owner: optionalUuid });

/** GET /shared-racks/:id/events?before=&limit=&owner=&actor=&placement=&bottle= */
export const SharedRackEventsQuerySchema = z.strictObject({
  before: z.preprocess(
    (v) => (v === null || v === "" ? undefined : v),
    z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
  ),
  limit: z.preprocess(
    (v) => (v === null || v === "" ? undefined : v),
    z.coerce.number().int().min(1).max(SHARED_RACK_LIMITS.eventsPerPage).default(50),
  ),
  owner: optionalUuid,
  actor: optionalUuid,
  placement: optionalUuid,
  bottle: optionalUuid,
});
export type SharedRackEventsQuery = z.infer<typeof SharedRackEventsQuerySchema>;

// ---- What the API answers on a write ------------------------------------------------------------------------------

export interface SharedRackPlaceResult {
  placementId: string;
  /** "placed", or "already_there": a repeat of a placement that had already happened. */
  outcome: "placed" | "already_there";
  to: SharedRackSpot;
}

export interface SharedRackMoveResult {
  placementId: string;
  /** "moved", or "already_there": a repeat of a move that had already happened. */
  outcome: "moved" | "already_there";
  from: SharedRackSpot;
  to: SharedRackSpot;
}

/** What the Shared Racks API answers on a database without its step (migration 0052). */
export const SHARED_RACKS_NOT_SET_UP = "Shared racks aren't set up on this server yet.";
