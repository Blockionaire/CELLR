import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cellarDigest, type MenuAdvice } from "@cellr/domain";
import { SOMMELIER_SYSTEM } from "@/server/ai/prompts/sommelier";
import { SOMMELIER_SYSTEM_V7 } from "@/server/ai/prompts/sommelier-v7";
import type { AiResult, GenerateObjectRequest, LlmProvider } from "@/server/ai/types";
import {
  normalizeMarkdown,
  sampleMarkdown,
  sampleRows,
  SAMPLE_PATH,
  translate,
} from "./annotation-sample";
import { ANCHORS, benchCellar } from "./bench-cellar";
import { benchService, CONFIGS, listedWines, QUESTIONS, requestFor } from "./bench-harness";
import { evalSetCost } from "./bench-eval-cost";
import { measureCell } from "./bench-latency";
import { wiredAgainstEngine } from "./fallback-wired";
import { promptRows, type PromptRow } from "./bench-prompt";
import { askMenuScenario, estimateMenuRun, menuTotals, scoreCourse, scoreMenu } from "./menu-score";
import { MENU_SCENARIOS, menuExpectations, type MenuScenario } from "./scenarios-menu";
import type { VectorFile } from "./vectors";
import { sameVectors } from "./vectors-same";
import { WINES } from "./wines";

/**
 * THE P8 BENCHMARKS (latency, prompt size, the menu set's scorer and estimate, the annotation sample). Free: the
 * model is a fake or an estimate, nothing is sent. These tests keep the tools honest (the fake answers like a
 * model the service accepts; each part does its work in the benchmark) and the committed numbers that do not
 * depend on the clock true to the code.
 */
const results = new URL("../../docs/sprints/sommelier-3-mega/results/", import.meta.url);
const recorded = JSON.parse(readFileSync(new URL("p8-quality-bench.json", results), "utf8")) as {
  cost: {
    rows: PromptRow[];
    evalSets: { rows: Array<Awaited<ReturnType<typeof evalSetCost>> & { config: string }> };
  };
  menu: { estimate: { runs: Array<Awaited<ReturnType<typeof estimateMenuRun>>> } };
};

describe("the generated cellars", () => {
  it("are the same every time, of the size asked, with refs as short as production's", () => {
    const a = benchCellar(25);
    expect(JSON.stringify(a.view)).toBe(JSON.stringify(benchCellar(25).view));
    for (const n of [25, 120, 500]) expect(benchCellar(n).wines).toBe(n);
    const digest = cellarDigest(benchCellar(120).view.items, QUESTIONS.pairing);
    for (const ref of digest.refs.keys()) expect(ref).toHaveLength(6);
  });

  it("are varied: every type, NV, reservations, places and bottles without one, profiles", () => {
    const { view, profiles, anchors } = benchCellar(500);
    expect(new Set(view.items.map((i) => i.type)).size).toBeGreaterThanOrEqual(6);
    expect(view.items.some((i) => i.year === null)).toBe(true);
    expect(view.items.filter((i) => i.reserved).length).toBeGreaterThan(10);
    expect(view.items.some((i) => i.places.length > 1)).toBe(true);
    expect(view.items.some((i) => i.unplaced > 0)).toBe(true);
    expect(profiles.size).toBeGreaterThan(100);
    // The anchors are each the only wine of their producer.
    expect(anchors.map((a) => a.producer)).toEqual(ANCHORS.map((a) => a.producer));
    for (const a of anchors)
      expect(view.items.filter((i) => i.producer === a.producer)).toHaveLength(1);
  });
});

describe("the harness: the app's service with a fake model", () => {
  const cellar = benchCellar(120);

  it("answers through V1's own checks in every configuration, with one model call", async () => {
    for (const c of CONFIGS) {
      const s = benchService(cellar, c.parts, { llm: true });
      const answer = await s.ask(requestFor("pairing-guests", 1));
      expect(answer.source, c.name).toBe("ai");
      expect(answer.bottles, c.name).toHaveLength(3);
      expect(s.counts.modelCalls(), c.name).toBe(1);
      expect(answer.check !== undefined, c.name).toBe(c.parts.includes("check"));
      if (answer.check) expect(answer.check.text).toBe("kept");
      expect(answer.annotations?.length ?? 0, c.name).toBe(c.parts.includes("annotate") ? 3 : 0);
      expect(answer.quantity !== undefined, c.name).toBe(c.parts.includes("quantities"));
      // At most one profiles read, and only with `annotate`.
      expect(s.counts.profileReads, c.name).toBe(c.parts.includes("annotate") ? 1 : 0);
    }
  });

  it("plans a menu only with the part, and gives the serving facts only with annotate", async () => {
    for (const c of CONFIGS) {
      const menu = await benchService(cellar, c.parts, { llm: true }).ask(requestFor("menu-3", 12));
      expect(menu.menu?.courses.filter((x) => x.vintageId !== null).length ?? 0, c.name).toBe(
        c.parts.includes("menu") ? 3 : 0,
      );
      const s = benchService(cellar, c.parts, { llm: true });
      const serving = await s.ask(requestFor("serving", 12));
      expect(
        serving.bottles.map((b) => b.producer),
        c.name,
      ).toEqual(["Vajrelli"]);
      expect(s.counts.profileReads, c.name).toBe(c.parts.includes("annotate") ? 1 : 0);
    }
  });

  it("without a model: V1's plain answer, or the engines' plan with the fallback", async () => {
    const plain = await benchService(cellar, "", { llm: false }).ask(requestFor("pairing", 1));
    expect(plain).toMatchObject({ source: "basic", reason: "ai-off" });
    expect(plain.plan).toBeUndefined();
    const planned = await benchService(cellar, "fallback", { llm: false }).ask(
      requestFor("pairing", 1),
    );
    expect(planned.plan).toBeDefined();
    expect(planned.reason).toBe("ai-off");
  });

  it("measures a cell: every configuration, V1's difference to itself 0", async () => {
    const rows = await measureCell(25, "pairing-guests", 1, { iterations: 3, warmup: 1 });
    expect(rows.map((r) => r.config)).toEqual([
      ...CONFIGS.map((c) => c.name),
      "V1 (no model)",
      "fallback (no model)",
    ]);
    for (const r of rows.filter((x) => x.config === x.against)) expect(r.deltaP95).toBe(0);
    expect(rows.find((r) => r.config === "all")!.modelCallsPerAsk).toBe(1);
    expect(rows.find((r) => r.config === "V1 (no model)")!.modelCallsPerAsk).toBe(0);
  }, 60_000);
});

describe("the prompt each part sends", () => {
  it("is V1's for an ordinary pairing, except check's system prompt and schema (v7)", async () => {
    const rows = (await promptRows(120, 1, ["pairing", "serving"])).filter(
      (r) => r.question === "pairing",
    );
    for (const r of rows) {
      expect(r.userSameAsV1, r.config).toBe(true);
      const check = r.config === "check" || r.config === "all";
      expect(r.systemSameAsV1, r.config).toBe(!check);
      expect(r.schemaSameAsV1, r.config).toBe(!check);
      expect(r.maxOutputTokens).toBe(900);
    }
    expect(SOMMELIER_SYSTEM_V7.length).toBeGreaterThan(SOMMELIER_SYSTEM.length);
  }, 60_000);

  it("gives a new menu more room to answer: 70 tokens a course", async () => {
    const rows = await promptRows(120, 1, ["menu-3", "menu-8"]);
    const cap = (q: string, c: string) =>
      rows.find((r) => r.question === q && r.config === c)!.maxOutputTokens;
    expect(cap("menu-3", "V1")).toBe(900);
    expect(cap("menu-3", "menu")).toBe(1110);
    expect(cap("menu-8", "menu")).toBe(1460);
    expect(cap("menu-8", "all")).toBe(1460);
  }, 60_000);

  it("is recorded as measured (results/p8-quality-bench.json)", async () => {
    const now = [...(await promptRows(120, 1)), ...(await promptRows(120, 12))];
    const committed = recorded.cost.rows.filter((r) => r.wines === 120);
    expect(now).toEqual(committed);
  }, 120_000);
});

/** A model that answers a menu with the wine `choose` gives each course, as V1's model would (one call). */
function menuModel(scenario: MenuScenario, choose: (course: number) => string | null): LlmProvider {
  return {
    async generateObject<T>(request: GenerateObjectRequest<T>): Promise<AiResult<T>> {
      const listed = listedWines(request.user);
      const refOf = (key: string | null) => {
        if (key === null) return null;
        const name = WINES.find((w) => w.key === key)!.name;
        return listed.find((l) => l.name === name)?.ref ?? null;
      };
      const planning = JSON.stringify(request.jsonSchema).includes('"courses"');
      const courses = planning
        ? scenario.courses.map((_, i) => ({
            course: i + 1,
            ref: refOf(choose(i)),
            why: "It suits this course.",
          }))
        : null;
      const follow = scenario.followUp ? refOf(choose(scenario.followUp.course - 1)) : null;
      const refs = courses
        ? courses.flatMap((c) => (c.ref ? [c.ref] : []))
        : follow
          ? [follow]
          : [];
      const value = {
        answer: "One wine per course, below.",
        bottle_refs: refs.slice(0, 3),
        verdict: "match",
        buy: [],
        used_taste: false,
        ...(courses ? { courses } : {}),
      };
      return {
        ok: true,
        value: request.parse(value),
        usage: { model: "gpt-6-luna", tokensIn: 1, tokensOut: 1, latencyMs: 0 },
      };
    },
  };
}

describe("cost over an eval set", () => {
  it("counts V1 as the repo's own `v1-ai --estimate` does (P2: 131 calls, 340,592 tokens in)", async () => {
    const v1 = await evalSetCost("main", "");
    expect(v1).toMatchObject({ calls: 131, inputTokens: 340_592, outputTokensAllowance: 117_900 });
    expect(Math.round(v1.highEstimateMicro / 100) / 1e4).toBe(0.2031);
  }, 120_000);

  it("is recorded as measured (results/p8-quality-bench.json)", async () => {
    for (const r of recorded.cost.evalSets.rows.filter((x) => x.set === "holdout-dev")) {
      const parts = r.parts === "(none: V1)" ? "" : r.parts;
      const now = await evalSetCost("holdout-dev", parts);
      expect({ ...r, ...now }).toEqual(r);
    }
  }, 120_000);
});

describe("the menu set's scorer", () => {
  const scenario = (id: string) => MENU_SCENARIOS.find((s) => s.id === id)!;

  it("scores a course right, acceptable or poor against the labels", () => {
    const mn10 = scenario("mn-10"); // oysters: nothing suits; lamb: the Rioja
    expect(scoreCourse(mn10, 0, null, "Oysters").score).toBe("right");
    expect(scoreCourse(mn10, 0, "rioja-reserva", "Oysters").score).toBe("poor");
    expect(scoreCourse(mn10, 1, "rioja-reserva", "roast lamb").score).toBe("right");
    expect(scoreCourse(mn10, 1, null, "roast lamb").score).toBe("poor");
    expect(scoreCourse(mn10, 1, "rioja-reserva", "lamb").score).toBe("poor"); // said otherwise
    expect(scoreCourse(mn10, 1, "rioja-reserva", null).score).toBe("poor"); // left out
    expect(scoreCourse(mn10, 1, "?", "roast lamb").score).toBe("poor"); // not in the cellar
    const mn18 = scenario("mn-18"); // course 2 cannot be read
    expect(scoreCourse(mn18, 1, null, "qwertzu").score).toBe("right");
    expect(scoreCourse(mn18, 1, "barolo", "qwertzu").score).toBe("right");
    // A good wine in the cellar: an ok one is acceptable.
    const mn01 = scenario("mn-01");
    const [oysters] = menuExpectations(mn01);
    expect(oysters!.level).toBe("good");
    const ok = WINES.map((w) => w.key).find(
      (k) => !oysters!.right.includes(k) && !oysters!.poor.includes(k),
    );
    if (ok) expect(scoreCourse(mn01, 0, ok, "Oysters").score).toBe("acceptable");
    // Only wines that will do: the honest "none" is acceptable.
    const okOnly = MENU_SCENARIOS.flatMap((s) =>
      menuExpectations(s).flatMap((e, i) => (e.level === "ok" ? [{ s, i, e }] : [])),
    )[0];
    if (okOnly) {
      const said = okOnly.s.courses[okOnly.i]!.said;
      expect(scoreCourse(okOnly.s, okOnly.i, okOnly.e.right[0]!, said).score).toBe("right");
      expect(scoreCourse(okOnly.s, okOnly.i, null, said).score).toBe("acceptable");
    }
  });

  it("scores the app's own menu answer: all right with the right wines, poor with poor ones", async () => {
    const good = [];
    const bad = [];
    for (const s of MENU_SCENARIOS) {
      const expected = menuExpectations(s);
      const right = (i: number) => expected[i]!.right[0] ?? null;
      const { answer, keyOf } = await askMenuScenario(s, "menu", menuModel(s, right));
      const scored = scoreMenu(
        s,
        { menu: answer.menu ?? null, firstCard: answer.bottles[0]?.vintageId ?? null },
        keyOf,
      );
      good.push(scored);
      expect(scored.poor, s.id).toBe(0);
      const poor = (i: number) => expected[i]!.poor[0] ?? right(i);
      const worse = await askMenuScenario(s, "menu", menuModel(s, poor));
      bad.push(
        scoreMenu(
          s,
          {
            menu: worse.answer.menu ?? null,
            firstCard: worse.answer.bottles[0]?.vintageId ?? null,
          },
          worse.keyOf,
        ),
      );
    }
    const t = menuTotals(good);
    expect(t.poor).toBe(0);
    expect(t.right).toBe(t.courses);
    expect(t.shownAsMenu).toBe(MENU_SCENARIOS.length);
    expect(menuTotals(bad).poor).toBeGreaterThan(t.courses / 2);
  }, 60_000);

  it("counts a menu V1 did not draw as a menu as poor, course by course", async () => {
    const s = scenario("mn-01");
    const { answer, keyOf } = await askMenuScenario(
      s,
      "",
      menuModel(s, () => "barolo"),
    );
    expect(answer.menu).toBeUndefined();
    const scored = scoreMenu(s, { menu: (answer.menu as MenuAdvice | undefined) ?? null }, keyOf);
    expect(scored).toMatchObject({ menuShown: false, poor: 3 });
  });

  it("estimates one paid run without sending anything, as recorded", async () => {
    for (const r of recorded.menu.estimate.runs) {
      const parts = r.parts === "(none: V1)" ? "" : r.parts;
      const now = await estimateMenuRun(parts);
      expect(now).toEqual(r);
      expect(now.sent).toBe(0);
      expect(now.calls).toBe(MENU_SCENARIOS.reduce((n, s) => n + s.turns.length, 0));
    }
  }, 60_000);
});

describe("the annotation sample for a person to review", () => {
  it("is the committed file, and says that nobody has reviewed it", () => {
    const committed = readFileSync(SAMPLE_PATH, "utf8");
    expect(normalizeMarkdown(committed)).toBe(normalizeMarkdown(sampleMarkdown()));
    expect(committed).toMatch(/NOT REVIEWED\. No person has checked this sample yet\./);
  });

  it("has 50 rows in the screen's words, flagged only by the code's own lowest bases", () => {
    const rows = sampleRows();
    expect(rows).toHaveLength(50);
    for (const r of rows) {
      expect(r.drinkAdvice).not.toBe("");
      if (r.flag.includes("serving: colour only")) expect(r.decanting).toBe("(nothing said)");
      if (r.flag === "") expect(r.codes).not.toMatch(/serving (style|colour)/);
    }
    // The profile basis is worded "from its profile" since the review fixes (was "known for this wine").
    expect(rows.some((r) => r.servingBasis === "from its profile")).toBe(true);
    expect(rows.some((r) => r.temperature.startsWith("Too little is known"))).toBe(true);
  });

  it("words the lines as the screen does (the screen's own expected lines)", () => {
    // From apps/web/src/features/sommelier/annotation-lines.test.tsx.
    expect(translate("annotate.serve.tempAbout", { min: 17, max: 18 })).toBe("about 17–18 °C");
    expect(translate("annotate.where.unplaced", { count: 1 })).toBe("1 bottle without a place");
    expect(translate("annotate.where.unplaced", { count: 2 })).toBe("2 bottles without a place");
    // Since the review fixes the card line says "not reserved" ("free to open" is the quantity box's).
    expect(translate("annotate.reserved.some", { free: 4, total: 6 })).toBe("4 of 6 not reserved");
    expect(translate("annotate.reserved.all", { count: 1 })).toBe("reserved (the only bottle)");
    expect(translate("annotate.reserved.all", { count: 3 })).toBe("all reserved (3)");
    expect(translate("annotate.window.estimated", { years: "2022–2031" })).toBe("est. 2022–2031");
    expect(translate("annotate.window.range", { from: 2022, until: 2031 })).toBe("2022–2031");
  });
});

describe("comparing two runs' vectors", () => {
  const file = (rows: Record<string, unknown>): VectorFile =>
    ({
      set: "main",
      engine: "v1-basic",
      keyed: "id",
      salt: null,
      incomplete: false,
      rows,
    }) as VectorFile;
  const v = { first: 1, noPoor: 1, useful: 1, offered: 3, poor: 0, good: 2 };

  it("counts identical, different and one-sided scenarios", () => {
    expect(sameVectors(file({ a: v, b: v }), file({ a: v, b: v }))).toMatchObject({
      identical: 2,
      different: 0,
      onlyOne: 0,
    });
    expect(sameVectors(file({ a: v, b: v }), file({ a: { ...v, first: 0 }, c: v }))).toMatchObject({
      identical: 0,
      different: 1,
      onlyOne: 2,
    });
    expect(sameVectors(file({ a: v }), { ...file({ a: v }), engine: "v1-fallback" })).toMatchObject(
      { comparable: false },
    );
  });
});

describe("the fallback as the integrated service wires it", () => {
  it.each(["main", "holdout-dev", "holdout-test"])(
    "answers every scenario as the measured engine does (%s, totals only)",
    async (set) => {
      const r = await wiredAgainstEngine(set);
      expect(r.different).toBe(0);
      expect(r.scenarios).toBeGreaterThan(40);
    },
    120_000,
  );
});
