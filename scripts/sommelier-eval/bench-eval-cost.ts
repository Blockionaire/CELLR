/**
 * COST PER ANSWER OVER AN EVAL SET, WITH AND WITHOUT THE V1+ PARTS (P8), free: nothing is sent.
 *
 *   pnpm --filter @cellr/sommelier-eval run bench:eval-cost [--json <file>]
 *
 * The gate measures cost "on the eval run". `pnpm sommelier:eval --engine v1-ai --estimate` counts V1 (no part);
 * this asks the same scenarios (those V1 can attempt: needs within pairing and facts) through the app's own
 * service with each configuration of parts, turn by turn as `v1-ai` asks them, with paid.ts `estimating()` as the
 * model (it counts the prompt, estimates high, and answers "no AI"). Reported in totals per set (a blind set is
 * never listed scenario by scenario).
 */
import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { parseSommelierParts, type CellarItem, type Reservation } from "@cellr/domain";
import { aggregateInventory, buildTonight } from "@/server/cellar/service";
import { getAiEnv } from "@/server/env";
import { createSommelierService } from "@/server/sommelier/service";
import { profileOf } from "./engines/v3-app";
import { buildFixture, NOW } from "./fixtures";
import { estimating, newMeter } from "./paid";
import { scenariosOf } from "./sets";

export const EVAL_COST_CONFIGS = [
  { name: "V1", parts: "" },
  { name: "check", parts: "check" },
  { name: "annotate", parts: "annotate" },
  { name: "quantities", parts: "quantities" },
  { name: "menu", parts: "menu" },
  { name: "all (no fallback: it adds no call)", parts: "check,annotate,quantities,menu" },
] as const;

export async function evalSetCost(set: string, parts: string) {
  const env = getAiEnv();
  const meter = newMeter();
  const llm = estimating(env, meter);
  let promptChars = 0;
  const counting: typeof llm = {
    generateObject: (request) => {
      promptChars +=
        request.system.length + request.user.length + JSON.stringify(request.jsonSchema).length;
      return llm.generateObject(request);
    },
  };
  const scenarios = scenariosOf(set).filter((s) =>
    s.needs.every((n) => n === "pairing" || n === "facts"),
  );
  let turns = 0;
  for (const scenario of scenarios) {
    const fixture = buildFixture(scenario);
    const favorites = new Set(fixture.wines.filter((f) => f.favorite).map((f) => f.wineId));
    const scores = fixture.wines
      .filter((f) => f.rating !== null)
      .map((f) => ({ vintageId: f.vintageId, score: f.rating! }));
    const reservedOf = new Map<string, Reservation>(
      fixture.wines
        .filter((f) => f.reserved > 0)
        .map((f) => [f.vintageId, { count: f.reserved, title: "Benchmark occasion", on: null }]),
    );
    const profiles = new Map(
      fixture.wines.filter((f) => f.profiled).map((f) => [f.vintageId, profileOf(f)]),
    );
    const service = createSommelierService({
      cellar: async () => {
        const view = aggregateInventory(fixture.rows, favorites, scores, NOW);
        return {
          ...view,
          items: view.items.map((i): CellarItem => ({
            ...i,
            reserved: reservedOf.get(i.vintageId) ?? null,
          })),
        };
      },
      storage: async () => [],
      racks: async () => ({ units: [], unplaced: [] }),
      tonight: async (request, taste) =>
        buildTonight(fixture.rows, favorites, scores, request, NOW, taste ?? null),
      llm: counting,
      parts: parseSommelierParts(parts),
      profiles: async (ids) =>
        new Map(ids.flatMap((id) => (profiles.has(id) ? [[id, profiles.get(id)!]] : []))),
      now: () => NOW,
      spend: async () => {},
      householdId: async () => "00000000-0000-4000-8000-0000000000aa",
      locale: async () => scenario.lang,
      recordUsage: async () => {},
    });
    const said: Array<{ role: "user" | "assistant"; text: string }> = [];
    for (const turn of scenario.turns) {
      turns += 1;
      said.push({ role: "user", text: turn.user.slice(0, 800) });
      const answer = await service.ask({ messages: said.slice(-12), mode: "chat" });
      said.push({ role: "assistant", text: (answer.text ?? "…").slice(0, 2000) });
    }
  }
  return {
    set,
    parts: parts === "" ? "(none: V1)" : parts,
    scenarios: scenarios.length,
    turns,
    calls: meter.calls,
    promptChars,
    inputTokens: meter.inputTokens,
    outputTokensAllowance: meter.outputTokens,
    highEstimateMicro: meter.usdMicro,
    reservedMicro: meter.reservationsMicro,
    highPerCallMicro: meter.calls === 0 ? 0 : Math.round(meter.usdMicro / meter.calls),
  };
}

export async function evalCostTable(
  sets: readonly string[] = ["main", "holdout-dev", "holdout-test"],
) {
  const rows = [];
  for (const set of sets) {
    const v1 = await evalSetCost(set, "");
    for (const c of EVAL_COST_CONFIGS) {
      const r = c.parts === "" ? v1 : await evalSetCost(set, c.parts);
      const pct = (x: number, b: number) => Math.round((1000 * (x - b)) / b) / 10;
      rows.push({
        config: c.name,
        ...r,
        vsV1: {
          promptChars: pct(r.promptChars, v1.promptChars),
          highEstimate: pct(r.highEstimateMicro, v1.highEstimateMicro),
        },
      });
    }
  }
  return rows;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values: args } = parseArgs({ options: { json: { type: "string" } } });
  const rows = await evalCostTable();
  console.log("ESTIMATE ONLY, nothing was sent.");
  console.log(
    "| Set | Configuration | Calls | Prompt chars | Tokens in | High estimate | Δ chars | Δ high estimate |",
  );
  console.log("| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const r of rows)
    console.log(
      `| ${r.set} | ${r.config} | ${r.calls} | ${r.promptChars} | ${r.inputTokens} | $${(r.highEstimateMicro / 1e6).toFixed(4)} | ${r.vsV1.promptChars}% | ${r.vsV1.highEstimate}% |`,
    );
  if (args.json) await writeFile(args.json, JSON.stringify({ rows }, null, 2) + "\n");
}
