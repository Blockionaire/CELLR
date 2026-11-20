import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DISHES } from "./dishes";
import { ENGINES } from "./engines";
import { SCENARIOS } from "./scenarios";
import { cardsOf, scenariosOf } from "./sets";
import { expectedVerdictOf, scoreScenario, summarize } from "./score";
import { CAPABILITIES, CATEGORIES, type EvalAnswer, type Scenario } from "./types";
import { CELLARS, WINE_KEYS } from "./wines";

const cards = new Map(DISHES.map((d) => [d.id, d]));

describe("the benchmark's own data", () => {
  it("has at least 150 scenarios with unique ids, in known categories", () => {
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(150);
    expect(new Set(SCENARIOS.map((s) => s.id)).size).toBe(SCENARIOS.length);
    for (const s of SCENARIOS) {
      expect(CATEGORIES, s.id).toContain(s.category);
      expect(s.turns.length, s.id).toBeGreaterThan(0);
      expect(s.needs.length, s.id).toBeGreaterThan(0);
      for (const n of s.needs) expect(CAPABILITIES, s.id).toContain(n);
      expect(CELLARS[s.cellar], `${s.id}: cellar ${s.cellar}`).toBeDefined();
      if (s.dish) expect(cards.has(s.dish), `${s.id}: dish ${s.dish}`).toBe(true);
    }
    for (const c of CATEGORIES)
      expect(
        SCENARIOS.some((s) => s.category === c),
        `category ${c} is empty`,
      ).toBe(true);
  });

  it("names only wines that exist", () => {
    for (const d of DISHES) {
      for (const k of [...d.good, ...d.ok]) expect(WINE_KEYS.has(k), `${d.id}: ${k}`).toBe(true);
      expect(
        d.good.filter((k) => d.ok.includes(k)),
        d.id,
      ).toEqual([]);
    }
    expect(new Set(DISHES.map((d) => d.id)).size).toBe(DISHES.length);
    const keysOf = (s: Scenario) => [
      ...(s.expect.never ?? []),
      ...Object.keys(s.expect.tiers ?? {}),
      ...(s.expect.buy?.styleAnyOf ?? []),
      ...Object.keys(s.mods?.reserved ?? {}),
      ...Object.keys(s.mods?.years ?? {}),
      ...Object.keys(s.mods?.counts ?? {}),
      ...Object.keys(s.mods?.ratings ?? {}),
      ...(s.mods?.favorites ?? []),
      ...(Array.isArray(s.mods?.strip) ? s.mods.strip : []),
      ...(Array.isArray(s.mods?.profiles) ? s.mods.profiles : []),
    ];
    for (const s of SCENARIOS)
      for (const k of keysOf(s)) expect(WINE_KEYS.has(k), `${s.id}: ${k}`).toBe(true);
  });

  it("can say what the reference outcome of every pairing scenario is", () => {
    for (const s of SCENARIOS)
      if (s.expect.verdict !== undefined)
        expect(["good", "acceptable", "none"], s.id).toContain(
          expectedVerdictOf(s, s.dish ? (cards.get(s.dish) ?? null) : null),
        );
  });
});

describe("scoring", () => {
  const scenario = SCENARIOS.find((s) => s.dish === "raw-oysters" && s.cellar === "all")!;
  const card = cards.get("raw-oysters")!;
  const answer = (over: Partial<EvalAnswer>): EvalAnswer => ({
    verdict: "good",
    bottles: [card.good[0]!],
    invented: 0,
    food: { truth: card.truth },
    ...over,
  });

  it("passes the reference answer", () => {
    expect(scoreScenario(scenario, card, answer({}), 1).pass).toBe(true);
  });
  it("fails a poor first bottle, an invented wine, a wrong verdict and a wrong reading of the dish", () => {
    const failed = (a: EvalAnswer) =>
      scoreScenario(scenario, card, a, 1)
        .checks.filter((c) => !c.pass)
        .map((c) => c.name);
    expect(failed(answer({ bottles: ["pauillac"] }))).toEqual(["first", "no-poor-bottle"]);
    expect(failed(answer({ invented: 1 }))).toEqual(["grounded"]);
    expect(failed(answer({ verdict: "acceptable" }))).toEqual(["verdict"]);
    expect(failed(answer({ food: { truth: { ...card.truth, main: "red-meat" } } }))).toEqual([
      "food",
    ]);
    expect(failed(answer({ unsupported: ["pairing"] }))).toEqual(["capability"]);
  });
  it("counts a forced answer where nothing suits", () => {
    const none = SCENARIOS.find((s) => s.category === "no-suitable-wine" && s.expect.noBottles)!;
    const noneCard = cards.get(none.dish!)!;
    const forced: EvalAnswer = {
      verdict: "good",
      bottles: [CELLARS[none.cellar]![0]!],
      invented: 0,
    };
    const honest: EvalAnswer = { verdict: "none", bottles: [], invented: 0 };
    const results = [forced, honest].map((a) => scoreScenario(none, noneCard, a, 1));
    expect(summarize("test", results, [forced, honest]).measures["honest-none"]).toEqual([1, 2]);
  });
});

describe("the V1 baseline", () => {
  it("is reproducible: every scenario fails the same checks as in the recorded run, and no wine is invented", async () => {
    const recorded = JSON.parse(
      readFileSync(
        new URL(
          "../../docs/sprints/sommelier-3-mega/results/baseline-v1-basic.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as { results: Array<{ id: string; failed: string[] }> };
    const failedBefore = new Map(recorded.results.map((r) => [r.id, r.failed]));
    const engine = ENGINES.find((e) => e.name === "v1-basic")!;
    for (const s of SCENARIOS) {
      const { answer, ms } = await engine.run(s);
      expect(answer.invented, s.id).toBe(0);
      // Scenarios added after the recorded run have no line there yet: the baseline is run again when they are.
      const before = failedBefore.get(s.id);
      if (!before) continue;
      const now = scoreScenario(s, s.dish ? (cards.get(s.dish) ?? null) : null, answer, ms)
        .checks.filter((c) => !c.pass)
        .map((c) => c.name);
      expect(now, s.id).toEqual(before);
    }
  });
});

describe("Sommelier 3.0 in the app", () => {
  // Only V1's baseline used to be pinned, so a change to the engines could move the results the documents quote
  // without any test noticing. A change that moves a result now has to record a new run
  // (`pnpm sommelier:eval --engine v3-app --set <set> --json …/results/<file>`) and say why.
  const pinned = (set: string, file: string, passed: number) =>
    it(`gives the recorded result on "${set}": ${passed} scenarios, each failing the same checks`, async () => {
      const recorded = JSON.parse(
        readFileSync(
          new URL(`../../docs/sprints/sommelier-3-mega/results/${file}`, import.meta.url),
          "utf8",
        ),
      ) as { passed: number; results: Array<{ id: string; supported: boolean; failed: string[] }> };
      const before = new Map(recorded.results.map((r) => [r.id, r]));
      const engine = ENGINES.find((e) => e.name === "v3-app")!;
      const cardOf = cardsOf(set);
      let now = 0;
      for (const s of scenariosOf(set)) {
        const was = before.get(s.id);
        const supported = s.needs.every((n) => engine.capabilities.has(n));
        expect(supported, s.id).toBe(was?.supported);
        if (!supported) continue;
        const { answer, ms } = await engine.run(s);
        expect(answer.invented, s.id).toBe(0);
        const failed = scoreScenario(s, s.dish ? (cardOf.get(s.dish) ?? null) : null, answer, ms)
          .checks.filter((c) => !c.pass)
          .map((c) => c.name);
        expect(failed, s.id).toEqual(was?.failed);
        if (failed.length === 0) now += 1;
      }
      expect(now).toBe(recorded.passed);
      expect(now).toBe(passed);
    });
  pinned("main", "s9-v3-app.json", 155);
  // The blind set of S9: its halves are pinned so that neither can drift, and never to be tuned to.
  pinned("holdout-dev", "s9-holdout-dev.json", 19);
  pinned("holdout-test", "s9-holdout-test.json", 20);
});

describe("the holdout set's own data", () => {
  it("has dishes that are not in the main set, labelled against known wines, and scenarios that use them", () => {
    const main = new Set(DISHES.map((d) => d.id));
    const mainNames = new Set(DISHES.map((d) => d.en.toLowerCase()));
    const holdout = cardsOf("holdout");
    expect(holdout.size).toBe(44);
    for (const d of holdout.values()) {
      expect(main.has(d.id), d.id).toBe(false);
      expect(mainNames.has(d.en.toLowerCase()), d.en).toBe(false);
      for (const key of [...d.good, ...d.ok]) expect(WINE_KEYS, `${d.id}: ${key}`).toContain(key);
      expect(
        d.good.filter((k) => d.ok.includes(k)),
        d.id,
      ).toEqual([]);
    }
    const scenarios = scenariosOf("holdout");
    expect(scenarios.length).toBe(88);
    expect(new Set(scenarios.map((s) => s.id)).size).toBe(88);
    for (const s of scenarios) {
      expect(holdout.has(s.dish!), s.id).toBe(true);
      expect(CELLARS[s.cellar], s.id).toBeDefined();
    }
    // The two halves are the whole, with no scenario in both.
    const dev = scenariosOf("holdout-dev").map((s) => s.id);
    const test = scenariosOf("holdout-test").map((s) => s.id);
    expect(dev.length + test.length).toBe(88);
    expect(dev.filter((id) => test.includes(id))).toEqual([]);
  });
});
