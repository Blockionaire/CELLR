// CI runs the end-to-end suite as two suites with their own shards (playwright.config.ts, THREE_D_SPECS; issue
// #77). This proves that splitting it loses nothing: the tests of E2E_SUITE=3d and of E2E_SUITE=core, together, are
// exactly the tests of the whole suite, none in both, and neither suite is empty. It lists the tests (nothing is
// run, no server is started) and fails with the tests that are missing or doubled.
//   node apps/web/scripts/e2e-suites-check.mjs
import { execFileSync } from "node:child_process";
import path from "node:path";

const WEB = path.resolve(import.meta.dirname, "..");

function list(suite) {
  const env = { ...process.env, E2E_SUITE: suite ?? "" };
  const out = execFileSync("pnpm", ["exec", "playwright", "test", "--list", "--reporter=json"], {
    cwd: WEB,
    env,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "inherit"],
  });
  const report = JSON.parse(out);
  const ids = [];
  const walk = (suiteNode) => {
    for (const spec of suiteNode.specs ?? [])
      for (const t of spec.tests ?? [])
        ids.push(`${t.projectName} › ${spec.file}:${spec.line}:${spec.column} › ${spec.title}`);
    for (const child of suiteNode.suites ?? []) walk(child);
  };
  for (const s of report.suites ?? []) walk(s);
  return ids;
}

const all = list(undefined);
const threeD = list("3d");
const core = list("core");
const problems = [];
const count = (ids) => ids.reduce((m, id) => m.set(id, (m.get(id) ?? 0) + 1), new Map());
const inAll = count(all);
const inSplit = count([...threeD, ...core]);
for (const [id, n] of inAll)
  if ((inSplit.get(id) ?? 0) !== n) problems.push(`not run exactly once: ${id}`);
for (const id of inSplit.keys()) if (!inAll.has(id)) problems.push(`not in the whole suite: ${id}`);
const coreSet = new Set(core);
for (const id of threeD) if (coreSet.has(id)) problems.push(`in both suites: ${id}`);
if (threeD.length === 0) problems.push("the 3D suite is empty: THREE_D_SPECS matches no spec");
if (core.length === 0) problems.push("the core suite is empty");

if (problems.length > 0) {
  console.error(
    `e2e suites: ${problems.length} problem(s)\n- ${problems.slice(0, 50).join("\n- ")}`,
  );
  process.exit(1);
}
console.log(
  `e2e suites: ${all.length} tests = ${threeD.length} (3d) + ${core.length} (core), none in both, none left out`,
);
