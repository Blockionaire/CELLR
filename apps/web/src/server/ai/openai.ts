import "server-only";
import { logError, logWarn } from "@/server/log";
import type { AiEnv } from "@/server/env";
import type { AiErrorKind, AiResult, AiUsage, GenerateObjectRequest, LlmProvider } from "./types";

type Message = { role: "system" | "user" | "assistant"; content: unknown };

interface ChatResponse {
  choices?: Array<{ message?: { content?: string | null; refusal?: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

/**
 * An OpenAI-compatible chat endpoint (the base address is configurable, so another host that speaks the same
 * protocol works too). The answer is held to a strict JSON schema, checked again by our own code, and given
 * one chance to repair itself; after that the caller gets a plain "no" and uses its fallback.
 */
export function createOpenAiProvider(
  env: AiEnv & { apiKey: string },
  fetcher: typeof fetch = fetch,
): LlmProvider {
  return {
    async generateObject<T>(request: GenerateObjectRequest<T>): Promise<AiResult<T>> {
      const model = request.model === "vision" ? env.visionModel : env.chatModel;
      const started = Date.now();
      const usage: AiUsage = { model, tokensIn: 0, tokensOut: 0, latencyMs: 0 };
      const done = <R extends AiResult<T>>(result: R): R => {
        usage.latencyMs = Date.now() - started;
        return result;
      };
      const fail = (kind: AiErrorKind): AiResult<T> => done({ ok: false, kind, usage });

      const messages: Message[] = [
        { role: "system", content: request.system },
        {
          role: "user",
          content: [
            { type: "text", text: request.user },
            ...(request.images ?? []).map((image) => ({
              type: "image_url",
              image_url: {
                url: `data:${image.mime};base64,${toBase64(image.bytes)}`,
                detail: "high",
              },
            })),
          ],
        },
      ];

      for (let attempt = 1; attempt <= 2; attempt++) {
        let response: Response;
        try {
          response = await fetcher(`${env.baseUrl}/chat/completions`, {
            method: "POST",
            headers: { authorization: `Bearer ${env.apiKey}`, "content-type": "application/json" },
            body: JSON.stringify({
              model,
              messages,
              max_completion_tokens: request.maxOutputTokens,
              response_format: {
                type: "json_schema",
                json_schema: { name: request.schemaName, strict: true, schema: request.jsonSchema },
              },
            }),
            signal: AbortSignal.timeout(request.timeoutMs),
          });
        } catch (error) {
          const timedOut =
            error instanceof Error &&
            (error.name === "TimeoutError" || error.name === "AbortError");
          if (!timedOut) logError("ai_request_failed", error);
          return fail(timedOut ? "timeout" : "unavailable");
        }

        if (!response.ok) {
          // The provider's own words stay in our log, without the key; the person gets a plain fallback.
          logWarn("ai_http_error", { status: response.status, task: request.task, model });
          return fail(response.status === 429 ? "rate_limited" : "unavailable");
        }

        let body: ChatResponse;
        try {
          body = (await response.json()) as ChatResponse;
        } catch {
          return fail("unavailable");
        }
        usage.tokensIn += body.usage?.prompt_tokens ?? 0;
        usage.tokensOut += body.usage?.completion_tokens ?? 0;
        const message = body.choices?.[0]?.message;
        if (message?.refusal) return fail("refused");
        const content = message?.content ?? "";

        try {
          return done({ ok: true, value: request.parse(JSON.parse(content)), usage });
        } catch (problem) {
          if (attempt === 2) {
            logWarn("ai_invalid_output", { task: request.task, model });
            return fail("invalid");
          }
          // One repair: show the model what was wrong with its own answer.
          messages.push(
            { role: "assistant", content },
            {
              role: "user",
              content: `That answer could not be used (${problem instanceof Error ? problem.message.slice(0, 300) : "invalid"}). Reply again with only the corrected JSON.`,
            },
          );
        }
      }
      return fail("invalid");
    },
  };
}
