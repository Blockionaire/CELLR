import { describe, expect, it } from "vitest";
import { SHARED_RACKS_NOT_SET_UP, isDomainError } from "@cellr/domain";
import type { Db } from "@/server/db/clients";
import {
  createSharedRacksRepository,
  isSharedRacksSchemaMissing,
  mapSharedRacksError,
  readOutcome,
  toEvent,
  toStoredRack,
  toWineSnapshot,
} from "./repository";

type DbError = { code: string; message: string };
type Answer = { data: unknown; error: DbError | null };

const RACK = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const BOTTLE = "33333333-3333-4333-8333-333333333333";
const PLACEMENT = "44444444-4444-4444-8444-444444444444";
const INVITATION = "55555555-5555-4555-8555-555555555555";
const SPOT = { row: 2, col: 3, index: 1 };
const LAYOUT = {
  kind: "rack",
  template: "rack_classic",
  semantics: "depth",
  rows: 5,
  cols: 12,
  cellCapacity: 1,
  appearance: { v: 1, material: "wood", color: "oak", lighting: "none", door: "none" },
} as const;

/**
 * A data API in memory that only has functions: every call is recorded, and answered with what the test programmed
 * for that function. Reading or writing a TABLE is refused outright: nothing in this repository may do that (the
 * shared-rack tables are not reachable, and no other table is its business).
 */
function fakeDb(answers: Record<string, Answer | ((args: Record<string, unknown>) => Answer)>) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const db = {
    rpc(fn: string, args: Record<string, unknown> = {}) {
      calls.push({ fn, args });
      const answer = answers[fn];
      if (!answer) throw new Error(`unexpected function ${fn}`);
      return Promise.resolve(typeof answer === "function" ? answer(args) : answer);
    },
    from(table: string) {
      throw new Error(`a table was touched: ${table}`);
    },
  };
  return { repo: createSharedRacksRepository(db as unknown as Db), calls };
}
const ok = (data: unknown): Answer => ({ data, error: null });
const outcome = (value: string, extra: Record<string, unknown> = {}) =>
  ok({ outcome: value, ...extra });
const caught = async (run: () => Promise<unknown>) => {
  try {
    await run();
  } catch (error) {
    if (isDomainError(error))
      return { code: error.code, message: error.message, retryable: error.retryable };
    throw error;
  }
  throw new Error("nothing was thrown");
};

const rackRow = {
  id: RACK,
  name: "Office rack",
  kind: "rack",
  template: "rack_classic",
  slot_semantics: "depth",
  grid_rows: 5,
  grid_cols: 12,
  cell_capacity: 1,
  appearance: null,
  revision: 7,
  archived_at: null as unknown as string,
  created_at: "2026-11-23T10:00:00+00:00",
  updated_at: "2026-11-23T10:00:00+00:00",
  my_role: "owner",
  member_count: 3,
  bottle_count: 14,
  my_bottle_count: 5,
};

describe("reading a rack", () => {
  it("is a row of the function in the domain's words, nothing interpreted", () => {
    expect(toStoredRack(rackRow)).toEqual({
      id: RACK,
      name: "Office rack",
      role: "owner",
      archivedAt: null,
      kind: "rack",
      template: "rack_classic",
      slotSemantics: "depth",
      rows: 5,
      cols: 12,
      cellCapacity: 1,
      appearance: null,
      revision: "7",
      memberCount: 3,
      bottleCount: 14,
      myBottleCount: 5,
      createdAt: "2026-11-23T10:00:00+00:00",
    });
  });

  it("never reads a role it does not know as owner", () => {
    expect(toStoredRack({ ...rackRow, my_role: "admin" }).role).toBe("member");
  });

  it("lists my racks, archived ones only when asked, and one rack by id", async () => {
    const { repo, calls } = fakeDb({ shared_racks: ok([rackRow]) });
    expect(await repo.listRacks(false)).toHaveLength(1);
    await repo.listRacks(true);
    expect((await repo.getRack(RACK))?.id).toBe(RACK);
    expect(calls.map((c) => c.args)).toEqual([
      { p_include_archived: false },
      { p_include_archived: true },
      { p_rack: RACK },
    ]);
  });

  it("answers null for a rack that is not there or not mine: the database gives no row for either", async () => {
    const { repo } = fakeDb({ shared_racks: ok([]) });
    expect(await repo.getRack(RACK)).toBeNull();
  });
});

describe("the projection", () => {
  const row = {
    placement_id: PLACEMENT,
    bottle_id: null as unknown as string,
    loc_row: 2,
    loc_col: 3,
    loc_index: 1,
    owner_user_id: USER,
    owner_name: "Bob",
    owner_is_member: true,
    is_mine: false,
    placed_by_name: "Bob",
    placed_at: "2026-11-23T10:00:00+00:00",
    moved_at: null as unknown as string,
    producer: "Shared Estate",
    wine_name: "Office Red",
    year: 2019,
    wine_type: "red",
    region: "Rioja",
    country_code: "ES",
    format_ml: 750,
  };

  it("passes on exactly what the database projects, and only asks for one owner when one is named", async () => {
    const { repo, calls } = fakeDb({ shared_rack_bottles: ok([row]) });
    const [bottle] = await repo.bottles(RACK);
    expect(bottle).toEqual({
      placementId: PLACEMENT,
      bottleId: null,
      row: 2,
      col: 3,
      index: 1,
      owner: { userId: USER, name: "Bob", isMember: true },
      mine: false,
      placedBy: "Bob",
      placedAt: "2026-11-23T10:00:00+00:00",
      movedAt: null,
      producer: "Shared Estate",
      wineName: "Office Red",
      year: 2019,
      type: "red",
      region: "Rioja",
      countryCode: "ES",
      formatMl: 750,
    });
    await repo.bottles(RACK, USER);
    expect(calls.map((c) => c.args)).toEqual([{ p_rack: RACK }, { p_rack: RACK, p_owner: USER }]);
  });

  it("has no field for anything private", async () => {
    const { repo } = fakeDb({ shared_rack_bottles: ok([row]) });
    const [bottle] = await repo.bottles(RACK);
    expect(JSON.stringify(Object.keys(bottle!))).not.toMatch(
      /price|purchas|note|rating|household|image|vintageId|wineId/i,
    );
  });
});

describe("the history", () => {
  const row = {
    seq: 41,
    event_type: "bottle_moved",
    occurred_at: "2026-11-23T10:00:00+00:00",
    actor_id: USER,
    actor_name: "Cy",
    owner_id: null as unknown as string,
    owner_name: "Bob",
    subject_id: null as unknown as string,
    subject_name: null as unknown as string,
    placement_id: PLACEMENT,
    bottle_id: null as unknown as string,
    wine: {
      producer: "Shared Estate",
      name: "Office Red",
      year: 2019,
      type: "red",
      format_ml: 750,
    },
    from_row: 1,
    from_col: 1,
    from_index: 1,
    to_row: 2,
    to_col: 2,
    to_index: 1,
    detail: null,
  };

  it("is read with its people, its wine as it was and its whole spots", () => {
    expect(toEvent(row)).toEqual({
      seq: 41,
      type: "bottle_moved",
      occurredAt: "2026-11-23T10:00:00+00:00",
      actor: { userId: USER, name: "Cy" },
      // the owner's account is gone: the name as it read stays
      owner: { userId: null, name: "Bob" },
      subject: null,
      placementId: PLACEMENT,
      bottleId: null,
      wine: {
        producer: "Shared Estate",
        name: "Office Red",
        year: 2019,
        type: "red",
        formatMl: 750,
      },
      from: { row: 1, col: 1, index: 1 },
      to: { row: 2, col: 2, index: 1 },
      detail: null,
    });
  });

  it("leaves out a kind of event this server does not know, rather than guess what it means", () => {
    expect(toEvent({ ...row, event_type: "bottle_teleported" })).toBeNull();
  });

  it("reads a wine that is not an object as no wine", () => {
    expect(toWineSnapshot(null)).toBeNull();
    expect(toWineSnapshot("Office Red")).toBeNull();
    expect(toWineSnapshot([1])).toBeNull();
    expect(toWineSnapshot({ name: 7, year: "2019" })).toEqual({
      producer: null,
      name: null,
      year: null,
      type: null,
      formatMl: null,
    });
  });

  it("sends only the filters that were given", async () => {
    const { repo, calls } = fakeDb({
      shared_rack_events: ok([row, { ...row, seq: 40, event_type: "from_the_future" }]),
    });
    expect(await repo.events(RACK, { limit: 50 })).toHaveLength(1);
    await repo.events(RACK, { limit: 20, before: 41, owner: USER, placement: PLACEMENT });
    expect(calls.map((c) => c.args)).toEqual([
      { p_rack: RACK, p_limit: 50 },
      { p_rack: RACK, p_limit: 20, p_before: 41, p_owner: USER, p_placement: PLACEMENT },
    ]);
  });
});

describe("writing: one function each, and never an identity", () => {
  it("calls exactly one function per write, with exactly its arguments", async () => {
    const { repo, calls } = fakeDb({
      shared_rack_create: outcome("created", { rack_id: RACK }),
      shared_rack_rename: outcome("renamed"),
      shared_rack_save_layout: outcome("saved", { revision: 8 }),
      shared_rack_set_archived: outcome("archived"),
      shared_rack_invite: outcome("invited", { invitation_id: INVITATION }),
      shared_rack_respond_invitation: outcome("accepted", { rack_id: RACK }),
      shared_rack_cancel_invitation: outcome("cancelled"),
      shared_rack_set_member_role: outcome("changed"),
      shared_rack_remove_member: outcome("removed"),
      shared_rack_leave: outcome("left"),
      shared_rack_place: outcome("placed", { placement_id: PLACEMENT }),
      shared_rack_move: outcome("moved"),
      shared_rack_take_out: outcome("taken_out"),
      shared_rack_withdraw_bottle: outcome("withdrawn"),
    });
    expect(await repo.create("Office", LAYOUT)).toEqual({ outcome: "created", rackId: RACK });
    expect(await repo.rename(RACK, "Office 2")).toBe("renamed");
    expect(await repo.saveLayout(RACK, LAYOUT, "7")).toEqual({ outcome: "saved" });
    expect(await repo.saveLayout(RACK, LAYOUT, null)).toEqual({ outcome: "saved" });
    expect(await repo.setArchived(RACK, true)).toBe("archived");
    expect(await repo.invite(RACK, USER)).toEqual({ outcome: "invited", invitationId: INVITATION });
    expect(await repo.respond(INVITATION, true)).toEqual({ outcome: "accepted", rackId: RACK });
    expect(await repo.cancelInvitation(INVITATION)).toBe("cancelled");
    expect(await repo.setRole(RACK, USER, "owner")).toBe("changed");
    expect(await repo.removeMember(RACK, USER)).toBe("removed");
    expect(await repo.leave(RACK)).toBe("left");
    expect(await repo.place(RACK, BOTTLE, SPOT)).toEqual({
      outcome: "placed",
      placementId: PLACEMENT,
    });
    expect(await repo.move(RACK, PLACEMENT, SPOT, { row: 4, col: 4, index: 1 })).toEqual({
      outcome: "moved",
    });
    expect(await repo.takeOut(RACK, PLACEMENT, SPOT)).toEqual({ outcome: "taken_out" });
    expect(await repo.withdraw(BOTTLE)).toBe("withdrawn");

    const layoutArgs = {
      p_kind: "rack",
      p_template: "rack_classic",
      p_slot_semantics: "depth",
      p_rows: 5,
      p_cols: 12,
      p_cell_capacity: 1,
      p_appearance: LAYOUT.appearance,
    };
    expect(calls).toEqual([
      { fn: "shared_rack_create", args: { p_name: "Office", ...layoutArgs } },
      { fn: "shared_rack_rename", args: { p_rack: RACK, p_name: "Office 2" } },
      {
        fn: "shared_rack_save_layout",
        args: { p_rack: RACK, ...layoutArgs, p_expected_revision: 7 },
      },
      { fn: "shared_rack_save_layout", args: { p_rack: RACK, ...layoutArgs } },
      { fn: "shared_rack_set_archived", args: { p_rack: RACK, p_archived: true } },
      { fn: "shared_rack_invite", args: { p_rack: RACK, p_user: USER } },
      { fn: "shared_rack_respond_invitation", args: { p_invitation: INVITATION, p_accept: true } },
      { fn: "shared_rack_cancel_invitation", args: { p_invitation: INVITATION } },
      { fn: "shared_rack_set_member_role", args: { p_rack: RACK, p_user: USER, p_role: "owner" } },
      { fn: "shared_rack_remove_member", args: { p_rack: RACK, p_user: USER } },
      { fn: "shared_rack_leave", args: { p_rack: RACK } },
      {
        fn: "shared_rack_place",
        args: { p_rack: RACK, p_bottle: BOTTLE, p_row: 2, p_col: 3, p_index: 1 },
      },
      {
        fn: "shared_rack_move",
        args: {
          p_rack: RACK,
          p_placement: PLACEMENT,
          p_from_row: 2,
          p_from_col: 3,
          p_from_index: 1,
          p_to_row: 4,
          p_to_col: 4,
          p_to_index: 1,
        },
      },
      {
        fn: "shared_rack_take_out",
        args: {
          p_rack: RACK,
          p_placement: PLACEMENT,
          p_from_row: 2,
          p_from_col: 3,
          p_from_index: 1,
        },
      },
      { fn: "shared_rack_withdraw_bottle", args: { p_bottle: BOTTLE } },
    ]);
  });

  it("passes no owner, actor or household anywhere: the database takes the person from the session", async () => {
    const { repo, calls } = fakeDb({
      shared_rack_place: outcome("placed", { placement_id: PLACEMENT }),
      shared_rack_move: outcome("moved"),
      shared_rack_take_out: outcome("taken_out"),
      shared_rack_withdraw_bottle: outcome("withdrawn"),
      shared_rack_leave: outcome("left"),
      shared_rack_rename: outcome("renamed"),
    });
    await repo.place(RACK, BOTTLE, SPOT);
    await repo.move(RACK, PLACEMENT, SPOT, SPOT);
    await repo.takeOut(RACK, PLACEMENT, SPOT);
    await repo.withdraw(BOTTLE);
    await repo.leave(RACK);
    await repo.rename(RACK, "x");
    for (const call of calls)
      expect(Object.keys(call.args).join(" "), call.fn).not.toMatch(
        /owner|actor|user|household|by/i,
      );
  });

  it("gives where the bottle is now with a stale move or taking-out", async () => {
    const { repo } = fakeDb({
      shared_rack_move: outcome("stale", { row: 4, col: 5, index: 1 }),
      shared_rack_take_out: outcome("stale", { row: 4, col: 5, index: 1 }),
    });
    expect(await repo.move(RACK, PLACEMENT, SPOT, SPOT)).toEqual({
      outcome: "stale",
      now: { row: 4, col: 5, index: 1 },
    });
    expect(await repo.takeOut(RACK, PLACEMENT, SPOT)).toEqual({
      outcome: "stale",
      now: { row: 4, col: 5, index: 1 },
    });
  });

  it("passes a refusal on as the refusal it is", async () => {
    const { repo } = fakeDb({
      shared_rack_place: outcome("taken"),
      shared_rack_invite: outcome("recently_declined"),
      shared_rack_respond_invitation: outcome("already_accepted", { rack_id: RACK }),
      shared_rack_leave: outcome("last_owner"),
    });
    expect(await repo.place(RACK, BOTTLE, SPOT)).toEqual({ outcome: "taken" });
    expect(await repo.invite(RACK, USER)).toEqual({ outcome: "recently_declined" });
    expect(await repo.respond(INVITATION, true)).toEqual({
      outcome: "already_accepted",
      rackId: RACK,
    });
    expect(await repo.leave(RACK)).toBe("last_owner");
  });
});

describe("an answer is read strictly", () => {
  it("takes nothing it does not know for a success or for a refusal", () => {
    expect(readOutcome({ outcome: "moved" }, ["moved", "stale"]).outcome).toBe("moved");
    for (const answer of [
      null,
      "moved",
      ["moved"],
      {},
      { outcome: 1 },
      { outcome: "teleported" },
      { result: "moved" },
    ])
      expect(() => readOutcome(answer, ["moved", "stale"]), JSON.stringify(answer)).toThrow();
  });

  it("is an error, not a success, when the database answers something else", async () => {
    const { repo } = fakeDb({
      shared_rack_move: outcome("teleported"),
      shared_rack_place: outcome("placed"), // no placement id
      shared_rack_leave: ok(null),
    });
    expect((await caught(() => repo.move(RACK, PLACEMENT, SPOT, SPOT))).code).toBe("INTERNAL");
    expect((await caught(() => repo.place(RACK, BOTTLE, SPOT))).code).toBe("INTERNAL");
    expect((await caught(() => repo.leave(RACK))).code).toBe("INTERNAL");
  });
});

describe("errors", () => {
  it("only a missing function means the database has no shared racks", () => {
    expect(isSharedRacksSchemaMissing({ code: "PGRST202" })).toBe(true);
    expect(isSharedRacksSchemaMissing({ code: "42883" })).toBe(true);
    for (const code of ["42501", "57014", "23505", "PGRST301", "54000", undefined])
      expect(isSharedRacksSchemaMissing({ code }), String(code)).toBe(false);
  });

  it("a database without the migration is 'not set up', for reads and for writes", async () => {
    const missing: Answer = {
      data: null,
      error: { code: "PGRST202", message: "Could not find the function" },
    };
    const { repo } = fakeDb({ shared_racks: missing, shared_rack_place: missing });
    expect(await caught(() => repo.listRacks(false))).toMatchObject({
      code: "NOT_FOUND",
      message: SHARED_RACKS_NOT_SET_UP,
    });
    expect(await caught(() => repo.place(RACK, BOTTLE, SPOT))).toMatchObject({
      code: "NOT_FOUND",
      message: SHARED_RACKS_NOT_SET_UP,
    });
  });

  it("two writers that ran into each other can try again; a spent budget and a refusal are what they are", () => {
    for (const code of ["40P01", "40001", "55P03"])
      expect(mapSharedRacksError({ code, message: "x" })).toMatchObject({
        code: "CONFLICT",
        retryable: true,
      });
    expect(mapSharedRacksError({ code: "54000", message: "rate_limited" }).code).toBe(
      "RATE_LIMITED",
    );
    expect(mapSharedRacksError({ code: "42501", message: "not_authenticated" }).code).toBe(
      "FORBIDDEN",
    );
    expect(mapSharedRacksError({ code: "23514", message: "check" }).code).toBe("VALIDATION");
    expect(mapSharedRacksError({ code: "XX000", message: "boom" }).code).toBe("INTERNAL");
  });
});
