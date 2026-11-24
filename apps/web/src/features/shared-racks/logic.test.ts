import { describe, expect, it } from "vitest";
import {
  SHARED_RACKS_NOT_SET_UP,
  resolveStorage,
  type RackView,
  type SharedRackBottleView,
  type SharedRackEventView,
  type SharedRackMemberView,
} from "@cellr/domain";
import { ApiError } from "@/lib/api";
import {
  RACK_NOT_FOUND_MESSAGE,
  bottleName,
  canLeave,
  candidates,
  eventLine,
  freeSpotsOf,
  isNotSetUp,
  matchesOwner,
  ownerChoices,
  refusalKind,
  storedSharedBottles,
  validFilter,
} from "./logic";

const ANN = "a1111111-1111-4111-8111-111111111111";
const BOB = "b2222222-2222-4222-8222-222222222222";
const CY = "c3333333-3333-4333-8333-333333333333";

const bottle = (over: Partial<SharedRackBottleView> = {}): SharedRackBottleView => ({
  placementId: "p-1",
  bottleId: null,
  row: 1,
  col: 1,
  index: 1,
  owner: { userId: BOB, name: "Bob", isMember: true },
  mine: false,
  placedBy: "Bob",
  placedAt: "2026-11-23T10:00:00Z",
  movedAt: null,
  producer: "Estate",
  wineName: "Barolo",
  year: 2019,
  type: "red",
  region: null,
  countryCode: null,
  formatMl: 750,
  ...over,
});
const member = (over: Partial<SharedRackMemberView>): SharedRackMemberView => ({
  userId: ANN,
  displayName: "Ann",
  handle: null,
  role: "member",
  joinedAt: "2026-11-23T10:00:00Z",
  bottleCount: 0,
  isMe: false,
  ...over,
});
const RACK = resolveStorage({
  kind: "rack",
  rows: 2,
  cols: 3,
  template: "rack_classic",
  cellCapacity: 1,
  semantics: "depth",
});

describe("bottles in a shared rack", () => {
  it("are drawn by their placement id, never by a bottle id", () => {
    const [stored] = storedSharedBottles([
      bottle({ placementId: "p-9", bottleId: "secret", row: 2, col: 3 }),
    ]);
    expect(stored).toMatchObject({ id: "p-9", row: 2, col: 3, index: 1, type: "red" });
    expect(JSON.stringify(stored)).not.toContain("secret");
    expect(bottleName(bottle({ year: null }))).toBe("Estate Barolo NV");
  });

  it("owners to choose from: everyone, me, then the others by name; a former member still has their bottles", () => {
    const choices = ownerChoices(
      [
        bottle({
          placementId: "1",
          mine: true,
          owner: { userId: ANN, name: "Ann", isMember: true },
        }),
        bottle({ placementId: "2" }),
        bottle({ placementId: "3" }),
        bottle({ placementId: "4", owner: { userId: CY, name: "Cy", isMember: false } }),
        bottle({ placementId: "5", owner: { userId: null, name: "Gone", isMember: false } }),
      ],
      [member({ isMe: true }), member({ userId: BOB, displayName: "Bob" })],
    );
    expect(choices).toEqual([
      { key: "all", name: null, count: 5, former: false },
      { key: "mine", name: null, count: 1, former: false },
      { key: BOB, name: "Bob", count: 2, former: false },
      { key: CY, name: "Cy", count: 1, former: true },
    ]);
  });

  it("a member without bottles can still be chosen, by name or account name", () => {
    const choices = ownerChoices([], [member({ userId: BOB, displayName: null, handle: "bob.b" })]);
    expect(choices.at(-1)).toEqual({ key: BOB, name: "@bob.b", count: 0, former: false });
  });

  it("the filter only chooses what is shown", () => {
    const mine = bottle({ mine: true, owner: { userId: ANN, name: "Ann", isMember: true } });
    const bobs = bottle();
    expect([mine, bobs].filter((b) => matchesOwner(b, "all"))).toHaveLength(2);
    expect([mine, bobs].filter((b) => matchesOwner(b, "mine"))).toEqual([mine]);
    expect([mine, bobs].filter((b) => matchesOwner(b, BOB))).toEqual([bobs]);
    expect(validFilter(CY, ownerChoices([mine, bobs], []))).toBe("all");
    expect(validFilter(BOB, ownerChoices([mine, bobs], []))).toBe(BOB);
  });

  it("a spot is free only when NOBODY's bottle is on it, whatever the filter shows", () => {
    const free = freeSpotsOf(RACK, [
      bottle({ row: 1, col: 1 }),
      bottle({ placementId: "p-2", row: 2, col: 3 }),
    ]);
    expect(free.map((s) => `${s.row}:${s.col}`)).toEqual(["1:2", "1:3", "2:1", "2:2"]);
    expect(free.every((s) => s.index === 1)).toBe(true);
  });
});

describe("my own bottles to put in a rack", () => {
  const placed = (bottleId: string, wineName: string, row: number | null, col: number | null) => ({
    bottleId,
    vintageId: `v-${bottleId}`,
    producer: "Estate",
    wineName,
    type: "red" as const,
    year: 2019,
    region: null,
    countryCode: null,
    row,
    col,
    image: null,
  });
  const racks = {
    units: [
      {
        id: "u",
        label: "Home rack",
        bottles: [placed("b3", "Chianti", 2, 4), placed("b4", "Rioja", null, null)],
      },
    ],
    unplaced: [placed("b1", "Barolo", null, null), placed("b2", "Riesling", null, null)],
  } as unknown as RackView;

  it("those without a place first, then those in a place of mine; never one that already stands in a shared rack", () => {
    expect(
      candidates(racks, [{ bottleId: "b2" }]).map((c) => [c.bottleId, c.from?.unit ?? null]),
    ).toEqual([
      ["b1", null],
      ["b3", "Home rack"],
    ]);
  });

  it("searchable by any word of the name", () => {
    expect(candidates(racks, [], "estate chi").map((c) => c.bottleId)).toEqual(["b3"]);
    expect(candidates(racks, [], "  ").length).toBe(3);
    expect(candidates(racks, [], "nothing")).toEqual([]);
    expect(candidates(undefined, [])).toEqual([]);
  });
});

describe("leaving", () => {
  it("the last owner cannot; anyone else can; an owner with another owner can", () => {
    expect(canLeave([member({ isMe: true, role: "owner" }), member({ userId: BOB })])).toBe(false);
    expect(
      canLeave([member({ isMe: true, role: "owner" }), member({ userId: BOB, role: "owner" })]),
    ).toBe(true);
    expect(canLeave([member({ isMe: true }), member({ userId: BOB, role: "owner" })])).toBe(true);
    expect(canLeave([member({ userId: BOB, role: "owner" })])).toBe(false);
  });
});

describe("a line of history", () => {
  const event = (over: Partial<SharedRackEventView>): SharedRackEventView => ({
    seq: 1,
    type: "bottle_moved",
    occurredAt: "2026-11-23T10:00:00Z",
    actor: { userId: BOB, name: "Bob" },
    owner: { userId: ANN, name: "Ann" },
    subject: null,
    placementId: "p-1",
    bottleId: null,
    wine: null,
    from: null,
    to: null,
    detail: null,
    ...over,
  });

  it("names the owner next to the actor only when they differ", () => {
    expect(eventLine(event({}))).toEqual({ key: "bottle_moved_other", forSomeoneElse: true });
    expect(eventLine(event({ actor: { userId: ANN, name: "Ann" } }))).toEqual({
      key: "bottle_moved",
      forSomeoneElse: false,
    });
    expect(eventLine(event({ type: "bottle_taken_out" })).key).toBe("bottle_taken_out_other");
    expect(
      eventLine(event({ type: "bottle_opened", actor: { userId: ANN, name: "Ann" } })).key,
    ).toBe("bottle_opened");
  });

  it("an actor or owner whose account is gone is never taken for the same person", () => {
    expect(
      eventLine(
        event({ actor: { userId: null, name: "Ann" }, owner: { userId: null, name: "Ann" } }),
      ).key,
    ).toBe("bottle_moved_other");
  });

  it("says a deleted record and a deleted account as what they were", () => {
    expect(
      eventLine(
        event({
          type: "bottle_removed",
          detail: { reason: "deleted" },
          actor: { userId: ANN, name: "Ann" },
        }),
      ).key,
    ).toBe("bottle_deleted");
    expect(eventLine(event({ type: "bottle_removed", detail: { reason: "removed" } })).key).toBe(
      "bottle_removed_other",
    );
    expect(
      eventLine(
        event({ type: "member_removed", owner: null, detail: { reason: "account_deleted" } }),
      ).key,
    ).toBe("member_removed_account");
    expect(
      eventLine(
        event({ type: "rack_archived", owner: null, detail: { reason: "owner_account_deleted" } }),
      ).key,
    ).toBe("rack_archived_account");
    expect(eventLine(event({ type: "member_joined", owner: null })).key).toBe("member_joined");
  });
});

describe("a refused change", () => {
  it("a rack that is no longer mine closes the screen; a conflict refreshes it; anything else is said", () => {
    expect(
      refusalKind(new ApiError("NOT_FOUND", RACK_NOT_FOUND_MESSAGE, false), RACK_NOT_FOUND_MESSAGE),
    ).toBe("gone");
    expect(
      refusalKind(
        new ApiError("NOT_FOUND", "We couldn't find that bottle.", false),
        RACK_NOT_FOUND_MESSAGE,
      ),
    ).toBe("say");
    expect(
      refusalKind(
        new ApiError("CONFLICT", "That spot was just taken. Pick another.", true),
        RACK_NOT_FOUND_MESSAGE,
      ),
    ).toBe("refresh");
    expect(refusalKind(new ApiError("NETWORK", "", true), RACK_NOT_FOUND_MESSAGE)).toBe("say");
    expect(refusalKind(new Error("x"), RACK_NOT_FOUND_MESSAGE)).toBe("say");
  });

  it("knows a database without shared racks", () => {
    expect(isNotSetUp(new ApiError("NOT_FOUND", SHARED_RACKS_NOT_SET_UP, false))).toBe(true);
    expect(isNotSetUp(new ApiError("NOT_FOUND", RACK_NOT_FOUND_MESSAGE, false))).toBe(false);
    expect(isNotSetUp(null)).toBe(false);
  });
});
