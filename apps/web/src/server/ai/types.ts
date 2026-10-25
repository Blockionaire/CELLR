import "server-only";

export type AiTask = "label_extraction" | "sommelier_chat" | "wine_insight" | "wine_valuation";

/** Which of the configured models a task uses: the one that sees pictures, or the one that talks. */
export type ModelKind = "vision" | "chat";

export interface AiImage {
  mime: "image/jpeg";
  bytes: Uint8Array;
}

export interface GenerateObjectRequest<T> {
  task: AiTask;
  model: ModelKind;
  /** Instructions: ours, versioned in server/ai/prompts. */
  system: string;
  /** The question or text to work on. Anything the person typed or a photo showed is data, never instructions. */
  user: string;
  images?: readonly AiImage[];
  /** The shape of the answer, as a strict JSON schema the model is held to. */
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  /** Checks the model's answer; throws when it is not what we asked for. */
  parse: (value: unknown) => T;
  maxOutputTokens: number;
  timeoutMs: number;
  /** Lower = the same question gets the same answer more often. Left to the model when absent. */
  temperature?: number;
  /** Let the model search the web first (for facts that change, like prices); the pages it opened come back. */
  webSearch?: boolean;
  /** With `webSearch`: at most this many searches (the budget holds this many; default 3). */
  maxSearches?: number;
}

export interface AiUsage {
  /** The model asked for (the configured id). */
  model: string;
  /** The model the provider says answered (often a dated snapshot), when it said so. */
  servedModel?: string;
  tokensIn: number;
  /** Of tokensIn, how many were served from the provider's prompt cache (billed cheaper). */
  tokensCachedIn?: number;
  tokensOut: number;
  /** Web searches the provider ran for this call. */
  webSearchCalls?: number;
  latencyMs: number;
  /**
   * True only when every request that was sent came back with the provider's usage numbers. A timeout, a
   * dropped connection or an error answer leaves it false: the cost is then unknown, not zero.
   */
  reported?: boolean;
  /** No request was made at all (the platform budget said no): a confirmed cost of 0. */
  notSent?: boolean;
  /** The platform budget's hold for this call, released when the usage is recorded. */
  budgetHold?: { id: string; estimateUsdMicro: number };
}

/** Why there is no answer. The caller picks the plain fallback; the person never sees a model's own words. */
export type AiErrorKind =
  | "unavailable" // no key, a refused key, a server error, or no network
  | "timeout"
  | "rate_limited" // the provider's limit, not ours
  | "refused" // the model declined to answer
  | "invalid" // the answer did not fit the shape, even after one repair
  | "budget"; // the platform-wide AI budget is used up (no request was made)

export type AiResult<T> =
  | {
      ok: true;
      value: T;
      usage: AiUsage;
      /** With `webSearch`: the addresses of the pages the search actually opened. */
      consulted?: string[];
    }
  | { ok: false; kind: AiErrorKind; usage: AiUsage };

export interface LlmProvider {
  generateObject<T>(request: GenerateObjectRequest<T>): Promise<AiResult<T>>;
}
