import "server-only";
import { logError, logWarn } from "@/server/log";
import type { AiEnv } from "@/server/env";
import type { AiErrorKind, AiResult, AiUsage, GenerateObjectRequest, LlmProvider } from "./types";

type Message = { role: "system" | "user" | "assistant"; content: unknown };

interface ResponsesResponse {
  output?: Array<{
    type?: string;
    action?: { sources?: Array<{ url?: string }> };
    content?: Array<{ type?: string; text?: string; refusal?: string }>;
  }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

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

      // A question that needs today's facts goes through the Responses API with web search: one attempt (a
      // repair would search again and cost as much), the answer held to the same strict schema.
      if (request.webSearch) {
        let response: Response;
        try {
          response = await fetcher(`${env.baseUrl}/responses`, {
            method: "POST",
            headers: { authorization: `Bearer ${env.apiKey}`, "content-type": "application/json" },
            body: JSON.stringify({
              model,
              input: [
                { role: "system", content: request.system },
                { role: "user", content: request.user },
              ],
              tools: [{ type: "web_search" }],
              include: ["web_search_call.action.sources"],
              max_output_tokens: request.maxOutputTokens,
              ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
              text: {
                format: {
                  type: "json_schema",
                  name: request.schemaName,
                  strict: true,
                  schema: request.jsonSchema,
                },
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
          logWarn("ai_http_error", { status: response.status, task: request.task, model });
          return fail(response.status === 429 ? "rate_limited" : "unavailable");
        }
        let body: ResponsesResponse;
        try {
          body = (await response.json()) as ResponsesResponse;
        } catch {
          return fail("unavailable");
        }
        usage.tokensIn += body.usage?.input_tokens ?? 0;
        usage.tokensOut += body.usage?.output_tokens ?? 0;
        const items = body.output ?? [];
        const consulted = items.flatMap((o) =>
          o.type === "web_search_call"
            ? (o.action?.sources ?? []).flatMap((s) => (s.url ? [s.url] : []))
            : [],
        );
        const parts = items.flatMap((o) => (o.type === "message" ? (o.content ?? []) : []));
        if (parts.some((p) => p.type === "refusal")) return fail("refused");
        const text = parts.find((p) => p.type === "output_text")?.text ?? "";
        try {
          return done({ ok: true, value: request.parse(JSON.parse(text)), usage, consulted });
        } catch {
          logWarn("ai_invalid_output", { task: request.task, model });
          return fail("invalid");
        }
      }

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
              ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
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
