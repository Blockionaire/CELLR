import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import type { AiResult, GenerateObjectRequest, LlmProvider } from "@/server/ai/types";
import { listedWines } from "./bench-harness";
import { costCheck, spread } from "./cost-check";
import { v1PlusAi } from "./engines/v1plus-ai";
import { checkForms, summarizeForm } from "./forms-check";
import { clopperPearson, rateText } from "./intervals";
import { Ledger, PAID_ENV, PAID_PHRASE } from "./paid";
import { commandsOf, dryRun, preconditions } from "./p8";
import { REVIEW_DIR, VERDICT } from "./review-forms";
import { csv, parseCsv } from "./review-sheet";
import { MENU_SCENARIOS } from "./scenarios-menu";
import { scenariosOf } from "./sets";
import { FAILED_MIN_CALLS, RunMonitor, sameModel } from "./stop-rules";

/**
 * THE STOP RULES, THE COST CHECK, THE RUNBOOK AND THE FORMS' RETURN (P8, fixed before any paid run). No network: the
 * paid engine gets a fake provider.
 */
const APPROVED = { [PAID_ENV]: PAID_PHRASE, OPENAI_API_KEY: "sk-test-not-a-key" };
const outside = () => mkdtempSync(join(tmpdir(), "cellr-p8-stops-"));

function provider(options: { served?: string; fail?: boolean } = {}): LlmProvider {
  return {
    async generateObject<T>(request: GenerateObjectRequest<T>): Promise<AiResult<T>> {
      const usage = {
        model: "gpt-6-luna",
        tokensIn: 1000,
        tokensOut: 100,
        latencyMs: 0,
        reported: true,
        ...(options.served ? { servedModel: options.served } : {}),
      };
      if (options.fail) return { ok: false, kind: "timeout", usage };
      const wines = listedWines(request.user);
      return {
        ok: true,
        value: request.parse({
          answer: "A good choice for the dish.",
          bottle_refs: wines.slice(0, 1).map((w) => w.ref),
          verdict: "match",
          buy: [],
          used_taste: false,
        }),
        usage,
      };
    },
  };
}

const run = (p: LlmProvider, parts = "check") =>
  v1PlusAi({
    estimate: false,
    maxUsd: 1,
    parts,
    env: APPROVED,
    provider: p,
    ledger: Ledger.open(join(outside(), "b.json"), 1_000_000),
  });

describe("the stop rules during a paid run", () => {
  it("know a dated snapshot of the configured model from another model", () => {
    expect(sameModel("gpt-6-luna", "gpt-6-luna")).toBe(true);
    expect(sameModel("gpt-6-luna", "gpt-6-luna-2026-10-01")).toBe(true);
    expect(sameModel("gpt-6-luna", "gpt-6-luna-pro")).toBe(false);
    expect(sameModel("gpt-6-luna", "gpt-4.1")).toBe(false);
  });

  it("stop when the provider answers with another model", async () => {
    const r = run(provider({ served: "gpt-4.1-2025-04-14" }));
    await r.engine.run(scenariosOf("holdout-dev")[0]!);
    expect(r.monitor.stopped?.rule).toBe("served-model");
  });

  it("stop when more than 5% of the calls fail (after 20 calls, and at the end of a run)", async () => {
    const r = run(provider({ fail: true }));
    for (const s of scenariosOf("holdout-dev").slice(0, FAILED_MIN_CALLS - 1))
      await r.engine.run(s);
    expect(r.monitor.stopped).toBeNull();
    await r.engine.run(scenariosOf("holdout-dev")[FAILED_MIN_CALLS]!);
    expect(r.monitor.stopped?.rule).toBe("failed-calls");
    const few = new RunMonitor("gpt-6-luna", true);
    few.call({
      ok: false,
      kind: "invalid",
      usage: { model: "x", tokensIn: 0, tokensOut: 0, latencyMs: 0 },
    });
    expect(few.stopped).toBeNull();
    few.end();
    expect(few.stopped?.rule).toBe("failed-calls");
  });

  it("never stop an estimate (it answers 'no AI' on purpose), and record served model and cost per call", async () => {
    const est = v1PlusAi({ estimate: true, maxUsd: 1, parts: "check" });
    for (const s of scenariosOf("holdout-dev").slice(0, 25)) await est.engine.run(s);
    expect(est.monitor.stopped).toBeNull();
    const r = run(provider({ served: "gpt-6-luna-2026-10-01" }), "check,annotate,quantities");
    for (const s of scenariosOf("probe")) await r.engine.run(s);
    expect(r.monitor.stopped).toBeNull();
    const calls = [...r.records.values()].flatMap((c) => c.calls);
    expect(calls.every((c) => c.servedModel === "gpt-6-luna-2026-10-01" && c.usdMicro! > 0)).toBe(
      true,
    );
    // The probe's serving questions are measured (the serving reconciliation's outcome is recorded).
    expect([...r.records.values()].filter((c) => c.serving !== null).length).toBeGreaterThan(5);
    expect([...r.records.values()].every((c) => c.shownServing.length === 0)).toBe(true);
  });

  it("the probe: 16 scenarios in English and Dutch, serving and guests", () => {
    const probe = scenariosOf("probe");
    expect(probe).toHaveLength(16);
    expect(new Set(probe.map((s) => s.lang))).toEqual(new Set(["en", "nl"]));
    expect(probe.filter((s) => s.dish).length).toBe(6);
  });
});

describe("intervals for rates", () => {
  it("are exact (Clopper–Pearson), and too few items say so", () => {
    expect(clopperPearson(0, 219).high).toBeCloseTo(1 - 0.025 ** (1 / 219), 6);
    const ci = clopperPearson(5, 100);
    expect(ci.low).toBeCloseTo(0.01643, 4);
    expect(ci.high).toBeCloseTo(0.11283, 4);
    expect(rateText(1, 10)).toBe("too few to conclude (1 of 10)");
  });
});

describe("the cost criterion on real tokens", () => {
  const dir = () => pathToFileURL(outside() + "/");
  const call = (usdMicro: number) => ({
    promptChars: 1,
    maxOutputTokens: 900,
    tokensIn: 1,
    tokensOut: 1,
    ok: true,
    usdMicro,
    servedModel: "gpt-6-luna",
  });
  const vectors = (usd: number) => ({
    set: "main",
    engine: "x",
    keyed: "id",
    salt: null,
    incomplete: false,
    rows: Object.fromEntries(
      scenariosOf("main")
        .slice(0, 30)
        .map((s) => [
          s.id,
          {
            first: 1,
            noPoor: 1,
            useful: 1,
            offered: 1,
            poor: 0,
            good: 1,
            claims: { calls: [call(usd)] },
          },
        ]),
    ),
  });
  const menu = (usd: number, calls = 1) => ({
    incomplete: false,
    rows: MENU_SCENARIOS.map((s) => ({
      id: s.id,
      questions: s.turns.length,
      calls: Array.from({ length: s.turns.length + calls - 1 }, () => call(usd)),
    })),
  });
  const write = (d: URL, v6: number, v7: number, m: ReturnType<typeof menu>) => {
    for (const n of [1, 2, 3]) {
      writeFileSync(new URL(`main-v6-${n}.json`, d), JSON.stringify(vectors(v6)));
      writeFileSync(new URL(`main-v7-${n}.json`, d), JSON.stringify(vectors(v7)));
      writeFileSync(new URL(`menu-menu-${n}.json`, d), JSON.stringify(m));
    }
  };

  it("is not measured without the files", () => {
    expect(costCheck(dir()).measured).toBe(false);
  });

  it("passes within the limits and reports the spread", () => {
    const d = dir();
    write(d, 1000, 1050, menu(1400));
    const r = costCheck(d);
    expect(r).toMatchObject({ measured: true, passed: true });
    if (r.measured) {
      expect(r.ordinary.ratio).toBe(1.05);
      expect(r.menuTimesSameCellarV1).toMatchObject({ min: 1.4, median: 1.4, max: 1.4 });
    }
    expect(spread([1, 2, 3, 4])).toEqual({ n: 4, min: 1, median: 3, p95: 4, max: 4 });
  });

  it("fails on two calls for a menu question, a menu above 1.5x, or ordinary questions above +10%", () => {
    for (const [v7, m, rule] of [
      [1000, menu(1000, 2), /more than one model call/],
      [1000, menu(1600), /1\.6 × the same cellar/],
      [1150, menu(1000), /1\.15 × V1's/],
    ] as const) {
      const d = dir();
      write(d, 1000, v7, m);
      const r = costCheck(d);
      expect(r.measured && r.passed).toBe(false);
      expect(r.measured ? r.failures.join(" ") : "").toMatch(rule);
    }
  });
});

describe("the runbook", () => {
  it("dry-runs every step with --estimate: the commands in order, and the budget fits $5", async () => {
    const d = await dryRun();
    expect(d.fits).toBe(true);
    expect(d.steps[1]).toHaveLength(3 * 4 * 2);
    expect(d.steps[2]).toHaveLength(3 * 2 + 2);
    const all = [...d.steps[1], ...d.steps[2]].map((c) => c.join(" "));
    expect(all.every((c) => c.includes("--budget-file $B") && c.includes("--total-usd 5"))).toBe(
      true,
    );
    expect(all.some((c) => c.includes("--definitive"))).toBe(false);
    // v6 before v7 for each set in each round; the blind set's vectors outside the repository, no review sheet.
    expect(all[0]).toMatch(/--parts none --set main .*main-v6-1\.json/);
    expect(all[1]).toMatch(/--parts check --set main .*main-v7-1\.json .*--review-sheet/);
    const blind = all.filter((c) => c.includes("--set holdout-test"));
    expect(blind.every((c) => c.includes("--vectors $O/") && !c.includes("--review-sheet"))).toBe(
      true,
    );
    expect(d.rows.find((r) => r.step === "4-probe-v7")!.parts).toBe("check,annotate,quantities");
    expect(commandsOf(d.rows[0]!)).toHaveLength(3);
  }, 120_000);

  it("refuses a paid step until every precondition is met", () => {
    const none = preconditions({ env: {}, head: "abc1234", clean: false, frozen: null });
    expect(none).toHaveLength(7);
    const o = outside();
    mkdirSync(join(o, "blind"));
    const ok = preconditions({
      env: {
        ...APPROVED,
        SOMMELIER_EVAL_BUDGET_FILE: join(o, "budget.json"),
        SOMMELIER_EVAL_BLIND_DIR: join(o, "blind"),
        SOMMELIER_EVAL_BLIND_SALT: "0123456789abcdef0123",
      },
      head: "abc1234def",
      clean: true,
      frozen: { commit: "abc1234", frozenOn: "2026-12-01", by: "owner" },
    });
    expect(ok).toEqual([]);
    expect(
      preconditions({
        env: { ...APPROVED, SOMMELIER_EVAL_BUDGET_FILE: "docs/budget.json" },
        head: "abc1234",
        clean: true,
        frozen: { commit: "fff0000", frozenOn: "x", by: "owner" },
      }).join(" "),
    ).toMatch(/outside the repository.*not the frozen build/);
    expect(
      preconditions({
        env: {},
        head: "eee9999",
        clean: true,
        frozen: { commit: "abc1234", frozenOn: "x", by: "owner" },
        onlyResultsSince: true,
      }).join(" "),
    ).not.toMatch(/frozen build/);
  });
});

describe("the human forms coming back", () => {
  it("count an empty form as incomplete, a filled one as complete, and copy no free text", () => {
    const blank = readFileSync(new URL("annotation-review.csv", REVIEW_DIR), "utf8");
    const empty = summarizeForm("annotation-review.csv", blank)!;
    expect(empty).toMatchObject({ rows: 50, filled: 0, complete: false, filledInBy: false });
    const rows = parseCsv(blank);
    const at = rows.findIndex((r) => r.some((c) => c.startsWith(VERDICT)));
    const cols = rows[at]!.flatMap((h, i) => (h.startsWith(VERDICT) ? [i] : []));
    const filled = rows.map((r, k) => {
      if (r[0] === "Filled in by (name, role):") return [r[0], "A. Reviewer, sommelier"];
      if (r[0] === "Date:") return [r[0], "2026-12-10"];
      if (k <= at || r.every((c) => c === "")) return r;
      return r.map((c, i) => (cols.includes(i) ? (i === cols[2] ? "a private remark" : "yes") : c));
    });
    const s = summarizeForm("annotation-review.csv", csv(filled))!;
    expect(s.complete).toBe(true);
    expect(s.answers["factually right? (yes / no / partly)"]).toEqual({ yes: 50 });
    expect(JSON.stringify(s)).not.toContain("a private remark");
    expect(JSON.stringify(s)).not.toContain("A. Reviewer");
  });

  it("are read only from a folder outside the repository", () => {
    expect(() => checkForms(".")).toThrow(/outside the repository/);
    const r = checkForms(outside());
    expect(r.complete).toBe(false);
    expect(r.missing).toContain("annotation-review");
  });
});
