/**
 * PAID MODEL CALLS IN THE BENCHMARK: OFF UNLESS THE OWNER SAID YES.
 *
 * The benchmark calls no model by default. One engine (`v1-ai`, Sommelier V1 with its AI) needs the paid model
 * to be measured at all. It can be run in two ways:
 *
 *   --estimate   No request leaves this machine. The prompts V1 would send are built by the app's own code and
 *                counted, and the cost is estimated high from the app's own price list.
 *   (for real)   Only with BOTH `SOMMELIER_EVAL_PAID=owner-approved` and a key in `OPENAI_API_KEY`, and only with
 *                a budget file (`--budget-file`, `--total-usd`) that holds the total for every run together.
 *                Before each call the most it can cost is reserved (`reservationFor`); a call whose
 *                reservation does not fit in what is left of the run's `--max-usd` AND of the total is never
 *                sent. So a run, and all runs together, stay under their limits by construction, as far as
 *                the reservation is an upper bound (see `reservationFor` for when it is not).
 *
 * What is sent when it runs for real: the app's own sommelier prompt, a made-up cellar from fixtures.ts and a
 * question written for the benchmark. No person's data, no conversation anyone had, no account identifier.
 */
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { planCall } from "@/server/ai/models";
import { costOf, estimateCost, priceOf } from "@/server/ai/pricing";
import type { AiResult, GenerateObjectRequest, LlmProvider } from "@/server/ai/types";
import type { AiEnv } from "@/server/env";

export const PAID_ENV = "SOMMELIER_EVAL_PAID";
export const PAID_PHRASE = "owner-approved";

/** Whether this run may spend money: the owner's phrase and a key, both. Anything else is a no. */
export const paidAllowed = (env: Record<string, string | undefined>): boolean =>
  env[PAID_ENV] === PAID_PHRASE && (env.OPENAI_API_KEY ?? "").trim() !== "";

export interface Meter {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  usdMicro: number;
  /** Calls whose cost the provider did not report (a timeout, an error): counted at a high estimate. */
  unknownCost: number;
  /** The models the provider said answered, when it said so. */
  servedModels: Set<string>;
  /** Micro-USD reserved for calls that were sent and have not answered yet. */
  reservedMicro: number;
  /** Calls that cost more than their reservation: the bound did not hold, and the run stopped at once. */
  overReservation: number;
  /** With --estimate: what a run for real would reserve, call by call, added up (the budget a run needs). */
  reservationsMicro: number;
  /**
   * The limit was reached. Set before the refusal is thrown, because a caller inside the app (the engines) turns
   * every failure of a model into "go on without it": the runner reads this flag to stop and say so.
   */
  stopped: boolean;
}
export const newMeter = (): Meter => ({
  calls: 0,
  inputTokens: 0,
  outputTokens: 0,
  usdMicro: 0,
  unknownCost: 0,
  reservedMicro: 0,
  overReservation: 0,
  reservationsMicro: 0,
  servedModels: new Set(),
  stopped: false,
});

export class BudgetReached extends Error {
  constructor(
    readonly usdMicro: number,
    readonly why: string = "the benchmark's own spending limit was reached",
  ) {
    super(`${why} at $${(usdMicro / 1e6).toFixed(4)}`);
    this.name = "BudgetReached";
  }
}

/** Extra input tokens a repair adds besides the model's first answer: the error message and the instruction. */
const REPAIR_OVERHEAD_TOKENS = 400;
/** Margin on top of the bound, for tokenisers that cut text finer than 2 characters a token. */
const RESERVATION_MARGIN = 1.25;

/**
 * The most one call can cost, held back before it is sent. Deliberately above `estimateCost` (which plans the
 * platform budget): every input character counts as half a token (estimateCost: a third), the provider's two
 * attempts each use the full output allowance, and the repair's prompt also carries the first answer and the
 * error. Long-prompt rates apply whenever the input could reach them. Then 25% on top.
 *
 * It is an upper bound only for the model the app planned and priced. It is NOT one when the provider answers
 * with a dearer model than asked for, or bills differently from the price list in pricing.ts (a price change, a
 * charge the list does not know). The meter therefore records the cost the provider reports for every call, and a
 * call that cost more than its reservation stops the run at once (`overReservation`).
 *
 * Refuses, by throwing, what it cannot bound: a model without a price, and a web-search call (the eval makes none).
 */
export function reservationFor(
  env: Pick<AiEnv, "visionModel" | "chatModel" | "adviceModel" | "reasoningEffort">,
  request: GenerateObjectRequest<unknown>,
): number {
  if (request.webSearch)
    throw new Error("reservationFor: a web-search call cannot be bounded here");
  const plan = planCall(env, request);
  const price = priceOf(plan.model);
  if (!price) throw new Error(`reservationFor: no price for "${plan.model}"`);
  const promptChars =
    request.system.length + request.user.length + JSON.stringify(request.jsonSchema).length;
  const out = plan.maxOutputTokens;
  const first = Math.ceil(promptChars / 2);
  const repair = first + out + REPAIR_OVERHEAD_TOKENS;
  const attempt = (tokensIn: number) => {
    const long =
      price.longPrompt && tokensIn > price.longPrompt.aboveTokensIn ? price.longPrompt : null;
    return tokensIn * price.input * (long?.input ?? 1) + out * price.output * (long?.output ?? 1);
  };
  return Math.ceil((attempt(first) + attempt(repair)) * RESERVATION_MARGIN);
}

/**
 * The total budget over several runs, kept in a JSON file outside the repository. Each reservation is written
 * there BEFORE its call is sent and settled after it, so a run that dies mid-call leaves its reservation counted
 * (fail closed: the owner clears it by hand, after checking the provider's own usage page). A file that cannot
 * be read, or that was written for another total, is refused, never repaired.
 */
export interface LedgerRun {
  id: string;
  startedAt: string;
  endedAt: string | null;
  calls: number;
  spentMicro: number;
  /** False until the run ended with every scenario answered; a stopped or crashed run stays false. */
  complete: boolean;
}
export interface LedgerFile {
  version: 1;
  limitMicro: number;
  spentMicro: number;
  pendingMicro: number;
  runs: LedgerRun[];
}

const REPO_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));

function insideRepository(path: string): boolean {
  const dir = dirname(resolve(path));
  const real = existsSync(dir) ? realpathSync(dir) : dir;
  const rel = relative(realpathSync(REPO_ROOT), real);
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith(sep) && rel !== "..");
}

export class Ledger {
  private constructor(
    readonly path: string,
    private data: LedgerFile,
    readonly run: LedgerRun,
  ) {}

  /** Opens (or creates) the budget file for `limitMicro` in total, and starts a run in it. */
  static open(path: string, limitMicro: number, now: Date = new Date()): Ledger {
    if (!Number.isInteger(limitMicro) || limitMicro <= 0)
      throw new Error("the total budget must be a positive amount");
    if (insideRepository(path))
      throw new Error(`the budget file must be outside the repository (${path})`);
    let data: LedgerFile;
    if (existsSync(path)) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(readFileSync(path, "utf8"));
      } catch {
        throw new Error(`the budget file ${path} cannot be read: refusing to spend`);
      }
      const f = parsed as Partial<LedgerFile>;
      const num = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0;
      if (
        f.version !== 1 ||
        !num(f.limitMicro) ||
        !num(f.spentMicro) ||
        !num(f.pendingMicro) ||
        !Array.isArray(f.runs)
      )
        throw new Error(`the budget file ${path} is not one this tool wrote: refusing to spend`);
      if (f.limitMicro !== limitMicro)
        throw new Error(
          `the budget file ${path} holds a total of $${(f.limitMicro! / 1e6).toFixed(2)}, not $${(limitMicro / 1e6).toFixed(2)}: refusing to change it`,
        );
      data = f as LedgerFile;
    } else {
      mkdirSync(dirname(resolve(path)), { recursive: true });
      data = { version: 1, limitMicro, spentMicro: 0, pendingMicro: 0, runs: [] };
    }
    const run: LedgerRun = {
      id: randomUUID(),
      startedAt: now.toISOString(),
      endedAt: null,
      calls: 0,
      spentMicro: 0,
      complete: false,
    };
    data.runs.push(run);
    const ledger = new Ledger(path, data, run);
    ledger.write();
    return ledger;
  }

  /** What is left of the total: neither spent nor held back for a call in flight (or one a crash left). */
  remainingMicro(): number {
    return this.data.limitMicro - this.data.spentMicro - this.data.pendingMicro;
  }

  spentMicro(): number {
    return this.data.spentMicro;
  }

  reserve(micro: number): void {
    this.data.pendingMicro += micro;
    this.write();
  }

  settle(reservedMicro: number, actualMicro: number): void {
    this.data.pendingMicro = Math.max(0, this.data.pendingMicro - reservedMicro);
    this.data.spentMicro += actualMicro;
    this.run.calls += 1;
    this.run.spentMicro += actualMicro;
    this.write();
  }

  end(complete: boolean, now: Date = new Date()): void {
    this.run.endedAt = now.toISOString();
    this.run.complete = complete;
    this.write();
  }

  private write(): void {
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2) + "\n");
    renameSync(tmp, this.path);
  }
}

/**
 * A provider that spends only within its limits. Before a call it reserves the most the call can cost
 * (`reserve`); the call is sent only if that fits in what is left of this run's limit and, with a ledger, of the
 * total over all runs. After the call the reservation is replaced by what the provider reported (an unreported
 * cost counts as the reservation: unknown is never free). A call that cost more than its reservation stops the run.
 */
export function metered(
  inner: LlmProvider,
  meter: Meter,
  maxUsdMicro: number,
  guard: { reserve: (request: GenerateObjectRequest<unknown>) => number; ledger?: Ledger | null },
): LlmProvider {
  return {
    async generateObject<T>(request: GenerateObjectRequest<T>): Promise<AiResult<T>> {
      if (meter.stopped) throw new BudgetReached(meter.usdMicro, "the run was already stopped");
      let reserved: number;
      try {
        reserved = guard.reserve(request as GenerateObjectRequest<unknown>);
      } catch (error) {
        meter.stopped = true;
        throw new BudgetReached(meter.usdMicro, (error as Error).message);
      }
      const runLeft = maxUsdMicro - meter.usdMicro - meter.reservedMicro;
      const totalLeft = guard.ledger ? guard.ledger.remainingMicro() : Infinity;
      if (reserved > runLeft || reserved > totalLeft) {
        meter.stopped = true;
        throw new BudgetReached(
          meter.usdMicro,
          reserved > runLeft
            ? "the next call could pass this run's limit (--max-usd)"
            : "the next call could pass the total budget (--total-usd)",
        );
      }
      meter.reservedMicro += reserved;
      guard.ledger?.reserve(reserved);
      let result: AiResult<T>;
      try {
        result = await inner.generateObject(request);
      } catch (error) {
        // Nothing reported: the whole reservation counts as spent.
        meter.reservedMicro -= reserved;
        meter.calls += 1;
        meter.unknownCost += 1;
        meter.usdMicro += reserved;
        guard.ledger?.settle(reserved, reserved);
        throw error;
      }
      meter.reservedMicro -= reserved;
      meter.calls += 1;
      meter.inputTokens += result.usage.tokensIn;
      meter.outputTokens += result.usage.tokensOut;
      const reported = costOf(result.usage).usdMicro;
      let cost: number;
      if (reported === null) {
        // The provider did not say what this call used (a timeout, an error): it counts at its reservation.
        meter.unknownCost += 1;
        cost = reserved;
      } else cost = reported;
      meter.usdMicro += cost;
      guard.ledger?.settle(reserved, cost);
      if (cost > reserved) {
        meter.overReservation += 1;
        meter.stopped = true;
      }
      if (result.usage.servedModel) meter.servedModels.add(result.usage.servedModel);
      return result;
    },
  };
}

/**
 * A provider that sends nothing: it counts the prompt the app built and what the call could cost at most (the
 * app's own high estimate: ~3 characters a token, the full output allowance, one repair), then answers "no AI"
 * so the caller falls back, exactly as it does without a key.
 */
export function estimating(
  env: Pick<AiEnv, "visionModel" | "chatModel" | "adviceModel" | "reasoningEffort">,
  meter: Meter,
): LlmProvider {
  return {
    async generateObject<T>(request: GenerateObjectRequest<T>): Promise<AiResult<T>> {
      const plan = planCall(env, request);
      // The schema is sent with every call and counts as input too (for the dish reading it is the larger part).
      const promptChars =
        request.system.length + request.user.length + JSON.stringify(request.jsonSchema).length;
      meter.calls += 1;
      meter.inputTokens += Math.ceil(promptChars / 3);
      meter.outputTokens += plan.maxOutputTokens;
      meter.usdMicro += estimateCost({
        model: plan.model,
        promptChars,
        images: 0,
        maxOutputTokens: plan.maxOutputTokens,
        webSearch: false,
      });
      meter.reservationsMicro += reservationFor(env, request as GenerateObjectRequest<unknown>);
      return {
        ok: false,
        kind: "unavailable",
        usage: { model: plan.model, tokensIn: 0, tokensOut: 0, latencyMs: 0, notSent: true },
      };
    },
  };
}
