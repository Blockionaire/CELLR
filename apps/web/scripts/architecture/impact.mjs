// Architecture impact of a change (System Intelligence ADR-001): what the repository inventory says changed between a
// base commit and the working tree — tables, foreign keys, routes, modules, jobs, workflows, configuration, external
// hosts, dependencies, data access and imports between areas — and whether the register was touched.
//   pnpm architecture:impact                      against origin/main
//   pnpm architecture:impact -- --base <ref>      against any commit (CI: the pull request's base)
// Informational: it prints Markdown and exits 0. What BLOCKS a merge is registry.test.ts (in `pnpm test`), which
// fails when a change is not reflected in the register. Node built-ins only; no network, no AI, no secrets.
import { execFileSync } from "node:child_process";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../../../..");
const INVENTORY = "apps/web/src/server/system/inventory.generated.json";
const REGISTER = "apps/web/src/server/system/registry.ts";

const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 18)) {
  console.error(
    `architecture:impact needs Node 22.18 or newer (type stripping); this is ${process.version}`,
  );
  process.exit(2);
}
const { buildInventory } = await import("./inventory-builder.ts");

const args = process.argv.slice(2);
const base = args.includes("--base") ? args[args.indexOf("--base") + 1] : "origin/main";
if (!base || !/^[\w./~^@-]+$/.test(base)) {
  console.error("usage: architecture:impact [--base <git ref>]");
  process.exit(2);
}
const git = (...a) =>
  execFileSync("git", a, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

let before = {};
let baseNote = "";
try {
  before = JSON.parse(git("show", `${base}:${INVENTORY}`));
} catch {
  baseNote = `No inventory at \`${base}\`: everything below counts as new.`;
}
const after = buildInventory(ROOT);

/** Each inventory list as comparable one-line facts, with the inventory key it comes from. */
const facts = {
  Tables: (i) => (i.tables ?? []).map((t) => t.name),
  "Foreign keys": (i) =>
    (i.tables ?? []).flatMap((t) =>
      (t.references ?? []).map(
        (r) => `${t.name} → ${typeof r === "string" ? r : JSON.stringify(r)}`,
      ),
    ),
  "Database functions": (i) => i.functions ?? [],
  "Storage buckets": (i) => i.buckets ?? [],
  "pg_cron jobs": (i) => (i.cronJobs ?? []).map((j) => `${j.name} (${j.schedule})`),
  "Vercel crons": (i) => (i.vercelCrons ?? []).map((j) => `${j.path} (${j.schedule})`),
  "API routes": (i) => (i.apiRoutes ?? []).map((r) => `${r.methods.join(",")} ${r.path}`),
  "Server modules": (i) => i.serverModules ?? [],
  "Feature switches": (i) => i.features ?? [],
  Workflows: (i) => (i.workflows ?? []).map((w) => `${w.file}: ${w.jobs.join(", ")}`),
  "Environment variables": (i) => i.envVars ?? [],
  "External hosts": (i) => i.externalHosts ?? [],
  Dependencies: (i) => i.dependencies ?? [],
  "Data access (area → table)": (i) => (i.dataAccess ?? []).map((d) => `${d.area} → ${d.table}`),
  "Imports between areas": (i) => (i.imports ?? []).map((d) => `${d.from} → ${d.to}`),
};

const KEY = {
  Tables: "tables",
  "Foreign keys": "tables",
  "Database functions": "functions",
  "Storage buckets": "buckets",
  "pg_cron jobs": "cronJobs",
  "Vercel crons": "vercelCrons",
  "API routes": "apiRoutes",
  "Server modules": "serverModules",
  "Feature switches": "features",
  Workflows: "workflows",
  "Environment variables": "envVars",
  "External hosts": "externalHosts",
  Dependencies: "dependencies",
  "Data access (area → table)": "dataAccess",
  "Imports between areas": "imports",
};
// a list the base inventory did not have yet is newly inventoried, not newly built
const firstInventoried = baseNote
  ? []
  : Object.keys(facts)
      .filter((name) => !(KEY[name] in before))
      .map((name) => `${name} (${facts[name](after).length})`);

const changes = Object.entries(facts)
  .filter(([name]) => baseNote || KEY[name] in before)
  .map(([name, of]) => {
    const was = new Set(of(before));
    const is = new Set(of(after));
    return {
      name,
      added: [...is].filter((x) => !was.has(x)),
      removed: [...was].filter((x) => !is.has(x)),
    };
  })
  .filter((c) => c.added.length || c.removed.length);

let registerTouched = false;
try {
  git("diff", "--quiet", base, "--", REGISTER);
} catch {
  registerTouched = true;
}
const migrationsBefore = before.migrations?.latest ?? "";
const newMigration = after.migrations.latest !== migrationsBefore ? after.migrations.latest : "";

const out = ["## Architecture impact", ""];
if (baseNote) out.push(baseNote, "");
if (firstInventoried.length)
  out.push(
    `Inventoried for the first time (not counted as change): ${firstInventoried.join(", ")}.`,
    "",
  );
if (!changes.length && !newMigration) {
  out.push(
    `No structural change against \`${base}\`.${registerTouched ? " The register itself changed." : ""}`,
  );
} else {
  const n = changes.reduce((s, c) => s + c.added.length + c.removed.length, 0);
  out.push(
    `**${n} structural change${n === 1 ? "" : "s"}** against \`${base}\`. Register (\`registry.ts\`) ${registerTouched ? "**updated** in this change" : "**not changed**"}.`,
    "",
    registerTouched
      ? "Check that each new relation has code evidence and that what cannot be proven is `planned` or `unverified`."
      : "Fine if `registry.test.ts` passes (the change stays inside existing components and edges); otherwise update the register — see docs/sprints/system-health/REGISTRY-GUIDE.md.",
    "",
  );
  if (newMigration) out.push(`- New latest migration: \`${newMigration}\``);
  const MAX = 25;
  for (const c of changes) {
    out.push(`- **${c.name}**: +${c.added.length} / −${c.removed.length}`);
    const lines = [
      ...c.added.map((x) => `  - \`+ ${x}\``),
      ...c.removed.map((x) => `  - \`− ${x}\``),
    ];
    out.push(...lines.slice(0, MAX));
    if (lines.length > MAX) out.push(`  - … ${lines.length - MAX} more`);
  }
}
out.push(
  "",
  "_Structure only: read from the code, no live data. Live health is on System › Health and never decides structure._",
);
console.log(out.join("\n"));
