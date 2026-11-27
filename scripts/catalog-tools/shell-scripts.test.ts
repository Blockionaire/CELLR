import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The shell scripts read their JSON results with `j FILE EXPR`, which runs `console.log(EXPR)` in node: EXPR must be
 * an expression. A statement there (staging run 46012494694: `const a = …` inside console.log) is a syntax error that
 * only shows at the end of a long run, so every call is parsed here.
 */
const dir = new URL("./", import.meta.url);
const scripts = readdirSync(dir).filter((f) => f.endsWith(".sh"));

/** The second argument of each `j "…" "…"` call, with shell variables replaced by a placeholder. */
function calls(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(/(?:^|[\s{;(])j "[^"]*" "((?:[^"\\]|\\.)*)"/gm))
    out.push(m[1]!.replace(/\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/g, "x").replace(/\\"/g, '"'));
  return out;
}

describe("the shell scripts' JSON checks", () => {
  it("finds the scripts that use them", () => {
    const using = scripts.filter((f) => calls(readFileSync(new URL(f, dir), "utf8")).length > 0);
    expect(using).toContain("staging-pilot.sh");
    expect(using).toContain("production-run.sh");
  });

  for (const file of scripts)
    it(`${file}: every j call passes an expression`, () => {
      for (const expr of calls(readFileSync(new URL(file, dir), "utf8")))
        expect(() => new Function("r", "require", `return (${expr});`), expr).not.toThrow();
    });

  it("would have caught the statement of run 46012494694", () => {
    const [bad] = calls(
      `  j "$OUT/t.json" "const a=require('$OUT/a.json');process.exit(r.units===a.units?0:1)"`,
    );
    expect(() => new Function("r", "require", `return (${bad});`)).toThrow(SyntaxError);
  });
});

/**
 * perf16's cleanup (perf16-lib.sh) run for real in bash, with the database stubbed: psqlq answers the provider count
 * and fails the switch-off a given number of times; perf16_state writes a given state.
 */
describe("perf16 cleanup in the shell", { timeout: 60_000 }, () => {
  const before = {
    xwines_scope: "pilot",
    synth_scope: null,
    person_sees_synth: 0,
    users: 1,
    households: 201,
    wines: 10300,
  };
  const clean = { ...before, synth_scope: "off", synth_records: 100000 };
  const run = (opts: {
    exists?: number;
    fails?: number;
    after?: object;
    before?: object | null;
  }) => {
    const out = mkdtempSync(join(tmpdir(), "perf16-"));
    if (opts.before !== null)
      writeFileSync(join(out, "perf-state-before.json"), JSON.stringify(opts.before ?? before));
    writeFileSync(join(out, "after.json"), JSON.stringify(opts.after ?? clean));
    const script = `
      set -euo pipefail
      OUT='${out}'; T=(node --import tsx); STAGING_DB_URL=unused; USER_ID=u; HOUSEHOLD=h; PERF16_RETRY_SECONDS=0
      source ./perf16-lib.sh
      fails=${opts.fails ?? 0}; tries=0
      psqlq() {
        case "$*" in
          *"count(*) from public.catalog_providers"*) echo ${opts.exists ?? 1} ;;
          *admin_catalog_provider_disable*) tries=$((tries+1)); echo "attempt $tries" >> "$OUT/disable.log";
            [ "$tries" -gt "$fails" ] || { echo "ERROR: simulated failure" >&2; return 1; } ;;
        esac
      }
      perf16_state() { cp "$OUT/after.json" "$1"; }
      if perf16_cleanup; then echo "RESULT ok"; else echo "RESULT failed"; fi`;
    const r = spawnSync("bash", ["-c", script], {
      cwd: new URL(".", import.meta.url).pathname,
      encoding: "utf8",
    });
    const log = (() => {
      try {
        return readFileSync(join(out, "disable.log"), "utf8").trim().split("\n").filter(Boolean)
          .length;
      } catch {
        return 0;
      }
    })();
    return {
      ok: r.stdout.includes("RESULT ok"),
      failed: r.stdout.includes("RESULT failed"),
      stdout: r.stdout,
      stderr: r.stderr,
      attempts: log,
    };
  };

  it("switches the source off once and finds it clean", () => {
    const r = run({});
    expect(r.ok).toBe(true);
    expect(r.attempts).toBe(1);
    expect(r.stdout).toContain("perf16 cleanup: CLEAN");
  });
  it("retries a failed switch-off, and shows each failure", () => {
    const r = run({ fails: 2 });
    expect(r.ok).toBe(true);
    expect(r.attempts).toBe(3);
    expect(r.stderr).toContain("simulated failure");
    expect(r.stderr).toContain("failed (attempt 2)");
  });
  it("three failed switch-offs: fails and prints the recovery", () => {
    const r = run({ fails: 3 });
    expect(r.failed).toBe(true);
    expect(r.attempts).toBe(3);
    expect(r.stderr).toContain("RECOVERY");
    expect(r.stderr).toContain("perf16-cleanup");
  });
  it("a switch-off that 'worked' but leaves the source public or findable still fails", () => {
    expect(run({ after: { ...clean, synth_scope: "public" } }).failed).toBe(true);
    const r = run({ after: { ...clean, person_sees_synth: 2 } });
    expect(r.failed).toBe(true);
    expect(r.stderr).toContain("RECOVERY");
  });
  it("X-Wines no longer pilot, or a wine changed, fails", () => {
    expect(run({ after: { ...clean, xwines_scope: "public" } }).failed).toBe(true);
    expect(run({ after: { ...clean, wines: 10299 } }).failed).toBe(true);
  });
  it("no synthetic source registered: nothing to switch off, still checked", () => {
    const r = run({ exists: 0, after: before });
    expect(r.ok).toBe(true);
    expect(r.attempts).toBe(0);
  });
  it("no state from before the run: fails rather than compare the after state with itself", () => {
    expect(run({ before: null }).failed).toBe(true);
  });
});

describe("perf16 in staging-pilot.sh", () => {
  const src = readFileSync(new URL("staging-pilot.sh", dir), "utf8");
  const perf16 = src.slice(src.indexOf("\nperf16)"), src.indexOf("\nperf16-cleanup)"));
  it("every exit runs the checked cleanup and keeps a failure", () => {
    expect(perf16).toMatch(/trap 'rc=\$\?; perf16_cleanup \|\| rc=1;[^']*exit \$rc' EXIT/);
  });
  it("the acceptance decides the exit code, and the old estimate is gone", () => {
    expect(perf16).toContain("perf-accept.ts --report");
    expect(perf16).not.toMatch(/in_flight/);
    expect(perf16).not.toMatch(/\? 'MET' : 'NOT MET'/);
  });
  it("X-Wines must be pilot before the run and while the source is public", () => {
    expect(perf16).toContain("r.xwines_scope==='pilot'?0:1");
    expect(perf16).toContain("r.xwines_scope==='pilot'&&r.synth_scope==='public'");
  });
  it("no switch-off of a provider is silenced anywhere in the catalogue scripts", () => {
    for (const f of scripts) {
      const text = readFileSync(new URL(f, dir), "utf8");
      for (const line of text
        .split("\n")
        .filter((l) => l.includes("admin_catalog_provider_disable")))
        expect(line, `${f}: ${line.trim()}`).not.toMatch(/\|\|\s*true|2>&1/);
    }
  });
});
