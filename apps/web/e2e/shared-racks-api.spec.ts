import { expect, test, type APIRequestContext } from "@playwright/test";
import {
  APP_URL,
  FEATURES_URL,
  PREVIEW_URL,
  bearer,
  sessionToken,
  sql,
  stamp,
  uniqueEmail,
  wineBody,
} from "./helpers";

/**
 * Shared racks (ADR-010, migration 0052): the API, end to end. Every request goes through the app (Next.js) to the
 * real PostgREST and Postgres of the local stack, AS the signed-in person: the database's own functions decide who
 * may do what, not a mock. People here are three (or more) accounts, each with a household of their own.
 *
 * The three test servers (playwright.config.ts) are the states of the switch:
 *   3100  CELLR_SHARED_RACKS unset                       closed: 404, as if the API did not exist
 *   3101  "1", on an unmarked production build           closed all the same: never on production
 *   3102  "1", on a Vercel preview (the local stack)     open, and writing
 * Not a browser test: the phone project would only run the same requests again.
 */
test.skip(({ isMobile }) => isMobile, "HTTP only: the desktop project");
test.setTimeout(120_000);

const UNSET = APP_URL;
const PRODUCTION_BUILD = FEATURES_URL;
const OPEN = PREVIEW_URL;

type Method = "get" | "post" | "patch" | "put" | "delete";
type Body = Record<string, unknown>;

async function call<T = Body>(
  request: APIRequestContext,
  base: string,
  token: string,
  method: Method,
  path: string,
  data?: unknown,
  headers: Record<string, string> = {},
) {
  const res = await request[method](`${base}/api/v1${path}`, {
    headers: { ...bearer(token), ...headers },
    ...(data === undefined ? {} : { data }),
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status(), body: body as T, text };
}

const RACK_5X12 = {
  structure: { template: "rack_classic", rows: 5, cols: 12, cellCapacity: 1, zones: [] },
  appearance: { v: 1, material: "wood", color: "oak", lighting: "none", door: "none" },
};
const spot = (row: number, col: number, index = 1) => ({ row, col, index });

/** A person with a household of their own, a name, and bottles when asked (all through the API, as a native app). */
async function person(request: APIRequestContext, name: string) {
  const email = uniqueEmail(name.toLowerCase());
  const token = await sessionToken(email);
  const as = <T = Body>(
    method: Method,
    path: string,
    data?: unknown,
    headers?: Record<string, string>,
  ) => call<T>(request, OPEN, token, method, path, data, headers);
  const household = await as<{ id: string }>("post", "/households", {
    name: `${name} home ${stamp()}`,
  });
  expect(household.status, "household").toBe(201);
  const [user] = await sql<{ id: string; friend_code: string }>(
    "update public.profiles set display_name = $2 where id = (select id from auth.users where email = $1) returning id, friend_code",
    [email, name],
  );
  /** Bottles of one new wine of this person's own, without a place (or in a private place of theirs). */
  const bottles = async (
    quantity: number,
    wine = `${name}'s wine ${stamp()}`,
    locationId: string | null = null,
  ) => {
    const made = await as<{ id: string }>("post", "/wines", { ...wineBody, name: wine });
    expect(made.status, "wine").toBe(201);
    const added = await as<{ bottleIds: string[] }>("post", "/bottles", {
      wineId: made.body.id,
      year: 2019,
      quantity,
      locationId,
    });
    expect(added.status, "bottles").toBe(201);
    return added.body.bottleIds;
  };
  return {
    name,
    email,
    token,
    userId: user!.id,
    friendCode: user!.friend_code,
    householdId: household.body.id,
    as,
    bottles,
    /** The same person against another of the test servers. */
    on: <T = Body>(base: string, method: Method, path: string, data?: unknown) =>
      call<T>(request, base, token, method, path, data),
  };
}
type Person = Awaited<ReturnType<typeof person>>;

/** `owner` makes a rack and the others join it, the way the product does: found by friend code, invited, accepted. */
async function rackOf(owner: Person, others: Person[], name = `Office rack ${stamp()}`) {
  const made = await owner.as<{ id: string }>("post", "/shared-racks", { name, ...RACK_5X12 });
  expect(made.status, "rack").toBe(201);
  for (const other of others) {
    const found = await owner.as<{ person: { userId: string } | null }>(
      "get",
      `/friends/search?q=${other.friendCode}`,
    );
    expect(found.body.person?.userId, "found by friend code").toBe(other.userId);
    const invited = await owner.as<{ invitationId: string }>(
      "post",
      `/shared-racks/${made.body.id}/invitations`,
      { userId: found.body.person!.userId },
    );
    expect(invited.status, "invited").toBe(201);
    const accepted = await other.as(
      "post",
      `/shared-racks/invitations/${invited.body.invitationId}`,
      {
        accept: true,
      },
    );
    expect(accepted.status, "accepted").toBe(200);
  }
  return made.body.id;
}

type Shown = {
  placementId: string;
  bottleId: string | null;
  row: number;
  col: number;
  index: number;
  owner: { userId: string | null; name: string | null; isMember: boolean };
  mine: boolean;
  wineName: string;
};
const shown = async (who: Person, rack: string, query = "") =>
  (await who.as<{ bottles: Shown[] }>("get", `/shared-racks/${rack}/bottles${query}`)).body.bottles;
const place = (who: Person, rack: string, bottleId: string, to: ReturnType<typeof spot>) =>
  who.as<{ placementId: string; outcome: string }>("post", `/shared-racks/${rack}/bottles`, {
    bottleId,
    to,
  });
const occupancy = (rack: string) =>
  sql<{ id: string; bottle_id: string; owner_user_id: string; loc_row: number; loc_col: number }>(
    "select id, bottle_id, owner_user_id, loc_row, loc_col from private.shared_rack_placements where rack_id = $1 order by loc_row, loc_col",
    [rack],
  );
const history = (rack: string) =>
  sql<{ event_type: string; actor_id: string | null; owner_id: string | null }>(
    "select event_type, actor_id, owner_id from private.shared_rack_events where rack_id = $1 order by seq",
    [rack],
  );

test.describe("the switch", () => {
  test("closed unless switched on, and closed on a production build whatever is set: every route is 404", async ({
    request,
  }) => {
    const ann = await person(request, "Ann");
    const rack = await rackOf(ann, []);
    const [bottle] = await ann.bottles(1);
    const placed = await place(ann, rack, bottle!, spot(1, 1));
    expect(placed.status).toBe(201);
    const id = "3f0e1c62-58a7-4a39-9d0b-7a4f2a1c9e10";
    const routes: Array<[Method, string, unknown?]> = [
      ["get", "/shared-racks"],
      ["post", "/shared-racks", { name: "x", ...RACK_5X12 }],
      ["post", "/shared-racks", { nonsense: true }],
      ["get", "/shared-racks/invitations"],
      ["post", `/shared-racks/invitations/${id}`, { accept: true }],
      ["delete", `/shared-racks/invitations/${id}`],
      ["get", "/shared-racks/bottles"],
      ["delete", `/shared-racks/bottles/${bottle}`],
      ["get", `/shared-racks/${rack}`],
      ["patch", `/shared-racks/${rack}`, { name: "x" }],
      ["delete", `/shared-racks/${rack}`],
      ["post", `/shared-racks/${rack}/restore`],
      ["put", `/shared-racks/${rack}/layout`, RACK_5X12],
      ["get", `/shared-racks/${rack}/members`],
      ["patch", `/shared-racks/${rack}/members/${ann.userId}`, { role: "member" }],
      ["delete", `/shared-racks/${rack}/members/${id}`],
      ["post", `/shared-racks/${rack}/leave`],
      ["get", `/shared-racks/${rack}/invitations`],
      ["post", `/shared-racks/${rack}/invitations`, { userId: id }],
      ["get", `/shared-racks/${rack}/bottles`],
      ["post", `/shared-racks/${rack}/bottles`, { bottleId: bottle, to: spot(1, 2) }],
      [
        "post",
        `/shared-racks/${rack}/bottles/${placed.body.placementId}/move`,
        { from: spot(1, 1), to: spot(2, 2) },
      ],
      [
        "post",
        `/shared-racks/${rack}/bottles/${placed.body.placementId}/take-out`,
        { from: spot(1, 1) },
      ],
      ["get", `/shared-racks/${rack}/events`],
    ];
    for (const base of [UNSET, PRODUCTION_BUILD])
      for (const [method, path, data] of routes)
        expect((await ann.on(base, method, path, data)).status, `${base} ${method} ${path}`).toBe(
          404,
        );
    // and nothing of it happened: the rack is as it was
    expect(await occupancy(rack)).toHaveLength(1);
    expect(
      (await ann.as<{ name: string; archived: boolean }>("get", `/shared-racks/${rack}`)).body,
    ).toMatchObject({
      archived: false,
      memberCount: 1,
    });
    // someone who is not signed in is asked to sign in, as everywhere
    const anonymous = await request.get(`${OPEN}/api/v1/shared-racks`, {
      headers: { origin: OPEN },
    });
    expect(anonymous.status()).toBe(401);
  });

  test("the preview server says what it offers", async ({ request }) => {
    const ann = await person(request, "Ann");
    const list = await ann.as("get", "/shared-racks");
    expect(list.status).toBe(200);
    expect(list.body).toMatchObject({ version: 1, writes: true, depthPlacement: false, racks: [] });
  });
});

test.describe("three households, one rack", () => {
  test("two people edit one rack: each bottle keeps its owner, and the history says who did what", async ({
    request,
  }) => {
    const [ann, bob, cy] = await Promise.all([
      person(request, "Ann"),
      person(request, "Bob"),
      person(request, "Cy"),
    ]);
    const rack = await rackOf(ann, [bob, cy]);

    const members = await cy.as<{
      members: Array<{ displayName: string; role: string; isMe: boolean }>;
    }>("get", `/shared-racks/${rack}/members`);
    expect(members.body.members.map((m) => [m.displayName, m.role, m.isMe])).toEqual([
      ["Ann", "owner", false],
      ["Bob", "member", false],
      ["Cy", "member", true],
    ]);

    const [annBottle] = await ann.bottles(1, "Ann Riesling");
    const [bobBottle] = await bob.bottles(1, "Bob Barolo");
    const [cyBottle] = await cy.bottles(1, "Cy Chenin");
    const a = await place(ann, rack, annBottle!, spot(1, 1));
    const b = await place(bob, rack, bobBottle!, spot(1, 2));
    const c = await place(cy, rack, cyBottle!, spot(5, 12));
    expect([a.status, b.status, c.status]).toEqual([201, 201, 201]);

    // everyone sees the same rack, every bottle with its owner; only one's own bottle comes with its id
    for (const who of [ann, bob, cy]) {
      const seen = await shown(who, rack);
      expect(seen.map((s) => [s.wineName, s.owner.name, s.row, s.col, s.index])).toEqual([
        ["Ann Riesling", "Ann", 1, 1, 1],
        ["Bob Barolo", "Bob", 1, 2, 1],
        ["Cy Chenin", "Cy", 5, 12, 1],
      ]);
      expect(seen.filter((s) => s.mine).map((s) => s.owner.name)).toEqual([who.name]);
      expect(seen.filter((s) => s.bottleId !== null).map((s) => s.owner.name)).toEqual([who.name]);
    }
    expect((await shown(ann, rack, `?owner=${bob.userId}`)).map((s) => s.wineName)).toEqual([
      "Bob Barolo",
    ]);
    const view = await bob.as<{ rack: Body }>("get", `/shared-racks/${rack}/bottles`);
    expect(view.body.rack).toMatchObject({
      role: "member",
      templateId: "rack_classic",
      rows: 5,
      cols: 12,
      capacity: 60,
      occupied: 3,
      free: 57,
      memberCount: 3,
      myBottleCount: 1,
      arrangementKnown: true,
    });

    // Bob moves Ann's bottle; Cy moves it again from where it is now; Bob's stale view is refused
    const moved = await bob.as("post", `/shared-racks/${rack}/bottles/${a.body.placementId}/move`, {
      from: spot(1, 1),
      to: spot(3, 3),
    });
    expect(moved.status).toBe(200);
    expect(moved.body).toMatchObject({ outcome: "moved", from: spot(1, 1), to: spot(3, 3) });
    expect(
      (
        await cy.as("post", `/shared-racks/${rack}/bottles/${a.body.placementId}/move`, {
          from: spot(3, 3),
          to: spot(4, 4),
        })
      ).status,
    ).toBe(200);
    const stale = await bob.as<{ error: { code: string } }>(
      "post",
      `/shared-racks/${rack}/bottles/${a.body.placementId}/move`,
      { from: spot(3, 3), to: spot(2, 2) },
    );
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("CONFLICT");
    // a repeat of a move that happened is not an error
    const repeat = await cy.as("post", `/shared-racks/${rack}/bottles/${a.body.placementId}/move`, {
      from: spot(3, 3),
      to: spot(4, 4),
    });
    expect([repeat.status, repeat.body.outcome]).toEqual([200, "already_there"]);
    // onto a taken spot, and outside the rack
    expect(
      (
        await bob.as("post", `/shared-racks/${rack}/bottles/${a.body.placementId}/move`, {
          from: spot(4, 4),
          to: spot(1, 2),
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await bob.as("post", `/shared-racks/${rack}/bottles/${a.body.placementId}/move`, {
          from: spot(4, 4),
          to: spot(6, 1),
        })
      ).status,
    ).toBe(422);
    // it is still Ann's bottle, in Ann's household, and Ann's own record of it was not touched
    const [annRow] = await sql<{
      status: string;
      household_id: string;
      location_id: string | null;
    }>("select status, household_id, location_id from public.bottles where id = $1", [annBottle]);
    expect(annRow).toEqual({
      status: "in_cellar",
      household_id: ann.householdId,
      location_id: null,
    });
    expect((await occupancy(rack)).find((p) => p.bottle_id === annBottle)).toMatchObject({
      owner_user_id: ann.userId,
      loc_row: 4,
      loc_col: 4,
    });

    // Cy takes Bob's bottle out: recorded, and NOT consumed
    const out = await cy.as(
      "post",
      `/shared-racks/${rack}/bottles/${b.body.placementId}/take-out`,
      {
        from: spot(1, 2),
      },
    );
    expect([out.status, out.body.outcome]).toEqual([200, "taken_out"]);
    const [bobRow] = await sql<{ status: string; household_id: string; opened_at: string | null }>(
      "select status, household_id, opened_at from public.bottles where id = $1",
      [bobBottle],
    );
    expect(bobRow).toEqual({ status: "in_cellar", household_id: bob.householdId, opened_at: null });
    expect((await shown(ann, rack)).map((s) => s.wineName)).toEqual(["Ann Riesling", "Cy Chenin"]);
    // a second taking-out of the same bottle is told it is gone
    expect(
      (
        await ann.as("post", `/shared-racks/${rack}/bottles/${b.body.placementId}/take-out`, {
          from: spot(1, 2),
        })
      ).status,
    ).toBe(409);

    // Cy opens their own bottle at home, through the cellar's own API: it leaves the rack, as "opened", by Cy
    expect((await cy.as("patch", `/bottles/${cyBottle}`, { action: "open" })).status).toBe(200);
    expect((await shown(ann, rack)).map((s) => s.wineName)).toEqual(["Ann Riesling"]);

    // the history, chronological, with who did it and whose bottle it was
    type Event = {
      seq: number;
      type: string;
      actor: { userId: string | null; name: string | null };
      owner: { userId: string | null; name: string | null } | null;
      subject: { name: string | null } | null;
      wine: { name: string | null } | null;
      from: unknown;
      to: unknown;
      bottleId: string | null;
    };
    const events = await ann.as<{ events: Event[]; nextBefore: number | null }>(
      "get",
      `/shared-racks/${rack}/events?limit=100`,
    );
    expect(events.status).toBe(200);
    expect(events.body.nextBefore).toBeNull();
    const oldestFirst = [...events.body.events].reverse();
    expect(
      oldestFirst.map((e) => [e.type, e.actor.name, e.owner?.name ?? e.subject?.name ?? null]),
    ).toEqual([
      ["rack_created", "Ann", null],
      ["member_joined", "Bob", "Bob"],
      ["member_joined", "Cy", "Cy"],
      ["bottle_placed", "Ann", "Ann"],
      ["bottle_placed", "Bob", "Bob"],
      ["bottle_placed", "Cy", "Cy"],
      ["bottle_moved", "Bob", "Ann"],
      ["bottle_moved", "Cy", "Ann"],
      ["bottle_taken_out", "Cy", "Bob"],
      ["bottle_opened", "Cy", "Cy"],
    ]);
    expect(events.body.events.map((e) => e.seq)).toEqual(
      [...events.body.events.map((e) => e.seq)].sort((x, y) => y - x),
    );
    expect(oldestFirst[6]).toMatchObject({
      from: spot(1, 1),
      to: spot(3, 3),
      wine: { name: "Ann Riesling" },
    });
    // one's own bottle id only
    expect(
      events.body.events
        .filter((e) => e.bottleId !== null)
        .every((e) => e.owner?.userId === ann.userId),
    ).toBe(true);
    // a page at a time, and filtered
    const page = await bob.as<{ events: Event[]; nextBefore: number | null }>(
      "get",
      `/shared-racks/${rack}/events?limit=4`,
    );
    expect(page.body.events).toHaveLength(4);
    const next = await bob.as<{ events: Event[] }>(
      "get",
      `/shared-racks/${rack}/events?limit=4&before=${page.body.nextBefore}`,
    );
    expect(next.body.events.map((e) => e.seq)).toEqual(
      events.body.events.slice(4, 8).map((e) => e.seq),
    );
    const byActor = await bob.as<{ events: Event[] }>(
      "get",
      `/shared-racks/${rack}/events?actor=${cy.userId}`,
    );
    expect(byActor.body.events.map((e) => e.type)).toEqual([
      "bottle_opened",
      "bottle_taken_out",
      "bottle_moved",
      "bottle_placed",
      "member_joined",
    ]);
    const byOwner = await bob.as<{ events: Event[] }>(
      "get",
      `/shared-racks/${rack}/events?owner=${bob.userId}`,
    );
    expect(byOwner.body.events.map((e) => e.type)).toEqual(["bottle_taken_out", "bottle_placed"]);
    const byBottle = await cy.as<{ events: Event[] }>(
      "get",
      `/shared-racks/${rack}/events?placement=${a.body.placementId}`,
    );
    expect(byBottle.body.events.map((e) => e.type)).toEqual([
      "bottle_moved",
      "bottle_moved",
      "bottle_placed",
    ]);
    expect((await bob.as("get", `/shared-racks/${rack}/events?limit=1000`)).status).toBe(422);
  });

  test("two people place into the same spot at the same moment: one gets it, the other a clean conflict", async ({
    request,
  }) => {
    const [ann, bob] = await Promise.all([person(request, "Ann"), person(request, "Bob")]);
    const rack = await rackOf(ann, [bob]);
    const annBottles = await ann.bottles(6);
    const bobBottles = await bob.bottles(6);
    for (let round = 0; round < 6; round++) {
      const to = spot(1, round + 1);
      const [x, y] = await Promise.all([
        place(ann, rack, annBottles[round]!, to),
        place(bob, rack, bobBottles[round]!, to),
      ]);
      expect([x.status, y.status].sort(), `round ${round}`).toEqual([201, 409]);
      const lost = x.status === 409 ? x : y;
      expect((lost.body as unknown as { error: Body }).error).toMatchObject({
        code: "CONFLICT",
        retryable: true,
      });
    }
    const rows = await occupancy(rack);
    expect(rows).toHaveLength(6);
    expect(new Set(rows.map((r) => `${r.loc_row}:${r.loc_col}`)).size).toBe(6);
    // exactly one line of history per bottle that got in
    expect((await history(rack)).filter((e) => e.event_type === "bottle_placed")).toHaveLength(6);
    // the one who lost puts their bottle somewhere else
    const loser = rows[0]!.owner_user_id === ann.userId ? bob : ann;
    const spare = (loser === ann ? annBottles : bobBottles)[0]!;
    expect((await place(loser, rack, spare, spot(2, 1))).status).toBe(201);
  });
});

test.describe("what stays private", () => {
  test("a member reaches nothing of another member's own cellar through any route, new or old", async ({
    request,
  }) => {
    const [ann, bob] = await Promise.all([person(request, "Ann"), person(request, "Bob")]);
    const rack = await rackOf(ann, [bob]);
    // Ann's own cellar: a private place, a bottle in the rack and one that is not, with everything private on them
    const privatePlace = await ann.as<{ id: string }>("post", "/storage", {
      label: "ANNPRIVATEPLACE",
      kind: "rack",
      rows: 3,
      cols: 3,
    });
    expect(privatePlace.status).toBe(201);
    const [inRack] = await ann.bottles(1, "Ann Shared Wine");
    const [atHome] = await ann.bottles(1, "ANNPRIVATEWINE", privatePlace.body.id);
    await sql(
      "update public.bottles set purchase_price_cents = 987654, currency = 'EUR', purchased_from = 'ANNSECRETSHOP', notes = 'ANNSECRETNOTE' where id = any($1::uuid[])",
      [[inRack, atHome]],
    );
    const placed = await place(ann, rack, inRack!, spot(2, 2));
    expect(placed.status).toBe(201);
    const [annWine] = await sql<{ vintage_id: string; wine_id: string }>(
      "select b.vintage_id, v.wine_id from public.bottles b join public.wine_vintages v on v.id = b.vintage_id where b.id = $1",
      [inRack],
    );

    // everything the shared-rack routes say to Bob, in one text
    const everything = (
      await Promise.all(
        [
          "/shared-racks",
          "/shared-racks?archived=1",
          "/shared-racks/invitations",
          "/shared-racks/bottles",
          `/shared-racks/${rack}`,
          `/shared-racks/${rack}/members`,
          `/shared-racks/${rack}/bottles`,
          `/shared-racks/${rack}/bottles?owner=${ann.userId}`,
          `/shared-racks/${rack}/events?limit=100`,
        ].map(async (path) => {
          const res = await bob.as("get", path);
          expect(res.status, path).toBe(200);
          return res.text;
        }),
      )
    ).join("\n");
    expect(everything).toContain("Ann Shared Wine");
    for (const secret of [
      "ANNSECRET",
      "987654",
      "ANNPRIVATE",
      ann.householdId,
      privatePlace.body.id,
      inRack!,
      atHome!,
      annWine!.vintage_id,
      annWine!.wine_id,
      ann.email,
    ])
      expect(everything, secret).not.toContain(secret);
    // the projection's fields, exactly
    const [seen] = await shown(bob, rack);
    expect(Object.keys(seen!).sort()).toEqual(
      [
        "bottleId",
        "col",
        "countryCode",
        "formatMl",
        "index",
        "mine",
        "movedAt",
        "owner",
        "placedAt",
        "placedBy",
        "placementId",
        "producer",
        "region",
        "row",
        "type",
        "wineName",
        "year",
      ].sort(),
    );
    expect(seen!.bottleId).toBeNull();

    // the existing routes, with every id Bob could have guessed: Ann's cellar is as closed to him as before
    for (const [method, path, data] of [
      ["patch", `/bottles/${inRack}`, { action: "open" }],
      ["patch", `/bottles/${inRack}`, { action: "remove" }],
      ["patch", `/bottles/${atHome}`, { action: "open" }],
      ["get", `/smart-cellar/bottles/${inRack}`],
      ["get", `/smart-cellar/storage/${privatePlace.body.id}`],
      ["get", `/smart-cellar/storage/${privatePlace.body.id}/bottles`],
      ["post", `/smart-cellar/bottles/${inRack}/move`, { from: null, to: null }],
      ["get", `/friends/${ann.userId}`],
    ] as Array<[Method, string, unknown?]>) {
      const res = await bob.as(method, path, data);
      expect([403, 404, 409], `${method} ${path}`).toContain(res.status);
      expect(res.text, path).not.toContain("ANN");
    }
    // ...and the owner's side of the shared-rack API is not a way in either
    expect((await bob.as("delete", `/shared-racks/bottles/${inRack}`)).status).toBe(404);
    expect((await bob.as("delete", `/shared-racks/bottles/${atHome}`)).status).toBe(404);
    // Bob's own cellar shows none of Ann's bottles, and Ann's are untouched
    expect((await bob.as("get", "/cellar")).text).not.toContain("Ann Shared Wine");
    const rows = await sql<{ status: string; notes: string }>(
      "select status, notes from public.bottles where id = any($1::uuid[])",
      [[inRack, atHome]],
    );
    expect(rows).toEqual([
      { status: "in_cellar", notes: "ANNSECRETNOTE" },
      { status: "in_cellar", notes: "ANNSECRETNOTE" },
    ]);
    expect(await occupancy(rack)).toHaveLength(1);
    // Ann herself still sees her bottle in her own cellar, and that it stands in the rack
    const mine = await ann.as<{
      bottles: Array<{ bottleId: string; hasAccess: boolean; rackId: string; spot: unknown }>;
    }>("get", "/shared-racks/bottles");
    expect(mine.body.bottles).toEqual([
      expect.objectContaining({
        bottleId: inRack,
        hasAccess: true,
        rackId: rack,
        spot: spot(2, 2),
      }),
    ]);
  });

  test("someone who is not a member gets 404 for every route of a rack they know the id of, and changes nothing", async ({
    request,
  }) => {
    const [ann, bob, dee] = await Promise.all([
      person(request, "Ann"),
      person(request, "Bob"),
      person(request, "Dee"),
    ]);
    const rack = await rackOf(ann, [bob]);
    const [annBottle] = await ann.bottles(1);
    const [deeBottle] = await dee.bottles(1);
    const placed = await place(ann, rack, annBottle!, spot(1, 1));
    const invited = await ann.as<{ invitationId: string }>(
      "post",
      `/shared-racks/${rack}/invitations`,
      {
        userId: (await person(request, "Eve")).userId,
      },
    );
    const before = { occupancy: await occupancy(rack), history: await history(rack) };
    const nowhere = "3f0e1c62-58a7-4a39-9d0b-7a4f2a1c9e10";
    for (const target of [rack, nowhere]) {
      const routes: Array<[Method, string, unknown?]> = [
        ["get", `/shared-racks/${target}`],
        ["patch", `/shared-racks/${target}`, { name: "Dee's now" }],
        ["delete", `/shared-racks/${target}`],
        ["post", `/shared-racks/${target}/restore`],
        ["put", `/shared-racks/${target}/layout`, RACK_5X12],
        ["get", `/shared-racks/${target}/members`],
        ["patch", `/shared-racks/${target}/members/${dee.userId}`, { role: "owner" }],
        ["delete", `/shared-racks/${target}/members/${ann.userId}`],
        ["post", `/shared-racks/${target}/leave`],
        ["get", `/shared-racks/${target}/invitations`],
        ["post", `/shared-racks/${target}/invitations`, { userId: dee.userId }],
        ["get", `/shared-racks/${target}/bottles`],
        ["post", `/shared-racks/${target}/bottles`, { bottleId: deeBottle, to: spot(2, 2) }],
        [
          "post",
          `/shared-racks/${target}/bottles/${placed.body.placementId}/move`,
          { from: spot(1, 1), to: spot(2, 2) },
        ],
        [
          "post",
          `/shared-racks/${target}/bottles/${placed.body.placementId}/take-out`,
          { from: spot(1, 1) },
        ],
        ["get", `/shared-racks/${target}/events`],
      ];
      for (const [method, path, data] of routes) {
        const res = await dee.as<{ error: { code: string; message: string } }>(method, path, data);
        expect(res.status, `${method} ${path}`).toBe(404);
        // the same words for a rack that exists and one that does not
        expect(res.body.error.code).toBe("NOT_FOUND");
      }
    }
    // someone else's invitation: not theirs to answer or to cancel
    expect(
      (
        await dee.as("post", `/shared-racks/invitations/${invited.body.invitationId}`, {
          accept: true,
        })
      ).status,
    ).toBe(404);
    expect(
      (await dee.as("delete", `/shared-racks/invitations/${invited.body.invitationId}`)).status,
    ).toBe(404);
    expect(
      (await dee.as<{ racks: unknown[] }>("get", "/shared-racks?archived=1")).body.racks,
    ).toEqual([]);
    expect(
      (await dee.as<{ invitations: unknown[] }>("get", "/shared-racks/invitations")).body
        .invitations,
    ).toEqual([]);
    expect({ occupancy: await occupancy(rack), history: await history(rack) }).toEqual(before);
    expect((await ann.as<{ name: string }>("get", `/shared-racks/${rack}`)).body).toMatchObject({
      memberCount: 2,
    });
  });
});

test.describe("forged ownership and forged actors", () => {
  test("nobody places a bottle they do not own, names another owner, or acts as someone else", async ({
    request,
  }) => {
    const [ann, bob] = await Promise.all([person(request, "Ann"), person(request, "Bob")]);
    const rack = await rackOf(ann, [bob]);
    const [annBottle, annSpare] = await ann.bottles(2);
    const [bobBottle] = await bob.bottles(1);

    // Bob places Ann's bottle: "not found", exactly like a bottle that does not exist
    const stolen = await place(bob, rack, annBottle!, spot(1, 1));
    const missing = await place(bob, rack, "3f0e1c62-58a7-4a39-9d0b-7a4f2a1c9e10", spot(1, 1));
    expect([stolen.status, missing.status]).toEqual([404, 404]);
    expect(stolen.body).toEqual(missing.body);
    expect(await occupancy(rack)).toEqual([]);

    // a body that names an owner, an actor or a household is refused whole
    for (const forged of [
      { ownerId: ann.userId },
      { ownerUserId: ann.userId },
      { owner: { userId: ann.userId } },
      { actorId: ann.userId },
      { userId: ann.userId },
      { householdId: ann.householdId },
      { placedBy: ann.userId },
    ]) {
      const res = await bob.as("post", `/shared-racks/${rack}/bottles`, {
        bottleId: bobBottle,
        to: spot(1, 1),
        ...forged,
      });
      expect(res.status, JSON.stringify(forged)).toBe(422);
    }
    expect(await occupancy(rack)).toEqual([]);

    // placed honestly, the owner is whoever placed it
    const mine = await place(bob, rack, bobBottle!, spot(1, 1));
    expect(mine.status).toBe(201);
    const theirs = await place(ann, rack, annBottle!, spot(1, 2));
    expect((await occupancy(rack)).map((p) => p.owner_user_id)).toEqual([bob.userId, ann.userId]);

    // a move or a taking-out that names an actor or an owner is refused whole; an honest one keeps the owner
    for (const forged of [
      { actorId: ann.userId },
      { ownerId: bob.userId },
      { userId: ann.userId },
    ]) {
      expect(
        (
          await bob.as("post", `/shared-racks/${rack}/bottles/${theirs.body.placementId}/move`, {
            from: spot(1, 2),
            to: spot(3, 3),
            ...forged,
          })
        ).status,
      ).toBe(422);
      expect(
        (
          await bob.as(
            "post",
            `/shared-racks/${rack}/bottles/${theirs.body.placementId}/take-out`,
            {
              from: spot(1, 2),
              ...forged,
            },
          )
        ).status,
      ).toBe(422);
    }
    expect(
      (
        await bob.as("post", `/shared-racks/${rack}/bottles/${theirs.body.placementId}/move`, {
          from: spot(1, 2),
          to: spot(3, 3),
        })
      ).status,
    ).toBe(200);
    expect((await occupancy(rack)).find((p) => p.bottle_id === annBottle)).toMatchObject({
      owner_user_id: ann.userId,
      loc_row: 3,
      loc_col: 3,
    });
    const moved = (await history(rack)).filter((e) => e.event_type === "bottle_moved");
    expect(moved).toEqual([
      { event_type: "bottle_moved", actor_id: bob.userId, owner_id: ann.userId },
    ]);

    // a member cannot make themselves owner of the rack, or remove its owner
    expect(
      (await bob.as("patch", `/shared-racks/${rack}/members/${bob.userId}`, { role: "owner" }))
        .status,
    ).toBe(403);
    expect((await bob.as("delete", `/shared-racks/${rack}/members/${ann.userId}`)).status).toBe(
      403,
    );
    expect((await bob.as("patch", `/shared-racks/${rack}`, { name: "Bob's" })).status).toBe(403);
    expect((await bob.as("delete", `/shared-racks/${rack}`)).status).toBe(403);
    expect((await bob.as("put", `/shared-racks/${rack}/layout`, RACK_5X12)).status).toBe(403);
    expect((await bob.as("get", `/shared-racks/${rack}/invitations`)).status).toBe(403);
    // the same bottle cannot stand in two racks
    const second = await rackOf(ann, []);
    expect((await place(ann, second, annBottle!, spot(1, 1))).status).toBe(409);
    expect((await place(ann, second, annSpare!, spot(1, 1))).status).toBe(201);
  });
});

test.describe("losing access", () => {
  test("a removed member's stale client changes nothing; their bottle stays theirs and they can take its record back", async ({
    request,
  }) => {
    const [ann, bob, cy] = await Promise.all([
      person(request, "Ann"),
      person(request, "Bob"),
      person(request, "Cy"),
    ]);
    const rack = await rackOf(ann, [bob, cy]);
    const [annBottle] = await ann.bottles(1);
    const [cyBottle, cySpare] = await cy.bottles(2, "Cy Chenin");
    const a = await place(ann, rack, annBottle!, spot(1, 1));
    const c = await place(cy, rack, cyBottle!, spot(2, 2));
    // what Cy's screen shows at this moment
    const cyScreen = await shown(cy, rack);
    expect(cyScreen).toHaveLength(2);

    expect((await ann.as("delete", `/shared-racks/${rack}/members/${cy.userId}`)).status).toBe(204);

    const before = { occupancy: await occupancy(rack), history: await history(rack) };
    // every change Cy's stale screen could still send
    for (const [method, path, data] of [
      [
        "post",
        `/shared-racks/${rack}/bottles/${a.body.placementId}/move`,
        { from: spot(1, 1), to: spot(4, 4) },
      ],
      [
        "post",
        `/shared-racks/${rack}/bottles/${c.body.placementId}/move`,
        { from: spot(2, 2), to: spot(4, 4) },
      ],
      [
        "post",
        `/shared-racks/${rack}/bottles/${a.body.placementId}/take-out`,
        { from: spot(1, 1) },
      ],
      [
        "post",
        `/shared-racks/${rack}/bottles/${c.body.placementId}/take-out`,
        { from: spot(2, 2) },
      ],
      ["post", `/shared-racks/${rack}/bottles`, { bottleId: cySpare, to: spot(3, 3) }],
      ["post", `/shared-racks/${rack}/leave`],
      ["get", `/shared-racks/${rack}`],
      ["get", `/shared-racks/${rack}/bottles`],
      ["get", `/shared-racks/${rack}/members`],
      ["get", `/shared-racks/${rack}/events`],
    ] as Array<[Method, string, unknown?]>)
      expect((await cy.as(method, path, data)).status, `${method} ${path}`).toBe(404);
    expect({ occupancy: await occupancy(rack), history: await history(rack) }).toEqual(before);
    expect(
      (await cy.as<{ racks: unknown[] }>("get", "/shared-racks?archived=1")).body.racks,
    ).toEqual([]);

    // the others still see Cy's bottle where it stands, as the bottle of someone who is no longer a member
    const stillThere = (await shown(bob, rack)).find((s) => s.placementId === c.body.placementId);
    expect(stillThere).toMatchObject({
      row: 2,
      col: 2,
      owner: { userId: cy.userId, name: "Cy", isMember: false },
    });
    // it is still Cy's own bottle, in Cy's own cellar
    const [row] = await sql<{ status: string; household_id: string }>(
      "select status, household_id from public.bottles where id = $1",
      [cyBottle],
    );
    expect(row).toEqual({ status: "in_cellar", household_id: cy.householdId });
    // Cy is told it stands in a rack they cannot open (not which, not where), and takes its record back
    const mine = await cy.as<{ bottles: Array<Body> }>("get", "/shared-racks/bottles");
    expect(mine.body.bottles).toEqual([
      expect.objectContaining({
        bottleId: cyBottle,
        hasAccess: false,
        rackId: null,
        rackName: null,
        spot: null,
      }),
    ]);
    expect((await cy.as("delete", `/shared-racks/bottles/${cyBottle}`)).status).toBe(204);
    expect((await cy.as("delete", `/shared-racks/bottles/${cyBottle}`)).status).toBe(409);
    expect((await shown(bob, rack)).map((s) => s.placementId)).toEqual([a.body.placementId]);
    expect((await history(rack)).at(-1)).toEqual({
      event_type: "bottle_withdrawn",
      actor_id: cy.userId,
      owner_id: cy.userId,
    });
  });

  test("leaving: the last owner cannot, a member can, and the owner role moves only explicitly", async ({
    request,
  }) => {
    const [ann, bob] = await Promise.all([person(request, "Ann"), person(request, "Bob")]);
    const rack = await rackOf(ann, [bob]);
    const [annBottle] = await ann.bottles(1);
    await place(ann, rack, annBottle!, spot(1, 1));

    expect((await ann.as("post", `/shared-racks/${rack}/leave`)).status).toBe(409);
    expect(
      (await ann.as("patch", `/shared-racks/${rack}/members/${ann.userId}`, { role: "member" }))
        .status,
    ).toBe(409);
    expect((await ann.as("delete", `/shared-racks/${rack}/members/${ann.userId}`)).status).toBe(
      422,
    );
    // handed over explicitly: now Ann can leave, and her bottle stays hers and stays where it stands
    expect(
      (await ann.as("patch", `/shared-racks/${rack}/members/${bob.userId}`, { role: "owner" }))
        .status,
    ).toBe(200);
    expect((await ann.as("post", `/shared-racks/${rack}/leave`)).status).toBe(204);
    expect((await ann.as("get", `/shared-racks/${rack}`)).status).toBe(404);
    const left = await shown(bob, rack);
    expect(left).toEqual([
      expect.objectContaining({
        row: 1,
        col: 1,
        owner: { userId: ann.userId, name: "Ann", isMember: false },
      }),
    ]);
    const [row] = await sql<{ status: string; household_id: string }>(
      "select status, household_id from public.bottles where id = $1",
      [annBottle],
    );
    expect(row).toEqual({ status: "in_cellar", household_id: ann.householdId });
    expect((await bob.as<{ role: string }>("get", `/shared-racks/${rack}`)).body).toMatchObject({
      role: "owner",
      memberCount: 1,
    });
    // Bob is the last owner now
    expect((await bob.as("post", `/shared-racks/${rack}/leave`)).status).toBe(409);
    // archived: read-only, but the bottle can still come out
    const archived = await bob.as<{ archived: boolean }>("delete", `/shared-racks/${rack}`);
    expect([archived.status, archived.body.archived]).toEqual([200, true]);
    expect(
      (
        await bob.as("post", `/shared-racks/${rack}/bottles/${left[0]!.placementId}/move`, {
          from: spot(1, 1),
          to: spot(2, 2),
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await bob.as("post", `/shared-racks/${rack}/bottles/${left[0]!.placementId}/take-out`, {
          from: spot(1, 1),
        })
      ).status,
    ).toBe(200);
    expect((await bob.as<{ racks: unknown[] }>("get", "/shared-racks")).body.racks).toEqual([]);
    expect(
      (await bob.as<{ racks: unknown[] }>("get", "/shared-racks?archived=1")).body.racks,
    ).toHaveLength(1);
    expect(
      (await bob.as<{ archived: boolean }>("post", `/shared-racks/${rack}/restore`)).body.archived,
    ).toBe(false);
  });
});

test.describe("invitations", () => {
  test("declined, expired, cancelled and answered twice", async ({ request }) => {
    const [ann, bob, cy, dee] = await Promise.all([
      person(request, "Ann"),
      person(request, "Bob"),
      person(request, "Cy"),
      person(request, "Dee"),
    ]);
    const rack = await rackOf(ann, []);
    const invite = async (who: Person) => {
      const res = await ann.as<{ invitationId: string; outcome: string }>(
        "post",
        `/shared-racks/${rack}/invitations`,
        {
          userId: who.userId,
        },
      );
      expect(res.status).toBe(201);
      return res.body.invitationId;
    };
    const answer = (who: Person, invitation: string, accept: boolean) =>
      who.as("post", `/shared-racks/invitations/${invitation}`, { accept });

    // nobody invites themselves or nobody; inviting twice is the same invitation
    expect(
      (await ann.as("post", `/shared-racks/${rack}/invitations`, { userId: ann.userId })).status,
    ).toBe(422);
    expect(
      (
        await ann.as("post", `/shared-racks/${rack}/invitations`, {
          userId: "3f0e1c62-58a7-4a39-9d0b-7a4f2a1c9e10",
        })
      ).status,
    ).toBe(404);
    const toBob = await invite(bob);
    expect(await invite(bob)).toBe(toBob);

    // what Bob sees before accepting: the rack's name and who asked; nothing of the rack itself
    const waiting = await bob.as<{ invitations: Array<Body> }>("get", "/shared-racks/invitations");
    expect(waiting.body.invitations).toEqual([
      expect.objectContaining({ id: toBob, rackId: rack, invitedBy: "Ann" }),
    ]);
    expect((await bob.as("get", `/shared-racks/${rack}`)).status).toBe(404);
    expect((await bob.as("get", `/shared-racks/${rack}/bottles`)).status).toBe(404);

    // accepted, and accepted again: the same answer, one membership
    expect((await answer(bob, toBob, true)).body).toEqual({ outcome: "accepted", rackId: rack });
    expect((await answer(bob, toBob, true)).body).toEqual({ outcome: "accepted", rackId: rack });
    expect((await answer(bob, toBob, false)).status).toBe(409);
    expect((await history(rack)).filter((e) => e.event_type === "member_joined")).toHaveLength(1);
    expect(
      (await ann.as("post", `/shared-racks/${rack}/invitations`, { userId: bob.userId })).status,
    ).toBe(409);

    // declined: final, and not asked again straight away
    const toCy = await invite(cy);
    expect((await answer(cy, toCy, false)).body).toEqual({ outcome: "declined", rackId: null });
    expect((await answer(cy, toCy, true)).status).toBe(409);
    expect((await cy.as("get", `/shared-racks/${rack}`)).status).toBe(404);
    expect(
      (await ann.as("post", `/shared-racks/${rack}/invitations`, { userId: cy.userId })).status,
    ).toBe(409);

    // expired: no longer shown, cannot be accepted; the owner sees it as expired and can invite again
    const toDee = await invite(dee);
    await sql(
      "update private.shared_rack_invitations set created_at = now() - interval '15 days', expires_at = now() - interval '1 day' where id = $1",
      [toDee],
    );
    expect(
      (await dee.as<{ invitations: unknown[] }>("get", "/shared-racks/invitations")).body
        .invitations,
    ).toEqual([]);
    expect((await answer(dee, toDee, true)).status).toBe(409);
    expect((await dee.as("get", `/shared-racks/${rack}`)).status).toBe(404);
    const listed = await ann.as<{
      invitations: Array<{ id: string; state: string; displayName: string }>;
    }>("get", `/shared-racks/${rack}/invitations`);
    expect(listed.body.invitations.map((i) => [i.displayName, i.state]).sort()).toEqual([
      ["Bob", "accepted"],
      ["Cy", "declined"],
      ["Dee", "expired"],
    ]);
    const again = await invite(dee);
    expect(again).not.toBe(toDee);

    // cancelled by the owner: cannot be accepted
    expect((await ann.as("delete", `/shared-racks/invitations/${again}`)).status).toBe(204);
    expect((await ann.as("delete", `/shared-racks/invitations/${again}`)).status).toBe(409);
    expect((await answer(dee, again, true)).status).toBe(409);
    expect(
      (await ann.as<{ memberCount: number }>("get", `/shared-racks/${rack}`)).body.memberCount,
    ).toBe(2);

    // a removed member does not get back in with the invitation they once accepted
    expect((await ann.as("delete", `/shared-racks/${rack}/members/${bob.userId}`)).status).toBe(
      204,
    );
    expect((await answer(bob, toBob, true)).body).toMatchObject({ outcome: "accepted" });
    expect((await bob.as("get", `/shared-racks/${rack}`)).status).toBe(404);
  });
});

test.describe("the rack itself", () => {
  test("layout: from the catalogue only, never from under a bottle, and of two saves from one version one wins", async ({
    request,
  }) => {
    const ann = await person(request, "Ann");
    const rack = await rackOf(ann, []);
    const [bottle] = await ann.bottles(1);
    await place(ann, rack, bottle!, spot(5, 12));
    const layout = (rows: number, cols: number, extra: Body = {}) => ({
      structure: { ...RACK_5X12.structure, rows, cols, ...extra },
      appearance: RACK_5X12.appearance,
    });
    const put = (body: unknown, revision?: string) =>
      ann.as<{ revision: string; rows: number; error?: Body }>(
        "put",
        `/shared-racks/${rack}/layout`,
        body,
        revision ? { "if-match": `"${revision}"` } : {},
      );

    expect((await put(layout(4, 12))).status).toBe(409); // the bottle on shelf 5 would lose its spot
    expect((await put(layout(5, 11))).status).toBe(409);
    expect((await put(layout(5, 12, { cellCapacity: 2 }))).status).toBe(422); // not a size of this template
    expect((await put(layout(5, 12, { template: "rack_from_the_future" }))).status).toBe(422);
    expect(
      (
        await put(
          layout(5, 12, { zones: [{ fromRow: 1, toRow: 5, purpose: "storage", targetTempC: 12 }] }),
        )
      ).status,
    ).toBe(422);
    expect((await put({ ...layout(5, 12), kind: "fridge" })).status).toBe(422);

    const { revision } = (await ann.as<{ revision: string }>("get", `/shared-racks/${rack}`)).body;
    // two saves from the same version, at the same moment: exactly one is applied
    const [x, y] = await Promise.all([put(layout(6, 12), revision), put(layout(7, 12), revision)]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    const won = x.status === 200 ? x : y;
    const after = (await ann.as<{ revision: string; rows: number }>("get", `/shared-racks/${rack}`))
      .body;
    expect(after.rows).toBe(won.body.rows);
    expect(after.revision).not.toBe(revision);
    expect((await put(layout(8, 12), revision)).status).toBe(409);
    expect((await put(layout(8, 12), "not-a-version")).status).toBe(409);
    expect((await put(layout(8, 12), after.revision)).status).toBe(200);
    expect(
      (
        await ann.as<{ name: string }>("patch", `/shared-racks/${rack}`, {
          name: "  Renamed rack ",
        })
      ).body.name,
    ).toBe("Renamed rack");
    expect((await ann.as("patch", `/shared-racks/${rack}`, { name: "" })).status).toBe(422);
    expect(
      (await ann.as("patch", `/shared-racks/${rack}`, { name: "x", role: "owner" })).status,
    ).toBe(422);
  });

  test("a bottle moves from a private place into the rack in one step, and back home by the cellar's own API", async ({
    request,
  }) => {
    const ann = await person(request, "Ann");
    const rack = await rackOf(ann, []);
    const home = await ann.as<{ id: string }>("post", "/storage", {
      label: "Home rack",
      kind: "rack",
      rows: 2,
      cols: 2,
    });
    const [bottle] = await ann.bottles(1, "Ann Riesling", home.body.id);
    const at = async () =>
      (
        await sql<{ location_id: string | null; status: string }>(
          "select location_id, status from public.bottles where id = $1",
          [bottle],
        )
      )[0];
    expect((await at())!.location_id).toBe(home.body.id);
    expect((await place(ann, rack, bottle!, spot(1, 1))).status).toBe(201);
    // never both: in the rack, so no longer in the private place
    expect(await at()).toEqual({ location_id: null, status: "in_cellar" });
    // put back in the private place with the cellar's own API: it leaves the rack, as "relocated", never as consumed
    const back = await ann.as("patch", `/bottles/${bottle}`, {
      action: "move",
      to: { locationId: home.body.id, row: 2, col: 2 },
    });
    expect(back.status).toBe(200);
    expect(await at()).toEqual({ location_id: home.body.id, status: "in_cellar" });
    expect(await occupancy(rack)).toEqual([]);
    expect((await history(rack)).map((e) => e.event_type)).toEqual([
      "rack_created",
      "bottle_placed",
      "bottle_relocated",
    ]);
  });
});
