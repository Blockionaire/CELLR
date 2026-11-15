import { expect, test, type APIRequestContext } from "@playwright/test";
import {
  APP_URL,
  FEATURES_URL,
  PREVIEW_URL,
  PUBLISHABLE_KEY,
  STACK,
  bearer,
  sessionToken,
  sql,
  stamp,
  uniqueEmail,
  wineBody,
} from "./helpers";

/**
 * Smart Cellar 3D, sprint 1C: the Smart Cellar API, end to end. Every request goes through the app (Next.js) to the
 * real PostgREST and Postgres of the local stack, AS the signed-in person: row-level security, column grants and the
 * SECURITY INVOKER functions decide, not a mock.
 *
 * The three test servers (playwright.config.ts) are the three states of the switch:
 *   3100  CELLR_SMART_CELLAR unset              closed: 404, as if the API did not exist
 *   3101  "write", on an unmarked production build   reads only: writes may never open there
 *   3102  "write", on a Vercel preview          reads and writes
 * Not a browser test: the phone project would only run the same requests again.
 */
test.skip(({ isMobile }) => isMobile, "HTTP only: the desktop project");
test.setTimeout(120_000);

const CLOSED = APP_URL;
const READS = FEATURES_URL;
const OPEN = PREVIEW_URL;

type Method = "get" | "post" | "patch" | "put" | "delete";

/** One request to the app's API. `token` null: anonymous (with a same-origin header, so only auth can refuse it). */
async function call<T = Record<string, unknown>>(
  request: APIRequestContext,
  base: string,
  token: string | null,
  method: Method,
  path: string,
  data?: unknown,
) {
  const res = await request[method](`${base}/api/v1${path}`, {
    headers: token ? bearer(token) : { origin: base },
    ...(data === undefined ? {} : { data }),
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status(), body: body as T };
}

/** A person with a household of their own (made through the API, as a native app would). */
async function household(request: APIRequestContext, label: string) {
  const email = uniqueEmail(label);
  const token = await sessionToken(email);
  const made = await call<{ id: string }>(request, OPEN, token, "post", "/households", {
    name: `${label} ${stamp()}`,
  });
  expect(made.status, "household").toBe(201);
  const [user] = await sql<{ id: string }>("select id from auth.users where email = $1", [email]);
  const as = <T = Record<string, unknown>>(
    base: string,
    method: Method,
    path: string,
    data?: unknown,
  ) => call<T>(request, base, token, method, path, data);
  const place = async (label: string, kind: string, rows: number, cols: number) => {
    const res = await as<{ id: string }>(OPEN, "post", "/storage", { label, kind, rows, cols });
    expect(res.status, `place ${label}`).toBe(201);
    return res.body.id;
  };
  /** Bottles of one new wine, put on the next free spots of a place (the old API). */
  const bottles = async (locationId: string | null, quantity: number, name = `Wine ${stamp()}`) => {
    const wine = await as<{ id: string }>(OPEN, "post", "/wines", { ...wineBody, name });
    expect(wine.status).toBe(201);
    const added = await as<{ bottleIds: string[] }>(OPEN, "post", "/bottles", {
      wineId: wine.body.id,
      year: 2019,
      quantity,
      locationId,
    });
    expect(added.status).toBe(201);
    return added.body.bottleIds;
  };
  return { email, token, userId: user!.id, householdId: made.body.id, as, place, bottles };
}

/** A place as the database holds it. */
async function stored(locationId: string) {
  const [row] = await sql<{
    kind: string;
    template: string | null;
    grid_rows: number;
    grid_cols: number;
    cell_capacity: number;
    slot_semantics: string | null;
    appearance: unknown;
    updated_at: string;
  }>(
    "select kind, template, grid_rows, grid_cols, cell_capacity, slot_semantics, appearance, updated_at::text from public.cellar_locations where id = $1",
    [locationId],
  );
  const zones = await sql<{
    zone_index: number;
    from_row: number;
    to_row: number;
    purpose: string;
    target_temp_c: string | null;
  }>(
    "select zone_index, from_row, to_row, purpose, target_temp_c::text from public.cellar_location_zones where location_id = $1 order by zone_index",
    [locationId],
  );
  return { ...row!, zones };
}

const COOLER_8 = {
  structure: {
    template: "cooler_dual",
    rows: 8,
    cols: 4,
    cellCapacity: 1,
    zones: [
      { fromRow: 1, toRow: 4, purpose: "storage", targetTempC: 12 },
      { fromRow: 5, toRow: 8, purpose: "serving", targetTempC: 7.5 },
    ],
  },
  appearance: { v: 1, material: "metal", color: "graphite", lighting: "warm", door: "glass" },
};
const COOLER_6 = {
  ...COOLER_8,
  structure: {
    ...COOLER_8.structure,
    rows: 6,
    zones: [
      { fromRow: 1, toRow: 3, purpose: "storage", targetTempC: 13 },
      { fromRow: 4, toRow: 6, purpose: "serving", targetTempC: 8 },
    ],
  },
};

test.describe("the switch", () => {
  test("closed by default: every Smart Cellar route answers 404, whatever is sent; version 1 export as before", async ({
    request,
  }) => {
    const me = await household(request, "closed");
    const rack = await me.place("Rack", "rack", 2, 3);
    for (const path of [
      "/smart-cellar",
      "/smart-cellar/storage",
      `/smart-cellar/storage/${rack}`,
      `/smart-cellar/storage/${rack}/bottles`,
    ])
      expect((await me.as(CLOSED, "get", path)).status, path).toBe(404);
    // a valid body and garbage alike: nothing about the request is looked at
    expect(
      (await me.as(CLOSED, "put", `/smart-cellar/storage/${rack}/layout`, COOLER_8)).status,
    ).toBe(404);
    expect(
      (await me.as(CLOSED, "put", `/smart-cellar/storage/${rack}/layout`, { nonsense: true }))
        .status,
    ).toBe(404);
    expect((await stored(rack)).template).toBeNull();
    // export: version 2 is not offered; version 1 is what it always was
    expect((await me.as(CLOSED, "get", "/export?version=2")).status).toBe(422);
    const v1 = await me.as<{ version: number }>(CLOSED, "get", "/export");
    expect(v1.status).toBe(200);
    expect(v1.body.version).toBe(1);
  });

  test("a production build that asks for writes only READS: the layout is refused before anything is looked at", async ({
    request,
  }) => {
    const me = await household(request, "reads");
    const rack = await me.place("Rack", "rack", 2, 3);
    const caps = await me.as(READS, "get", "/smart-cellar");
    expect(caps.status).toBe(200);
    expect(caps.body).toMatchObject({
      version: 1,
      reads: true,
      writes: false,
      depthPlacement: false,
      schema: "ready",
      exportVersions: [1, 2],
    });
    expect((await me.as(READS, "get", `/smart-cellar/storage/${rack}`)).status).toBe(200);
    for (const body of [COOLER_8, { nonsense: true }])
      expect((await me.as(READS, "put", `/smart-cellar/storage/${rack}/layout`, body)).status).toBe(
        403,
      );
    expect((await stored(rack)).template).toBeNull();
  });

  test("the preview server reads and writes", async ({ request }) => {
    const me = await household(request, "open");
    expect((await me.as(OPEN, "get", "/smart-cellar")).body).toMatchObject({
      reads: true,
      writes: true,
    });
  });
});

test.describe("reading", () => {
  test("places from before templates are exactly what they were: same capacity and occupancy as /api/v1/storage", async ({
    request,
  }) => {
    const me = await household(request, "legacy");
    const rack = await me.place("Rack", "rack", 3, 4);
    const fridge = await me.place("Fridge", "fridge", 2, 2);
    await me.bottles(rack, 5);
    await me.bottles(null, 2); // unplaced: in no place
    const before = await stored(rack);
    const units = await me.as<Array<Record<string, unknown>>>(OPEN, "get", "/smart-cellar/storage");
    expect(units.status).toBe(200);
    const legacy = await me.as<Array<Record<string, unknown>>>(OPEN, "get", "/storage");
    for (const id of [rack, fridge]) {
      const unit = units.body.find((u) => u.id === id)!;
      const old = legacy.body.find((u) => u.id === id)!;
      expect(unit).toMatchObject({
        templateId: null,
        legacy: true,
        arrangementKnown: true,
        cellCapacity: 1,
        slotSemantics: null,
        indexMeaning: "single",
        fallbacks: [],
        zones: [],
        rows: old.rows,
        cols: old.cols,
        capacity: old.capacity,
        occupied: old.used,
        free: old.free,
      });
    }
    // reading never rewrites what is stored
    expect(await stored(rack)).toEqual(before);
  });

  test("every bottle with its WHOLE spot: index 1 for every bottle there is, index 2 kept as 2 (depth fixture)", async ({
    request,
  }) => {
    const me = await household(request, "depth");
    const rack = await me.place("Deep", "rack", 2, 3);
    const [front, other] = await me.bottles(rack, 2); // (1,1) and (1,2)
    const first = await me.as<{
      placements: Array<{ bottleId: string; row: number; col: number; index: number }>;
    }>(OPEN, "get", `/smart-cellar/storage/${rack}/bottles`);
    expect(first.body.placements.map((p) => [p.bottleId, p.row, p.col, p.index])).toEqual([
      [front, 1, 1, 1],
      [other, 1, 2, 1],
    ]);

    // A future cellar, made in ONE transaction by the database owner: the depth switch is on only inside it (no other
    // session ever sees it on), the place becomes two deep, the second bottle moves behind in its own cell. The old
    // unique index still allows one bottle per cell, so it is alone there.
    await sql(`begin;
      update private.cellar_settings set depth_placement = true;
      update public.cellar_locations set template = 'rack_double_depth', slot_semantics = 'depth', cell_capacity = 2 where id = '${rack}';
      update public.bottles set loc_index = 2 where id = '${other}';
      update private.cellar_settings set depth_placement = false;
      commit;`);
    expect(
      (await sql<{ on: boolean }>("select depth_placement as on from private.cellar_settings"))[0]!
        .on,
    ).toBe(false);

    const deep = await me.as<{
      unit: Record<string, unknown>;
      placements: Array<{ bottleId: string; row: number; col: number; index: number }>;
    }>(OPEN, "get", `/smart-cellar/storage/${rack}/bottles`);
    expect(deep.body.unit).toMatchObject({
      templateId: "rack_double_depth",
      cellCapacity: 2,
      indexMeaning: "depth",
      arrangementKnown: true,
      capacity: 12,
      occupied: 2,
    });
    expect(deep.body.placements.find((p) => p.bottleId === other)).toMatchObject({
      row: 1,
      col: 2,
      index: 2,
    });

    // the old API does not lose it (it is still in its place's list), and the old swap will not move it: it cannot
    // vouch for an index it does not know ('stale', nothing changed)
    const racks = await me.as<{
      units: Array<{ id: string; bottles: Array<{ bottleId: string }> }>;
    }>(OPEN, "get", "/racks");
    const unit = racks.body.units.find((u) => u.id === rack)!;
    expect(unit.bottles.map((b) => b.bottleId).sort()).toEqual([front, other].sort());
    const swap = await me.as(OPEN, "patch", `/bottles/${front}`, {
      action: "swap",
      with: other,
      expected: {
        self: { locationId: rack, row: 1, col: 1 },
        other: { locationId: rack, row: 1, col: 2 },
      },
    });
    expect(swap.status).toBe(409);
    expect(
      (
        await sql<{ loc_index: number }>("select loc_index from public.bottles where id = $1", [
          other,
        ])
      )[0]!.loc_index,
    ).toBe(2);

    // export version 2 keeps it too, and says what the index means there
    const exported = await me.as<{
      places: Array<Record<string, unknown>>;
      bottles: Array<Record<string, unknown>>;
    }>(OPEN, "get", "/export?version=2");
    expect(exported.status).toBe(200);
    expect(exported.body.places.find((p) => p.name === "Deep")).toMatchObject({
      template: "rack_double_depth",
      arrangement: "known",
      bottlesPerPosition: 2,
      indexMeaning: "depth",
    });
    expect(
      exported.body.bottles
        .filter((b) => b.place === "Deep")
        .map((b) => b.index)
        .sort(),
    ).toEqual([1, 2]);
  });

  test("what cannot be read as stored is reported, never silently changed: unknown template, wrong meaning, look, zones", async ({
    request,
  }) => {
    const me = await household(request, "unknown");
    const newer = await me.place("Newer", "rack", 3, 4);
    const mismatched = await me.place("Mismatched", "rack", 3, 4);
    const cooler = await me.place("Cooler", "fridge", 8, 4);
    await sql(
      `update public.cellar_locations set template = 'hex_rack_2031', slot_semantics = 'depth', appearance = '{"v": 9, "finish": "holo"}' where id = $1`,
      [newer],
    );
    await sql(
      `update public.cellar_locations set template = 'rack_classic', slot_semantics = 'ordinal' where id = $1`,
      [mismatched],
    );
    // zones that do not split the shelves, as only a writer around every check could leave them (the owner, with
    // triggers off for this one transaction)
    await sql(`begin;
      set local session_replication_role = replica;
      update public.cellar_locations set template = 'cooler_dual', slot_semantics = 'depth' where id = '${cooler}';
      insert into public.cellar_location_zones (location_id, household_id, zone_index, from_row, to_row, purpose, target_temp_c)
        values ('${cooler}', '${me.householdId}', 1, 1, 3, 'storage', 12), ('${cooler}', '${me.householdId}', 2, 5, 8, 'serving', 7);
      commit;`);
    const before = await Promise.all([newer, mismatched, cooler].map(stored));

    const read = async (id: string) =>
      (await me.as<Record<string, unknown>>(OPEN, "get", `/smart-cellar/storage/${id}`)).body;
    expect(await read(newer)).toMatchObject({
      templateId: "hex_rack_2031",
      arrangementKnown: false,
      legacy: false,
      indexMeaning: "single",
      fallbacks: expect.arrayContaining(["unknown_template", "appearance"]),
      appearance: { v: 1 },
    });
    expect(await read(mismatched)).toMatchObject({
      templateId: "rack_classic",
      slotSemantics: "ordinal",
      arrangementKnown: false,
      fallbacks: ["semantics_mismatch"],
    });
    expect(await read(cooler)).toMatchObject({
      templateId: "cooler_dual",
      arrangementKnown: true,
      zones: [],
      fallbacks: ["zones"],
    });
    // and nothing that was read was written back
    expect(await Promise.all([newer, mismatched, cooler].map(stored))).toEqual(before);
  });
});

test.describe("writing a layout", () => {
  test("a valid one-deep layout with zones: saved whole, the template decides kind and meaning", async ({
    request,
  }) => {
    const me = await household(request, "save");
    const place = await me.place("Fridge", "other", 3, 3);
    await me.bottles(place, 3);
    const saved = await me.as<Record<string, unknown>>(
      OPEN,
      "put",
      `/smart-cellar/storage/${place}/layout`,
      COOLER_8,
    );
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({
      kind: "fridge",
      templateId: "cooler_dual",
      rows: 8,
      cols: 4,
      cellCapacity: 1,
      slotSemantics: "depth",
      indexMeaning: "single",
      arrangementKnown: true,
      legacy: false,
      fallbacks: [],
      occupied: 3,
      zones: COOLER_8.structure.zones,
      appearance: COOLER_8.appearance,
    });
    const row = await stored(place);
    expect(row).toMatchObject({
      kind: "fridge",
      template: "cooler_dual",
      grid_rows: 8,
      grid_cols: 4,
      cell_capacity: 1,
      slot_semantics: "depth",
      appearance: COOLER_8.appearance,
    });
    expect(
      row.zones.map((z) => [z.zone_index, z.from_row, z.to_row, z.purpose, z.target_temp_c]),
    ).toEqual([
      [1, 1, 4, "storage", "12.0"],
      [2, 5, 8, "serving", "7.5"],
    ]);
    // zones: [] removes them, with the layout
    const none = await me.as(OPEN, "put", `/smart-cellar/storage/${place}/layout`, {
      ...COOLER_8,
      structure: { ...COOLER_8.structure, zones: [] },
    });
    expect(none.status).toBe(200);
    expect((await stored(place)).zones).toEqual([]);
  });

  test("refused, and nothing changed: unknown template, a look it does not offer, zones that do not split, depth, a template of bins", async ({
    request,
  }) => {
    const me = await household(request, "refuse");
    const place = await me.place("Rack", "rack", 4, 4);
    const before = await stored(place);
    const cases: Array<[string, unknown, number]> = [
      [
        "unknown template",
        { ...COOLER_8, structure: { ...COOLER_8.structure, template: "hex_rack_2031" } },
        422,
      ],
      [
        "size outside the template",
        { ...COOLER_8, structure: { ...COOLER_8.structure, rows: 25, zones: [] } },
        422,
      ],
      [
        "colour not of its material",
        { ...COOLER_8, appearance: { ...COOLER_8.appearance, color: "oak" } },
        422,
      ],
      [
        "a look of another version",
        { ...COOLER_8, appearance: { ...COOLER_8.appearance, v: 2 } },
        422,
      ],
      [
        "no version at all",
        {
          ...COOLER_8,
          appearance: { material: "metal", color: "graphite", lighting: "warm", door: "glass" },
        },
        422,
      ],
      [
        "zones with a gap",
        {
          ...COOLER_8,
          structure: {
            ...COOLER_8.structure,
            zones: [{ ...COOLER_8.structure.zones[0], toRow: 3 }, COOLER_8.structure.zones[1]],
          },
        },
        422,
      ],
      [
        "a temperature out of range",
        {
          ...COOLER_8,
          structure: {
            ...COOLER_8.structure,
            zones: [{ fromRow: 1, toRow: 8, purpose: "storage", targetTempC: 30 }],
          },
        },
        422,
      ],
      [
        "a purpose that is not one",
        {
          ...COOLER_8,
          structure: {
            ...COOLER_8.structure,
            zones: [{ fromRow: 1, toRow: 8, purpose: "aging", targetTempC: 12 }],
          },
        },
        422,
      ],
      [
        "two bottles per position",
        {
          structure: {
            template: "rack_double_depth",
            rows: 4,
            cols: 4,
            cellCapacity: 2,
            zones: [],
          },
          appearance: { v: 1, material: "wood", color: "walnut", lighting: "none", door: "none" },
        },
        409,
      ],
      [
        "bins (two and more per compartment)",
        {
          structure: { template: "diamond_bins", rows: 2, cols: 3, cellCapacity: 8, zones: [] },
          appearance: { v: 1, material: "wood", color: "walnut", lighting: "none", door: "none" },
        },
        409,
      ],
      [
        "a meaning of the index sent along",
        { ...COOLER_8, structure: { ...COOLER_8.structure, semantics: "ordinal" } },
        422,
      ],
      ["a kind sent along", { ...COOLER_8, kind: "wall" }, 422],
    ];
    for (const [what, body, status] of cases) {
      const res = await me.as(OPEN, "put", `/smart-cellar/storage/${place}/layout`, body);
      expect(res.status, what).toBe(status);
    }
    expect(await stored(place)).toEqual(before);
  });

  test("a layout that would take bottles' spots is refused, and the place and its bottles stay as they were", async ({
    request,
  }) => {
    const me = await household(request, "shrink");
    const place = await me.place("Fridge", "fridge", 8, 4);
    const ids = await me.bottles(place, 1);
    await me.as(OPEN, "patch", `/bottles/${ids[0]}`, {
      action: "move",
      to: { locationId: place, row: 8, col: 4 },
    });
    const before = await stored(place);
    const res = await me.as<{ error: { code: string } }>(
      OPEN,
      "put",
      `/smart-cellar/storage/${place}/layout`,
      COOLER_6,
    );
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CONFLICT");
    expect(await stored(place)).toEqual(before);
    expect(
      (
        await sql<{ loc_row: number }>("select loc_row from public.bottles where id = $1", [ids[0]])
      )[0]!.loc_row,
    ).toBe(8);
  });

  test("what an index means is not changed under bottles in a place more than one deep", async ({
    request,
  }) => {
    const me = await household(request, "semantics");
    const place = await me.place("Crates", "other", 2, 2);
    await me.bottles(place, 1);
    await sql(`begin;
      update private.cellar_settings set depth_placement = true;
      update public.cellar_locations set template = 'crate_storage', slot_semantics = 'ordinal', cell_capacity = 2 where id = '${place}';
      update private.cellar_settings set depth_placement = false;
      commit;`);
    const before = await stored(place);
    const res = await me.as(OPEN, "put", `/smart-cellar/storage/${place}/layout`, {
      structure: { template: "rack_generic", rows: 2, cols: 2, cellCapacity: 1, zones: [] },
      appearance: { v: 1, material: "wood", color: "walnut", lighting: "none", door: "none" },
    });
    expect(res.status).toBe(409);
    expect(await stored(place)).toEqual(before);
  });

  test("ATOMIC: when the database fails halfway through a save, nothing at all is changed", async ({
    request,
  }) => {
    const me = await household(request, "atomic");
    const place = await me.place("Fridge", "other", 3, 3);
    const before = await stored(place);
    // the zones are written after the place inside save_storage_layout: make that second step fail, for this place only
    const fn = `test_fail_zones_${stamp().replace(/[^a-z0-9]/g, "")}`;
    await sql(`begin;
      create function public.${fn}() returns trigger language plpgsql as $f$
        begin if new.location_id = '${place}' then raise exception 'test_zone_failure'; end if; return new; end $f$;
      create trigger ${fn} before insert on public.cellar_location_zones for each row execute function public.${fn}();
      commit;`);
    try {
      const res = await me.as(OPEN, "put", `/smart-cellar/storage/${place}/layout`, COOLER_8);
      expect(res.status).toBeGreaterThanOrEqual(400);
      // the place was updated first inside the function, and that is undone with the rest
      expect(await stored(place)).toEqual(before);
    } finally {
      await sql(
        `drop trigger if exists ${fn} on public.cellar_location_zones; drop function if exists public.${fn}();`,
      );
    }
    // and with the failure gone, the same save goes through
    expect(
      (await me.as(OPEN, "put", `/smart-cellar/storage/${place}/layout`, COOLER_8)).status,
    ).toBe(200);
  });

  test("two saves of one place at once: one after the other, and the result is one of them, whole", async ({
    request,
  }) => {
    const me = await household(request, "concurrent");
    const place = await me.place("Fridge", "fridge", 8, 4);
    for (let round = 0; round < 3; round++) {
      const [a, b] = await Promise.all([
        me.as(OPEN, "put", `/smart-cellar/storage/${place}/layout`, COOLER_8),
        me.as(OPEN, "put", `/smart-cellar/storage/${place}/layout`, COOLER_6),
      ]);
      for (const res of [a, b]) expect([200, 409]).toContain(res.status);
      const row = await stored(place);
      const zones = row.zones.map((z) => [z.from_row, z.to_row]);
      // never the rows of one and the zones of the other
      if (row.grid_rows === 8)
        expect(zones).toEqual([
          [1, 4],
          [5, 8],
        ]);
      else {
        expect(row.grid_rows).toBe(6);
        expect(zones).toEqual([
          [1, 3],
          [4, 6],
        ]);
      }
    }
  });

  test("a save waits for a lock on the place; a direct zone write during it is refused at once, to retry (never a deadlock)", async ({
    request,
  }) => {
    const me = await household(request, "locked");
    const place = await me.place("Fridge", "fridge", 8, 4);
    expect(
      (await me.as(OPEN, "put", `/smart-cellar/storage/${place}/layout`, COOLER_8)).status,
    ).toBe(200);
    // someone holds the place's row lock for a moment (a bottle being placed, a resize)
    const held = sql(
      `begin; select 1 from public.cellar_locations where id = '${place}' for no key update; select pg_sleep(2); commit;`,
    );
    await new Promise((r) => setTimeout(r, 400));
    // a client writing a zone row directly, as the person, through PostgREST: refused at once (55P03), not waiting
    const direct = await request.patch(
      `${STACK}/rest/v1/cellar_location_zones?location_id=eq.${place}&zone_index=eq.1`,
      {
        headers: {
          apikey: PUBLISHABLE_KEY,
          ...bearer(me.token),
          "content-type": "application/json",
        },
        data: { target_temp_c: 14 },
      },
    );
    expect(direct.ok()).toBe(false);
    expect(JSON.stringify(await direct.json())).toContain("zone_place_busy");
    // the API's save waits its turn and then goes through
    const started = Date.now();
    const saved = await me.as(OPEN, "put", `/smart-cellar/storage/${place}/layout`, COOLER_6);
    expect(saved.status).toBe(200);
    expect(Date.now() - started).toBeGreaterThan(500);
    await held;
    expect((await stored(place)).grid_rows).toBe(6);
  });
});

test.describe("who may", () => {
  test("anonymous and a bad token: 401 on every route", async ({ request }) => {
    const someone = await household(request, "anon");
    const rack = await someone.place("Rack", "rack", 2, 2);
    for (const [method, path] of [
      ["get", "/smart-cellar"],
      ["get", "/smart-cellar/storage"],
      ["get", `/smart-cellar/storage/${rack}`],
      ["get", `/smart-cellar/storage/${rack}/bottles`],
      ["put", `/smart-cellar/storage/${rack}/layout`],
      ["get", "/export?version=2"],
    ] as const) {
      expect(
        (await call(request, OPEN, null, method, path, method === "put" ? COOLER_8 : undefined))
          .status,
        path,
      ).toBe(401);
      expect(
        (
          await call(
            request,
            OPEN,
            "not-a-token",
            method,
            path,
            method === "put" ? COOLER_8 : undefined,
          )
        ).status,
        path,
      ).toBe(401);
    }
    expect((await stored(rack)).template).toBeNull();
  });

  test("a member of the household reads and saves; another household sees and changes nothing, not even that it exists", async ({
    request,
  }) => {
    const owner = await household(request, "owner");
    const place = await owner.place("Fridge", "fridge", 8, 4);
    await owner.bottles(place, 2);
    // a member, through an invite
    const invite = await owner.as<{ code: string }>(
      OPEN,
      "post",
      `/households/${owner.householdId}/invites`,
      {},
    );
    expect(invite.status).toBe(201);
    const memberEmail = uniqueEmail("member");
    const memberToken = await sessionToken(memberEmail);
    expect(
      (
        await call(request, OPEN, memberToken, "post", "/households/join", {
          code: invite.body.code,
        })
      ).status,
    ).toBe(200);
    expect(
      (await call(request, OPEN, memberToken, "get", `/smart-cellar/storage/${place}`)).status,
    ).toBe(200);
    expect(
      (
        await call(
          request,
          OPEN,
          memberToken,
          "put",
          `/smart-cellar/storage/${place}/layout`,
          COOLER_8,
        )
      ).status,
    ).toBe(200);
    const after = await stored(place);

    // a stranger with a household of their own
    const stranger = await household(request, "stranger");
    for (const path of [
      `/smart-cellar/storage/${place}`,
      `/smart-cellar/storage/${place}/bottles`,
    ]) {
      const res = await stranger.as<{ error: { code: string; message: string } }>(
        OPEN,
        "get",
        path,
      );
      expect(res.status, path).toBe(404);
      expect(JSON.stringify(res.body)).not.toContain("Fridge");
    }
    expect(
      (await stranger.as(OPEN, "put", `/smart-cellar/storage/${place}/layout`, COOLER_6)).status,
    ).toBe(404);
    expect((await stranger.as<unknown[]>(OPEN, "get", "/smart-cellar/storage")).body).toEqual([]);
    // the same 404 as an id that does not exist at all
    const nowhere = await stranger.as(
      OPEN,
      "get",
      "/smart-cellar/storage/00000000-0000-4000-8000-000000000000",
    );
    expect(nowhere.status).toBe(404);
    // the function itself, called directly through PostgREST with the victim's household: row-level security holds
    const direct = await request.post(`${STACK}/rest/v1/rpc/save_storage_layout`, {
      headers: {
        apikey: PUBLISHABLE_KEY,
        ...bearer(stranger.token),
        "content-type": "application/json",
      },
      data: {
        p_household: owner.householdId,
        p_location: place,
        p_kind: "fridge",
        p_template: "cooler_dual",
        p_slot_semantics: "depth",
        p_rows: 6,
        p_cols: 4,
        p_cell_capacity: 1,
        p_appearance: COOLER_8.appearance,
        p_zones: [],
      },
    });
    expect(await direct.json()).toBe("not_found");
    // nor can they read its zones directly
    const zones = await request.get(
      `${STACK}/rest/v1/cellar_location_zones?location_id=eq.${place}`,
      {
        headers: { apikey: PUBLISHABLE_KEY, ...bearer(stranger.token) },
      },
    );
    expect(await zones.json()).toEqual([]);
    expect(await stored(place)).toEqual(after);
  });

  test("someone without a household: told to make one, nothing else", async ({ request }) => {
    const token = await sessionToken(uniqueEmail("nohouse"));
    const res = await call<{ error: { message: string } }>(
      request,
      OPEN,
      token,
      "get",
      "/smart-cellar/storage",
    );
    expect(res.status).toBe(404);
    expect(res.body.error.message).toMatch(/household/i);
  });

  test("a friend who may see the cellar sees what they always saw, and nothing of its structure or temperatures", async ({
    request,
  }) => {
    const owner = await household(request, "sharer");
    const place = await owner.place("Cooler", "fridge", 8, 4);
    await owner.bottles(place, 1);
    expect(
      (await owner.as(OPEN, "put", `/smart-cellar/storage/${place}/layout`, COOLER_8)).status,
    ).toBe(200);
    const friend = await household(request, "friend");
    await sql(
      "insert into public.friendships (requester, addressee, status, accepted_at) values ($1, $2, 'accepted', now())",
      [owner.userId, friend.userId],
    );
    await sql(
      "insert into public.sharing_settings (user_id, cellar) values ($1, 'friends') on conflict (user_id) do update set cellar = 'friends'",
      [owner.userId],
    );
    // what the friend view has always shown: places by name and size, and which wine is where
    const view = await friend.as<{ cellar: { racks: Array<Record<string, unknown>> } | null }>(
      OPEN,
      "get",
      `/friends/${owner.userId}`,
    );
    expect(view.status).toBe(200);
    const rack = view.body.cellar!.racks.find((r) => r.label === "Cooler")!;
    expect(Object.keys(rack).sort()).toEqual(["bottles", "cols", "kind", "label", "rows"]);
    expect(JSON.stringify(view.body)).not.toMatch(/template|zone|temp|appearance|cooler_dual/i);
    // the Smart Cellar API is the friend's own household's, never the owner's
    expect((await friend.as(OPEN, "get", `/smart-cellar/storage/${place}`)).status).toBe(404);
    expect((await friend.as(OPEN, "get", `/smart-cellar/storage/${place}/bottles`)).status).toBe(
      404,
    );
    const own = await friend.as<Array<{ id: string }>>(OPEN, "get", "/smart-cellar/storage");
    expect(own.body.map((u) => u.id)).not.toContain(place);
    const zones = await request.get(
      `${STACK}/rest/v1/cellar_location_zones?location_id=eq.${place}`,
      {
        headers: { apikey: PUBLISHABLE_KEY, ...bearer(friend.token) },
      },
    );
    expect(await zones.json()).toEqual([]);
    const exported = await friend.as(OPEN, "get", "/export?version=2");
    expect(JSON.stringify(exported.body)).not.toContain("Cooler");
  });
});

test.describe("the old API keeps working, and keeps a templated place consistent", () => {
  test("/api/v1/storage answers in the same shape for every place, with or without a template", async ({
    request,
  }) => {
    const me = await household(request, "shape");
    const legacy = await me.place("Rack", "rack", 2, 3);
    const templated = await me.place("Cooler", "fridge", 8, 4);
    expect(
      (await me.as(OPEN, "put", `/smart-cellar/storage/${templated}/layout`, COOLER_8)).status,
    ).toBe(200);
    for (const base of [CLOSED, OPEN]) {
      const list = await me.as<Array<Record<string, unknown>>>(base, "get", "/storage");
      expect(list.status).toBe(200);
      for (const unit of list.body.filter((u) => u.id === legacy || u.id === templated))
        expect(Object.keys(unit).sort()).toEqual([
          "capacity",
          "cols",
          "free",
          "id",
          "kind",
          "label",
          "rows",
          "used",
        ]);
      expect(list.body.find((u) => u.id === templated)).toMatchObject({
        kind: "fridge",
        rows: 8,
        cols: 4,
        capacity: 32,
      });
    }
  });

  test("a place without a template is edited exactly as before (any kind, any size the database allows)", async ({
    request,
  }) => {
    const me = await household(request, "oldedit");
    const place = await me.place("Rack", "rack", 2, 3);
    const res = await me.as(CLOSED, "patch", `/storage/${place}`, {
      kind: "wall",
      rows: 30,
      cols: 30,
      label: "Wall",
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: place,
      label: "Wall",
      kind: "wall",
      rows: 30,
      cols: 30,
      capacity: 900,
    });
    expect((await stored(place)).template).toBeNull();
  });

  test("a place with a template: renamed freely, resized within the template, never re-kinded or sized past it", async ({
    request,
  }) => {
    const me = await household(request, "guard");
    const place = await me.place("Cooler", "fridge", 8, 4);
    expect(
      (
        await me.as(OPEN, "put", `/smart-cellar/storage/${place}/layout`, {
          ...COOLER_8,
          structure: { ...COOLER_8.structure, zones: [] },
        })
      ).status,
    ).toBe(200);
    // on every server, switch or not: this protects the data, not a feature
    for (const base of [CLOSED, OPEN]) {
      expect(
        (await me.as(base, "patch", `/storage/${place}`, { label: `Cooler ${base.slice(-4)}` }))
          .status,
      ).toBe(200);
      expect((await me.as(base, "patch", `/storage/${place}`, { kind: "rack" })).status).toBe(409);
      expect((await me.as(base, "patch", `/storage/${place}`, { rows: 30 })).status).toBe(422);
    }
    const resized = await me.as(CLOSED, "patch", `/storage/${place}`, { rows: 10 });
    expect(resized.status).toBe(200);
    expect(await stored(place)).toMatchObject({
      kind: "fridge",
      template: "cooler_dual",
      grid_rows: 10,
      slot_semantics: "depth",
    });
    // with zones, a change of shelves that leaves them without a split is refused by the database, and says why
    expect(
      (
        await me.as(OPEN, "put", `/smart-cellar/storage/${place}/layout`, {
          ...COOLER_8,
          structure: { ...COOLER_8.structure, rows: 8 },
        })
      ).status,
    ).toBe(200);
    const unsplit = await me.as<{ error: { code: string } }>(CLOSED, "patch", `/storage/${place}`, {
      rows: 9,
    });
    expect(unsplit.status).toBe(422);
    expect((await stored(place)).grid_rows).toBe(8);
  });

  test("bottles: added, moved without an index (an older client), swapped, opened: as before, every index 1", async ({
    request,
  }) => {
    const me = await household(request, "bottles");
    const rack = await me.place("Rack", "rack", 2, 3);
    const fridge = await me.place("Fridge", "fridge", 8, 4);
    expect(
      (await me.as(OPEN, "put", `/smart-cellar/storage/${fridge}/layout`, COOLER_8)).status,
    ).toBe(200);
    const [a, b] = await me.bottles(rack, 2);
    // a move into the templated place, by a client that knows nothing of indexes
    const moved = await me.as(CLOSED, "patch", `/bottles/${a}`, {
      action: "move",
      to: { locationId: fridge, row: 3, col: 2 },
    });
    expect(moved.status).toBe(200);
    const swapped = await me.as(CLOSED, "patch", `/bottles/${a}`, {
      action: "swap",
      with: b,
      expected: {
        self: { locationId: fridge, row: 3, col: 2 },
        other: { locationId: rack, row: 1, col: 2 },
      },
    });
    expect(swapped.status).toBe(200);
    const spots = await sql<{
      id: string;
      location_id: string;
      loc_row: number;
      loc_col: number;
      loc_index: number;
    }>(
      "select id, location_id, loc_row, loc_col, loc_index from public.bottles where id = any($1::uuid[]) order by id",
      [[a, b]],
    );
    expect(spots.map((s) => s.loc_index)).toEqual([1, 1]);
    expect(spots.find((s) => s.id === a)).toMatchObject({
      location_id: rack,
      loc_row: 1,
      loc_col: 2,
    });
    expect(spots.find((s) => s.id === b)).toMatchObject({
      location_id: fridge,
      loc_row: 3,
      loc_col: 2,
    });
    // the new API sees the same
    const placed = await me.as<{
      placements: Array<{ bottleId: string; row: number; col: number; index: number }>;
    }>(OPEN, "get", `/smart-cellar/storage/${fridge}/bottles`);
    expect(placed.body.placements).toEqual([
      expect.objectContaining({ bottleId: b, row: 3, col: 2, index: 1 }),
    ]);
    // the racks view is unchanged in shape
    const racks = await me.as<{ units: Array<Record<string, unknown>>; unplaced: unknown[] }>(
      CLOSED,
      "get",
      "/racks",
    );
    expect(racks.status).toBe(200);
    expect(Object.keys(racks.body).sort()).toEqual(["units", "unplaced"]);
    expect((await me.as(CLOSED, "patch", `/bottles/${b}`, { action: "open" })).status).toBe(200);
  });

  test("export version 1 is the same on every server; version 2 adds, and changes nothing of what version 1 says", async ({
    request,
  }) => {
    const me = await household(request, "export");
    const fridge = await me.place("Fridge", "fridge", 8, 4);
    await me.bottles(fridge, 2);
    expect(
      (await me.as(OPEN, "put", `/smart-cellar/storage/${fridge}/layout`, COOLER_8)).status,
    ).toBe(200);
    type V1 = {
      version: number;
      places: Array<Record<string, unknown>>;
      bottles: Array<Record<string, unknown>>;
      exportedAt: string;
    };
    const strip = (x: V1) => ({ ...x, exportedAt: "" });
    const closed = await me.as<V1>(CLOSED, "get", "/export");
    const open = await me.as<V1>(OPEN, "get", "/export");
    expect(closed.body.version).toBe(1);
    expect(strip(open.body)).toEqual(strip(closed.body));
    expect(Object.keys(closed.body.places[0]!)).toEqual([
      "name",
      "kind",
      "shelves",
      "positionsPerShelf",
    ]);
    expect(closed.body.bottles.every((b) => !("index" in b))).toBe(true);
    const v2 = await me.as<{
      version: number;
      places: Array<Record<string, unknown>>;
      bottles: Array<Record<string, unknown>>;
    }>(OPEN, "get", "/export?version=2");
    expect(v2.body.version).toBe(2);
    expect(v2.body.places[0]).toMatchObject({
      name: "Fridge",
      template: "cooler_dual",
      arrangement: "known",
      zones: [
        { fromShelf: 1, toShelf: 4, purpose: "storage", setToC: 12 },
        { fromShelf: 5, toShelf: 8, purpose: "serving", setToC: 7.5 },
      ],
    });
    // every bottle of version 1, with the same words, and an index
    expect(
      v2.body.bottles.map((b) =>
        Object.fromEntries(Object.entries(b).filter(([key]) => key !== "index")),
      ),
    ).toEqual(closed.body.bottles);
    expect(v2.body.bottles.map((b) => b.index)).toEqual([1, 1]);
    // other versions: refused, not quietly answered with version 1
    expect((await me.as(OPEN, "get", "/export?version=3")).status).toBe(422);
  });
});
