#!/usr/bin/env node
// The production dependency audit gate: like `pnpm audit --prod --audit-level high`, with narrowly scoped,
// expiring exceptions (scripts/audit/audit-exceptions.json).
//
//   node scripts/audit/check-audit.mjs <pnpm audit --prod --json output> [exceptions file]
//
// Every advisory at high or critical fails the gate, unless ONE exception covers it completely:
// - the same GHSA id and package;
// - every finding's version listed;
// - every dependency path listed;
// - the exception not expired;
// - the exception valid: all fields, and an expiry at most 30 days after it was added.
// A report that is missing or unreadable, or that carries an error, also fails: no report is never a pass.
// Low and moderate advisories are reported and do not fail, as with --audit-level high.
// Exit 0: nothing blocks. Exit 1: something blocks (listed). Exit 2: wrong usage.
// AUDIT_TODAY=YYYY-MM-DD overrides today's date (UTC), for the tests.
import { appendFileSync, readFileSync } from "node:fs";

const [reportPath, exceptionsPath = new URL("./audit-exceptions.json", import.meta.url).pathname] =
  process.argv.slice(2);
if (!reportPath) {
  console.error("usage: check-audit.mjs <audit.json> [exceptions.json]");
  process.exit(2);
}
const today = process.env.AUDIT_TODAY || new Date().toISOString().slice(0, 10);
const BLOCKING = new Set(["high", "critical"]);
const MAX_DAYS = 30;
const lines = [];
const out = (s = "") => {
  lines.push(s);
  console.log(s);
};
const days = (from, to) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
const isDate = (s) =>
  typeof s === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

function finish(blocking) {
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `### Dependency audit gate\n\n\`\`\`\n${lines.join("\n")}\n\`\`\`\n`,
      );
    } catch {
      /* the summary is a convenience; the log has the same text */
    }
  }
  process.exit(blocking ? 1 : 0);
}

// ---- the exceptions: each must be complete and short-lived, or the gate fails -------------------------------------
let exceptions = [];
const invalid = [];
try {
  exceptions = JSON.parse(readFileSync(exceptionsPath, "utf8")).exceptions ?? [];
} catch (e) {
  invalid.push(`the exceptions file ${exceptionsPath} cannot be read: ${e.message}`);
}
for (const x of exceptions) {
  const id = x.ghsa ?? "(no ghsa)";
  for (const f of ["ghsa", "package", "owner", "reason", "remove_when"])
    if (typeof x[f] !== "string" || !x[f].trim()) invalid.push(`${id}: "${f}" is missing`);
  if (!Array.isArray(x.versions) || x.versions.length === 0)
    invalid.push(`${id}: "versions" must list the versions`);
  if (!Array.isArray(x.paths) || x.paths.length === 0)
    invalid.push(`${id}: "paths" must list the dependency paths`);
  if (!isDate(x.added) || !isDate(x.expires))
    invalid.push(`${id}: "added" and "expires" must be YYYY-MM-DD dates`);
  else if (days(x.added, x.expires) > MAX_DAYS || days(x.added, x.expires) < 0)
    invalid.push(`${id}: expires ${x.expires} is not within ${MAX_DAYS} days of ${x.added}`);
}

// ---- the report ---------------------------------------------------------------------------------------------------
let report;
try {
  report = JSON.parse(readFileSync(reportPath, "utf8"));
} catch (e) {
  out(
    `BLOCKING: the audit report ${reportPath} cannot be read (${e.message}); no report is never a pass`,
  );
  finish(true);
}
if (
  !report ||
  typeof report !== "object" ||
  report.error ||
  typeof report.advisories !== "object" ||
  !report.metadata
) {
  out(
    `BLOCKING: the audit did not produce a report${report?.error ? `: ${JSON.stringify(report.error)}` : ""}`,
  );
  finish(true);
}

const advisories = Object.values(report.advisories);
const counts = report.metadata.vulnerabilities ?? {};
out(
  `pnpm audit --prod: ${advisories.length} advisories (${["critical", "high", "moderate", "low", "info"].map((s) => `${counts[s] ?? 0} ${s}`).join(", ")}); date ${today}`,
);

const blocking = [...invalid.map((s) => `invalid exception: ${s}`)];
const used = new Set();
for (const a of advisories) {
  const ghsa = a.github_advisory_id ?? `npm-${a.id}`;
  const findings = (a.findings ?? [])
    .map((f) => `${f.version} via ${(f.paths ?? []).join(", ")}`)
    .join("; ");
  const head = `${a.severity} ${ghsa} ${a.module_name}: ${a.title} [${findings}]`;
  if (!BLOCKING.has(a.severity)) {
    out(`  reported  ${head}`);
    continue;
  }
  const x = exceptions.find((e) => e.ghsa === ghsa);
  const problems = [];
  if (!x) problems.push("no exception");
  else {
    if (x.package !== a.module_name)
      problems.push(`the exception is for package ${x.package}, not ${a.module_name}`);
    if (isDate(x.expires) && today > x.expires)
      problems.push(`the exception expired on ${x.expires}`);
    for (const f of a.findings ?? []) {
      if (!(x.versions ?? []).includes(f.version))
        problems.push(`version ${f.version} is not covered`);
      for (const p of f.paths ?? [])
        if (!(x.paths ?? []).includes(p)) problems.push(`path ${p} is not covered`);
    }
    if ((a.findings ?? []).length === 0)
      problems.push("the report lists no findings to compare with the exception");
  }
  if (problems.length) {
    blocking.push(`${head}: ${problems.join("; ")}`);
  } else {
    used.add(ghsa);
    out(`  accepted  ${head}`);
    out(
      `            exception: owner ${x.owner}; expires ${x.expires} (${days(today, x.expires)} days left); remove when: ${x.remove_when}`,
    );
  }
}
for (const x of exceptions)
  if (!used.has(x.ghsa))
    out(
      `::warning::the audit exception for ${x.ghsa} is no longer needed (not reported at high or above); remove it from scripts/audit/audit-exceptions.json`,
    );

if (blocking.length) {
  out(`BLOCKING (${blocking.length}):`);
  for (const b of blocking) out(`  ${b}`);
  finish(true);
}
out("OK: nothing at high or critical except what an exception covers completely");
finish(false);
