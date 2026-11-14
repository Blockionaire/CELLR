// Smoke test against the REAL Supabase stack (`supabase start`): the parts the plain-Postgres suite cannot see —
// Storage policies through the Storage API, and account deletion through the Auth admin API.
// Run by CI after `supabase start`; reads the local URL and keys from `supabase status -o env`.
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const env = Object.fromEntries(
  execSync("supabase status -o env", { encoding: "utf8" })
    .split("\n")
    .map((l) => l.match(/^([A-Z_]+)="?(.*?)"?$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);
const URL = env.API_URL;
const ANON = env.ANON_KEY;
const SERVICE = env.SERVICE_ROLE_KEY;
if (!URL || !ANON || !SERVICE)
  throw new Error("supabase status did not give API_URL / ANON_KEY / SERVICE_ROLE_KEY");

let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  (${detail})`}`);
  if (!ok) failed++;
};
const json = (r) => r.json().catch(() => ({}));

const admin = (path, init = {}) =>
  fetch(`${URL}${path}`, {
    ...init,
    headers: {
      apikey: SERVICE,
      authorization: `Bearer ${SERVICE}`,
      "content-type": "application/json",
      ...init.headers,
    },
  });

async function newUser(label) {
  const email = `${label}-${Date.now()}@example.test`;
  const password = `Pw-${randomUUID()}`; // throwaway user on a throwaway local stack
  const made = await json(
    await admin("/auth/v1/admin/users", {
      method: "POST",
      body: JSON.stringify({ email, password, email_confirm: true }),
    }),
  );
  const signIn = await json(
    await fetch(`${URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: ANON, "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    }),
  );
  return { id: made.id, email, password, token: signIn.access_token };
}
const asUser = (u, path, init = {}) =>
  fetch(`${URL}${path}`, {
    ...init,
    headers: { apikey: ANON, authorization: `Bearer ${u.token}`, ...init.headers },
  });

const rpc = async (u, fn, args) =>
  json(
    await asUser(u, `/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(args),
    }),
  );

// Bytes that start like a JPEG: the bucket checks the declared type and size, not the picture.
const jpeg = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9,
]);
const upload = (u, path, body, type) =>
  asUser(u, `/storage/v1/object/bottle-images/${path}`, {
    method: "POST",
    headers: { "content-type": type },
    body,
  });

const one = await newUser("smoke-one");
const two = await newUser("smoke-two");
check(
  "two users can sign in",
  Boolean(one.token && two.token),
  JSON.stringify({ one: !!one.token, two: !!two.token }),
);

const h1 = await rpc(one, "create_household", { p_name: "Smoke One" });
const h2 = await rpc(two, "create_household", { p_name: "Smoke Two" });
check(
  "each user can create a household",
  typeof h1 === "string" && typeof h2 === "string",
  JSON.stringify({ h1, h2 }),
);

const mine = `${h1}/img1/original.jpg`;
check(
  "a member uploads a JPEG into their household folder",
  (await upload(one, mine, jpeg, "image/jpeg")).ok,
);
check(
  "a PNG is refused (MIME allow-list)",
  !(await upload(one, `${h1}/img1/x.png`, jpeg, "image/png")).ok,
);
check(
  "a file over 4 MB is refused",
  !(await upload(one, `${h1}/img1/big.jpg`, new Uint8Array(4 * 1024 * 1024 + 1024), "image/jpeg"))
    .ok,
);
check(
  "nobody uploads into another household's folder",
  !(await upload(two, `${h1}/img1/stolen.jpg`, jpeg, "image/jpeg")).ok,
);
check(
  "a bare filename (no household folder) is refused",
  !(await upload(one, "loose.jpg", jpeg, "image/jpeg")).ok,
);

const read = (u) => asUser(u, `/storage/v1/object/authenticated/bottle-images/${mine}`);
check("a member can read their own file", (await read(one)).ok);
check("another household cannot read it", !(await read(two)).ok);
check(
  "anonymous cannot read it",
  !(
    await fetch(`${URL}/storage/v1/object/authenticated/bottle-images/${mine}`, {
      headers: { apikey: ANON },
    })
  ).ok,
);

// ---- Smart Cellar 3D, sprint 1B: the new columns, zones and functions through PostgREST itself -----------------
// The SQL suite proves the rules inside the database. This proves them at the door a client really uses: one HTTP
// request is one statement in one transaction, and a client names exactly the columns in its body.
const rest = async (u, method, path, body, prefer = "return=representation") => {
  const r = await asUser(u, `/rest/v1/${path}`, {
    method,
    headers: { "content-type": "application/json", prefer },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: r.status, body: await json(r) };
};
const refusedWith = (r, message) => r.status >= 400 && r.body?.message === message;
const sql = (statement) =>
  execSync(`psql "${env.DB_URL}" -X -qtA -v ON_ERROR_STOP=1 -c "${statement}"`, {
    encoding: "utf8",
  }).trim();

const producer = (
  await rest(one, "POST", "producers", {
    name: "Smoke Estate",
    country_code: "FR",
    owner_household_id: h1,
  })
).body[0];
const wine = (
  await rest(one, "POST", "wines", {
    producer_id: producer?.id,
    name: "Smoke",
    wine_type: "red",
    country_code: "FR",
    owner_household_id: h1,
  })
).body[0];
const vintage = (await rest(one, "POST", "wine_vintages", { wine_id: wine?.id, year: 2019 }))
  .body[0];
const cellar = (await rest(one, "POST", "cellars", { household_id: h1, name: "Smoke" })).body[0];
const place = async (label, extra = {}) =>
  (
    await rest(one, "POST", "cellar_locations", {
      cellar_id: cellar?.id,
      household_id: h1,
      label,
      grid_rows: 5,
      grid_cols: 4,
      ...extra,
    })
  ).body[0];
const rack = await place("Rack");
const bottle = async (row, col, extra = {}) =>
  (
    await rest(one, "POST", "bottles", {
      household_id: h1,
      vintage_id: vintage?.id,
      location_id: rack?.id,
      loc_row: row,
      loc_col: col,
      ...extra,
    })
  ).body[0];
const b1 = await bottle(1, 1);
const b2 = await bottle(2, 2);
check(
  "REST: a place and a bottle made the way the app makes them get today's defaults",
  rack?.template === null &&
    rack?.cell_capacity === 1 &&
    rack?.slot_semantics === null &&
    b1?.loc_index === 1,
  JSON.stringify({ rack, b1 }),
);
const moved = await rest(one, "PATCH", `bottles?id=eq.${b1?.id}`, {
  location_id: rack?.id,
  loc_row: 3,
  loc_col: 3,
});
check(
  "REST: the app's move (place, row, col: no index) works and stays at index 1",
  moved.status === 200 && moved.body[0]?.loc_row === 3 && moved.body[0]?.loc_index === 1,
  JSON.stringify(moved),
);
check(
  "REST: more than one bottle per cell is refused while that is switched off, for a direct write too",
  refusedWith(
    await rest(one, "PATCH", `cellar_locations?id=eq.${rack?.id}`, {
      template: "rack_double_depth",
      slot_semantics: "depth",
      cell_capacity: 2,
    }),
    "depth_not_enabled",
  ),
);
check(
  "REST: ...so an index above 1 has nowhere to go",
  refusedWith(
    await rest(one, "PATCH", `bottles?id=eq.${b1?.id}`, { loc_index: 2 }),
    "slot_out_of_bounds",
  ),
);
check(
  "REST: the old swap still swaps two bottles of a rack",
  (await rpc(one, "swap_bottles", {
    p_household: h1,
    p_a: b1?.id,
    p_a_location: rack?.id,
    p_a_row: 3,
    p_a_col: 3,
    p_b: b2?.id,
    p_b_location: rack?.id,
    p_b_row: 2,
    p_b_col: 2,
  })) === "swapped",
);

const cooler = await place("Cooler", {
  kind: "fridge",
  template: "cooler_dual",
  slot_semantics: "depth",
  grid_rows: 8,
});
const zone = (zone_index, from_row, to_row, target_temp_c) => ({
  location_id: cooler?.id,
  household_id: h1,
  zone_index,
  from_row,
  to_row,
  purpose: "storage",
  target_temp_c,
});
const zones = await rest(one, "POST", "cellar_location_zones", [
  zone(1, 1, 3, 8),
  zone(2, 4, 8, 12.5),
]);
check(
  "REST: two zones that split the shelves are written in one request",
  zones.status === 201,
  JSON.stringify(zones),
);
const gap = await rest(one, "PATCH", `cellar_location_zones?id=eq.${zones.body[0]?.id}`, {
  to_row: 2,
});
const after = await rest(one, "GET", `cellar_location_zones?id=eq.${zones.body[0]?.id}`);
check(
  "REST: a zone edit that leaves a gap is refused when the request commits, and nothing of it stays",
  refusedWith(gap, "zones_not_a_split") && after.body[0]?.to_row === 3,
  JSON.stringify({ gap, after }),
);
const fewer = await rest(one, "PATCH", `cellar_locations?id=eq.${cooler?.id}`, { grid_rows: 6 });
check(
  "REST: fewer shelves under zones that no longer fit is refused (what an older app would send)",
  refusedWith(fewer, "zones_not_a_split"),
  JSON.stringify(fewer),
);
check(
  "REST: shelves and zones change together through save_storage_layout",
  (await rpc(one, "save_storage_layout", {
    p_household: h1,
    p_location: cooler?.id,
    p_kind: "fridge",
    p_template: "cooler_dual",
    p_slot_semantics: "depth",
    p_rows: 6,
    p_cols: 5,
    p_cell_capacity: 1,
    p_appearance: { v: 1, door: "glass" },
    p_zones: [
      { from_row: 1, to_row: 2, purpose: "serving", target_temp_c: 7 },
      { from_row: 3, to_row: 6, purpose: "storage", target_temp_c: 12 },
    ],
  })) === "saved",
);

check(
  "REST: another household reads none of our zones or places",
  (await rest(two, "GET", "cellar_location_zones?select=id")).body.length === 0 &&
    (await rest(two, "GET", `cellar_locations?id=eq.${cooler?.id}`)).body.length === 0,
);
check(
  "REST: ...changes none of them (0 rows)",
  (
    await rest(two, "PATCH", `cellar_locations?id=eq.${cooler?.id}`, {
      template: "rack_generic",
      slot_semantics: "depth",
    })
  ).body.length === 0 &&
    (
      await rest(two, "PATCH", `cellar_location_zones?location_id=eq.${cooler?.id}`, {
        target_temp_c: 5,
      })
    ).body.length === 0 &&
    (await rest(two, "DELETE", `cellar_location_zones?location_id=eq.${cooler?.id}`)).body
      .length === 0,
);
check(
  "REST: ...cannot add a zone to our place, and the functions answer not_found",
  (await rest(two, "POST", "cellar_location_zones", zone(3, 7, 8, 5))).status >= 400 &&
    (await rpc(two, "save_storage_layout", {
      p_household: h1,
      p_location: cooler?.id,
      p_kind: "rack",
      p_template: null,
      p_slot_semantics: null,
      p_rows: 2,
      p_cols: 2,
      p_cell_capacity: 1,
      p_appearance: null,
      p_zones: [],
    })) === "not_found" &&
    (await rpc(two, "swap_bottles_v2", {
      p_household: h1,
      p_a: b1?.id,
      p_a_location: rack?.id,
      p_a_row: 2,
      p_a_col: 2,
      p_a_index: 1,
      p_b: b2?.id,
      p_b_location: rack?.id,
      p_b_row: 3,
      p_b_col: 3,
      p_b_index: 1,
    })) === "not_found",
);
check(
  "REST: anonymous reads no zones and calls none of the functions",
  !(await fetch(`${URL}/rest/v1/cellar_location_zones?select=id`, { headers: { apikey: ANON } }))
    .ok &&
    !(
      await fetch(`${URL}/rest/v1/rpc/swap_bottles_v2`, {
        method: "POST",
        headers: { apikey: ANON, "content-type": "application/json" },
        body: JSON.stringify({}),
      })
    ).ok,
);
check(
  "REST: no API role can switch depth on (the settings table is not exposed, even to the service role)",
  !(await admin("/rest/v1/cellar_settings?select=*")).ok,
);

// With depth switched on (by the database owner, as a later migration will): a writer that knows no index must
// never move a back bottle to a spot it did not name.
sql("update private.cellar_settings set depth_placement = true");
const deep = await place("Deep", {
  template: "rack_double_depth",
  slot_semantics: "depth",
  cell_capacity: 2,
});
const back = (
  await rest(one, "POST", "bottles", {
    household_id: h1,
    vintage_id: vintage?.id,
    location_id: deep?.id,
    loc_row: 1,
    loc_col: 1,
    loc_index: 2,
  })
).body[0];
const front = (
  await rest(one, "POST", "bottles", {
    household_id: h1,
    vintage_id: vintage?.id,
    location_id: deep?.id,
    loc_row: 2,
    loc_col: 2,
  })
).body[0];
check(
  "REST: with depth on, a bottle can be put at the back of a cell",
  back?.loc_index === 2 && front?.loc_index === 1,
);
const blind = await rest(one, "PATCH", `bottles?id=eq.${back?.id}`, {
  location_id: deep?.id,
  loc_row: 3,
  loc_col: 3,
});
const still = (await rest(one, "GET", `bottles?id=eq.${back?.id}`)).body[0];
check(
  "REST: the app's move (no index) of a BACK bottle is refused, and the bottle is where it was",
  refusedWith(blind, "slot_index_ambiguous") &&
    still?.loc_row === 1 &&
    still?.loc_col === 1 &&
    still?.loc_index === 2,
  JSON.stringify({ blind, still }),
);
const many = await rest(one, "PATCH", `bottles?location_id=eq.${deep?.id}`, {
  location_id: rack?.id,
  loc_row: 5,
  loc_col: 4,
});
check(
  "REST: one request moving several bottles, a back one among them: refused whole",
  many.status >= 400 &&
    (await rest(one, "GET", `bottles?id=eq.${front?.id}`)).body[0]?.location_id === deep?.id,
  JSON.stringify(many),
);
check(
  "REST: the old swap answers stale for a back bottle; swap_bottles_v2 swaps it",
  (await rpc(one, "swap_bottles", {
    p_household: h1,
    p_a: back?.id,
    p_a_location: deep?.id,
    p_a_row: 1,
    p_a_col: 1,
    p_b: front?.id,
    p_b_location: deep?.id,
    p_b_row: 2,
    p_b_col: 2,
  })) === "stale" &&
    (await rpc(one, "swap_bottles_v2", {
      p_household: h1,
      p_a: back?.id,
      p_a_location: deep?.id,
      p_a_row: 1,
      p_a_col: 1,
      p_a_index: 2,
      p_b: front?.id,
      p_b_location: deep?.id,
      p_b_row: 2,
      p_b_col: 2,
      p_b_index: 1,
    })) === "swapped" &&
    (await rest(one, "GET", `bottles?id=eq.${front?.id}`)).body[0]?.loc_index === 2,
);
check(
  "REST: a deep rack with bottles in it is not turned into bins",
  refusedWith(
    await rest(one, "PATCH", `cellar_locations?id=eq.${deep?.id}`, {
      template: "diamond_bins",
      slot_semantics: "ordinal",
    }),
    "layout_semantics_change",
  ),
);
sql("update private.cellar_settings set depth_placement = false");

// Account deletion: what the app's "delete my account" does with the service role.
const del = await admin(`/auth/v1/admin/users/${two.id}`, { method: "DELETE" });
check("the Auth admin API deletes a user", del.ok, String(del.status));
const again = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { apikey: ANON, "content-type": "application/json" },
  body: JSON.stringify({ email: two.email, password: two.password }),
});
check("a deleted user can no longer sign in", !again.ok);

await admin(`/auth/v1/admin/users/${one.id}`, { method: "DELETE" });
console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
