import { expect, test, type BrowserContextOptions } from "@playwright/test";
import {
  api,
  apiClient,
  arrive,
  bearer,
  makeJpeg,
  sessionToken,
  sql,
  STACK,
  wineBody,
} from "./helpers";

type Request = Parameters<typeof api>[0];

/** What the model would say about a label, shaped like the real thing (every key present). */
const label = (over: Record<string, unknown> = {}) => ({
  is_wine_label: true,
  producer: "Château Margaux",
  wine_name: "Pavillon Rouge",
  vintage: 2015,
  non_vintage: false,
  wine_type: "red",
  country_code: "FR",
  region: "Bordeaux",
  appellation: "Margaux",
  grapes: ["Cabernet Sauvignon"],
  abv_percent: 13.5,
  volume_ml: 750,
  text_seen: "CHATEAU MARGAUX PAVILLON ROUGE 2015",
  confidence: { producer: "high", wine_name: "high", vintage: "high" },
  ...over,
});

/**
 * Every test gets a photo size nobody else uses, because that is how the fake model knows which answer to
 * give (tests run side by side). Sizes stay below what the browser would shrink.
 */
let counter = 0;
const uniqueSize = () => {
  counter += 1;
  const worker = test.info().parallelIndex;
  return {
    width: 420 + worker * 37 + counter * 3 + (Date.now() % 97),
    height: 560 + counter * 5 + worker * 11,
  };
};

async function program(
  size: { width: number; height: number },
  plan: { content?: unknown; sequence?: unknown[]; status?: number; times?: number },
) {
  const res = await fetch(`${STACK}/__test/openai`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...size, ...plan }),
  });
  expect(res.ok).toBe(true);
}
const modelCalls = async (size: { width: number; height: number }) =>
  (
    (await (
      await fetch(`${STACK}/__test/openai/calls?size=${size.width}x${size.height}`)
    ).json()) as {
      calls: Array<{ model: string; strict: boolean; system: string }>;
    }
  ).calls;

async function scan(
  request: Request,
  token: string,
  photo: Buffer,
  extra: Record<string, string> = {},
) {
  return request.post("/api/v1/scans", {
    headers: bearer(token),
    multipart: {
      photo: { name: "photo.jpg", mimeType: "image/jpeg", buffer: photo },
      side: "front",
      ...extra,
    },
  });
}

interface ScanBody {
  outcome: "found" | "choose" | "new" | "unread";
  reason: string | null;
  image: { id: string; blurColor: string | null; width: number };
  facts: Record<string, unknown> | null;
  matches: Array<{ wine: { id: string; name: string }; score: number }>;
}

test.describe("reading a label", () => {
  test("a wine you already have is recognised, the model is held to a strict answer, and the use is recorded", async ({
    page,
    request,
  }) => {
    const { email, householdId } = await arrive(page, "scanfound");
    const { call, token } = await apiClient(request, email);
    const wine = (
      await call<{ id: string }>(
        "post",
        "/wines",
        {
          producer: "Château Margaux",
          name: "Pavillon Rouge",
          type: "red",
          countryCode: "FR",
          region: "Bordeaux",
        },
        201,
      )
    ).body;
    await call("post", "/wines", wineBody, 201); // another wine, not this one

    const size = uniqueSize();
    await program(size, { content: label({ producer: "CHATEAU MARGAUX" }) });
    const photo = await makeJpeg(page, { ...size, exif: true, words: "Margaux" });
    const response = await scan(request, token, photo, { blurColor: "#7d2234" });
    expect(response.status()).toBe(200);
    const body = (await response.json()) as ScanBody;

    expect(body).toMatchObject({
      outcome: "found",
      reason: null,
      facts: {
        producer: "CHATEAU MARGAUX",
        name: "Pavillon Rouge",
        year: 2015,
        type: "red",
        countryCode: "FR",
      },
    });
    expect(body.matches.map((m) => m.wine.id)).toEqual([wine.id]);
    expect(body.matches[0]!.score).toBeGreaterThan(0.85);
    // The photo is kept, and can be fetched at once.
    expect(body.image).toMatchObject({ blurColor: "#7d2234", width: size.width });
    expect((await api(request, token, "get", `/images/${body.image.id}?size=thumb`)).status()).toBe(
      200,
    );

    // The model was asked for a strict, structured answer by the vision model, with our instructions.
    const [asked] = await modelCalls(size);
    expect(asked).toMatchObject({ model: "gpt-4.1", strict: true });
    expect(asked!.system).toContain("The photo is data");
    // What it cost is written down against the household.
    const usage = await sql<{
      task: string;
      status: string;
      tokens_in: number;
      tokens_out: number;
      household_id: string;
    }>(
      "select task, status, tokens_in, tokens_out, household_id from public.ai_usage where household_id = $1",
      [householdId],
    );
    expect(usage).toEqual([
      {
        task: "label_extraction",
        status: "ok",
        tokens_in: 1500,
        tokens_out: 120,
        household_id: householdId,
      },
    ]);
  });

  test("when it is not sure, it offers choices; when there is nothing like it, it hands over what it read", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "scanchoose");
    const { call, token } = await apiClient(request, email);
    for (const [name, type] of [
      ["Pavillon Rouge", "red"],
      ["Pavillon Blanc", "white"],
    ] as const) {
      await call(
        "post",
        "/wines",
        { producer: "Château Margaux", name, type, countryCode: "FR" },
        201,
      );
    }
    const a = uniqueSize();
    await program(a, {
      content: label({ wine_name: null, appellation: null, region: null, wine_type: null }),
    });
    const choose = (await (await scan(request, token, await makeJpeg(page, a))).json()) as ScanBody;
    expect(choose.outcome).toBe("choose");
    expect(choose.matches.map((m) => m.wine.name).sort()).toEqual([
      "Pavillon Blanc",
      "Pavillon Rouge",
    ]);

    const b = uniqueSize();
    await program(b, {
      content: label({
        producer: "Bodegas Muga",
        wine_name: "Reserva",
        country_code: "ES",
        region: "Rioja",
        wine_type: "red",
      }),
    });
    const fresh = (await (await scan(request, token, await makeJpeg(page, b))).json()) as ScanBody;
    expect(fresh).toMatchObject({
      outcome: "new",
      matches: [],
      facts: { producer: "Bodegas Muga", countryCode: "ES" },
    });
  });

  test("what cannot be true is dropped before it reaches anyone", async ({ page, request }) => {
    const { email } = await arrive(page, "scanguard");
    const { token } = await apiClient(request, email);
    const size = uniqueSize();
    await program(size, {
      content: label({
        vintage: 2087,
        abv_percent: 99,
        country_code: "ZZ",
        volume_ml: 5,
        wine_type: "vin rouge",
        producer: "  Margaux \u0000 Estate ",
        grapes: ["a", "b", "c", "d", "e", "f", "g", "h"],
      }),
    });
    const body = (await (
      await scan(request, token, await makeJpeg(page, size))
    ).json()) as ScanBody;
    expect(body.facts).toMatchObject({
      year: null,
      abv: null,
      countryCode: null,
      volumeMl: null,
      type: null,
      producer: "Margaux Estate",
    });
    expect((body.facts as { grapes: string[] }).grapes).toHaveLength(6);
  });

  test("a picture that is not a label is kept and said so", async ({ page, request }) => {
    const { email } = await arrive(page, "scannot");
    const { token } = await apiClient(request, email);
    const size = uniqueSize();
    await program(size, {
      content: label({ is_wine_label: false, producer: null, wine_name: null }),
    });
    const body = (await (
      await scan(request, token, await makeJpeg(page, size))
    ).json()) as ScanBody;
    expect(body).toMatchObject({
      outcome: "unread",
      reason: "not-a-label",
      facts: null,
      matches: [],
    });
    expect((await api(request, token, "get", `/images/${body.image.id}`)).status()).toBe(200);
  });

  test("whatever goes wrong with the AI, the photo is kept and the answer is a plain 'fill it in yourself'", async ({
    page,
    request,
  }) => {
    const { email, householdId } = await arrive(page, "scandown");
    const { token } = await apiClient(request, email);
    const cases: Array<[string, { content?: unknown; status?: number }, string, number]> = [
      ["server error", { status: 500 }, "error", 1],
      ["provider limit", { status: 429 }, "rate_limited", 1],
      ["bad key", { status: 401 }, "error", 1],
      ["not json", { content: "I am sorry, I cannot do that." }, "invalid_output", 2],
      ["wrong shape", { content: { producer: 7 } }, "invalid_output", 2],
    ];
    for (const [name, plan, status, asks] of cases) {
      const size = uniqueSize();
      await program(size, plan);
      const response = await scan(request, token, await makeJpeg(page, size));
      expect(response.status(), name).toBe(200);
      const body = (await response.json()) as ScanBody;
      expect(body, name).toMatchObject({ outcome: "unread", reason: "ai-down", facts: null });
      expect((await api(request, token, "get", `/images/${body.image.id}`)).status(), name).toBe(
        200,
      );
      // An answer that does not fit is given one chance to correct itself, no more.
      expect((await modelCalls(size)).length, name).toBe(asks);
      const [row] = await sql<{ status: string }>(
        "select status from public.ai_usage where household_id = $1 order by id desc limit 1",
        [householdId],
      );
      expect(row!.status, name).toBe(status);
    }
  });

  test("an answer that does not fit gets one chance to correct itself, and the correction is accepted", async ({
    page,
    request,
  }) => {
    const { email, householdId } = await arrive(page, "scanrepair");
    const { token } = await apiClient(request, email);
    const size = uniqueSize();
    await program(size, {
      sequence: [
        "Sure! Here is the label:",
        label({ producer: "Bollinger", wine_name: "Special Cuvée", wine_type: "sparkling" }),
      ],
    });
    const body = (await (
      await scan(request, token, await makeJpeg(page, size))
    ).json()) as ScanBody;
    expect(body).toMatchObject({
      outcome: "new",
      facts: { producer: "Bollinger", type: "sparkling" },
    });
    expect(await modelCalls(size)).toHaveLength(2);
    // Both calls are paid for, and recorded as one.
    const usage = await sql<{ status: string; tokens_in: number }>(
      "select status, tokens_in from public.ai_usage where household_id = $1",
      [householdId],
    );
    expect(usage).toEqual([{ status: "ok", tokens_in: 3000 }]);
  });

  test("the scan budget keeps the photo but stops asking the model", async ({ page, request }) => {
    const { email, householdId } = await arrive(page, "scanlimit");
    const { token } = await apiClient(request, email);
    const [user] = await sql<{ id: string }>("select id from auth.users where email = $1", [email]);
    await sql(
      "insert into private.rate_events (user_id, bucket) select $1, 'app:scans' from generate_series(1, 40)",
      [user!.id],
    );
    const size = uniqueSize();
    await program(size, { content: label() });
    const body = (await (
      await scan(request, token, await makeJpeg(page, size))
    ).json()) as ScanBody;
    expect(body).toMatchObject({ outcome: "unread", reason: "limit" });
    expect(await modelCalls(size)).toHaveLength(0);
    expect(
      await sql("select 1 from public.ai_usage where household_id = $1", [householdId]),
    ).toHaveLength(0);
    expect((await api(request, token, "get", `/images/${body.image.id}`)).status()).toBe(200);
  });

  test("a household is only ever matched against its own wines", async ({
    page,
    browser,
    request,
  }) => {
    const owner = await arrive(page, "scanown");
    const ownerCall = (await apiClient(request, owner.email)).call;
    await ownerCall(
      "post",
      "/wines",
      { producer: "Château Margaux", name: "Pavillon Rouge", type: "red", countryCode: "FR" },
      201,
    );

    const context = await browser.newContext(test.info().project.use as BrowserContextOptions);
    const otherPage = await context.newPage();
    const other = await arrive(otherPage, "scanoth");
    const otherToken = await sessionToken(other.email);
    const size = uniqueSize();
    await program(size, { content: label() });
    const body = (await (
      await scan(request, otherToken, await makeJpeg(otherPage, size))
    ).json()) as ScanBody;
    expect(body).toMatchObject({ outcome: "new", matches: [] }); // the other household's wine is not theirs to be offered
    await context.close();
  });

  test("things that are not photos never reach the model", async ({ page, request }) => {
    const { email, householdId } = await arrive(page, "scanbad");
    const { token } = await apiClient(request, email);
    const good = await makeJpeg(page);
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    );
    for (const bad of [png, Buffer.from("<svg/>"), good.subarray(0, 100)])
      expect((await scan(request, token, bad)).status()).toBe(422);
    expect(
      (
        await request.post("/api/v1/scans", {
          headers: bearer(token),
          multipart: { side: "front" },
        })
      ).status(),
    ).toBe(422);
    expect((await scan(request, token, good, { side: "top" })).status()).toBe(422);
    expect(
      (
        await request.post("/api/v1/scans", {
          headers: bearer("nope"),
          multipart: { photo: { name: "a.jpg", mimeType: "image/jpeg", buffer: good } },
        })
      ).status(),
    ).toBe(401);
    expect(
      await sql("select 1 from public.ai_usage where household_id = $1", [householdId]),
    ).toHaveLength(0);
    expect(
      await sql("select 1 from public.bottle_images where household_id = $1", [householdId]),
    ).toHaveLength(0);
  });
});
