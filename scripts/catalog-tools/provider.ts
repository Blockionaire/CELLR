/**
 * Provider administration (Sprint 004A, review of PR #65): registering a provider and managing its rights are admin
 * actions, separate from imports. Every rights change is logged in catalog_provider_rights_log with a reason and actor.
 *
 *   register:  provider.ts register --db <url> --provider xwines
 *              (name, homepage and notes only; a new provider starts with no rights at all)
 *   rights:    provider.ts rights --db <url> --provider xwines --set '{"may_store":true,"may_display":true}'
 *                --reason "pilot evaluation" --actor "J. Prins"
 *              (only the fields given change; "verified" needs rights_evidence, rights_verified_at, rights_verified_by;
 *               the pilot scope is refused in a production database; "public" needs verified commercial rights)
 *   show:      provider.ts show --db <url> --provider xwines
 *
 * The static PROVIDERS configuration documents Sprint 004A's assessment. It is never applied automatically: rights
 * reach the database only through an explicit `rights --set`.
 */
import { PROVIDERS, type ProviderId } from "@cellr/domain";
import { parseArgs, str } from "./lib";
import { connectToTarget } from "./target";

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  const id = str(args, "provider");
  const client = await connectToTarget(str(args, "db"), args);
  try {
    if (command === "register") {
      const p = PROVIDERS[id as ProviderId];
      if (!p) throw new Error(`unknown provider ${id}`);
      await client.query("select public.catalog_provider_register($1::jsonb)", [
        JSON.stringify({ id: p.id, name: p.name, homepage: p.homepage, notes: p.notes }),
      ]);
    } else if (command === "rights") {
      const set = JSON.parse(str(args, "set")) as Record<string, unknown>;
      await client.query("select public.admin_catalog_provider_rights($1, $2::jsonb, $3, $4)", [
        id,
        JSON.stringify(set),
        str(args, "reason"),
        str(args, "actor"),
      ]);
    } else if (command !== "show") throw new Error("command: register | rights | show");
    const r = await client.query(
      "select id, name, license, may_store, may_display, commercial_use, rights_status, search_scope from public.catalog_providers where id = $1",
      [id],
    );
    console.log(JSON.stringify(r.rows[0] ?? null));
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
