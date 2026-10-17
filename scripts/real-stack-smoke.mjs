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
