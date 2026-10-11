// Starts PostgREST (real) and the mock Supabase gateway/auth in front of an already-migrated Postgres.
// Normally launched by up.sh. Env: PGURL (superuser), AUTHENTICATOR_URL, plus optional ports/keys.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSigningKeys, startMockSupabase } from "./mock-supabase.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const env = process.env;
const port = Number(env.MOCK_PORT ?? 54321);
const restPort = Number(env.POSTGREST_PORT ?? 54320);
const publishableKey = env.PUBLISHABLE_KEY ?? "sb_publishable_localstack_0000000000";
const serviceKey = env.SERVICE_KEY ?? "sb_secret_localstack_00000000000000";

const workDir = fs.mkdtempSync(path.join(env.TMPDIR ?? "/tmp", "cellr-stack-"));
const keys = createSigningKeys();
fs.writeFileSync(path.join(workDir, "jwks.json"), JSON.stringify(keys.jwks));
fs.writeFileSync(
  path.join(workDir, "postgrest.conf"),
  [
    `db-uri = "${env.AUTHENTICATOR_URL}"`,
    `db-schemas = "public"`,
    `db-anon-role = "anon"`,
    `db-pool = 5`,
    `jwt-secret = "@${path.join(workDir, "jwks.json")}"`,
    `server-host = "127.0.0.1"`,
    `server-port = ${restPort}`,
    ``,
  ].join("\n"),
);

const postgrest = spawn(
  path.join(root, ".cache/postgrest/postgrest"),
  [path.join(workDir, "postgrest.conf")],
  { stdio: ["ignore", "inherit", "inherit"] },
);
postgrest.on("exit", (code) => {
  console.error(`[local-stack] PostgREST exited (${code})`);
  process.exit(1);
});

// wait for PostgREST
for (let i = 0; i < 60; i++) {
  if (
    await fetch(`http://127.0.0.1:${restPort}/`)
      .then((r) => r.ok)
      .catch(() => false)
  )
    break;
  await new Promise((r) => setTimeout(r, 250));
}

const mock = await startMockSupabase({
  port,
  pgUrl: env.PGURL,
  postgrestUrl: `http://127.0.0.1:${restPort}`,
  publishableKey,
  serviceKey,
  keys,
});
console.log(`[local-stack] ready: ${mock.url}  (publishable key ${publishableKey})`);

const stop = async () => {
  postgrest.removeAllListeners("exit");
  postgrest.kill("SIGTERM");
  await mock.close().catch(() => {});
  fs.rmSync(workDir, { recursive: true, force: true });
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
