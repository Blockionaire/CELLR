// Regenerates apps/web/src/server/system/inventory.generated.json from the repository (System Intelligence
// ADR-001): tables and foreign keys, functions, migrations, Storage buckets, pg_cron jobs, route handlers, server
// modules, CI jobs, Vercel crons, feature switches, workflows, environment variables (names only), external hosts,
// runtime dependencies, data access per area and imports between areas.
//   pnpm architecture:inventory           write the file
//   pnpm architecture:inventory --check   fail if the committed file is out of date
// registry.test.ts runs the same comparison in `pnpm test`, so CI catches drift either way.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import prettier from "prettier";

const ROOT = path.resolve(import.meta.dirname, "../../../..");
const OUT = path.join(ROOT, "apps/web/src/server/system/inventory.generated.json");
// Node >= 22.18 strips TypeScript types itself; the builder imports node built-ins and types only.
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 18)) {
  console.error(
    `architecture:inventory needs Node 22.18 or newer (type stripping); this is ${process.version}`,
  );
  process.exit(2);
}
const { buildInventory } = await import("./inventory-builder.ts");

const config = JSON.parse(readFileSync(path.join(ROOT, ".prettierrc.json"), "utf8"));
const text = await prettier.format(JSON.stringify(buildInventory(ROOT)), {
  ...config,
  parser: "json",
});

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(OUT, "utf8");
  } catch {}
  if (current === text) {
    console.log("inventory.generated.json is up to date");
  } else {
    console.error("inventory.generated.json is stale — run: pnpm architecture:inventory");
    process.exit(1);
  }
} else {
  writeFileSync(OUT, text);
  console.log(`wrote ${path.relative(ROOT, OUT)}`);
}
