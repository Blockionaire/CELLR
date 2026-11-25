import {
  SHARED_RACKS_NOT_SET_UP,
  formatVintage,
  isSharedRackEndingEvent,
  sharedRackEventByHousehold,
  sharedRackLeaveProblem,
  type MySharedRackBottleView,
  type RackView,
  type ResolvedStorage,
  type SharedRackBottleView,
  type SharedRackEventView,
  type SharedRackMemberView,
  type SharedRackSpot,
} from "@cellr/domain";
import { ApiError } from "@/lib/api";
import { freeSpots, type FreeSpot } from "@/features/cellar/quick-add/spots";
import type { StoredBottle } from "@/features/cellar/storage3d/model";
import { shapeFor } from "@/features/cellar/wine-visuals";

/**
 * SHARED RACKS ON SCREEN (ADR-010): everything the screens decide that is not drawing. Pure, so it is tested without
 * a browser. Nothing here decides who may do what (the server does); these only arrange what the server said.
 */

// ---- Bottles ------------------------------------------------------------------------------------------------------

/** What a bottle is called in a sentence. */
export const bottleName = (b: Pick<SharedRackBottleView, "producer" | "wineName" | "year">) =>
  `${b.producer} ${b.wineName} ${formatVintage(b.year)}`;

/**
 * The bottles as the existing storage view draws them. A bottle is known by its PLACEMENT id: the one handle every
 * member has for it (the bottle's own id is only given to its own household).
 */
export const storedSharedBottles = (bottles: readonly SharedRackBottleView[]): StoredBottle[] =>
  bottles.map((b) => ({
    id: b.placementId,
    row: b.row,
    col: b.col,
    index: b.index,
    type: b.type,
    shape: shapeFor(b.type),
  }));

/** Whose bottles are shown: everyone's, mine, or one person's (by user id). Only on screen; nothing moves. */
export type OwnerFilter = "all" | "mine" | string;

export interface OwnerChoice {
  key: OwnerFilter;
  /** Null for "all" and "mine": the screen has its own words for those. */
  name: string | null;
  count: number;
  /** No longer a member of the rack: their bottles are still theirs, and still here. */
  former: boolean;
}

/**
 * The owners to choose from: everyone, me, then every other person who has a bottle in the rack or is a member, by
 * name. Someone whose account is gone has no id to filter by; their bottles are found under "all".
 */
export function ownerChoices(
  bottles: readonly SharedRackBottleView[],
  members: readonly SharedRackMemberView[],
): OwnerChoice[] {
  const others = new Map<string, OwnerChoice>();
  for (const m of members)
    if (!m.isMe)
      others.set(m.userId, {
        key: m.userId,
        name: m.displayName ?? (m.handle ? `@${m.handle}` : null),
        count: 0,
        former: false,
      });
  let mine = 0;
  for (const b of bottles) {
    if (b.mine) {
      mine += 1;
      continue;
    }
    const id = b.owner.userId;
    if (!id) continue;
    const known = others.get(id);
    if (known) known.count += 1;
    else others.set(id, { key: id, name: b.owner.name, count: 1, former: !b.owner.isMember });
  }
  return [
    { key: "all", name: null, count: bottles.length, former: false },
    { key: "mine", name: null, count: mine, former: false },
    ...[...others.values()].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "")),
  ];
}

export const matchesOwner = (b: SharedRackBottleView, filter: OwnerFilter): boolean =>
  filter === "all" ? true : filter === "mine" ? b.mine : b.owner.userId === filter;

/** A filter that names someone who is no longer among the choices falls back to everyone. */
export const validFilter = (filter: OwnerFilter, choices: readonly OwnerChoice[]): OwnerFilter =>
  choices.some((c) => c.key === filter) ? filter : "all";

/**
 * The free spots of the rack as the server would take a bottle there now. EVERY bottle counts as an occupant,
 * whatever the owner filter shows: a spot is free when nobody's bottle is on it.
 */
export const freeSpotsOf = (
  resolved: ResolvedStorage,
  bottles: readonly SharedRackBottleView[],
): FreeSpot[] =>
  freeSpots(
    resolved,
    bottles.map((b) => ({ bottleId: b.placementId, row: b.row, col: b.col, index: b.index })),
  );

export const spotOf = (b: Pick<SharedRackBottleView, "row" | "col" | "index">): SharedRackSpot => ({
  row: b.row,
  col: b.col,
  index: b.index,
});

// ---- My own bottles, to put in a rack -----------------------------------------------------------------------------

export interface Candidate {
  bottleId: string;
  vintageId: string;
  name: string;
  /** Where it stands in my own cellar now, or null: no place yet. */
  from: { unit: string; row: number; col: number } | null;
}

/**
 * The bottles of mine that can go into a shared rack: those without a place first, then those standing in a place of
 * my own (they leave it when they go into the rack). A bottle that already stands in a shared rack is not offered:
 * it has a place, even though my own cellar lists it without one.
 */
export function candidates(
  racks: RackView | undefined,
  inSharedRacks: readonly Pick<MySharedRackBottleView, "bottleId">[] | undefined,
  search = "",
): Candidate[] {
  if (!racks) return [];
  const taken = new Set((inSharedRacks ?? []).map((b) => b.bottleId));
  const name = (b: RackView["unplaced"][number]) =>
    `${b.producer} ${b.wineName} ${formatVintage(b.year)}`;
  const all: Candidate[] = [
    ...racks.unplaced.map((b) => ({
      bottleId: b.bottleId,
      vintageId: b.vintageId,
      name: name(b),
      from: null,
    })),
    ...racks.units.flatMap((u) =>
      u.bottles.flatMap((b) =>
        b.row === null || b.col === null
          ? []
          : [
              {
                bottleId: b.bottleId,
                vintageId: b.vintageId,
                name: name(b),
                from: { unit: u.label, row: b.row, col: b.col },
              },
            ],
      ),
    ),
  ].filter((c) => !taken.has(c.bottleId));
  const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return words.length === 0
    ? all
    : all.filter((c) => words.every((w) => c.name.toLowerCase().includes(w)));
}

// ---- People -------------------------------------------------------------------------------------------------------

/** Whether I can leave now, known before asking: the last owner hands the role over first, or archives the rack. */
export function canLeave(members: readonly SharedRackMemberView[]): boolean {
  const me = members.find((m) => m.isMe);
  if (!me) return false;
  const otherOwners = members.filter((m) => !m.isMe && m.role === "owner").length;
  return sharedRackLeaveProblem(me.role, otherOwners) === null;
}

export const memberName = (
  m: Pick<SharedRackMemberView, "displayName" | "handle">,
): string | null => m.displayName ?? (m.handle ? `@${m.handle}` : null);

// ---- History ------------------------------------------------------------------------------------------------------

/**
 * How one line of history is said: which sentence, and whether the bottle's owner is named next to who did it (only
 * when they differ: "Bob moved Ann's …"; a person doing something with their own bottle is named once).
 */
export interface EventLine {
  /** The message key under `sharedRacks.events`. */
  key: string;
  /** The actor and the owner are different people (or the actor is not known): both are named. */
  forSomeoneElse: boolean;
}

/** What can happen to a bottle in its own household's cellar: the sentences that exist "by the household". */
const BY_HOUSEHOLD: ReadonlySet<string> = new Set([
  "bottle_withdrawn",
  "bottle_relocated",
  "bottle_opened",
  "bottle_gifted",
  "bottle_removed",
  "bottle_deleted",
]);

export function eventLine(event: SharedRackEventView): EventLine {
  const bottle = event.type.startsWith("bottle_");
  const sameAccount =
    event.owner !== null &&
    event.actor.userId !== null &&
    event.actor.userId === event.owner.userId;
  const forSomeoneElse = bottle && event.owner !== null && !sameAccount;
  if (event.type === "member_removed" && event.detail?.reason === "account_deleted")
    return { key: "member_removed_account", forSomeoneElse: false };
  if (event.type === "rack_archived" && event.detail?.reason === "owner_account_deleted")
    return { key: "rack_archived_account", forSomeoneElse: false };
  const kind =
    event.type === "bottle_removed" && event.detail?.reason === "deleted"
      ? "bottle_deleted"
      : event.type;
  // done in the owner's own cellar by someone of that household who is not in the rack: the household is named,
  // the person is not (the server does not say who)
  if (sharedRackEventByHousehold(event) && event.owner !== null && BY_HOUSEHOLD.has(kind))
    return { key: `${kind}_household`, forSomeoneElse: true };
  if (kind === "bottle_deleted")
    return { key: forSomeoneElse ? "bottle_deleted_other" : "bottle_deleted", forSomeoneElse };
  return { key: forSomeoneElse ? `${event.type}_other` : event.type, forSomeoneElse };
}

/** Whether a line of history means the bottle left the rack (for the mark next to it). */
export const leftTheRack = (event: SharedRackEventView): boolean =>
  isSharedRackEndingEvent(event.type);

// ---- Refusals -----------------------------------------------------------------------------------------------------

/**
 * What a refused change means for the screen:
 * - `gone`: the rack is not there for me any more (I was removed, or it never was): the rack's screen closes.
 * - `refresh`: the rack is not as I saw it (a spot taken, a bottle moved or taken out): say so and read it again.
 *   Never a silent retry on another spot.
 * - `say`: anything else: say it.
 */
export type RefusalKind = "gone" | "refresh" | "say";

export function refusalKind(error: unknown, rackMessage: string): RefusalKind {
  if (!(error instanceof ApiError)) return "say";
  if (error.code === "NOT_FOUND" && error.serverMessage === rackMessage) return "gone";
  if (error.code === "CONFLICT") return "refresh";
  return "say";
}

/** The sentence the server sends for a rack I am not (or no longer) a member of. */
export const RACK_NOT_FOUND_MESSAGE = "We couldn't find that shared rack.";

/** The database has no shared racks yet (migration 0052 is not applied there). */
export const isNotSetUp = (error: unknown): boolean =>
  error instanceof ApiError && error.serverMessage === SHARED_RACKS_NOT_SET_UP;
