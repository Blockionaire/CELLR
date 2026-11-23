import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { AiResult, GenerateObjectRequest, LlmProvider } from "@/server/ai/types";
import { listedWines } from "./bench-harness";
import { compareClaims } from "./compare-claims";
import { dishesFromForm } from "./holdout-csv";
import { v1Ai } from "./engines/v1-ai";
import { v1PlusAi } from "./engines/v1plus-ai";
import { criterionMet, menuCostTable } from "./menu-cost";
import { estimateMenuArm, runMenuArm } from "./menu-run";
import { Ledger, PAID_ENV, PAID_PHRASE } from "./paid";
import { planRuns, planTotals } from "./plan-estimate";
import {
  allForms,
  FORM_PREAMBLE,
  HOLDOUT_HEADER,
  HOLDOUT_ROWS,
  REVIEW_DIR,
  VERDICT,
} from "./review-forms";
import { csv, keptSample, parseCsv, removedSheet, sheetRows } from "./review-sheet";
import { MENU_SCENARIOS } from "./scenarios-menu";
import { scenariosOf } from "./sets";
import type { VectorFile } from "./vectors";

/**
 * THE P8 PAID PLAN, PREPARED AND NOT RUN. No test here calls a network or a model: the paid engines are given a
 * fake provider, or estimate. They hold the plan to its promises: no spending without the owner's phrase and a
 * budget file, an estimate sends nothing and creates no file, v6 and v7 are asked the same scenarios in the same
 * order, the review sheets and forms carry no verdict, and the generated forms are the code's.
 */
const here = fileURLToPath(new URL(".", import.meta.url));
const APPROVED = { [PAID_ENV]: PAID_PHRASE, OPENAI_API_KEY: "sk-test-not-a-key" };

/**
 * A model that answers like V1's would: its first two listed wines, in v7 as [[ref]], in v6 by name, plus a
 * sentence with a price (so the check has something to remove). It records every request it was sent.
 */
function fakeModel(): LlmProvider & { requests: GenerateObjectRequest<unknown>[] } {
  const requests: GenerateObjectRequest<unknown>[] = [];
  return {
    requests,
    async generateObject<T>(request: GenerateObjectRequest<T>): Promise<AiResult<T>> {
      requests.push(request as GenerateObjectRequest<unknown>);
      const wines = listedWines(request.user);
      const v7 = !JSON.stringify(request.jsonSchema).includes('"price"');
      const say = (w: (typeof wines)[number] | undefined) =>
        !w ? "a wine" : v7 ? `[[${w.ref}]]` : `the ${w.name}`;
      const answer = `I would open ${say(wines[0])}: it suits the dish well. ${say(wines[1])} is a fine second choice. A bottle like it costs about €25 in most shops.`;
      return {
        ok: true,
        value: request.parse({
          answer,
          bottle_refs: wines.slice(0, 2).map((w) => w.ref),
          verdict: "match",
          buy: [],
          used_taste: false,
        }),
        usage: {
          model: "gpt-6-luna",
          tokensIn: 1200,
          tokensOut: 150,
          latencyMs: 0,
          reported: true,
        },
      };
    },
  };
}

const outside = () => mkdtempSync(join(tmpdir(), "cellr-p8-"));

describe("the V1+ paid engine (v1plus-ai)", () => {
  it("refuses to spend without the owner's phrase and a key, and without a budget file", () => {
    expect(() => v1PlusAi({ estimate: false, maxUsd: 1, parts: "check", env: {} })).toThrow(
      /calls a paid model.*--estimate/,
    );
    expect(() =>
      v1PlusAi({ estimate: false, maxUsd: 1, parts: "check", env: APPROVED, ledger: null }),
    ).toThrow(/needs a total budget over all runs/);
    expect(() => v1PlusAi({ estimate: true, maxUsd: 1, parts: "chek" })).toThrow(/unknown part/);
  });

  it("estimates without sending anything: the provider is never called", async () => {
    const provider = {
      generateObject: () => {
        throw new Error("a request was sent");
      },
    } as LlmProvider;
    const run = v1PlusAi({ estimate: true, maxUsd: 1, parts: "check", provider });
    for (const s of scenariosOf("holdout-dev").slice(0, 5)) await run.engine.run(s);
    expect(run.meter.calls).toBeGreaterThan(0);
    expect(run.meter.usdMicro).toBeGreaterThan(0);
    expect(run.mode).toBe("estimate");
  });

  it("asks v6 exactly as v1-ai does, and v6 and v7 the same scenarios in the same order", async () => {
    const dir = outside();
    const scenarios = scenariosOf("holdout-dev").slice(0, 12);
    const legacy = fakeModel();
    const v1 = v1Ai({
      estimate: false,
      maxUsd: 1,
      env: APPROVED,
      provider: legacy,
      ledger: Ledger.open(join(dir, "a.json"), 1_000_000),
    });
    const six = fakeModel();
    const v6 = v1PlusAi({
      estimate: false,
      maxUsd: 1,
      parts: "none",
      env: APPROVED,
      provider: six,
      ledger: Ledger.open(join(dir, "b.json"), 1_000_000),
    });
    const seven = fakeModel();
    const v7 = v1PlusAi({
      estimate: false,
      maxUsd: 1,
      parts: "check",
      env: APPROVED,
      provider: seven,
      ledger: Ledger.open(join(dir, "c.json"), 1_000_000),
    });
    for (const s of scenarios) {
      await v1.engine.run(s);
      await v6.engine.run(s);
      await v7.engine.run(s);
    }
    const sent = (m: ReturnType<typeof fakeModel>) =>
      m.requests.map((r) => ({ s: r.system, u: r.user, j: r.jsonSchema, o: r.maxOutputTokens }));
    expect(sent(six)).toEqual(sent(legacy));
    expect([...v6.records.keys()]).toEqual([...v7.records.keys()]);
    expect([...v7.records.keys()]).toEqual(scenarios.map((s) => s.id));
    expect(v6.engine.name).toBe("v1plus-ai:none");
    expect(v7.engine.name).toBe("v1plus-ai:check");
    // The measurement: v6 shows the price sentence, v7's check removes it; v7 wrote its cards as refs.
    const any = (r: Map<string, { shownCodes: string[]; check: string | null }>) => [...r.values()];
    expect(any(v6.records).some((r) => r.shownCodes.includes("price"))).toBe(true);
    expect(any(v7.records).every((r) => !r.shownCodes.includes("price"))).toBe(true);
    expect([...v7.records.values()].some((r) => r.check === "trimmed")).toBe(true);
    expect([...v7.records.values()].every((r) => r.refsAsAsked !== 0)).toBe(true);
    expect([...v6.records.values()].every((r) => r.refsAsAsked === null)).toBe(true);
    // Tokens per call are recorded, for the cost criterion on real numbers.
    expect([...v7.records.values()].flatMap((r) => r.calls).every((c) => c.tokensIn === 1200)).toBe(
      true,
    );
  });

  it("writes review sheets with every removed sentence and no verdict in them", async () => {
    const dir = outside();
    const run = v1PlusAi({
      estimate: false,
      maxUsd: 1,
      parts: "check",
      env: APPROVED,
      provider: fakeModel(),
      ledger: Ledger.open(join(dir, "b.json"), 1_000_000),
      set: "holdout-dev",
    });
    for (const s of scenariosOf("holdout-dev").slice(0, 10)) await run.engine.run(s);
    const answers = run.sheet.map((a) => ({ ...a, run: "test" }));
    const removed = sheetRows(removedSheet(answers));
    expect(removed.length).toBeGreaterThan(0);
    expect(
      removed.every((r) =>
        /costs about/.test(r["sentence (the model's words; refs written as wine names)"]!),
      ),
    ).toBe(true);
    const kept = sheetRows(keptSample(answers, 100));
    expect(kept.length).toBeGreaterThan(0);
    for (const rows of [removed, kept])
      for (const r of rows)
        for (const [h, v] of Object.entries(r))
          if (/VERDICT|reviewer note/.test(h)) expect(v).toBe("");
    const header = parseCsv(removedSheet(answers)).find((r) => r[0] === "row")!;
    expect(header.join(" ")).toMatch(/heuristic, set by code - not a judgement/);
    expect(header.filter((h) => /AI/.test(h))).toEqual([]);
    expect(keptSample(answers, 100)).toBe(keptSample(answers, 100));
  });

  it("from the command line: an estimate creates no budget file; no review sheet for a blind set", () => {
    const dir = outside();
    const file = join(dir, "budget.json");
    const cli = (args: string[], env: Record<string, string> = {}) =>
      spawnSync("npx", ["tsx", "--conditions=react-server", "run.ts", ...args], {
        cwd: here,
        encoding: "utf8",
        env: { ...process.env, [PAID_ENV]: "", OPENAI_API_KEY: "", ...env },
      });
    const estimate = cli([
      "--engine",
      "v1plus-ai",
      "--parts",
      "check",
      "--estimate",
      "--set",
      "holdout-dev",
      "--budget-file",
      file,
      "--total-usd",
      "1",
    ]);
    expect(estimate.status).toBe(0);
    expect(estimate.stdout).toMatch(/ESTIMATE ONLY, nothing was sent/);
    expect(existsSync(file)).toBe(false);
    const refused = cli([
      "--engine",
      "v1plus-ai",
      "--parts",
      "check",
      "--set",
      "holdout-dev",
      "--budget-file",
      file,
      "--total-usd",
      "1",
    ]);
    expect(refused.status).toBe(2);
    expect(refused.stderr).toMatch(/calls a paid model/);
    expect(existsSync(file)).toBe(false);
    const blind = cli([
      "--engine",
      "v1plus-ai",
      "--estimate",
      "--set",
      "holdout-test",
      "--review-sheet",
      join(dir, "x.csv"),
    ]);
    expect(blind.status).toBe(2);
    expect(blind.stderr).toMatch(/blind/);
  }, 120_000);
});

describe("comparing the claims of two runs", () => {
  const file = (engine: string, clean: Array<0 | 1>): VectorFile => ({
    set: "main",
    engine,
    keyed: "id",
    salt: null,
    incomplete: false,
    rows: Object.fromEntries(
      clean.map((c, i) => [
        `s${i}`,
        {
          first: 1,
          noPoor: 1,
          useful: 1,
          offered: 1,
          poor: 0,
          good: 1,
          cluster: `d${i % 4}`,
          claims: {
            rawClean: 0,
            shownClean: c,
            rawCodes: ["price"],
            shownCodes: c ? [] : ["price"],
            refsAsAsked: null,
            check: null,
            removed: 0,
            calls: [{ promptChars: 10, maxOutputTokens: 900, tokensIn: 5, tokensOut: 2, ok: true }],
          },
        },
      ]),
    ),
  });

  it("pairs the scenarios and clusters them by dish", () => {
    const r = compareClaims(
      [file("v1plus-ai:check", [1, 1, 1, 1, 1, 1, 1, 1])],
      [file("v1plus-ai:none", [0, 0, 0, 0, 1, 1, 1, 1])],
    );
    expect(r.measures.shownClean.diff).toBeCloseTo(0.5);
    expect(r.measures.shownClean.clusters).toBe(4);
    expect(r.measures.rawClean.diff).toBe(0);
    expect(r.a.tokensIn).toBe(40);
  });
});

describe("the menu set with the model", () => {
  it("scores each arm per course, and asks per course once per course", async () => {
    const v1 = await estimateMenuArm("v1");
    const menu = await estimateMenuArm("menu");
    const perCourse = await estimateMenuArm("per-course");
    const turns = MENU_SCENARIOS.reduce((n, s) => n + s.turns.length, 0);
    const courses = MENU_SCENARIOS.reduce((n, s) => n + s.courses.length, 0);
    expect(v1.calls).toBe(turns);
    expect(menu.calls).toBe(turns);
    expect(perCourse.calls).toBe(courses);
    expect(menu.highMicro).toBeGreaterThan(v1.highMicro);
    const rows = await runMenuArm("v1", fakeModel());
    expect(rows).toHaveLength(MENU_SCENARIOS.length);
    // V1 draws no menu: strict scoring makes every course poor, scoring by its cards does not.
    const plain = rows.filter((r) => !MENU_SCENARIOS.find((s) => s.id === r.id)!.followUp);
    expect(plain.every((r) => r.strict.menuShown === false)).toBe(true);
    expect(rows.reduce((n, r) => n + r.byCards.poor, 0)).toBeLessThan(
      rows.reduce((n, r) => n + r.strict.poor, 0),
    );
  }, 60_000);

  it("keeps to the proposed cost criterion for menus (free estimate)", async () => {
    const result = criterionMet(await menuCostTable());
    expect(result.over).toEqual([]);
  }, 120_000);
});

describe("the whole plan's budget (estimate)", () => {
  it("fits the owner's provisional $5 even if every call cost its whole reservation", async () => {
    const rows = await planRuns();
    const t = planTotals(rows, 5);
    expect(t.fits).toBe(true);
    expect(rows.filter((r) => r.required).every((r) => r.runs === 3)).toBe(true);
    for (const r of rows) expect(r.maxUsd * 1e6).toBeGreaterThan(r.reservedMicro);
  }, 120_000);
});

/** The forms are generated once for the file (they run the fallback over two sets). */
let generated: ReturnType<typeof allForms> | null = null;
const forms = () => (generated ??= allForms());

describe("the human review forms", () => {
  const verdicts = (text: string) => {
    const rows = parseCsv(text);
    const at = rows.findIndex((r) => r.some((c) => c.startsWith(VERDICT)));
    if (at < 0) return [];
    const columns = rows[at]!.flatMap((h, i) => (h.startsWith(VERDICT) ? [i] : []));
    return rows.slice(at + 1).flatMap((r) => columns.map((i) => r[i] ?? ""));
  };

  it("are the committed files, regenerated from the code", async () => {
    for (const [file, text] of Object.entries(await forms()))
      expect(readFileSync(new URL(file, REVIEW_DIR), "utf8"), file).toBe(text);
  }, 120_000);

  it("start with who filled them in and when, blank, and pre-fill no verdict", async () => {
    for (const [file, text] of Object.entries(await forms())) {
      if (file === "holdout-wines.csv") continue;
      const rows = parseCsv(text);
      expect(rows[1], file).toEqual(FORM_PREAMBLE("")[1]!.map(String));
      expect(rows[2], file).toEqual(["Date:", ""]);
      expect(rows[3]![0], file).toMatch(/until the person named above has signed it/);
      if (file === "holdout-template.csv") continue;
      const v = verdicts(text);
      expect(v.length, file).toBeGreaterThan(0);
      expect(
        v.every((c) => c === ""),
        file,
      ).toBe(true);
    }
  }, 120_000);

  it("the holdout template: 40 rows, only the ids filled; a filled form becomes the escrowed file", () => {
    const template = readFileSync(new URL("holdout-template.csv", REVIEW_DIR), "utf8");
    const rows = parseCsv(template);
    const at = rows.findIndex((r) => r[0] === "id");
    const body = rows.slice(at + 1).filter((r) => r.length > 1);
    expect(body).toHaveLength(HOLDOUT_ROWS);
    expect(body.every((r) => r.slice(1).every((c) => c === ""))).toBe(true);
    const filled = csv([
      HOLDOUT_HEADER,
      [
        "hh-01",
        "Kale stamppot with sausage",
        "Boerenkool met rookworst",
        "Kale stamppot tonight, which wine?",
        "Boerenkool vanavond, welke wijn?",
        "pork",
        "4",
        "2",
        "1",
        "0",
        "0",
        "1",
        "rioja-reserva beaujolais",
        "chianti",
        "",
        "Smoky, fatty pork.",
        "cook 1",
      ],
      [
        "hh-02",
        "Plain boiled rice",
        "Witte rijst",
        "Just plain rice, which wine?",
        "Alleen witte rijst, welke wijn?",
        "pasta-grain",
        "1",
        "0",
        "0",
        "0",
        "0",
        "0",
        "",
        "",
        "yes",
        "Nothing to pair.",
        "cook 1",
      ],
      ["hh-03", ...HOLDOUT_HEADER.slice(1).map(() => "")],
    ]);
    const dishes = dishesFromForm(filled);
    expect(dishes.map((d) => d.id)).toEqual(["hh-01", "hh-02"]);
    expect(dishes[0]).toMatchObject({ good: ["rioja-reserva", "beaujolais"], ok: ["chianti"] });
    expect(dishes[1]).toMatchObject({ good: [], ok: [] });
    const wrong = filled.replace("chianti", "not-a-wine").replace(",yes,", ",,");
    expect(() => dishesFromForm(wrong)).toThrow(/not a key[\s\S]*nothing suits/);
  });
});
