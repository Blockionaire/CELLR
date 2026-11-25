import { describe, expect, it } from "vitest";
import {
  STALE_LAYOUT_MESSAGE,
  defaultStorageConfig,
  isDomainError,
  type SharedRackBottleView,
  type SharedRackEventView,
  type StoredSharedRack,
} from "@cellr/domain";
import { knownMessage } from "@/lib/known-messages";
import { SHARED_RACK_MESSAGES as M, createSharedRacksService } from "./service";
import type { SharedRacksRepository } from "./types";

const RACK = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const BOTTLE = "33333333-3333-4333-8333-333333333333";
const PLACEMENT = "44444444-4444-4444-8444-444444444444";
const INVITATION = "55555555-5555-4555-8555-555555555555";
const OPEN = { open: true, writes: true };
const READS = { open: true, writes: false };
const CLOSED = { open: false, writes: false };
const spot = (row: number, col: number, index = 1) => ({ row, col, index });
const CONFIG = defaultStorageConfig("rack_classic");

const stored = (over: Partial<StoredSharedRack> = {}): StoredSharedRack => ({
  id: RACK,
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
  bottleCount: 2,
  myBottleCount: 1,
  createdAt: "2026-11-23T10:00:00Z",
  ...over,
});

type Answers = {
  [K in keyof SharedRacksRepository]?: Awaited<ReturnType<SharedRacksRepository[K]>>;
};

/** A repository in memory: it answers what the test says, and records every call made to it. */
function fakeRepo(answers: Answers = {}, rack: StoredSharedRack | null = stored()) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const defaults: Answers = {
    listRacks: rack ? [rack] : [],
    getRack: rack,
    members: [],
    bottles: [],
    events: [],
    rackInvitations: [],
    myInvitations: [],
    myBottles: [],
  };
  const repo = new Proxy({} as SharedRacksRepository, {
    get:
      (_, method: string) =>
      (...args: unknown[]) => {
        calls.push({ method, args });
        const all = { ...defaults, ...answers } as Record<string, unknown>;
        if (!(method in all)) throw new Error(`unexpected repository call ${method}`);
        return Promise.resolve(all[method]);
      },
  });
  return { repo, calls, writes: () => calls.filter((c) => !READ_METHODS.has(c.method)) };
}
const READ_METHODS = new Set([
  "listRacks",
  "getRack",
  "members",
  "bottles",
  "events",
  "rackInvitations",
  "myInvitations",
  "myBottles",
]);

const caught = async (run: () => unknown) => {
  try {
    await run();
  } catch (error) {
    if (isDomainError(error))
      return { code: error.code, message: error.message, retryable: error.retryable };
    throw error;
  }
  throw new Error("nothing was thrown");
};

type Service = ReturnType<typeof createSharedRacksService>;
/** Every way in, as a route would call it. */
const EVERY_CALL: Array<[string, boolean, (s: Service) => unknown]> = [
  ["guard", false, (s) => s.guard()],
  ["list", false, (s) => s.list()],
  ["rack", false, (s) => s.rack(RACK)],
  ["members", false, (s) => s.members(RACK)],
  ["invitations", false, (s) => s.invitations(RACK)],
  ["myInvitations", false, (s) => s.myInvitations()],
  ["bottles", false, (s) => s.bottles(RACK)],
  ["events", false, (s) => s.events(RACK, { limit: 50 })],
  ["myBottles", false, (s) => s.myBottles()],
  ["guardWrites", true, (s) => s.guardWrites()],
  ["create", true, (s) => s.create({ name: "Office", ...CONFIG })],
  ["rename", true, (s) => s.rename(RACK, "Office 2")],
  ["saveLayout", true, (s) => s.saveLayout(RACK, CONFIG)],
  ["archive", true, (s) => s.setArchived(RACK, true)],
  ["restore", true, (s) => s.setArchived(RACK, false)],
  ["setRole", true, (s) => s.setRole(RACK, USER, "owner")],
  ["removeMember", true, (s) => s.removeMember(RACK, USER)],
  ["leave", true, (s) => s.leave(RACK)],
  ["invite", true, (s) => s.invite(RACK, USER)],
  ["respond", true, (s) => s.respond(INVITATION, true)],
  ["cancelInvitation", true, (s) => s.cancelInvitation(INVITATION)],
  ["place", true, (s) => s.place(RACK, { bottleId: BOTTLE, to: spot(1, 1) })],
  ["move", true, (s) => s.move(RACK, PLACEMENT, { from: spot(1, 1), to: spot(2, 2) })],
  ["takeOut", true, (s) => s.takeOut(RACK, PLACEMENT, { from: spot(1, 1) })],
  ["withdraw", true, (s) => s.withdraw(BOTTLE)],
];

describe("the gate", () => {
  it("closed: every call is 'not found', and the database is never asked", async () => {
    const { repo, calls } = fakeRepo();
    const service = createSharedRacksService({ repo, access: CLOSED });
    for (const [name, , call] of EVERY_CALL)
      expect(await caught(() => call(service)), name).toMatchObject({ code: "NOT_FOUND" });
    expect(calls).toEqual([]);
  });

  it("open without writes: reads answer; every write is 'forbidden' before anything is asked or written", async () => {
    const { repo, calls, writes } = fakeRepo({}, stored({ role: "owner" }));
    const service = createSharedRacksService({ repo, access: READS });
    for (const [name, isWrite, call] of EVERY_CALL) {
      if (!isWrite) {
        await call(service);
        continue;
      }
      const before = calls.length;
      expect(await caught(() => call(service)), name).toMatchObject({
        code: "FORBIDDEN",
        message: M.closed,
      });
      expect(calls.length, name).toBe(before);
    }
    expect(writes()).toEqual([]);
    expect((await service.list()).writes).toBe(false);
  });
});

describe("someone who is not a member", () => {
  it("is told 'not found' for every read, never 'forbidden': an id says nothing", async () => {
    const { repo } = fakeRepo({}, null);
    const service = createSharedRacksService({ repo, access: OPEN });
    for (const call of [
      () => service.rack(RACK),
      () => service.members(RACK),
      () => service.invitations(RACK),
      () => service.bottles(RACK),
      () => service.events(RACK, { limit: 50 }),
    ])
      expect(await caught(call)).toEqual({
        code: "NOT_FOUND",
        message: M.rackNotFound,
        retryable: false,
      });
    expect((await service.list()).racks).toEqual([]);
  });

  it("...and for every write, exactly as the database answers it", async () => {
    const { repo, writes } = fakeRepo(
      {
        rename: "not_found",
        saveLayout: { outcome: "not_found" },
        setArchived: "not_found",
        setRole: "not_found",
        removeMember: "not_found",
        leave: "not_found",
        invite: { outcome: "not_found" },
        takeOut: { outcome: "not_found" },
      },
      null,
    );
    const service = createSharedRacksService({ repo, access: OPEN });
    for (const call of [
      () => service.rename(RACK, "Mine now"),
      () => service.saveLayout(RACK, CONFIG),
      () => service.setArchived(RACK, true),
      () => service.setRole(RACK, USER, "owner"),
      () => service.removeMember(RACK, USER),
      () => service.leave(RACK),
      () => service.invite(RACK, USER),
      () => service.takeOut(RACK, PLACEMENT, { from: spot(1, 1) }),
      // placing and moving look at the rack first: there is none for this person
      () => service.place(RACK, { bottleId: BOTTLE, to: spot(1, 1) }),
      () => service.move(RACK, PLACEMENT, { from: spot(1, 1), to: spot(2, 2) }),
    ])
      expect(await caught(call)).toMatchObject({ code: "NOT_FOUND", message: M.rackNotFound });
    expect(writes().map((c) => c.method)).not.toContain("place");
    expect(writes().map((c) => c.method)).not.toContain("move");
  });
});

describe("a member who is not an owner", () => {
  it("is told so (403) for what only owners do", async () => {
    const { repo } = fakeRepo({
      rename: "forbidden",
      saveLayout: { outcome: "forbidden" },
      setArchived: "forbidden",
      setRole: "forbidden",
      removeMember: "forbidden",
      invite: { outcome: "forbidden" },
      cancelInvitation: "forbidden",
    });
    const service = createSharedRacksService({ repo, access: OPEN });
    for (const call of [
      () => service.rename(RACK, "x"),
      () => service.saveLayout(RACK, CONFIG),
      () => service.setArchived(RACK, true),
      () => service.setRole(RACK, USER, "owner"),
      () => service.removeMember(RACK, USER),
      () => service.invite(RACK, USER),
      () => service.cancelInvitation(INVITATION),
      () => service.invitations(RACK),
    ])
      expect(await caught(call)).toEqual({
        code: "FORBIDDEN",
        message: M.ownerOnly,
        retryable: false,
      });
  });

  it("reads the rack with what they may do", async () => {
    const { repo } = fakeRepo();
    const rack = await createSharedRacksService({ repo, access: OPEN }).rack(RACK);
    expect(rack.permissions).toMatchObject({
      place: true,
      move: true,
      takeOut: true,
      manageRack: false,
      invite: false,
    });
  });
});

describe("making and changing a rack", () => {
  it("the template decides the kind and what an index means, never the request", async () => {
    const { repo, calls } = fakeRepo({ create: { outcome: "created", rackId: RACK } });
    const cooler = defaultStorageConfig("cooler_single");
    await createSharedRacksService({ repo, access: OPEN }).create({
      name: "Office cooler",
      structure: { ...cooler.structure, zones: [] },
      appearance: cooler.appearance,
    });
    expect(calls[0]).toEqual({
      method: "create",
      args: [
        "Office cooler",
        {
          kind: "fridge",
          template: "cooler_single",
          semantics: "depth",
          rows: cooler.structure.rows,
          cols: cooler.structure.cols,
          cellCapacity: 1,
          appearance: cooler.appearance,
        },
      ],
    });
  });

  it("says why a rack cannot be made", async () => {
    for (const [outcome, message] of [
      ["too_many", M.tooMany],
      ["depth_not_enabled", M.depth],
    ] as const) {
      const { repo } = fakeRepo({ create: { outcome } });
      expect(
        await caught(() =>
          createSharedRacksService({ repo, access: OPEN }).create({ name: "x", ...CONFIG }),
        ),
      ).toMatchObject({ code: "CONFLICT", message });
    }
  });

  it("a layout save sends the version it started from to the database, which compares it", async () => {
    const { repo, calls } = fakeRepo({ saveLayout: { outcome: "saved" } });
    const service = createSharedRacksService({ repo, access: OPEN });
    await service.saveLayout(RACK, CONFIG, "3");
    await service.saveLayout(RACK, CONFIG);
    expect(calls.filter((c) => c.method === "saveLayout").map((c) => c.args[2])).toEqual([
      "3",
      null,
    ]);
  });

  it("a version that is not a version is stale, and nothing is asked", async () => {
    const { repo, calls } = fakeRepo({ saveLayout: { outcome: "saved" } });
    const service = createSharedRacksService({ repo, access: OPEN });
    for (const revision of ["abc", "3;drop", "-1", "1.5", "2026-11-23 10:00:00+00", "9".repeat(16)])
      expect(
        await caught(() => service.saveLayout(RACK, CONFIG, revision)),
        revision,
      ).toMatchObject({
        code: "CONFLICT",
        message: STALE_LAYOUT_MESSAGE,
      });
    expect(calls).toEqual([]);
  });

  it("says why a layout was not saved", async () => {
    for (const [outcome, code, message] of [
      ["stale", "CONFLICT", STALE_LAYOUT_MESSAGE],
      ["in_use", "CONFLICT", M.inUse],
      ["semantics_change", "CONFLICT", M.semantics],
      ["depth_not_enabled", "CONFLICT", M.depth],
      ["archived", "CONFLICT", M.archived],
    ] as const) {
      const { repo } = fakeRepo({ saveLayout: { outcome } });
      expect(
        await caught(() =>
          createSharedRacksService({ repo, access: OPEN }).saveLayout(RACK, CONFIG, "3"),
        ),
        outcome,
      ).toMatchObject({ code, message });
    }
  });

  it("archiving or restoring twice is not an error", async () => {
    const { repo } = fakeRepo(
      { setArchived: "unchanged" },
      stored({ role: "owner", archivedAt: "2026-11-23T11:00:00Z" }),
    );
    expect(
      (await createSharedRacksService({ repo, access: OPEN }).setArchived(RACK, true)).archived,
    ).toBe(true);
  });
});

describe("people", () => {
  it("says why a role cannot change, why someone cannot be removed, and why I cannot leave", async () => {
    const cases: Array<[Answers, (s: Service) => unknown, string, string]> = [
      [{ setRole: "last_owner" }, (s) => s.setRole(RACK, USER, "member"), "CONFLICT", M.needsOwner],
      [
        { setRole: "no_such_member" },
        (s) => s.setRole(RACK, USER, "owner"),
        "NOT_FOUND",
        M.notMember,
      ],
      [{ removeMember: "invalid" }, (s) => s.removeMember(RACK, USER), "VALIDATION", M.removeSelf],
      [
        { removeMember: "no_such_member" },
        (s) => s.removeMember(RACK, USER),
        "NOT_FOUND",
        M.notMember,
      ],
      [{ leave: "last_owner" }, (s) => s.leave(RACK), "CONFLICT", M.lastOwner],
    ];
    for (const [answers, call, code, message] of cases) {
      const { repo } = fakeRepo(answers);
      const service = createSharedRacksService({ repo, access: OPEN });
      expect(await caught(() => call(service)), message).toMatchObject({ code, message });
    }
  });

  it("a role that is already so is fine", async () => {
    const { repo } = fakeRepo({ setRole: "unchanged" });
    expect(
      await createSharedRacksService({ repo, access: OPEN }).setRole(RACK, USER, "owner"),
    ).toEqual({
      userId: USER,
      role: "owner",
    });
  });

  it("an owner sees the rack's invitations", async () => {
    const { repo } = fakeRepo({}, stored({ role: "owner" }));
    expect(await createSharedRacksService({ repo, access: OPEN }).invitations(RACK)).toEqual({
      invitations: [],
    });
  });

  it("says why someone cannot be invited; inviting again is the same invitation", async () => {
    for (const [outcome, code, message] of [
      ["invalid", "VALIDATION", M.inviteSelf],
      ["no_such_user", "NOT_FOUND", M.personNotFound],
      ["already_member", "CONFLICT", M.alreadyMember],
      ["recently_declined", "CONFLICT", M.recentlyDeclined],
      ["person_limit", "CONFLICT", M.personLimit],
      ["full", "CONFLICT", M.full],
      ["too_many", "CONFLICT", M.tooManyInvitations],
      ["archived", "CONFLICT", M.archived],
    ] as const) {
      const { repo } = fakeRepo({ invite: { outcome } });
      expect(
        await caught(() => createSharedRacksService({ repo, access: OPEN }).invite(RACK, USER)),
        outcome,
      ).toMatchObject({ code, message });
    }
    const { repo } = fakeRepo({ invite: { outcome: "already_invited", invitationId: INVITATION } });
    expect(await createSharedRacksService({ repo, access: OPEN }).invite(RACK, USER)).toEqual({
      invitationId: INVITATION,
      outcome: "already_invited",
    });
  });

  it("accepting twice answers the same; declining what was accepted, or answering what is closed, is refused", async () => {
    const answer = async (answers: Answers, accept: boolean) => {
      const { repo } = fakeRepo(answers);
      return caught(async () => {
        throw Object.assign(new Error("answer"), {
          answer: await createSharedRacksService({ repo, access: OPEN }).respond(
            INVITATION,
            accept,
          ),
        });
      }).catch((error: { answer: unknown }) => error.answer);
    };
    expect(await answer({ respond: { outcome: "accepted", rackId: RACK } }, true)).toEqual({
      outcome: "accepted",
      rackId: RACK,
    });
    expect(await answer({ respond: { outcome: "already_accepted", rackId: RACK } }, true)).toEqual({
      outcome: "accepted",
      rackId: RACK,
    });
    expect(await answer({ respond: { outcome: "declined" } }, false)).toEqual({
      outcome: "declined",
      rackId: null,
    });
    expect(
      await answer({ respond: { outcome: "already_accepted", rackId: RACK } }, false),
    ).toMatchObject({
      code: "CONFLICT",
      message: M.alreadyAccepted,
    });
    for (const [outcome, code, message] of [
      ["not_found", "NOT_FOUND", M.invitationNotFound],
      ["expired", "CONFLICT", M.invitationExpired],
      ["archived", "CONFLICT", M.invitationClosed],
      ["full", "CONFLICT", M.full],
      ["too_many_racks", "CONFLICT", M.tooMany],
      ["already_declined", "CONFLICT", M.invitationClosed],
      ["already_cancelled", "CONFLICT", M.invitationClosed],
    ] as const)
      expect(await answer({ respond: { outcome } }, true), outcome).toMatchObject({
        code,
        message,
      });
  });

  it("cancelling: gone is 'not found', spent is 'no longer open'", async () => {
    for (const [outcome, code, message] of [
      ["not_found", "NOT_FOUND", M.invitationNotFound],
      ["already_accepted", "CONFLICT", M.invitationClosed],
      ["already_cancelled", "CONFLICT", M.invitationClosed],
    ] as const) {
      const { repo } = fakeRepo({ cancelInvitation: outcome });
      expect(
        await caught(() =>
          createSharedRacksService({ repo, access: OPEN }).cancelInvitation(INVITATION),
        ),
      ).toMatchObject({ code, message });
    }
  });
});

describe("placing", () => {
  it("sends the bottle and the spot, and nothing about whose it is", async () => {
    const { repo, calls } = fakeRepo({ place: { outcome: "placed", placementId: PLACEMENT } });
    expect(
      await createSharedRacksService({ repo, access: OPEN }).place(RACK, {
        bottleId: BOTTLE,
        to: spot(2, 3),
      }),
    ).toEqual({ placementId: PLACEMENT, outcome: "placed", to: spot(2, 3) });
    expect(calls.find((c) => c.method === "place")?.args).toEqual([RACK, BOTTLE, spot(2, 3)]);
  });

  it("refuses a spot that is not the rack's, or past index 1, before the database is asked", async () => {
    const { repo, writes } = fakeRepo({ place: { outcome: "placed", placementId: PLACEMENT } });
    const service = createSharedRacksService({ repo, access: OPEN });
    for (const to of [spot(6, 1), spot(1, 13)])
      expect(await caught(() => service.place(RACK, { bottleId: BOTTLE, to }))).toMatchObject({
        code: "VALIDATION",
        message: M.outOfBounds,
      });
    // an index past the cell is not a spot of this rack either (one bottle per position)
    expect(
      await caught(() => service.place(RACK, { bottleId: BOTTLE, to: spot(1, 1, 2) })),
    ).toMatchObject({
      code: "VALIDATION",
      message: M.outOfBounds,
    });
    expect(writes()).toEqual([]);
  });

  it("puts nothing into a rack whose arrangement this server does not know", async () => {
    const { repo, writes } = fakeRepo({}, stored({ template: "rack_from_the_future" }));
    expect(
      await caught(() =>
        createSharedRacksService({ repo, access: OPEN }).place(RACK, {
          bottleId: BOTTLE,
          to: spot(1, 1),
        }),
      ),
    ).toMatchObject({ code: "CONFLICT", message: M.unknownArrangement });
    expect(writes()).toEqual([]);
  });

  it("depth stays off: a rack stored two deep still takes nothing past index 1 from here", async () => {
    const { repo, writes } = fakeRepo(
      {},
      stored({ template: "rack_double_depth", slotSemantics: "depth", cellCapacity: 2 }),
    );
    expect(
      await caught(() =>
        createSharedRacksService({ repo, access: OPEN }).place(RACK, {
          bottleId: BOTTLE,
          to: spot(1, 1, 2),
        }),
      ),
    ).toMatchObject({ code: "CONFLICT", message: M.depth });
    expect(writes()).toEqual([]);
  });

  it("says what the database refused: someone else's bottle is 'not found', like one that does not exist", async () => {
    for (const [outcome, code, message, retryable] of [
      ["bottle_not_found", "NOT_FOUND", M.bottleNotFound, false],
      ["bottle_unavailable", "CONFLICT", M.bottleUnavailable, false],
      ["already_placed", "CONFLICT", M.alreadyPlaced, false],
      ["taken", "CONFLICT", M.taken, true],
      ["out_of_bounds", "VALIDATION", M.outOfBounds, false],
      ["depth_not_enabled", "CONFLICT", M.depth, false],
      ["archived", "CONFLICT", M.archived, false],
      ["not_found", "NOT_FOUND", M.rackNotFound, false],
    ] as const) {
      const { repo } = fakeRepo({ place: { outcome } });
      expect(
        await caught(() =>
          createSharedRacksService({ repo, access: OPEN }).place(RACK, {
            bottleId: BOTTLE,
            to: spot(1, 1),
          }),
        ),
        outcome,
      ).toEqual({ code, message, retryable });
    }
  });

  it("a repeat of a placement that happened says so", async () => {
    const { repo } = fakeRepo({ place: { outcome: "already_there", placementId: PLACEMENT } });
    expect(
      (
        await createSharedRacksService({ repo, access: OPEN }).place(RACK, {
          bottleId: BOTTLE,
          to: spot(1, 1),
        })
      ).outcome,
    ).toBe("already_there");
  });
});

describe("moving and taking out", () => {
  const move = { from: spot(1, 1), to: spot(2, 2) };

  it("a move is conditional on the spot the caller saw", async () => {
    const { repo, calls } = fakeRepo({ move: { outcome: "moved" } });
    expect(
      await createSharedRacksService({ repo, access: OPEN }).move(RACK, PLACEMENT, move),
    ).toEqual({
      placementId: PLACEMENT,
      outcome: "moved",
      ...move,
    });
    expect(calls.find((c) => c.method === "move")?.args).toEqual([
      RACK,
      PLACEMENT,
      move.from,
      move.to,
    ]);
  });

  it("stale, gone and taken change nothing and are conflicts; a repeat is 'already there'", async () => {
    for (const [answer, code, message, retryable] of [
      [{ outcome: "stale", now: spot(4, 4) }, "CONFLICT", M.stale, false],
      [{ outcome: "gone" }, "CONFLICT", M.gone, false],
      [{ outcome: "taken" }, "CONFLICT", M.taken, true],
      [{ outcome: "out_of_bounds" }, "VALIDATION", M.outOfBounds, false],
      [{ outcome: "depth_not_enabled" }, "CONFLICT", M.depth, false],
      [{ outcome: "archived" }, "CONFLICT", M.archived, false],
      [{ outcome: "not_found" }, "NOT_FOUND", M.rackNotFound, false],
    ] as const) {
      const { repo } = fakeRepo({ move: answer });
      expect(
        await caught(() =>
          createSharedRacksService({ repo, access: OPEN }).move(RACK, PLACEMENT, move),
        ),
        answer.outcome,
      ).toEqual({ code, message, retryable });
    }
    const { repo } = fakeRepo({ move: { outcome: "already_there" } });
    expect(
      (await createSharedRacksService({ repo, access: OPEN }).move(RACK, PLACEMENT, move)).outcome,
    ).toBe("already_there");
  });

  it("a target outside the rack is refused before the database is asked", async () => {
    const { repo, writes } = fakeRepo({ move: { outcome: "moved" } });
    expect(
      await caught(() =>
        createSharedRacksService({ repo, access: OPEN }).move(RACK, PLACEMENT, {
          from: spot(1, 1),
          to: spot(9, 9),
        }),
      ),
    ).toMatchObject({ code: "VALIDATION", message: M.outOfBounds });
    expect(writes()).toEqual([]);
  });

  it("taking out works in an archived rack, and is only ever a record of the rack", async () => {
    const { repo, calls } = fakeRepo(
      { takeOut: { outcome: "taken_out" } },
      stored({ archivedAt: "2026-11-23T11:00:00Z" }),
    );
    expect(
      await createSharedRacksService({ repo, access: OPEN }).takeOut(RACK, PLACEMENT, {
        from: spot(1, 1),
      }),
    ).toEqual({ placementId: PLACEMENT, outcome: "taken_out" });
    // one call, of the one function: nothing reads or writes the bottle itself
    expect(calls).toEqual([{ method: "takeOut", args: [RACK, PLACEMENT, spot(1, 1)] }]);
  });

  it("a stale or repeated taking-out is a conflict", async () => {
    for (const [answer, message] of [
      [{ outcome: "stale", now: spot(4, 4) }, M.stale],
      [{ outcome: "gone" }, M.gone],
    ] as const) {
      const { repo } = fakeRepo({ takeOut: answer });
      expect(
        await caught(() =>
          createSharedRacksService({ repo, access: OPEN }).takeOut(RACK, PLACEMENT, {
            from: spot(1, 1),
          }),
        ),
      ).toMatchObject({ code: "CONFLICT", message });
    }
  });

  it("withdrawing my own bottle needs no rack at all", async () => {
    const { repo, calls } = fakeRepo({ withdraw: "withdrawn" }, null);
    await createSharedRacksService({ repo, access: OPEN }).withdraw(BOTTLE);
    expect(calls).toEqual([{ method: "withdraw", args: [BOTTLE] }]);
    for (const [outcome, code, message] of [
      ["not_found", "NOT_FOUND", M.bottleNotFound],
      ["not_placed", "CONFLICT", M.notPlaced],
    ] as const) {
      const other = fakeRepo({ withdraw: outcome }, null);
      expect(
        await caught(() =>
          createSharedRacksService({ repo: other.repo, access: OPEN }).withdraw(BOTTLE),
        ),
      ).toMatchObject({ code, message });
    }
  });
});

describe("reading", () => {
  const bottle = (placementId: string, row: number): SharedRackBottleView => ({
    placementId,
    bottleId: null,
    row,
    col: 1,
    index: 1,
    owner: { userId: USER, name: "Bob", isMember: true },
    mine: false,
    placedBy: "Bob",
    placedAt: "2026-11-23T10:00:00Z",
    movedAt: null,
    producer: "Shared Estate",
    wineName: "Office Red",
    year: 2019,
    type: "red",
    region: null,
    countryCode: null,
    formatMl: 750,
  });
  const event = (seq: number): SharedRackEventView => ({
    seq,
    type: "bottle_placed",
    occurredAt: "2026-11-23T10:00:00Z",
    actor: { userId: USER, name: "Bob" },
    owner: { userId: USER, name: "Bob" },
    subject: null,
    placementId: PLACEMENT,
    bottleId: null,
    wine: null,
    from: null,
    to: spot(1, 1),
    detail: null,
  });

  it("the rack and its bottles together, one owner's when asked", async () => {
    const { repo, calls } = fakeRepo({ bottles: [bottle("a", 1), bottle("b", 2)] });
    const service = createSharedRacksService({ repo, access: OPEN });
    const all = await service.bottles(RACK);
    expect(all.rack.id).toBe(RACK);
    expect(all.bottles.map((b) => b.placementId)).toEqual(["a", "b"]);
    await service.bottles(RACK, USER);
    expect(calls.filter((c) => c.method === "bottles").map((c) => c.args)).toEqual([
      [RACK, undefined],
      [RACK, USER],
    ]);
  });

  it("a full page of history points at the next one; a short page is the end", async () => {
    const full = fakeRepo({ events: [event(9), event(8), event(7)] });
    expect(
      (await createSharedRacksService({ repo: full.repo, access: OPEN }).events(RACK, { limit: 3 }))
        .nextBefore,
    ).toBe(7);
    const short = fakeRepo({ events: [event(9), event(8)] });
    expect(
      (
        await createSharedRacksService({ repo: short.repo, access: OPEN }).events(RACK, {
          limit: 3,
        })
      ).nextBefore,
    ).toBeNull();
    const none = fakeRepo({ events: [] });
    expect(
      await createSharedRacksService({ repo: none.repo, access: OPEN }).events(RACK, { limit: 3 }),
    ).toEqual({
      events: [],
      nextBefore: null,
    });
  });

  it("says what this server offers", async () => {
    const { repo } = fakeRepo();
    expect(await createSharedRacksService({ repo, access: OPEN }).list()).toMatchObject({
      version: 1,
      writes: true,
      depthPlacement: false,
    });
  });
});

describe("the words", () => {
  it("every sentence a person can be given has a translation", () => {
    for (const [key, sentence] of Object.entries(M))
      expect(knownMessage(sentence), key).not.toBeNull();
  });
});
