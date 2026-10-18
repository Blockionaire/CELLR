import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createOpenAiProvider } from "./openai";
import type { GenerateObjectRequest } from "./types";

const env = {
  apiKey: "sk-test-secret",
  baseUrl: "https://ai.example/v1",
  visionModel: "vision-model",
  chatModel: "chat-model",
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
