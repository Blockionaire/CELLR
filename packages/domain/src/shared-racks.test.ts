import { describe, expect, it } from "vitest";
import { defaultStorageConfig } from "./storage-config";
import {
  SHARED_RACK_ENDING_EVENTS,
  SHARED_RACK_EVENT_TYPES,
  SharedRackCreateSchema,
  SharedRackEventsQuerySchema,
  SharedRackLayoutSchema,
  SharedRackMoveSchema,
  SharedRackPlaceSchema,
  SharedRackRoleSchema,
  SharedRackSpotSchema,
  isSharedRackConsumedEvent,
  isSharedRackEndingEvent,
  sharedRackEventByHousehold,
  replaySharedRackEvents,
  resolveSharedRack,
  sharedRackInvitationState,
  sharedRackLeaveProblem,
  sharedRackPermissions,
  sharedRackRoleChangeProblem,
  toSharedRackView,
  type StoredSharedRack,
} from "./shared-racks";

const ID = "3f0e1c62-58a7-4a39-9d0b-7a4f2a1c9e10";
const OTHER = "9b2d6a51-0c3e-4f7a-8e21-5d4c3b2a1f00";

const stored = (over: Partial<StoredSharedRack> = {}): StoredSharedRack => ({
  id: ID,
  name: "Office rack",
  role: "member",
  archivedAt: null,
  kind: "rack",
  template: "rack_classic",
  slotSemantics: "depth",
  rows: 5,
  cols: 12,
  cellCapacity: 1,
  appearance: null,
  revision: "3",
  memberCount: 3,
  bottleCount: 14,
  myBottleCount: 5,
  createdAt: "2026-11-23T10:00:00Z",
  ...over,
});

describe("who may do what in a shared rack", () => {
  it("a member reorganises and records, an owner also manages", () => {
    expect(sharedRackPermissions("member", false)).toEqual({
      manageRack: false,
      archive: false,
      restore: false,
      manageMembers: false,
      invite: false,
      place: true,
      move: true,
      takeOut: true,
    });
    expect(sharedRackPermissions("owner", false)).toEqual({
      manageRack: true,
      archive: true,
      restore: false,
      manageMembers: true,
      invite: true,
      place: true,
      move: true,
      takeOut: true,
    });
  });

  it("an archived rack only lets bottles out (and an owner restore it or manage its people)", () => {
    expect(sharedRackPermissions("member", true)).toMatchObject({
      place: false,
      move: false,
      takeOut: true,
      manageRack: false,
    });
    expect(sharedRackPermissions("owner", true)).toMatchObject({
      place: false,
      move: false,
      takeOut: true,
      manageRack: false,
      invite: false,
      archive: false,
      restore: true,
      manageMembers: true,
    });
  });

  it("there is no permission that changes whose bottle it is", () => {
    for (const role of ["owner", "member"] as const)
      for (const archived of [false, true])
        expect(Object.keys(sharedRackPermissions(role, archived)).join(" ")).not.toMatch(
          /owner|transfer|assign/i,
        );
  });

  it("the last owner cannot leave or step down; anyone else can", () => {
    expect(sharedRackLeaveProblem("owner", 0)).toBe("last_owner");
    expect(sharedRackLeaveProblem("owner", 1)).toBeNull();
    expect(sharedRackLeaveProblem("member", 0)).toBeNull();
    expect(sharedRackRoleChangeProblem({ from: "owner", to: "member", otherOwners: 0 })).toBe(
      "last_owner",
    );
    expect(sharedRackRoleChangeProblem({ from: "owner", to: "member", otherOwners: 1 })).toBeNull();
    expect(sharedRackRoleChangeProblem({ from: "member", to: "owner", otherOwners: 0 })).toBeNull();
    expect(sharedRackRoleChangeProblem({ from: "member", to: "member", otherOwners: 3 })).toBe(
      "unchanged",
    );
  });
});

describe("invitations", () => {
  const now = new Date("2026-11-23T12:00:00Z");
  it("a pending one past its date is expired", () => {
    expect(sharedRackInvitationState("pending", "2026-11-24T12:00:00Z", now)).toBe("pending");
    expect(sharedRackInvitationState("pending", "2026-11-23T12:00:00Z", now)).toBe("expired");
    expect(sharedRackInvitationState("pending", "2026-11-01T12:00:00Z", now)).toBe("expired");
  });
  it("an answered one stays what it was, whatever the date", () => {
    for (const state of ["accepted", "declined", "cancelled"] as const)
      expect(sharedRackInvitationState(state, "2026-11-01T12:00:00Z", now)).toBe(state);
  });
  it("a state this version does not know is never read as open", () => {
    expect(sharedRackInvitationState("something_new", "2027-01-01T00:00:00Z", now)).toBe(
      "cancelled",
    );
  });
});

describe("a rack as its members see it", () => {
  it("is read through the same rules as a place of one's own cellar", () => {
    const view = toSharedRackView(stored());
    expect(view).toMatchObject({
      id: ID,
      name: "Office rack",
      role: "member",
      archived: false,
      kind: "rack",
      templateId: "rack_classic",
      layoutTemplateId: "rack_classic",
      family: "grid",
      rows: 5,
      cols: 12,
      cellCapacity: 1,
      indexMeaning: "single",
      capacity: 60,
      occupied: 14,
      free: 46,
      arrangementKnown: true,
      fallbacks: [],
      revision: "3",
      memberCount: 3,
      myBottleCount: 5,
    });
    expect(view.appearance.v).toBe(1);
    expect(view.permissions).toEqual(sharedRackPermissions("member", false));
  });

  it("resolves to what the renderer draws: the template's layout over the rack's own size", () => {
    const resolved = resolveSharedRack(toSharedRackView(stored()));
    expect(resolved.arrangementKnown).toBe(true);
    expect(resolved.legacy).toBe(false);
    expect(resolved.template.id).toBe("rack_classic");
    expect(resolved.layout.cells).toHaveLength(60);
  });

  it("a template this server does not know is shown as stored, and claimed as nothing", () => {
    const view = toSharedRackView(stored({ template: "rack_from_the_future" }));
    expect(view.templateId).toBe("rack_from_the_future");
    expect(view.arrangementKnown).toBe(false);
    expect(view.fallbacks).toContain("unknown_template");
    expect(view.capacity).toBe(60);
  });

  it("an archived rack says so, and its permissions follow", () => {
    const view = toSharedRackView(stored({ role: "owner", archivedAt: "2026-11-23T11:00:00Z" }));
    expect(view.archived).toBe(true);
    expect(view.permissions.place).toBe(false);
    expect(view.permissions.restore).toBe(true);
  });

  it("never reports less than nothing free", () => {
    expect(toSharedRackView(stored({ bottleCount: 99 })).free).toBe(0);
  });
});

describe("what the API takes", () => {
  const config = defaultStorageConfig("rack_classic");

  it("a rack is a name and a layout from the catalogue", () => {
    const made = SharedRackCreateSchema.parse({ name: "  Office rack ", ...config });
    expect(made.name).toBe("Office rack");
    expect(made.structure.template).toBe("rack_classic");
  });

  it("refuses a name that is empty or too long, an unknown template and a size the template does not come in", () => {
    expect(SharedRackCreateSchema.safeParse({ name: "   ", ...config }).success).toBe(false);
    expect(SharedRackCreateSchema.safeParse({ name: "x".repeat(61), ...config }).success).toBe(
      false,
    );
    expect(
      SharedRackCreateSchema.safeParse({
        name: "Rack",
        ...config,
        structure: { ...config.structure, template: "rack_from_the_future" },
      }).success,
    ).toBe(false);
    expect(
      SharedRackCreateSchema.safeParse({
        name: "Rack",
        ...config,
        structure: { ...config.structure, rows: 99 },
      }).success,
    ).toBe(false);
  });

  it("refuses temperature zones: a shared rack has none yet", () => {
    const cooler = defaultStorageConfig("cooler_dual");
    expect(cooler.structure.zones.length).toBeGreaterThan(0);
    const refused = SharedRackLayoutSchema.safeParse(cooler);
    expect(refused.success).toBe(false);
    expect(refused.error?.issues.map((i) => i.message)).toContain(
      "A shared rack has no temperature zones.",
    );
    expect(
      SharedRackLayoutSchema.safeParse({ ...cooler, structure: { ...cooler.structure, zones: [] } })
        .success,
    ).toBe(true);
    expect(SharedRackCreateSchema.safeParse({ name: "Cooler", ...cooler }).success).toBe(false);
  });

  it("refuses a look the template does not offer", () => {
    expect(
      SharedRackLayoutSchema.safeParse({
        ...config,
        appearance: { ...config.appearance, door: "glass" },
      }).success,
    ).toBe(false);
  });

  it("a spot is whole: the index is 1 unless said", () => {
    expect(SharedRackSpotSchema.parse({ row: 2, col: 3 })).toEqual({ row: 2, col: 3, index: 1 });
    expect(SharedRackSpotSchema.safeParse({ row: 0, col: 3 }).success).toBe(false);
    expect(SharedRackSpotSchema.safeParse({ row: 2, col: 31 }).success).toBe(false);
    expect(SharedRackSpotSchema.safeParse({ row: 2, col: 3, index: 17 }).success).toBe(false);
    expect(SharedRackSpotSchema.safeParse({ row: 2, col: 3, locationId: ID }).success).toBe(false);
  });

  it("placing takes a bottle and a spot, and nothing that names an owner or an actor", () => {
    const to = { row: 1, col: 1, index: 1 };
    expect(SharedRackPlaceSchema.safeParse({ bottleId: ID, to }).success).toBe(true);
    for (const forged of [
      "ownerId",
      "ownerUserId",
      "owner",
      "actorId",
      "userId",
      "householdId",
      "placedBy",
    ])
      expect(
        SharedRackPlaceSchema.safeParse({ bottleId: ID, to, [forged]: OTHER }).success,
        forged,
      ).toBe(false);
    for (const forged of ["ownerId", "actorId", "userId", "bottleId"])
      expect(
        SharedRackMoveSchema.safeParse({ from: to, to, [forged]: OTHER }).success,
        forged,
      ).toBe(false);
  });

  it("a role is owner or member", () => {
    expect(SharedRackRoleSchema.safeParse({ role: "owner" }).success).toBe(true);
    expect(SharedRackRoleSchema.safeParse({ role: "admin" }).success).toBe(false);
  });

  it("reads the history's query from the address: nothing given is the first page", () => {
    expect(
      SharedRackEventsQuerySchema.parse({
        before: null,
        limit: null,
        owner: null,
        actor: null,
        placement: null,
        bottle: null,
      }),
    ).toEqual({ limit: 50 });
    expect(
      SharedRackEventsQuerySchema.parse({
        before: "120",
        limit: "20",
        owner: ID,
        actor: "",
        placement: OTHER,
        bottle: null,
      }),
    ).toEqual({ before: 120, limit: 20, owner: ID, placement: OTHER });
    expect(SharedRackEventsQuerySchema.safeParse({ limit: "101" }).success).toBe(false);
    expect(SharedRackEventsQuerySchema.safeParse({ limit: "0" }).success).toBe(false);
    expect(SharedRackEventsQuerySchema.safeParse({ before: "abc" }).success).toBe(false);
    expect(SharedRackEventsQuerySchema.safeParse({ owner: "not-an-id" }).success).toBe(false);
  });
});

describe("the vocabulary of the history", () => {
  it("every ending is an event, and only opening means consumed", () => {
    for (const type of SHARED_RACK_ENDING_EVENTS) expect(SHARED_RACK_EVENT_TYPES).toContain(type);
    expect(SHARED_RACK_EVENT_TYPES.filter(isSharedRackConsumedEvent)).toEqual(["bottle_opened"]);
    expect(isSharedRackEndingEvent("bottle_taken_out")).toBe(true);
    expect(isSharedRackConsumedEvent("bottle_taken_out")).toBe(false);
    expect(isSharedRackConsumedEvent("bottle_relocated")).toBe(false);
    expect(isSharedRackEndingEvent("bottle_moved")).toBe(false);
    expect(isSharedRackEndingEvent("member_left")).toBe(false);
  });

  it("a change by someone of the owner's household who is not in the rack is marked, and names nobody", () => {
    expect(sharedRackEventByHousehold({ detail: { by: "owners_household" } })).toBe(true);
    expect(
      sharedRackEventByHousehold({ detail: { by: "owners_household", reason: "deleted" } }),
    ).toBe(true);
    expect(sharedRackEventByHousehold({ detail: { reason: "deleted" } })).toBe(false);
    expect(sharedRackEventByHousehold({ detail: null })).toBe(false);
  });
});

describe("replaying a history", () => {
  const spot = (row: number, col: number) => ({ row, col, index: 1 });
  const placed = (seq: number, placementId: string, to: ReturnType<typeof spot>) =>
    ({ seq, type: "bottle_placed", placementId, from: null, to }) as const;
  const moved = (
    seq: number,
    placementId: string,
    from: ReturnType<typeof spot>,
    to: ReturnType<typeof spot>,
  ) => ({ seq, type: "bottle_moved", placementId, from, to }) as const;
  const ended = (seq: number, placementId: string, from: ReturnType<typeof spot>) =>
    ({ seq, type: "bottle_taken_out", placementId, from, to: null }) as const;

  it("gives the occupancy the history describes, in whatever order the lines arrive", () => {
    const history = [
      ended(5, "b", spot(2, 2)),
      placed(1, "a", spot(1, 1)),
      { seq: 3, type: "member_joined", placementId: null, from: null, to: null } as const,
      moved(4, "a", spot(1, 1), spot(3, 3)),
      placed(2, "b", spot(2, 2)),
      placed(6, "c", spot(1, 1)),
    ];
    expect([...(replaySharedRackEvents(history) ?? [])]).toEqual([
      ["a", spot(3, 3)],
      ["c", spot(1, 1)],
    ]);
  });

  it("notices a lost line, a doubled line and a bottle on a taken spot", () => {
    expect(replaySharedRackEvents([moved(2, "a", spot(1, 1), spot(2, 2))])).toBeNull();
    expect(
      replaySharedRackEvents([
        placed(1, "a", spot(1, 1)),
        ended(2, "a", spot(1, 1)),
        ended(3, "a", spot(1, 1)),
      ]),
    ).toBeNull();
    expect(
      replaySharedRackEvents([placed(1, "a", spot(1, 1)), placed(2, "a", spot(2, 2))]),
    ).toBeNull();
    expect(
      replaySharedRackEvents([placed(1, "a", spot(1, 1)), placed(2, "b", spot(1, 1))]),
    ).toBeNull();
    expect(
      replaySharedRackEvents([
        placed(1, "a", spot(1, 1)),
        placed(2, "b", spot(2, 2)),
        moved(3, "a", spot(1, 1), spot(2, 2)),
      ]),
    ).toBeNull();
    expect(
      replaySharedRackEvents([placed(1, "a", spot(1, 1)), moved(2, "a", spot(4, 4), spot(2, 2))]),
    ).toBeNull();
  });
});
