/**
 * THE FALLBACK AS THE SERVICE WIRES IT (P8). The `v1-fallback` engine (engines/v1-fallback.ts) calls the fallback
 * directly and gives the question to the service with `llm: null` when it declines. In the integrated build the
 * service asks the fallback itself (`deps.parts` names `fallback`, `deps.fallback` is set: server/services.ts).
 * This plays every scenario of a set both ways, turn by turn with the plan's state sent back, and counts the
 * scenarios whose last answer differs (its cards, its plan's picks, outcome and question back, its counted facts).
 * Names no scenario.
 *
 *   pnpm --filter @cellr/sommelier-eval exec tsx --conditions=react-server fallback-wired.ts <set>
 */
import {
  parseSommelierParts,
  wantsSomethingDifferent,
  type AskSommelier,
  type CellarItem,
  type CellarView,
  type Reservation,
  type SommelierAnswer,
} from "@cellr/domain";
import { aggregateInventory, buildTonight } from "@/server/cellar/service";
import { createSommelierIntelligence } from "@/server/sommelier/intelligence";
import { createSommelierFallback } from "@/server/sommelier/parts/fallback";
import { createSommelierService, type SommelierDeps } from "@/server/sommelier/service";
import { profileOf } from "./engines/v3-app";
import { buildFixture, NOW } from "./fixtures";
import { scenariosOf } from "./sets";
import type { Scenario } from "./types";

const shape = (a: SommelierAnswer) =>
  JSON.stringify({
    picks: a.plan ? a.plan.picks.map((p) => p.vintageId) : null,
    outcome: a.plan?.outcome ?? null,
    ask: a.plan?.ask ?? null,
    bottles: a.bottles.map((b) => b.vintageId),
    basic: a.basic,
    facts: a.facts ?? null,
    reason: a.reason,
  });

async function bothWays(scenario: Scenario): Promise<boolean> {
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
  const cellar = async (): Promise<CellarView> => {
    const view = aggregateInventory(fixture.rows, favorites, scores, NOW);
    return {
      ...view,
      items: view.items.map((i): CellarItem => ({
        ...i,
        reserved: reservedOf.get(i.vintageId) ?? null,
      })),
    };
  };
  const profiles = new Map(
    fixture.wines.filter((f) => f.profiled).map((f) => [f.vintageId, profileOf(f)]),
  );
  const fallback = () =>
    createSommelierFallback({
      intelligence: createSommelierIntelligence({
        cellar,
        profiles: async () => profiles,
        taste: async () => null,
        offers: null,
        buying: false,
        now: () => NOW,
      }),
      spend: async () => {},
    });
  const deps: SommelierDeps = {
    cellar,
    storage: async () => [],
    racks: async () => ({ units: [], unplaced: [] }),
    tonight: async (request, taste) => {
      const view = buildTonight(fixture.rows, favorites, scores, request, NOW, taste ?? null);
      return {
        ...view,
        picks: view.picks.map((p) => ({ ...p, reserved: reservedOf.get(p.vintageId) ?? null })),
      };
    },
    llm: null,
    spend: async () => {},
    householdId: async () => "00000000-0000-4000-8000-0000000000aa",
    locale: async () => scenario.lang,
    recordUsage: async () => {},
  };
  const plain = createSommelierService(deps);
  const direct = fallback();
  const wired = createSommelierService({
    ...deps,
    parts: parseSommelierParts("fallback"),
    fallback: fallback(),
  });
  const play = async (
    ask: (request: AskSommelier, question: string) => Promise<SommelierAnswer>,
  ) => {
    let state: unknown = undefined;
    let answer: SommelierAnswer | null = null;
    const said: Array<{ role: "user" | "assistant"; text: string }> = [];
    for (const turn of scenario.turns) {
      const question = turn.user.slice(0, 800);
      said.push({ role: "user", text: question });
      answer = await ask(
        {
          messages: said.slice(-12),
          mode: "chat",
          state,
          ...(turn.budgetEuros === undefined ? {} : { budgetEuros: turn.budgetEuros }),
        },
        question,
      );
      state = answer.plan?.state;
      said.push({ role: "assistant", text: "…" });
    }
    return answer!;
  };
  // As engines/v1-fallback.ts asks it.
  const a = await play(
    async (request, question) =>
      (await direct({
        request,
        items: (await cellar()).items,
        reason: "ai-off",
        personal: !wantsSomethingDifferent(question),
        locale: scenario.lang,
      })) ?? plain.ask(request),
  );
  const b = await play((request) => wired.ask(request));
  return shape(a) === shape(b);
}

export async function wiredAgainstEngine(set: string) {
  let same = 0;
  let different = 0;
  for (const s of scenariosOf(set)) {
    if (await bothWays(s)) same += 1;
    else different += 1;
  }
  return { set, scenarios: same + different, same, different };
}

if (import.meta.url === `file://${process.argv[1]}`)
  console.log(JSON.stringify(await wiredAgainstEngine(process.argv[2] ?? "main")));
