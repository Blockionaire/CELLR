/**
 * LATENCY OVERHEAD OF THE V1+ PARTS (P8), free: no model, no network, no key.
 *
 *   pnpm --filter @cellr/sommelier-eval run bench:latency                      the full run (about 45 minutes on 4 shared cores)
 *   pnpm --filter @cellr/sommelier-eval run bench:latency --sizes 25 --iterations 20    a quick look
 *   ... --json <file>                                                          also write every number as JSON
 *
 * Runs the app's own `createSommelierService` (bench-harness.ts) with a fake model that answers at once, over
 * generated cellars (bench-cellar.ts) of 25, 120, 500 and 3,000 wines, for three questions (a pairing with a guest
 * count, a three-course menu, a serving question naming a wine) in conversations of 1 and 12 messages. Per cell it
 * measures the wall clock of one `ask` for V1 (no part), each part alone, all five, and the path with no model with
 * and without `fallback`. The configurations run interleaved, round by round in a rotating order, after a warm-up,
 * so a slow moment of a shared machine falls on all of them alike.
 *
 * What it is: the time the app's own code adds. What it is not: the model's time (the fake answers in no time; a
 * real call takes seconds), the database reads (in-memory here; the parts add at most one profiles read, counted
 * per ask in `profileReadsPerAsk`), or a quiet machine.
 */
import { cpus, loadavg } from "node:os";
import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { cellarDigest, checkAnswerClaims, toSommelierBottle } from "@cellr/domain";
import { servingFactsBlock } from "@cellr/domain/intelligence";
import { benchCellar } from "./bench-cellar";
import {
  benchService,
  CONFIGS,
  messagesFor,
  percentile,
  requestFor,
  type BenchService,
  type QuestionKind,
} from "./bench-harness";
import { NOW } from "./fixtures";

export interface Cell {
  wines: number;
  question: QuestionKind;
  messages: 1 | 12;
  config: string;
  /** Against which configuration the difference is taken. */
  against: string;
  p50: number;
  p95: number;
  max: number;
  mean: number;
  deltaP50: number;
  deltaP95: number;
  profileReadsPerAsk: number;
  modelCallsPerAsk: number;
}

const round2 = (x: number) => Math.round(x * 100) / 100;

export function stats(times: number[]) {
  const sorted = [...times].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted.at(-1) ?? 0,
    mean: sorted.reduce((a, b) => a + b, 0) / Math.max(1, sorted.length),
  };
}

/** One cell: every configuration, warmed up, then measured round by round in a rotating order. */
export async function measureCell(
  wines: number,
  question: QuestionKind,
  messages: 1 | 12,
  options: { iterations: number; warmup: number },
): Promise<Cell[]> {
  const cellar = benchCellar(wines);
  const runs: Array<{ name: string; against: string; service: BenchService; times: number[] }> = [
    ...CONFIGS.map((c) => ({
      name: c.name,
      against: "V1",
      service: benchService(cellar, c.parts, { llm: true }),
      times: [] as number[],
    })),
    {
      name: "V1 (no model)",
      against: "V1 (no model)",
      service: benchService(cellar, "", { llm: false }),
      times: [],
    },
    {
      name: "fallback (no model)",
      against: "V1 (no model)",
      service: benchService(cellar, "fallback", { llm: false }),
      times: [],
    },
  ];
  const request = requestFor(question, messages);
  for (let w = 0; w < options.warmup; w++) for (const r of runs) await r.service.ask(request);
  const readsBefore = runs.map((r) => r.service.counts.profileReads);
  const callsBefore = runs.map((r) => r.service.counts.modelCalls());
  for (let i = 0; i < options.iterations; i++)
    for (let k = 0; k < runs.length; k++) {
      const r = runs[(i + k) % runs.length]!;
      const started = performance.now();
      await r.service.ask(request);
      r.times.push(performance.now() - started);
    }
  const byName = new Map(runs.map((r) => [r.name, stats(r.times)]));
  return runs.map((r, k) => {
    const s = byName.get(r.name)!;
    const base = byName.get(r.against)!;
    return {
      wines: cellar.wines,
      question,
      messages,
      config: r.name,
      against: r.against,
      p50: round2(s.p50),
      p95: round2(s.p95),
      max: round2(s.max),
      mean: round2(s.mean),
      deltaP50: round2(s.p50 - base.p50),
      deltaP95: round2(s.p95 - base.p95),
      profileReadsPerAsk: round2(
        (r.service.counts.profileReads - readsBefore[k]!) / options.iterations,
      ),
      modelCallsPerAsk: round2(
        (r.service.counts.modelCalls() - callsBefore[k]!) / options.iterations,
      ),
    };
  });
}

/**
 * Where the time goes: the pieces of pure code whose cost grows with the cellar, timed alone (warm). `check` runs
 * `checkAnswerClaims` once for the answer and once more for each course's reason of a menu; `annotate` runs the
 * serving facts over the whole cellar to find the wine a serving question names.
 */
export function components(wines: number, iterations: number) {
  const cellar = benchCellar(wines);
  const items = cellar.view.items;
  const question = "Roast lamb with rosemary and garlic tonight. Which bottle should I open?";
  const digest = cellarDigest(items, question);
  const refs = [...digest.refs.keys()].slice(0, 3);
  const text = `For the lamb I would open [[${refs[0]}]]: its firm tannins and dark fruit stand up to the rosemary and the fat of the meat. [[${refs[1]}]] is a softer alternative, and [[${refs[2]}]] works if you prefer something lighter.`;
  const bottles = refs.map((r) => digest.refs.get(r)!);
  const time = (fn: () => unknown) => {
    for (let i = 0; i < Math.min(10, iterations); i++) fn();
    const times: number[] = [];
    for (let i = 0; i < iterations; i++) {
      const started = performance.now();
      fn();
      times.push(performance.now() - started);
    }
    const s = stats(times);
    return { p50: round2(s.p50), p95: round2(s.p95), max: round2(s.max) };
  };
  return {
    wines: cellar.wines,
    cellarDigest: time(() => cellarDigest(items, question)),
    checkAnswerClaims: time(() =>
      checkAnswerClaims({
        text,
        bottles: bottles.map(toSommelierBottle),
        buy: [],
        digest,
        items,
        budget: null,
        facts: null,
        now: NOW,
      }),
    ),
    servingFactsBlockWholeCellar: time(() =>
      servingFactsBlock(messagesFor("serving", 1), items, () => null, {
        profiles: new Map(),
        now: NOW,
      }),
    ),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values: args } = parseArgs({
    options: {
      sizes: { type: "string", default: "25,120,500,3000" },
      iterations: { type: "string", default: "200" },
      warmup: { type: "string", default: "20" },
      json: { type: "string" },
    },
  });
  const sizes = args.sizes!.split(",").map(Number);
  const iterations = Number(args.iterations);
  const warmup = Number(args.warmup);
  const startedAt = new Date().toISOString();
  const loadBefore = loadavg();
  const cells: Cell[] = [];
  const parts: Array<ReturnType<typeof components>> = [];
  const t0 = performance.now();
  for (const wines of sizes) {
    parts.push(components(wines, iterations));
    for (const question of ["pairing-guests", "menu-3", "serving"] as const)
      for (const messages of [1, 12] as const) {
        const rows = await measureCell(wines, question, messages, { iterations, warmup });
        cells.push(...rows);
        console.error(
          `${wines} wines, ${question}, ${messages} msg: ${rows.map((r) => `${r.config} p95 ${r.p95}`).join(" | ")}`,
        );
      }
  }
  const header =
    "| Wines | Question | Msgs | Configuration | p50 ms | p95 ms | max ms | Δp50 | Δp95 | profile reads/ask |";
  console.log(header);
  console.log(
    "|" +
      header
        .split("|")
        .slice(1, -1)
        .map(() => " --- ")
        .join("|") +
      "|",
  );
  for (const c of cells)
    console.log(
      `| ${c.wines} | ${c.question} | ${c.messages} | ${c.config} | ${c.p50} | ${c.p95} | ${c.max} | ${c.deltaP50} | ${c.deltaP95} | ${c.profileReadsPerAsk} |`,
    );
  const worst = Object.fromEntries(
    [...new Set(cells.map((c) => c.config))].map((name) => {
      const mine = cells.filter((c) => c.config === name);
      const w = mine.reduce((a, b) => (b.deltaP95 > a.deltaP95 ? b : a));
      return [
        name,
        {
          worstDeltaP95: w.deltaP95,
          at: { wines: w.wines, question: w.question, messages: w.messages },
        },
      ];
    }),
  );
  console.log("\nWorst Δp95 per configuration (against V1, or V1 without a model):");
  for (const [name, w] of Object.entries(worst))
    console.log(
      `  ${name.padEnd(20)} ${w.worstDeltaP95} ms at ${w.at.wines} wines, ${w.at.question}, ${w.at.messages} msg`,
    );
  if (args.json)
    await writeFile(
      args.json,
      JSON.stringify(
        {
          machine: {
            cpus: cpus().length,
            cpu: cpus()[0]?.model ?? null,
            node: process.version,
            shared: true,
            loadAverageBefore: loadBefore.map(round2),
            loadAverageAfter: loadavg().map(round2),
          },
          startedAt,
          seconds: Math.round((performance.now() - t0) / 1000),
          iterations,
          warmup,
          cells,
          worst,
          components: parts,
        },
        null,
        2,
      ) + "\n",
    );
}
