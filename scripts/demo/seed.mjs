#!/usr/bin/env node
// Smart Cellar 3D, sprint 6: the DEMONSTRATION CELLAR, seeded through the app's own authorized API.
//
//   node scripts/demo/seed.mjs            (scripts/demo/up.sh runs it)
//   node scripts/demo/seed.mjs --reset    (removes the demo households first, then seeds again)
//
// What it makes (all synthetic: fictional producers, no photos, no copy of anyone's data):
//   • "Demo cellar": owner@demo.cellr.test (and partner@demo.cellr.test as a member), eleven places of the eleven
//     templates that can be saved today (warm walnut rack, black metal system, premium dual-zone cooler, …), one place
//     from before templates, ~80 bottles of 14 wines (red, white, rosé, sparkling, dessert, fortified, orange; vintage
//     and non-vintage; several of one vintage), different occupancy levels, and bottles without a place.
//   • "Demo neighbours": neighbour@demo.cellr.test, a small rack of their own (household isolation).
// The three templates that need more than one bottle per cell (double-depth rack, modular cubes, diamond bins) can't
// be saved while depth is off: they are shown in the Rack Builder as preview-only, never faked here.
//
// SAFETY: it only ever talks to localhost (the app and the local stack). Every write goes through the app's API as
// the signed-in demo person (RLS), except --reset, which deletes the demo households through the local stack's own
// test endpoint, and only the households whose members all have @demo.cellr.test addresses.

const APP = process.env.DEMO_APP_URL ?? "http://localhost:3200";
const STACK = process.env.DEMO_STACK_URL ?? "http://localhost:54321";
const CODE = process.env.DEMO_FIXED_OTP ?? null;
for (const url of [APP, STACK]) {
  const host = new URL(url).hostname;
  if (host !== "localhost" && host !== "127.0.0.1") {
    console.error(`demo seed: refusing ${url}: the demo only ever runs against localhost`);
    process.exit(2);
  }
}

const DOMAIN = "demo.cellr.test";
const OWNER = `owner@${DOMAIN}`;
const PARTNER = `partner@${DOMAIN}`;
const NEIGHBOUR = `neighbour@${DOMAIN}`;

async function sql(query, params = []) {
  const res = await fetch(`${STACK}/__test/sql`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sql: query, params }),
  });
  if (!res.ok) throw new Error(`demo seed: local SQL failed: ${await res.text()}`);
  return (await res.json()).rows;
}

async function signIn(email) {
  await fetch(`${STACK}/auth/v1/otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, create_user: true }),
  });
  let code = CODE;
  for (let i = 0; !code && i < 20; i++) {
    code = (await (await fetch(`${STACK}/__test/otp?email=${encodeURIComponent(email)}`)).json())
      .code;
    if (!code) await new Promise((r) => setTimeout(r, 100));
  }
  const res = await fetch(`${STACK}/auth/v1/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, token: code, type: "email" }),
  });
  const body = await res.json();
  if (!body.access_token) throw new Error(`demo seed: could not sign ${email} in`);
  return body.access_token;
}

function client(token) {
  return async (method, path, data, expected) => {
    const res = await fetch(`${APP}/api/v1${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(data === undefined ? {} : { "content-type": "application/json" }),
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    const body = await res.json().catch(() => null);
    if (expected !== undefined && res.status !== expected)
      throw new Error(`demo seed: ${method} ${path} → ${res.status} ${JSON.stringify(body)}`);
    return body;
  };
}

async function onboard(email, household, displayName) {
  const token = await signIn(email);
  const call = client(token);
  const created = await call("POST", "/households", { name: household }, 201);
  await call("PATCH", "/me", { displayName }, 200);
  return { token, call, householdId: created.id };
}

async function reset() {
  const rows = await sql(
    `delete from public.households h
      where exists (select 1 from public.household_members m join auth.users u on u.id = m.user_id
                     where m.household_id = h.id and u.email like '%@' || $1)
        and not exists (select 1 from public.household_members m join auth.users u on u.id = m.user_id
                         where m.household_id = h.id and u.email not like '%@' || $1)
      returning h.id`,
    [DOMAIN],
  );
  console.log(`demo seed: removed ${rows.length} demo household(s)`);
}

// ---- the collection ------------------------------------------------------------------------------------------------
const WINES = {
  lumiere: {
    producer: "Château Lumière",
    name: "Grand Vin",
    type: "red",
    countryCode: "FR",
    region: "Bordeaux",
  },
  essaisPinot: {
    producer: "Domaine des Essais",
    name: "Pinot Noir Vieilles Vignes",
    type: "red",
    countryCode: "FR",
    region: "Burgundy",
  },
  sierra: {
    producer: "Bodega Sierra Alta",
    name: "Reserva",
    type: "red",
    countryCode: "ES",
    region: "Rioja",
  },
  collina: {
    producer: "Tenuta Collina",
    name: "Chianti Classico Riserva",
    type: "red",
    countryCode: "IT",
    region: "Tuscany",
  },
  steinbergPinot: {
    producer: "Weingut Steinberg",
    name: "Spätburgunder",
    type: "red",
    countryCode: "DE",
    region: "Baden",
  },
  essaisChablis: {
    producer: "Domaine des Essais",
    name: "Chablis Premier Cru",
    type: "white",
    countryCode: "FR",
    region: "Burgundy",
  },
  steinbergRiesling: {
    producer: "Weingut Steinberg",
    name: "Riesling Kabinett",
    type: "white",
    countryCode: "DE",
    region: "Mosel",
  },
  vale: {
    producer: "Quinta do Vale",
    name: "Alvarinho",
    type: "white",
    countryCode: "PT",
    region: "Vinho Verde",
  },
  lumiereRose: {
    producer: "Château Lumière",
    name: "Rosé de Provence",
    type: "rose",
    countryCode: "FR",
    region: "Provence",
  },
  auroreBrut: {
    producer: "Maison Aurore",
    name: "Brut Réserve",
    type: "sparkling",
    countryCode: "FR",
    region: "Champagne",
  },
  auroreBdb: {
    producer: "Maison Aurore",
    name: "Blanc de Blancs",
    type: "sparkling",
    countryCode: "FR",
    region: "Champagne",
  },
  dore: {
    producer: "Château Doré",
    name: "Sauternes",
    type: "dessert",
    countryCode: "FR",
    region: "Bordeaux",
  },
  valePort: {
    producer: "Quinta do Vale",
    name: "Vintage Port",
    type: "fortified",
    countryCode: "PT",
    region: "Douro",
  },
  naranja: {
    producer: "Vinos Naranja",
    name: "Brisado",
    type: "orange",
    countryCode: "ES",
    region: "Penedès",
  },
};

const look = (material, color, lighting = "none", door = "none") => ({
  v: 1,
  material,
  color,
  lighting,
  door,
});

/**
 * The demo household's places: [label, kind, template|null, rows, cols, look, zones, bottles [[wine, year, qty, shelf?]]].
 * Without a shelf, bottles go in the way the app adds them (the first free spots from the top); with one, they are added
 * without a place and then moved, spot by spot from that shelf's first spot, through the Smart Cellar move endpoint.
 */
const PLACES = [
  [
    "Walnut rack",
    "rack",
    "rack_classic",
    6,
    8,
    look("wood", "walnut", "warm"),
    [],
    [
      ["lumiere", 2015, 6],
      ["lumiere", 2018, 4],
      ["essaisPinot", 2018, 4],
      ["sierra", 2016, 3],
      ["collina", 2017, 3],
      ["steinbergPinot", 2019, 2],
      ["essaisChablis", 2020, 3],
    ],
  ],
  [
    "Metal wall system",
    "rack",
    "rack_metal",
    5,
    6,
    look("metal", "black"),
    [],
    [
      ["sierra", 2016, 2],
      ["collina", 2019, 4],
      ["steinbergRiesling", 2021, 4],
    ],
  ],
  [
    "Dual-zone cooler",
    "fridge",
    "cooler_dual",
    8,
    5,
    look("metal", "graphite", "warm", "glass"),
    [
      { fromRow: 1, toRow: 3, purpose: "serving", targetTempC: 8 },
      { fromRow: 4, toRow: 8, purpose: "storage", targetTempC: 12 },
    ],
    [
      ["auroreBrut", null, 4],
      ["essaisChablis", 2020, 1],
      ["lumiereRose", 2023, 3],
      // long-term bottles in the keeping zone (shelf given: placed there with the placement API)
      ["auroreBdb", 2014, 2, 4],
      ["lumiere", 2010, 3, 6],
      ["dore", 2011, 2, 7],
    ],
  ],
  [
    "Kitchen cooler",
    "fridge",
    "cooler_single",
    5,
    4,
    look("metal", "stainless", "cool", "glass"),
    [{ fromRow: 1, toRow: 5, purpose: "storage", targetTempC: null }],
    [
      ["vale", 2022, 2],
      ["steinbergRiesling", 2021, 2],
      ["naranja", 2021, 1],
    ],
  ],
  [
    "Undercounter cooler",
    "fridge",
    "cooler_undercounter",
    6,
    4,
    look("lacquer", "black", "warm", "glass"),
    [{ fromRow: 1, toRow: 6, purpose: "serving", targetTempC: 7 }],
    [
      ["auroreBrut", null, 2],
      ["lumiereRose", 2023, 2],
    ],
  ],
  [
    "Open shelves",
    "shelving",
    "shelving_open",
    4,
    6,
    look("wood", "oak", "warm"),
    [],
    [
      ["essaisPinot", 2020, 3],
      ["collina", 2017, 2],
    ],
  ],
  [
    "Mahogany cabinet",
    "cabinet",
    "cabinet_closed",
    4,
    6,
    look("wood", "mahogany", "warm", "glass"),
    [],
    [
      ["valePort", 2007, 2],
      ["dore", 2011, 1],
      ["lumiere", 2005, 2],
    ],
  ],
  ["Wine crates", "other", "crate_storage", 3, 2, look("wood", "pine"), [], [["sierra", 2018, 2]]],
  [
    "Brass wall pegs",
    "wall",
    "wall_pegs",
    6,
    6,
    look("metal", "brass"),
    [],
    [
      ["steinbergPinot", 2019, 2],
      ["essaisPinot", 2018, 2],
    ],
  ],
  ["Wall rails", "wall", "wall_rails", 9, 1, look("metal", "black"), [], [["lumiere", 2018, 3]]],
  ["Studio rack", "other", "rack_generic", 4, 6, look("lacquer", "white"), [], []],
  // a place from before templates: shown by the existing view
  ["Old fridge", "fridge", null, 3, 3, null, [], [["steinbergRiesling", 2019, 3]]],
];
/** Bottles without a place (for placement and advice). */
const LOOSE = [
  ["lumiere", 2015, 2],
  ["auroreBrut", null, 1],
  ["vale", 2022, 1],
  ["collina", 2017, 1],
];

async function seedOwner() {
  const owner = await onboard(OWNER, "Demo cellar", "Demo owner");
  const { call } = owner;
  const wineIds = {};
  for (const [key, wine] of Object.entries(WINES))
    wineIds[key] = (await call("POST", "/wines", wine, 201)).id;
  let bottles = 0;
  for (const [label, kind, template, rows, cols, appearance, zones, list] of PLACES) {
    const { id } = await call("POST", "/storage", { label, kind, rows, cols }, 201);
    if (template)
      await call(
        "PUT",
        `/smart-cellar/storage/${id}/layout`,
        { structure: { template, rows, cols, cellCapacity: 1, zones }, appearance },
        200,
      );
    for (const [wine, year, quantity, shelf] of list) {
      if (shelf === undefined) {
        await call(
          "POST",
          "/bottles",
          { wineId: wineIds[wine], year, quantity, locationId: id },
          201,
        );
      } else {
        const { bottleIds } = await call(
          "POST",
          "/bottles",
          { wineId: wineIds[wine], year, quantity, locationId: null },
          201,
        );
        for (const [n, bottleId] of bottleIds.entries()) {
          const to = { locationId: id, row: shelf, col: n + 1, index: 1 };
          await call("POST", `/smart-cellar/bottles/${bottleId}/move`, { from: null, to }, 200);
        }
      }
      bottles += quantity;
    }
  }
  for (const [wine, year, quantity] of LOOSE) {
    await call(
      "POST",
      "/bottles",
      { wineId: wineIds[wine], year, quantity, locationId: null },
      201,
    );
    bottles += quantity;
  }
  // a second member of the same household (the advice and moves are shared)
  const invite = await call("POST", `/households/${owner.householdId}/invites`, {}, 201);
  const partnerToken = await signIn(PARTNER);
  const partner = client(partnerToken);
  await partner("POST", "/households/join", { code: invite.code }, 200);
  await partner("PATCH", "/me", { displayName: "Demo partner" }, 200);
  await partner("PUT", "/households/active", { householdId: owner.householdId }, 200);
  return { places: PLACES.length, bottles };
}

async function seedNeighbour() {
  const { call } = await onboard(NEIGHBOUR, "Demo neighbours", "Demo neighbour");
  const { id: wine } = await call(
    "POST",
    "/wines",
    {
      producer: "Domaine Voisin",
      name: "Côtes du Rhône",
      type: "red",
      countryCode: "FR",
      region: "Rhône",
    },
    201,
  );
  const { id } = await call(
    "POST",
    "/storage",
    { label: "Neighbours' rack", kind: "rack", rows: 3, cols: 4 },
    201,
  );
  await call(
    "PUT",
    `/smart-cellar/storage/${id}/layout`,
    {
      structure: { template: "rack_classic", rows: 3, cols: 4, cellCapacity: 1, zones: [] },
      appearance: look("wood", "oak"),
    },
    200,
  );
  await call("POST", "/bottles", { wineId: wine, year: 2020, quantity: 5, locationId: id }, 201);
}

async function main() {
  const health = await fetch(`${APP}/manifest.webmanifest`).catch(() => null);
  if (!health?.ok) throw new Error(`demo seed: the app isn't answering at ${APP}`);
  const existing = await sql(
    "select count(*)::int as n from public.household_members m join auth.users u on u.id = m.user_id where u.email = $1",
    [OWNER],
  );
  if (existing[0].n > 0 && !process.argv.includes("--reset")) {
    console.log("demo seed: the demo cellar is already there (use --reset to start it again)");
    return;
  }
  if (process.argv.includes("--reset")) await reset();
  const { places, bottles } = await seedOwner();
  await seedNeighbour();
  console.log(
    `demo seed: "Demo cellar" with ${places} places and ${bottles} bottles; "Demo neighbours" with 5`,
  );
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
