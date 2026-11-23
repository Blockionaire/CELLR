import { expect, test, type APIRequestContext } from "@playwright/test";
import { apiClient, arrive, bearer, FEATURES_URL, STACK } from "./helpers";

/**
 * Sommelier V1+, P2 (docs/sprints/sommelier-3-mega/SOMMELIER_CLOSEOUT.md §4.2, D-52): the release configuration
 * CELLR_SOMMELIER exists, and no part changes an answer yet. The default server has it unset. The features server
 * names every part and an unknown name (playwright.config.ts). The same question, from the same household, with the
 * same programmed model answer, must come back the same from both, and the model must have been asked the same
 * thing. Each part's own pull request replaces this with what that part adds.
 */

const DEFAULT_URL = "http://localhost:3100";

/** Words that only this question contains: that is how the fake model knows which answer to give. */
const marker = () =>
  `[${test.info().parallelIndex}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}]`;

async function program(match: string, content: unknown) {
  const res = await fetch(`${STACK}/__test/openai`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ match, content }),
  });
  expect(res.ok).toBe(true);
}

async function modelCalls(match: string) {
  const res = await fetch(`${STACK}/__test/openai/calls?match=${encodeURIComponent(match)}`);
  return ((await res.json()) as { calls: Array<{ model: string; system: string; user: string }> })
    .calls;
}

async function askAt(request: APIRequestContext, base: string, token: string, text: string) {
  const res = await request.post(`${base}/api/v1/sommelier`, {
    headers: bearer(token),
    data: { messages: [{ role: "user", text }] },
  });
  expect(res.status(), `${base}: ${text}`).toBe(200);
  return (await res.json()) as Record<string, unknown>;
}

test.describe("Sommelier V1+ parts (CELLR_SOMMELIER)", () => {
  test.skip(({ isMobile }) => isMobile, "an API comparison: the screen does not take part");

  test("every part named, and an unknown name, change nothing V1 says or asks its model", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "somparts");
    const { call, token } = await apiClient(request, email);
    const fridge = (
      await call("post", "/storage", { label: "Fridge", kind: "fridge", rows: 2, cols: 3 }, 201)
    ).body as { id: string };
    for (const wine of [
      {
        producer: "Château Margaux",
        name: "Pavillon Rouge",
        type: "red",
        countryCode: "FR",
        region: "Bordeaux",
        year: 2015,
      },
      {
        producer: "Bollinger",
        name: "Special Cuvée",
        type: "sparkling",
        countryCode: "FR",
        region: "Champagne",
        year: null,
      },
    ]) {
      const { year, ...rest } = wine;
      const w = (await call("post", "/wines", rest, 201)).body as { id: string };
      await call(
        "post",
        "/bottles",
        { wineId: w.id, year, quantity: 2, locationId: fridge.id },
        201,
      );
    }

    const answers: Record<string, unknown>[] = [];
    const prompts: Array<{ system: string; user: string }> = [];
    for (const base of [DEFAULT_URL, FEATURES_URL]) {
      const m = marker();
      await program(m, { answer: "Open the Bollinger with the oysters.", bottle_refs: [] });
      const answer = await askAt(request, base, token, `What goes with oysters? ${m}`);
      answers.push(answer);
      const [first] = await modelCalls(m);
      expect(first, base).toBeDefined();
      // The question carries its own marker: everything else the model is shown must be the same.
      prompts.push({ system: first!.system, user: first!.user.replaceAll(m, "[marker]") });
    }
    expect(answers[1]).toEqual(answers[0]);
    expect(prompts[1]).toEqual(prompts[0]);

    // A question of fact is counted, not asked: the same from both servers too.
    const facts = await Promise.all(
      [DEFAULT_URL, FEATURES_URL].map((base) =>
        askAt(request, base, token, "How many bottles do I have?"),
      ),
    );
    expect(facts[1]).toEqual(facts[0]);
  });
});
