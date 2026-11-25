import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ENGINES } from "./engines";
import { buildFixture } from "./fixtures";
import { qualityRow } from "./quality";
import { scoreScenario } from "./score";
import { cardsOf, scenariosOf } from "./sets";
import type { ScenarioVector } from "./stats";
import type { VectorFile } from "./vectors";
import { vectorOf } from "./vectors";

/**
 * THE FALLBACK'S MEASUREMENT (V1+ P7). The engine runs the app's own fallback and, where it declines, the app's own
 * plain answer; these tests keep the recorded evidence in docs/sprints/sommelier-3-mega/results/p7-*.json true to
 * the code: a change to the engines or the fallback that moves a number fails here until it is measured again.
 */
const results = new URL("../../docs/sprints/sommelier-3-mega/results/", import.meta.url);
const read = <T>(name: string) => JSON.parse(readFileSync(new URL(name, results), "utf8")) as T;
const engine = (name: string) => ENGINES.find((e) => e.name === name)!;

async function vectorsOf(name: string, set: string) {
  const cards = cardsOf(set);
  const rows = new Map<string, ScenarioVector>();
  const answers = [];
  for (const s of scenariosOf(set)) {
    const { answer, ms } = await engine(name).run(s);
    answers.push(answer);
    const card = s.dish ? (cards.get(s.dish) ?? null) : null;
    const scored = scoreScenario(s, card, answer, ms);
    const keys = buildFixture(s).wines.map((w) => w.key);
    const row = qualityRow(s, card, answer, scored, keys);
    if (row) rows.set(s.id, vectorOf(row, scored, s.dish ? `dish:${s.dish}` : undefined));
  }
  return { rows, answers };
}

const totals = (rows: Iterable<ScenarioVector>) => {
  const t = { first: 0, noPoor: 0, useful: 0, offered: 0, poor: 0, good: 0 };
  for (const v of rows) for (const k of Object.keys(t) as Array<keyof typeof t>) t[k] += v[k];
  return t;
};

describe("the fallback engine (v1-fallback)", () => {
  it("is registered next to v1-basic, with its measured alternative", () => {
    const names = ENGINES.map((e) => e.name);
    expect(names).toEqual(expect.arrayContaining(["v1-basic", "v1-fallback", "v1-fallback-plain"]));
  });

  it.each(["main", "holdout-dev", "holdout-test"])(
    "never invents a wine and never gives buying advice or a price (%s)",
    async (set) => {
      const { answers } = await vectorsOf("v1-fallback", set);
      for (const a of answers) {
        expect(a.invented).toBe(0);
        expect(a.buy ?? []).toEqual([]);
      }
    },
  );

  it.each(["main", "holdout-dev"])(
    "reproduces the recorded per-scenario vectors of both engines (%s)",
    async (set) => {
      for (const name of ["v1-fallback", "v1-basic", "v1-fallback-plain"]) {
        const recorded = read<VectorFile>(`p7-vectors-${set}-${name}.json`);
        expect(recorded.keyed).toBe("id");
        expect(recorded.incomplete).toBe(false);
        const { rows } = await vectorsOf(name, set);
        // The recorded cluster is the dish key the run wrote; compared as the run writes it.
        expect(Object.fromEntries(rows)).toEqual(recorded.rows);
      }
    },
  );

  it("reproduces the blind set's recorded totals, without naming a scenario", async () => {
    const aggregate = read<{
      sets: Record<string, { totals: Record<string, ReturnType<typeof totals>> }>;
    }>("p7-fallback.json");
    for (const name of ["v1-fallback", "v1-basic"]) {
      const recorded = read<VectorFile>(`p7-vectors-holdout-test-${name}.json`);
      expect(recorded.keyed).toBe("salted-sha256");
      const { rows } = await vectorsOf(name, "holdout-test");
      expect(Object.keys(recorded.rows)).toHaveLength(rows.size);
      expect(totals(rows.values())).toEqual(totals(Object.values(recorded.rows)));
      expect(totals(rows.values())).toEqual(aggregate.sets["holdout-test"]!.totals[name]);
    }
  });
});
