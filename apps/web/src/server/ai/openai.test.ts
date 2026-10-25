import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createOpenAiProvider } from "./openai";
import type { GenerateObjectRequest } from "./types";

const env = {
  apiKey: "sk-test-secret",
  baseUrl: "https://ai.example/v1",
  visionModel: "vision-model",
  chatModel: "chat-model",
  adviceModel: "chat-model",
  reasoningEffort: "none" as const,
};
const Answer = z.object({ producer: z.string() });
const request = (
  over: Partial<GenerateObjectRequest<{ producer: string }>> = {},
): GenerateObjectRequest<{ producer: string }> => ({
  task: "label_extraction",
  model: "vision",
  system: "Read the label.",
  user: "Go.",
  images: [{ mime: "image/jpeg", bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]) }],
  schemaName: "answer",
  jsonSchema: { type: "object" },
  parse: (v) => Answer.parse(v),
  maxOutputTokens: 500,
  timeoutMs: 1000,
  ...over,
});

const reply = (content: unknown, extra: Record<string, unknown> = {}) =>
  new Response(
    JSON.stringify({
      choices: [
        { message: { content: typeof content === "string" ? content : JSON.stringify(content) } },
      ],
      usage: { prompt_tokens: 900, completion_tokens: 60 },
      ...extra,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

function fakeFetch(...responses: Array<Response | Error>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error("no more responses");
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

describe("asking the model", () => {
  it("sends a strict, schema-held request with the picture, and returns the checked answer", async () => {
    const { fetcher, calls } = fakeFetch(reply({ producer: "Château Margaux" }));
    const result = await createOpenAiProvider(env, fetcher).generateObject(request());
    expect(result).toMatchObject({
      ok: true,
      value: { producer: "Château Margaux" },
      usage: { model: "vision-model", tokensIn: 900, tokensOut: 60 },
    });
    const [call] = calls;
    expect(call!.url).toBe("https://ai.example/v1/chat/completions");
    expect((call!.init.headers as Record<string, string>).authorization).toBe(
      "Bearer sk-test-secret",
    );
    const body = JSON.parse(String(call!.init.body));
    expect(body.model).toBe("vision-model");
    expect(body.max_completion_tokens).toBe(500);
    expect(body.response_format).toEqual({
      type: "json_schema",
      json_schema: { name: "answer", strict: true, schema: { type: "object" } },
    });
    const [system, user] = body.messages;
    expect(system).toEqual({ role: "system", content: "Read the label." });
    expect(user.content[1].image_url.url).toBe("data:image/jpeg;base64,/9j/2Q==");
  });

  it("uses the talking model for chat tasks, and sends no picture when there is none", async () => {
    const { fetcher, calls } = fakeFetch(reply({ producer: "x" }));
    await createOpenAiProvider(env, fetcher).generateObject(request({ model: "chat", images: [] }));
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body.model).toBe("chat-model");
    expect(body.messages[1].content).toHaveLength(1);
  });

  it("gives an answer that does not fit one chance to correct itself", async () => {
    const { fetcher, calls } = fakeFetch(reply({ producer: 42 }), reply({ producer: "Bollinger" }));
    const result = await createOpenAiProvider(env, fetcher).generateObject(request());
    expect(result).toMatchObject({
      ok: true,
      value: { producer: "Bollinger" },
      usage: { tokensIn: 1800 },
    });
    const second = JSON.parse(String(calls[1]!.init.body)).messages;
    expect(second.at(-2)).toEqual({ role: "assistant", content: '{"producer":42}' });
    expect(second.at(-1).content).toContain("could not be used");
  });

  it("then gives up: an answer that stays wrong is not 'best effort' parsed", async () => {
    const { fetcher, calls } = fakeFetch(reply("not json"), reply({ nope: true }));
    const result = await createOpenAiProvider(env, fetcher).generateObject(request());
    expect(result).toMatchObject({ ok: false, kind: "invalid" });
    expect(calls).toHaveLength(2);
  });

  it("says why there is no answer, in a few plain kinds", async () => {
    const ask = async (...responses: Array<Response | Error>) =>
      createOpenAiProvider(env, fakeFetch(...responses).fetcher).generateObject(request());
    expect(await ask(new Response("slow down", { status: 429 }))).toMatchObject({
      ok: false,
      kind: "rate_limited",
    });
    expect(await ask(new Response("bad key", { status: 401 }))).toMatchObject({
      ok: false,
      kind: "unavailable",
    });
    expect(await ask(new Response("oops", { status: 503 }))).toMatchObject({
      ok: false,
      kind: "unavailable",
    });
    expect(await ask(new Error("socket hang up"))).toMatchObject({
      ok: false,
      kind: "unavailable",
    });
    expect(
      await ask(Object.assign(new Error("timed out"), { name: "TimeoutError" })),
    ).toMatchObject({ ok: false, kind: "timeout" });
    expect(
      await ask(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: null, refusal: "I can't help with that" } }],
          }),
          { status: 200 },
        ),
      ),
    ).toMatchObject({ ok: false, kind: "refused" });
    expect(await ask(new Response("<html>", { status: 200 }))).toMatchObject({
      ok: false,
      kind: "unavailable",
    });
  });

  it("never lets the provider's own error text, or the key, reach the caller", async () => {
    const { fetcher } = fakeFetch(
      new Response("Incorrect API key provided: sk-test-secret", { status: 401 }),
    );
    const result = await createOpenAiProvider(env, fetcher).generateObject(request());
    expect(JSON.stringify(result)).not.toContain("sk-test-secret");
    expect(JSON.stringify(result)).not.toContain("Incorrect");
  });

  it("logs why the provider said no — no credit left is not a busy minute — but never its text", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const noCredit = new Response(
      JSON.stringify({
        error: {
          message: "You have no credits remaining. Key sk-test-secret.",
          type: "insufficient_quota",
          code: "credit_balance_exhausted",
        },
      }),
      { status: 429 },
    );
    const { fetcher } = fakeFetch(noCredit, new Response("slow down", { status: 429 }));
    const provider = createOpenAiProvider(env, fetcher);
    expect(await provider.generateObject(request())).toMatchObject({ kind: "rate_limited" });
    expect(await provider.generateObject(request())).toMatchObject({ kind: "rate_limited" });
    const logged = warn.mock.calls.map(([line]) => JSON.parse(String(line)));
    warn.mockRestore();
    expect(logged.map((l) => l.code)).toEqual(["credit_balance_exhausted", null]);
    expect(JSON.stringify(logged)).not.toContain("sk-test-secret");
    expect(JSON.stringify(logged)).not.toContain("no credits");
  });
});

describe("asking with a web search first", () => {
  const responses = (output: unknown[]) =>
    new Response(JSON.stringify({ output, usage: { input_tokens: 8000, output_tokens: 90 } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  it("uses the Responses API with the search tool, and returns the pages it opened", async () => {
    const { fetcher, calls } = fakeFetch(
      responses([
        {
          type: "web_search_call",
          action: { sources: [{ type: "url", url: "https://shop.example/a" }, { type: "url" }] },
        },
        {
          type: "message",
          content: [{ type: "output_text", text: JSON.stringify({ producer: "Margaux" }) }],
        },
      ]),
    );
    const result = await createOpenAiProvider(env, fetcher).generateObject(
      request({ model: "chat", images: [], webSearch: true, temperature: 0 }),
    );
    expect(result).toMatchObject({
      ok: true,
      value: { producer: "Margaux" },
      consulted: ["https://shop.example/a"],
      usage: { model: "chat-model", tokensIn: 8000, tokensOut: 90 },
    });
    expect(calls[0]!.url).toBe("https://ai.example/v1/responses");
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body).toMatchObject({
      tools: [{ type: "web_search" }],
      include: ["web_search_call.action.sources"],
      temperature: 0,
      text: { format: { type: "json_schema", strict: true, name: "answer" } },
    });
  });

  it("says no plainly on a refusal, an unusable answer or an error, without a second paid search", async () => {
    const refusal = fakeFetch(
      responses([{ type: "message", content: [{ type: "refusal", refusal: "no" }] }]),
    );
    expect(
      await createOpenAiProvider(env, refusal.fetcher).generateObject(request({ webSearch: true })),
    ).toMatchObject({ ok: false, kind: "refused" });
    const junk = fakeFetch(
      responses([{ type: "message", content: [{ type: "output_text", text: "{nope" }] }]),
    );
    expect(
      await createOpenAiProvider(env, junk.fetcher).generateObject(request({ webSearch: true })),
    ).toMatchObject({ ok: false, kind: "invalid" });
    expect(junk.calls).toHaveLength(1);
    const limited = fakeFetch(new Response("{}", { status: 429 }));
    expect(
      await createOpenAiProvider(env, limited.fetcher).generateObject(request({ webSearch: true })),
    ).toMatchObject({ ok: false, kind: "rate_limited" });
  });
});

describe("gpt-6-luna for advice", () => {
  const luna = { ...env, adviceModel: "gpt-6-luna" };
  const advice = request({ task: "sommelier_chat", model: "chat", images: [], temperature: 0.3 });

  it("effort none: same Chat Completions request plus reasoning_effort, temperature kept", async () => {
    const { fetcher, calls } = fakeFetch(
      reply({ producer: "X" }, { model: "gpt-6-luna-2026-09-22" }),
    );
    const result = await createOpenAiProvider(luna, fetcher).generateObject(advice);
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body).toMatchObject({
      model: "gpt-6-luna",
      reasoning_effort: "none",
      temperature: 0.3,
      max_completion_tokens: 500,
      response_format: { type: "json_schema" },
    });
    expect(result).toMatchObject({
      ok: true,
      usage: { model: "gpt-6-luna", servedModel: "gpt-6-luna-2026-09-22", reported: true },
    });
  });

  it("effort low: no temperature, room for reasoning; reasoning tokens arrive inside completion_tokens", async () => {
    const { fetcher, calls } = fakeFetch(
      reply(
        { producer: "X" },
        {
          usage: {
            prompt_tokens: 900,
            completion_tokens: 700,
            completion_tokens_details: { reasoning_tokens: 640 },
          },
        },
      ),
    );
    const result = await createOpenAiProvider(
      { ...luna, reasoningEffort: "low" },
      fetcher,
    ).generateObject(advice);
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body.reasoning_effort).toBe("low");
    expect(body).not.toHaveProperty("temperature");
    expect(body.max_completion_tokens).toBe(2500);
    expect(result.usage).toMatchObject({ tokensIn: 900, tokensOut: 700, reported: true });
  });

  it("an answer outside the schema is repaired once, then a plain failure for the fallback", async () => {
    const { fetcher, calls } = fakeFetch(reply({ nope: 1 }), reply("not json"));
    const result = await createOpenAiProvider(luna, fetcher).generateObject(advice);
    expect(result).toMatchObject({ ok: false, kind: "invalid" });
    expect(calls).toHaveLength(2);
  });

  it("GPT-4.x requests are unchanged: no reasoning parameter", async () => {
    const { fetcher, calls } = fakeFetch(reply({ producer: "X" }));
    await createOpenAiProvider(env, fetcher).generateObject(advice);
    expect(JSON.parse(String(calls[0]!.init.body))).not.toHaveProperty("reasoning_effort");
  });
});

describe("gpt-6-luna for scans and valuations", () => {
  const luna = {
    ...env,
    visionModel: "gpt-6-luna",
    chatModel: "gpt-6-luna",
    adviceModel: "gpt-6-luna",
  };

  it("a label scan: high-detail image, strict schema, effort none, nothing else added", async () => {
    const { fetcher, calls } = fakeFetch(reply({ producer: "Château Margaux" }));
    const result = await createOpenAiProvider(luna, fetcher).generateObject(request());
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body).toMatchObject({
      model: "gpt-6-luna",
      reasoning_effort: "none",
      max_completion_tokens: 500,
      response_format: { type: "json_schema", json_schema: { strict: true } },
    });
    expect(body.messages[1].content[1]).toMatchObject({
      type: "image_url",
      image_url: { detail: "high" },
    });
    expect(result).toMatchObject({ ok: true, value: { producer: "Château Margaux" } });
  });

  const valuation = request({
    task: "wine_valuation",
    model: "chat",
    images: [],
    webSearch: true,
    maxOutputTokens: 700,
    temperature: 0,
  });
  const searched = (output: unknown[]) =>
    new Response(
      JSON.stringify({
        model: "gpt-6-luna-2026-09-22",
        output,
        usage: {
          input_tokens: 12000,
          output_tokens: 1500,
          input_tokens_details: { cached_tokens: 0 },
        },
      }),
      { status: 200 },
    );

  it("a valuation: Responses API with web search, reasoning low, room for it, no temperature", async () => {
    const { fetcher, calls } = fakeFetch(
      searched([
        { type: "reasoning" },
        { type: "web_search_call", action: { sources: [{ url: "https://shop.example/margaux" }] } },
        { type: "message", content: [{ type: "output_text", text: '{"producer":"X"}' }] },
      ]),
    );
    const result = await createOpenAiProvider(luna, fetcher).generateObject(valuation);
    expect(calls[0]!.url).toBe("https://ai.example/v1/responses");
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body).toMatchObject({
      model: "gpt-6-luna",
      tools: [{ type: "web_search" }],
      include: ["web_search_call.action.sources"],
      reasoning: { effort: "low" },
      max_output_tokens: 2700,
      text: { format: { type: "json_schema", strict: true } },
    });
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("reasoning_effort");
    expect(result).toMatchObject({
      ok: true,
      consulted: ["https://shop.example/margaux"],
      usage: {
        servedModel: "gpt-6-luna-2026-09-22",
        webSearchCalls: 1,
        tokensIn: 12000,
        tokensOut: 1500,
        reported: true,
      },
    });
  });

  it("an extra message item does not hide the answer; nothing that fails the schema is accepted", async () => {
    const extra = { type: "message", content: [{ type: "output_text", text: "Searching…" }] };
    const answer = {
      type: "message",
      content: [{ type: "output_text", text: '{"producer":"X"}' }],
    };
    const one = fakeFetch(searched([extra, answer]));
    expect(await createOpenAiProvider(luna, one.fetcher).generateObject(valuation)).toMatchObject({
      ok: true,
      value: { producer: "X" },
    });
    const none = fakeFetch(
      searched([
        extra,
        { type: "message", content: [{ type: "output_text", text: '{"price":1}' }] },
      ]),
    );
    expect(await createOpenAiProvider(luna, none.fetcher).generateObject(valuation)).toMatchObject({
      ok: false,
      kind: "invalid",
    });
  });

  it("GPT-4.1-mini valuations are sent exactly as before", async () => {
    const { fetcher, calls } = fakeFetch(
      searched([{ type: "message", content: [{ type: "output_text", text: '{"producer":"X"}' }] }]),
    );
    await createOpenAiProvider({ ...env, chatModel: "gpt-4.1-mini" }, fetcher).generateObject(
      valuation,
    );
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body).toMatchObject({ model: "gpt-4.1-mini", max_output_tokens: 700, temperature: 0 });
    expect(body).not.toHaveProperty("reasoning");
  });
});

describe("usage for cost accounting", () => {
  it("records the model that answered, cached tokens, and that usage was reported", async () => {
    const { fetcher } = fakeFetch(
      reply(
        { producer: "X" },
        {
          model: "vision-model-2025-04-14",
          usage: {
            prompt_tokens: 900,
            completion_tokens: 60,
            prompt_tokens_details: { cached_tokens: 300 },
          },
        },
      ),
    );
    const result = await createOpenAiProvider(env, fetcher).generateObject(request());
    expect(result.usage).toMatchObject({
      model: "vision-model",
      servedModel: "vision-model-2025-04-14",
      tokensIn: 900,
      tokensCachedIn: 300,
      tokensOut: 60,
      reported: true,
    });
  });

  it("a repair counts both attempts, once each", async () => {
    const { fetcher } = fakeFetch(reply("not json"), reply({ producer: "X" }));
    const result = await createOpenAiProvider(env, fetcher).generateObject(request());
    expect(result.usage).toMatchObject({ tokensIn: 1800, tokensOut: 120, reported: true });
  });

  it("a timeout, an error answer, or an answer without usage leaves the cost unknown", async () => {
    for (const response of [
      Object.assign(new Error("timed out"), { name: "TimeoutError" }),
      new Response("oops", { status: 503 }),
      new Response(JSON.stringify({ choices: [{ message: { content: '{"producer":"X"}' } }] }), {
        status: 200,
      }),
    ]) {
      const { fetcher } = fakeFetch(response);
      const result = await createOpenAiProvider(env, fetcher).generateObject(request());
      expect(result.usage.reported).toBe(false);
    }
  });

  it("a usage block missing its input or output count is unknown, never a confirmed 0", async () => {
    for (const usage of [
      { prompt_tokens: 900 },
      { completion_tokens: 60 },
      {},
      { prompt_tokens: null, completion_tokens: 60 },
    ]) {
      const { fetcher } = fakeFetch(reply({ producer: "X" }, { usage }));
      const result = await createOpenAiProvider(env, fetcher).generateObject(request());
      expect(result.usage.reported).toBe(false);
    }
    // Only the cached count missing: still known, simply none priced as cached.
    const { fetcher } = fakeFetch(
      reply({ producer: "X" }, { usage: { prompt_tokens: 900, completion_tokens: 60 } }),
    );
    const result = await createOpenAiProvider(env, fetcher).generateObject(request());
    expect(result.usage).toMatchObject({ reported: true, tokensIn: 900, tokensCachedIn: 0 });
  });

  it("counts the web searches the provider ran", async () => {
    const { fetcher } = fakeFetch(
      new Response(
        JSON.stringify({
          output: [
            { type: "web_search_call" },
            { type: "web_search_call" },
            { type: "message", content: [{ type: "output_text", text: '{"producer":"X"}' }] },
          ],
          usage: {
            input_tokens: 9000,
            output_tokens: 80,
            input_tokens_details: { cached_tokens: 0 },
          },
        }),
        { status: 200 },
      ),
    );
    const result = await createOpenAiProvider(env, fetcher).generateObject(
      request({ model: "chat", images: [], webSearch: true }),
    );
    expect(result.usage).toMatchObject({ webSearchCalls: 2, tokensIn: 9000, reported: true });
  });
});
