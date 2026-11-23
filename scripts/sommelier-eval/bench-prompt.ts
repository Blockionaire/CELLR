/**
 * COST EFFECT OF THE V1+ PARTS (P8), free: what each part changes in the one model call V1 makes, counted with
 * the repo's own estimate code. Nothing is sent.
 *
 *   pnpm --filter @cellr/sommelier-eval run bench:prompt                  the tables (cellar of 120 wines, and 25 and 3,000)
 *   ... --json <file>                                                     also every number as JSON
 *
 * The app's own service (bench-harness.ts) builds the request for each question and configuration; a provider
 * that records it answers with the fake model's answer. Per request:
 *
 * - prompt characters: system + user message + JSON schema, as `estimating()` in paid.ts counts them (the schema is
 *   sent with every call);
 * - estimated input tokens: characters / 3, rounded up (paid.ts `estimating`, pricing.ts `estimateCost`);
 * - the output allowance after `planCall` (models.ts): 900 tokens, more for a new menu (`menuMaxOutputTokens`);
 * - the high estimate (`estimateCost`: input at ~3 characters a token plus the FULL output allowance, two
 *   attempts) and the reservation a paid run would hold (`reservationFor`), both in micro-dollars, priced with
 *   pricing.ts for the model the app is configured with (env.ts default: gpt-6-luna);
 * - the same with the output at a typical answer length instead of the allowance (`typicalOutputTokens`), to show
 *   which part of the high estimate is the allowance.
 *
 * The relative change is against V1 (prompt v6, no part) for the same question, conversation and cellar.
 */
import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { planCall } from "@/server/ai/models";
import { estimateCost, priceOf, PRICING_VERSION } from "@/server/ai/pricing";
import type { GenerateObjectRequest, LlmProvider } from "@/server/ai/types";
import { getAiEnv } from "@/server/env";
import { benchCellar, type BenchCellar } from "./bench-cellar";
import { benchService, CONFIGS, fakeModel, requestFor, type QuestionKind } from "./bench-harness";
import { reservationFor } from "./paid";

/** A plausible answer's length in output tokens (four sentences and three refs; a menu adds ~45 per course). */
export const TYPICAL_OUTPUT = { base: 180, perCourse: 45 } as const;

export const PROMPT_QUESTIONS: readonly QuestionKind[] = [
  "pairing",
  "serving",
  "pairing-guests",
  "menu-3",
  "menu-8",
  "compare",
];

export interface PromptRow {
  wines: number;
  question: QuestionKind;
  messages: 1 | 12;
  config: string;
  calls: number;
  systemChars: number;
  userChars: number;
  schemaChars: number;
  promptChars: number;
  inputTokens: number;
  maxOutputTokens: number;
  /** pricing.ts estimateCost: input + the full output allowance, two attempts. */
  highMicro: number;
  /** paid.ts reservationFor: what a paid run would hold back before the call. */
  reservationMicro: number;
  /** One attempt, input + a typical answer's output (not the allowance). */
  typicalMicro: number;
  /** Against V1 for the same question, conversation and cellar, in percent. */
  vsV1: { promptChars: number; inputTokens: number; highMicro: number; typicalMicro: number };
  /** The user message is V1's byte for byte. */
  userSameAsV1: boolean;
  systemSameAsV1: boolean;
  schemaSameAsV1: boolean;
}

const pct = (x: number, base: number) =>
  base === 0 ? 0 : Math.round((1000 * (x - base)) / base) / 10;

/** The requests the service sends for one question, one configuration and one cellar (one per `ask`). */
export async function requestsOf(
  cellar: BenchCellar,
  parts: string,
  question: QuestionKind,
  messages: 1 | 12,
): Promise<GenerateObjectRequest<unknown>[]> {
  const seen: GenerateObjectRequest<unknown>[] = [];
  const fake = fakeModel();
  const recording: LlmProvider = {
    generateObject: (request) => {
      seen.push(request as GenerateObjectRequest<unknown>);
      return fake.generateObject(request);
    },
  };
  const service = benchService(cellar, parts, { llm: true, provider: recording });
  await service.ask(requestFor(question, messages));
  return seen;
}

export async function promptRows(
  wines: number,
  messages: 1 | 12,
  questions: readonly QuestionKind[] = PROMPT_QUESTIONS,
): Promise<PromptRow[]> {
  const env = getAiEnv();
  const cellar = benchCellar(wines);
  const rows: PromptRow[] = [];
  for (const question of questions) {
    const measured = [];
    for (const c of CONFIGS) {
      const requests = await requestsOf(cellar, c.parts, question, messages);
      if (requests.length !== 1)
        throw new Error(`${c.name} / ${question}: ${requests.length} model calls, expected one`);
      const r = requests[0]!;
      const plan = planCall(env, r);
      const schema = JSON.stringify(r.jsonSchema);
      const promptChars = r.system.length + r.user.length + schema.length;
      const inputTokens = Math.ceil(promptChars / 3);
      const price = priceOf(plan.model);
      if (!price) throw new Error(`no price for ${plan.model}`);
      const courses = question === "menu-8" ? 8 : question === "menu-3" ? 3 : 0;
      const typicalOut =
        TYPICAL_OUTPUT.base + (r.maxOutputTokens > 900 ? courses * TYPICAL_OUTPUT.perCourse : 0);
      measured.push({
        config: c.name,
        r,
        schema,
        row: {
          calls: requests.length,
          systemChars: r.system.length,
          userChars: r.user.length,
          schemaChars: schema.length,
          promptChars,
          inputTokens,
          maxOutputTokens: plan.maxOutputTokens,
          highMicro: estimateCost({
            model: plan.model,
            promptChars,
            images: 0,
            maxOutputTokens: plan.maxOutputTokens,
            webSearch: false,
          }),
          reservationMicro: reservationFor(env, r),
          typicalMicro: Math.ceil(inputTokens * price.input + typicalOut * price.output),
        },
      });
    }
    const v1 = measured.find((m) => m.config === "V1")!;
    for (const m of measured)
      rows.push({
        wines: cellar.wines,
        question,
        messages,
        config: m.config,
        ...m.row,
        vsV1: {
          promptChars: pct(m.row.promptChars, v1.row.promptChars),
          inputTokens: pct(m.row.inputTokens, v1.row.inputTokens),
          highMicro: pct(m.row.highMicro, v1.row.highMicro),
          typicalMicro: pct(m.row.typicalMicro, v1.row.typicalMicro),
        },
        userSameAsV1: m.r.user === v1.r.user,
        systemSameAsV1: m.r.system === v1.r.system,
        schemaSameAsV1: m.schema === v1.schema,
      });
  }
  return rows;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values: args } = parseArgs({
    options: { sizes: { type: "string", default: "120,25,3000" }, json: { type: "string" } },
  });
  const env = getAiEnv();
  const all: PromptRow[] = [];
  for (const wines of args.sizes!.split(",").map(Number))
    for (const messages of [1, 12] as const) all.push(...(await promptRows(wines, messages)));
  const plan = planCall(env, { model: "chat", task: "sommelier_chat", maxOutputTokens: 900 });
  console.log(
    `Model ${plan.model} (pricing ${PRICING_VERSION}); nothing was sent. Δ is against V1 (prompt v6, no part), same question, conversation and cellar.\n`,
  );
  console.log(
    "| Wines | Msgs | Question | Configuration | prompt chars | est. tokens in | output cap | high est. µ$ | Δ chars | Δ tokens | Δ high est. | Δ typical | user = V1 | system = V1 |",
  );
  console.log(
    "| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |",
  );
  const sign = (x: number) => `${x > 0 ? "+" : ""}${x}%`;
  for (const r of all)
    console.log(
      `| ${r.wines} | ${r.messages} | ${r.question} | ${r.config} | ${r.promptChars} | ${r.inputTokens} | ${r.maxOutputTokens} | ${r.highMicro} | ${sign(r.vsV1.promptChars)} | ${sign(r.vsV1.inputTokens)} | ${sign(r.vsV1.highMicro)} | ${sign(r.vsV1.typicalMicro)} | ${r.userSameAsV1 ? "yes" : "no"} | ${r.systemSameAsV1 ? "yes" : "no"} |`,
    );
  if (args.json)
    await writeFile(
      args.json,
      JSON.stringify(
        {
          model: plan.model,
          pricingVersion: PRICING_VERSION,
          typicalOutput: TYPICAL_OUTPUT,
          rows: all,
        },
        null,
        2,
      ) + "\n",
    );
}
