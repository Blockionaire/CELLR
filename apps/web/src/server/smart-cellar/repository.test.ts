import { describe, expect, it } from "vitest";
import {
  LAYOUT_FUNCTION_PARAMS,
  createSmartCellarRepository,
  layoutFunctionDescribed,
  writeReadiness,
} from "./repository";

type Row = Record<string, unknown>;
type DbError = { code: string; message: string };

/**
 * A data API in memory that behaves as PostgREST does where it matters here: every answer is cut at `maxRows` rows
 * without saying so (Supabase: 1000), filters and order are applied, `range` pages. Function calls are refused
 * outright: nothing in this file may call one. `describe` is the answer to "describe yourself" at the API's root.
 */
function fakeDataApi(
  tables: Record<string, Row[]>,
  options: {
    maxRows?: number;
    /** An error for a select on this table that names this column (a database without the Smart Cellar step). */
    missing?: Array<{ table: string; column?: string; error: DbError }>;
    describe?: () => Promise<Response>;
  } = {},
) {
  const maxRows = options.maxRows ?? 1000;
  const calls = {
    rpc: 0,
    describe: [] as Array<{ url: string; accept: string | null; authorization: string | null }>,
    ranges: [] as Array<{ table: string; from: number; to: number }>,
    ins: [] as Array<{ table: string; column: string; count: number }>,
  };
  const db = {
    rpc: () => {
      calls.rpc += 1;
      throw new Error("a function was called");
    },
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      const orders: Array<[string, boolean]> = [];
      let columns = "";
      let range: [number, number] | null = null;
      let limit: number | null = null;
      let head = false;
      const run = () => {
        const failure = options.missing?.find(
          (m) => m.table === table && (!m.column || columns.includes(m.column)),
        );
        if (failure) return { data: null, error: failure.error, count: null };
        let rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
        rows = [...rows].sort((a, b) => {
          for (const [column, ascending] of orders) {
            const x = a[column] as string | number;
            const y = b[column] as string | number;
            if (x === y) continue;
            return (x < y ? -1 : 1) * (ascending ? 1 : -1);
          }
          return 0;
        });
        if (head) return { data: null, error: null, count: rows.length };
        if (range) {
          calls.ranges.push({ table, from: range[0], to: range[1] });
          rows = rows.slice(range[0], range[1] + 1);
        }
        if (limit !== null) rows = rows.slice(0, limit);
        return { data: rows.slice(0, maxRows), error: null, count: null };
      };
      const builder = {
        url: new URL(`http://stack.test/rest/v1/${table}`),
        headers: new Headers({ apikey: "publishable", Authorization: "Bearer person" }),
        fetch: async (url: string, init?: RequestInit) => {
          const headers = new Headers(init?.headers);
          calls.describe.push({
            url,
            accept: headers.get("accept"),
            authorization: headers.get("authorization"),
          });
          if (!options.describe) throw new Error("no description was expected");
          return options.describe();
        },
        select(cols: string, opts?: { head?: boolean }) {
          columns = cols;
          head = opts?.head === true;
          return builder;
        },
        eq(column: string, value: unknown) {
          filters.push((r) => r[column] === value);
          return builder;
        },
        in(column: string, values: unknown[]) {
          calls.ins.push({ table, column, count: values.length });
          filters.push((r) => values.includes(r[column]));
          return builder;
        },
        not(column: string) {
          filters.push((r) => r[column] !== null && r[column] !== undefined);
          return builder;
        },
        order(column: string, opts?: { ascending?: boolean }) {
          orders.push([column, opts?.ascending !== false]);
          return builder;
        },
        range(from: number, to: number) {
          range = [from, to];
          return builder;
        },
        limit(n: number) {
          limit = n;
          return builder;
        },
        maybeSingle: async () => {
          const r = run();
          return { ...r, data: r.data?.[0] ?? null };
        },
        then<T>(resolve: (value: ReturnType<typeof run>) => T) {
          return Promise.resolve(run()).then(resolve);
        },
      };
      return builder;
    },
  };
  const repo = createSmartCellarRepository(
    db as unknown as Parameters<typeof createSmartCellarRepository>[0],
  );
  return { repo, calls };
}

const json = (status: number, body: unknown) => async () =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/** The part of the document the local stack's PostgREST 12 serves for save_storage_layout (trimmed). */
const DESCRIBED = {
  swagger: "2.0",
  paths: {
    "/cellar_location_zones": { get: {} },
    "/rpc/save_storage_layout": {
      get: {
        parameters: LAYOUT_FUNCTION_PARAMS.map((name) => ({ in: "query", name, required: true })),
      },
      post: {
        parameters: [
          {
            in: "body",
            name: "args",
            schema: {
              properties: Object.fromEntries(LAYOUT_FUNCTION_PARAMS.map((n) => [n, {}])),
            },
          },
        ],
      },
    },
  },
};
/**
 * The same function as the real Supabase stack's PostgREST 16 describes it (CLI 2.120, recorded): a volatile function
 * only under POST, its parameters in the body's schema, none under GET.
 */
const DESCRIBED_V16 = {
  swagger: "2.0",
  paths: {
    "/rpc/save_storage_layout": {
      post: {
        parameters: [
          {
            in: "body",
            name: "args",
            required: true,
            schema: {
              properties: Object.fromEntries(LAYOUT_FUNCTION_PARAMS.map((n) => [n, {}])),
              required: [...LAYOUT_FUNCTION_PARAMS],
              type: "object",
            },
          },
          { $ref: "#/parameters/preferParams" },
        ],
      },
    },
  },
};
const WITHOUT_0045 = { swagger: "2.0", paths: { "/cellar_location_zones": { get: {} } } };

describe("is the Smart Cellar there: reading and writing, apart", () => {
  it("the complete database: reads ready, writes ready (described as callable, with 0045's parameters)", async () => {
    const { repo, calls } = fakeDataApi({}, { describe: json(200, DESCRIBED) });
    expect(await repo.schemaStatus()).toEqual({ reads: "ready", writes: "ready" });
    // asked at the root of the data API, as the person, for the description; nothing was called
    expect(calls.describe).toEqual([
      {
        url: "http://stack.test/rest/v1/",
        accept: "application/openapi+json",
        authorization: "Bearer person",
      },
    ]);
    expect(calls.rpc).toBe(0);
  });

  it("the complete database as PostgREST 16 describes it (the real Supabase stack): writes ready", async () => {
    const { repo, calls } = fakeDataApi({}, { describe: json(200, DESCRIBED_V16) });
    expect(await repo.schemaStatus()).toEqual({ reads: "ready", writes: "ready" });
    expect(calls.rpc).toBe(0);
  });

  it("0043 and 0044 but not 0045: reads ready, writes MISSING, and the function is never called", async () => {
    const { repo, calls } = fakeDataApi({}, { describe: json(200, WITHOUT_0045) });
    expect(await repo.schemaStatus()).toEqual({ reads: "ready", writes: "missing" });
    expect(calls.rpc).toBe(0);
  });

  it("a function of that name with other parameters is not the one the API calls: missing", () => {
    const other = structuredClone(DESCRIBED);
    other.paths["/rpc/save_storage_layout"].get.parameters.pop();
    other.paths["/rpc/save_storage_layout"].post.parameters[0]!.schema.properties = {};
    expect(layoutFunctionDescribed(other)).toBe(false);
    expect(layoutFunctionDescribed(DESCRIBED)).toBe(true);
    // PostgREST 16 (the real Supabase stack): parameters only in the body of POST
    expect(layoutFunctionDescribed(DESCRIBED_V16)).toBe(true);
    const v16Short = structuredClone(DESCRIBED_V16);
    delete (
      v16Short.paths["/rpc/save_storage_layout"].post.parameters[0]!.schema!.properties as Record<
        string,
        unknown
      >
    ).p_zones;
    expect(layoutFunctionDescribed(v16Short)).toBe(false);
    expect(layoutFunctionDescribed(WITHOUT_0045)).toBe(false);
    for (const nothing of [null, "text", [], { swagger: "2.0" }])
      expect(layoutFunctionDescribed(nothing)).toBeNull();
  });

  it("where PostgREST does not describe itself to this caller (hosted Supabase): unverified, never ready", async () => {
    for (const answer of [
      json(401, { message: "Invalid API key" }),
      json(403, { message: "forbidden" }),
      json(404, { code: "PGRST126", message: "Root endpoint metadata is disabled" }),
      json(200, { not: "a description" }),
      async () => new Response("<html>", { status: 200 }),
    ]) {
      const { repo, calls } = fakeDataApi({}, { describe: answer });
      expect(await repo.schemaStatus()).toEqual({ reads: "ready", writes: "unverified" });
      expect(calls.rpc).toBe(0);
    }
  });

  it("a server error or a network failure while asking is an error, not 'missing' and not 'unverified'", async () => {
    const failing = fakeDataApi({}, { describe: json(503, { message: "down" }) });
    await expect(failing.repo.schemaStatus()).rejects.toMatchObject({ code: "INTERNAL" });
    const offline = fakeDataApi(
      {},
      {
        describe: async () => {
          throw new TypeError("fetch failed");
        },
      },
    );
    await expect(offline.repo.schemaStatus()).rejects.toThrow();
    expect(() => writeReadiness({ status: 500, body: null })).toThrow();
  });

  it("no Smart Cellar migrations at all: reads and writes missing, and nothing more is asked", async () => {
    for (const missing of [
      // the answers the local stack's PostgREST gives for these
      {
        table: "cellar_locations",
        column: "template",
        error: { code: "42703", message: "column cellar_locations.template does not exist" },
      },
      {
        table: "bottles",
        column: "loc_index",
        error: { code: "42703", message: "column bottles.loc_index does not exist" },
      },
      {
        table: "cellar_location_zones",
        error: { code: "42P01", message: 'relation "public.cellar_location_zones" does not exist' },
      },
      {
        table: "cellar_location_zones",
        error: { code: "PGRST205", message: "Could not find the table" },
      },
    ]) {
      const { repo, calls } = fakeDataApi({}, { missing: [missing] });
      expect(await repo.schemaStatus(), missing.error.code).toEqual({
        reads: "missing",
        writes: "missing",
      });
      expect(calls.describe).toEqual([]);
      expect(calls.rpc).toBe(0);
    }
  });

  it("permission denied, an expired session or a timeout on a probe is that error, never 'missing'", async () => {
    for (const [code, expected] of [
      ["42501", "FORBIDDEN"],
      ["PGRST301", "UNAUTHENTICATED"],
      ["57014", "INTERNAL"],
    ] as const) {
      const { repo } = fakeDataApi(
        {},
        { missing: [{ table: "cellar_locations", error: { code, message: "x" } }] },
      );
      await expect(repo.schemaStatus(), code).rejects.toMatchObject({ code: expected });
    }
  });
});

describe("every place and every zone, however many (the data API cuts each answer at 1000 rows)", () => {
  const HOUSEHOLD = "h-1";
  const pad = (n: number) => String(n).padStart(5, "0");
  /** `places` places of the household; the first `zoned` of them with two zones each; and another household's. */
  function cellar(places: number, zoned: number) {
    const rows: Row[] = [];
    const zones: Row[] = [];
    const bottles: Row[] = [];
    for (let i = 0; i < places; i++) {
      const id = `p-${pad(i)}`;
      rows.push({
        id,
        household_id: HOUSEHOLD,
        label: `Place ${i}`,
        kind: "fridge",
        grid_rows: 8,
        grid_cols: 4,
        template: i < zoned ? "cooler_dual" : null,
        cell_capacity: 1,
        slot_semantics: i < zoned ? "depth" : null,
        appearance: null,
        // the order the app lists places in: sort_order, then created_at, then id
        sort_order: i % 3,
        created_at: `2026-11-15T10:${pad(i)}`,
      });
      if (i < zoned)
        zones.push(
          {
            location_id: id,
            household_id: HOUSEHOLD,
            zone_index: 2,
            from_row: 5,
            to_row: 8,
            purpose: "serving",
            target_temp_c: 7.5,
          },
          {
            location_id: id,
            household_id: HOUSEHOLD,
            zone_index: 1,
            from_row: 1,
            to_row: 4,
            purpose: "storage",
            target_temp_c: "12.0",
          },
        );
      if (i % 250 === 0)
        bottles.push({
          id: `b-${i}`,
          household_id: HOUSEHOLD,
          location_id: id,
          status: "in_cellar",
        });
    }
    // another household, interleaved in the same tables
    for (let i = 0; i < 40; i++) {
      rows.push({
        id: `x-${pad(i)}`,
        household_id: "h-2",
        label: `Theirs ${i}`,
        kind: "rack",
        grid_rows: 2,
        grid_cols: 2,
        template: null,
        cell_capacity: 1,
        slot_semantics: null,
        appearance: null,
        sort_order: 0,
        created_at: "2026-01-01",
      });
      zones.push({
        location_id: `x-${pad(i)}`,
        household_id: "h-2",
        zone_index: 1,
        from_row: 1,
        to_row: 2,
        purpose: "storage",
        target_temp_c: 12,
      });
    }
    return { cellar_locations: rows, cellar_location_zones: zones, bottles };
  }

  it("1,501 places and 1,002 zone rows: all of them, the household's only, in a stable order", async () => {
    const tables = cellar(1501, 501);
    const { repo, calls } = fakeDataApi(tables);
    const places = await repo.listPlaces(HOUSEHOLD);
    expect(places).toHaveLength(1501);
    expect(places.every((p) => p.id.startsWith("p-"))).toBe(true);
    // the app's order: sort_order, then created_at, then id
    const expected = tables.cellar_locations
      .filter((r) => r.household_id === HOUSEHOLD)
      .sort(
        (a, b) =>
          (a.sort_order as number) - (b.sort_order as number) ||
          String(a.created_at).localeCompare(String(b.created_at)) ||
          String(a.id).localeCompare(String(b.id)),
      )
      .map((r) => r.id);
    expect(places.map((p) => p.id)).toEqual(expected);
    // every zone of every place, top first, none of another household's
    const zones = places.flatMap((p) => p.zones);
    expect(zones).toHaveLength(1002);
    for (const p of places.filter((x) => x.template === "cooler_dual"))
      expect(p.zones).toEqual([
        { fromRow: 1, toRow: 4, purpose: "storage", targetTempC: 12 },
        { fromRow: 5, toRow: 8, purpose: "serving", targetTempC: 7.5 },
      ]);
    expect(places.filter((p) => p.zones.length === 0)).toHaveLength(1000);
    // occupancy counted for places past the first page too
    expect(places.find((p) => p.id === "p-01500")?.occupied).toBe(1);
    // read page by page, each page within the cut
    const pages = (table: string) =>
      calls.ranges.filter((r) => r.table === table).map((r) => [r.from, r.to]);
    expect(pages("cellar_locations")).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(pages("cellar_location_zones")).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(calls.rpc).toBe(0);
  });

  it("exactly 1,000 of each: one more page is asked for, and it is empty", async () => {
    const { repo, calls } = fakeDataApi(cellar(1000, 500));
    const places = await repo.listPlaces(HOUSEHOLD);
    expect(places).toHaveLength(1000);
    expect(places.flatMap((p) => p.zones)).toHaveLength(1000);
    expect(calls.ranges.filter((r) => r.table === "cellar_locations")).toHaveLength(2);
  });

  it("a page size that cuts between the two zones of one place still gives that place both", async () => {
    // 1,001 zone rows of the household: the cut after 1000 falls in the middle of a place's pair
    const tables = cellar(600, 500);
    tables.cellar_location_zones.push({
      location_id: "p-00599",
      household_id: HOUSEHOLD,
      zone_index: 1,
      from_row: 1,
      to_row: 8,
      purpose: "storage",
      target_temp_c: 12,
    });
    const { repo } = fakeDataApi(tables);
    const places = await repo.listPlaces(HOUSEHOLD);
    expect(places.flatMap((p) => p.zones)).toHaveLength(1001);
    expect(places.find((p) => p.id === "p-00499")?.zones).toHaveLength(2);
    expect(places.find((p) => p.id === "p-00599")?.zones).toHaveLength(1);
  });

  it("one place's zones are read page by page too", async () => {
    const { repo, calls } = fakeDataApi(cellar(3, 3));
    const place = await repo.getPlace(HOUSEHOLD, "p-00001");
    expect(place?.zones).toHaveLength(2);
    expect(calls.ranges.filter((r) => r.table === "cellar_location_zones")).toEqual([
      { table: "cellar_location_zones", from: 0, to: 999 },
    ]);
    expect(await repo.getPlace(HOUSEHOLD, "x-00001")).toBeNull(); // another household's
  });
});

describe("the bottles of a place, with their label photos", () => {
  const wine = (name: string) => ({
    year: 2019,
    wine_id: `w-${name}`,
    wines: {
      name,
      wine_type: "red",
      region: "Rioja",
      country_code: "ES",
      producers: { name: "Bodega" },
    },
  });
  /** `count` bottles of one place, every second one with a photo of its own; and a photo of another household. */
  function place(count: number) {
    const bottles: Row[] = [];
    const images: Row[] = [];
    for (let i = 0; i < count; i++) {
      const photo = i % 2 === 0 ? `img-${i}` : null;
      bottles.push({
        id: `b-${String(i).padStart(4, "0")}`,
        household_id: "h-1",
        location_id: "p-1",
        status: "in_cellar",
        loc_row: Math.floor(i / 30) + 1,
        loc_col: (i % 30) + 1,
        loc_index: 1,
        vintage_id: `v-${i}`,
        front_image_id: photo,
        wine_vintages: wine(`Wine ${i}`),
      });
      if (photo)
        images.push({
          id: photo,
          household_id: "h-1",
          blur_color: "#402010",
          width: 900,
          height: 1200,
          texture_path: i % 4 === 0 ? "t.jpg" : null,
        });
    }
    // a bottle that names a photo of ANOTHER household (it cannot be read: no photo, never theirs)
    bottles.push({
      id: "b-foreign",
      household_id: "h-1",
      location_id: "p-1",
      status: "in_cellar",
      loc_row: 30,
      loc_col: 30,
      loc_index: 1,
      vintage_id: "v-x",
      front_image_id: "img-theirs",
      wine_vintages: wine("Foreign photo"),
    });
    images.push({
      id: "img-theirs",
      household_id: "h-2",
      blur_color: null,
      width: 1,
      height: 1,
      texture_path: null,
    });
    return { bottles, bottle_images: images };
  }

  it("every bottle keeps its spot and gets its own photo; only this household's photos, asked for by id", async () => {
    const { repo, calls } = fakeDataApi(place(400));
    const placements = await repo.placements("h-1", "p-1");
    expect(placements).toHaveLength(401);
    expect(placements[0]).toMatchObject({
      bottleId: "b-0000",
      row: 1,
      col: 1,
      index: 1,
      region: "Rioja",
      countryCode: "ES",
      image: { id: "img-0", blurColor: "#402010", width: 900, height: 1200, texture: true },
    });
    expect(placements[1]?.image).toBeNull();
    expect(placements.filter((p) => p.image !== null)).toHaveLength(200);
    expect(placements.find((p) => p.bottleId === "b-foreign")?.image).toBeNull();
    // 201 ids (200 of its own and the foreign one), in chunks of at most 150
    expect(calls.ins.filter((c) => c.table === "bottle_images").map((c) => c.count)).toEqual([
      150, 51,
    ]);
    expect(calls.rpc).toBe(0);
  });

  it("a place without a single photo asks for none", async () => {
    const tables = place(10);
    for (const b of tables.bottles) b.front_image_id = null;
    const { repo, calls } = fakeDataApi(tables);
    expect((await repo.placements("h-1", "p-1")).every((p) => p.image === null)).toBe(true);
    expect(calls.ins).toEqual([]);
  });
});
