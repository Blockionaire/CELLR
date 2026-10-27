import { expect, test, type APIRequestContext, type BrowserContextOptions } from "@playwright/test";
import { api, apiClient, arrive, bearer, makeJpeg, sessionToken, sql, STACK } from "./helpers";

/**
 * The shared catalogue in a normal journey: the owner imports curated wines; households find them by scanning or
 * typing; a missing year is added safely; and a wine researched once is reused by the next household.
 */

const marker = () =>
  `${test.info().parallelIndex}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

let counter = 0;
const uniqueSize = () => {
  counter += 1;
  const worker = test.info().parallelIndex;
  return {
    width: 430 + worker * 41 + counter * 7 + (Date.now() % 89),
    height: 570 + counter * 9 + worker * 13,
  };
};

async function program(plan: Record<string, unknown>) {
  const res = await fetch(`${STACK}/__test/openai`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(plan),
  });
  expect(res.ok).toBe(true);
}
const calls = async (query: string) =>
  (
    (await (await fetch(`${STACK}/__test/openai/calls?${query}`)).json()) as {
      calls: unknown[];
    }
  ).calls.length;

/** What the vision model reads off a label. */
const label = (producer: string, wine: string, vintage: number) => ({
  is_wine_label: true,
  producer,
  wine_name: wine,
  vintage,
  non_vintage: false,
  wine_type: "red",
  country_code: "FR",
  region: "Bourgogne",
  appellation: null,
  grapes: [],
  abv_percent: null,
  volume_ml: 750,
  text_seen: `${producer} ${wine} ${vintage}`,
  confidence: { producer: "high", wine_name: "high", vintage: "high" },
});

async function scan(request: APIRequestContext, token: string, photo: Buffer) {
  const res = await request.post("/api/v1/scans", {
    headers: bearer(token),
    multipart: {
      photo: { name: "photo.jpg", mimeType: "image/jpeg", buffer: photo },
      side: "front",
    },
  });
  expect(res.status()).toBe(200);
  return (await res.json()) as {
    outcome: string;
    facts: { year: number | null } | null;
    matches: Array<{ wine: { id: string; catalog?: boolean } }>;
  };
}

test.describe("the shared catalogue", () => {
  test("imported once, found by scanning and typing, a new year added safely, researched once for everyone", async ({
    page,
    browser,
    request,
  }) => {
    const m = marker();
    const producer = `Domaine Catalogue ${m}`;
    const alpha = `Cuvée Alpha ${m}`;
    const reserve = `Cuvée Alpha Réserve ${m}`;

    // ---- the owner imports two curated wines (the reserve is a different wine) ----
    const entries = [
      {
        producer,
        producer_country: "FR",
        name: alpha,
        type: "red",
        region: "Bourgogne",
        vintages: [2018],
        aliases: [],
        sources: [{ name: "Producer website", url: `https://catalogue-${m}.example/alpha` }],
      },
      {
        producer,
        producer_country: "FR",
        name: reserve,
        type: "red",
        region: "Bourgogne",
        vintages: [2018],
        sources: [{ name: "Producer website", url: `https://catalogue-${m}.example/reserve` }],
      },
    ];
    const [dry] = await sql<{ r: { summary: { created: number }; applied: boolean } }>(
      "select public.catalog_import($1::jsonb) as r",
      [JSON.stringify(entries)],
    );
    expect(dry!.r).toMatchObject({ applied: false, summary: { created: 2 } });
    const [applied] = await sql<{ r: { summary: { created: number } } }>(
      "select public.catalog_import($1::jsonb, true) as r",
      [JSON.stringify(entries)],
    );
    expect(applied!.r.summary.created).toBe(2);
    const [{ id: alphaId }] = (await sql<{ id: string }>(
      "select id from public.wines where name = $1 and status = 'canonical'",
      [alpha],
    )) as [{ id: string }];

    // The profile research answers for this wine: this exact wine, with a page the search opened.
    const consulted = [`https://catalogue-${m}.example/alpha`];
    await program({
      match: alpha,
      consulted,
      content: {
        summary: `${alpha}: a precise, structured Burgundy.`,
        style: "Medium-bodied red",
        grapes: ["Pinot Noir"],
        tasting: "Cherry and earth.",
        serving_temp_min_c: 15,
        serving_temp_max_c: 17,
        decant_minutes: 30,
        abv_percent: 13,
        pairings: ["Duck"],
        aging: "Ten years.",
        body: 3,
        tannin: 3,
        sweetness: 1,
        acidity: 4,
        flavors: [{ group: "red_fruit", notes: ["Cherry"] }],
        pairing_kinds: ["poultry"],
        drink_from_year: 2022,
        drink_until_year: 2032,
        country_code: "FR",
        region: "Bourgogne",
        appellation: null,
        confidence: "high",
        evidence: "exact_wine",
        sources: [{ name: "Producer website", url: consulted[0] }],
      },
    });
    const research = () => calls(`match=${encodeURIComponent(alpha)}`);

    const households: Array<{ email: string; householdId: string; close: () => Promise<void> }> =
      [];
    for (const who of ["catA", "catB", "catC"]) {
      const context = await browser.newContext(test.info().project.use as BrowserContextOptions);
      const h = await arrive(await context.newPage(), who);
      households.push({ ...h, close: () => context.close() });
    }
    const [a, b, c] = households as [
      (typeof households)[0],
      (typeof households)[0],
      (typeof households)[0],
    ];

    // ---- household A scans the label: the catalogue wine is found, the year stays as read ----
    const size = uniqueSize();
    await program({ ...size, content: label(producer.toUpperCase(), alpha, 2019) });
    const aToken = await sessionToken(a.email);
    const found = await scan(request, aToken, await makeJpeg(page, { ...size, words: "Alpha" }));
    expect(found.outcome).toBe("found");
    expect(found.matches[0]!.wine).toMatchObject({ id: alphaId, catalog: true });
    expect(found.facts?.year).toBe(2019);
    // It confirms: 2019 is not in the catalogue yet, and is added safely for it.
    const { call: aCall } = await apiClient(request, a.email);
    await aCall("post", "/bottles", { wineId: alphaId, year: 2019, quantity: 1 }, 201);
    const [v2019] = await sql<{ id: string }>(
      "select id from public.wine_vintages where wine_id = $1 and year = 2019",
      [alphaId],
    );
    expect(v2019).toBeTruthy();
    // Its profile is researched once, and shared.
    expect((await api(request, aToken, "post", `/cellar/${v2019!.id}/insight`)).status()).toBe(200);
    expect(await research()).toBe(1);

    // ---- household B types the wine by hand: it gets the catalogue wine, not a private copy ----
    const { call: bCall } = await apiClient(request, b.email);
    const typed = (
      await bCall<{ id: string; catalog?: boolean }>(
        "post",
        "/wines",
        {
          producer: producer.toLowerCase(),
          name: alpha.toUpperCase(),
          type: "red",
          countryCode: "FR",
        },
        201,
      )
    ).body;
    expect(typed).toMatchObject({ id: alphaId, catalog: true });
    await bCall("post", "/bottles", { wineId: alphaId, year: 2019, quantity: 2 }, 201);
    expect(
      await sql("select 1 from public.wines where owner_household_id = $1", [b.householdId]),
    ).toHaveLength(0);
    // Same wine, same vintage, same language: the shared profile, without a research call or AI usage.
    const bView = await api(
      request,
      await sessionToken(b.email),
      "post",
      `/cellar/${v2019!.id}/insight`,
    );
    expect(bView.status()).toBe(200);
    expect(
      ((await bView.json()) as { insight: { output: { summary: string } } }).insight.output.summary,
    ).toContain(alpha);
    expect(await research()).toBe(1);
    expect(
      await sql("select 1 from public.ai_usage where household_id = $1", [b.householdId]),
    ).toHaveLength(0);

    // ---- household C: a similar name is a choice, never silently the catalogue wine ----
    const size2 = uniqueSize();
    await program({ ...size2, content: label(producer, `Alpha Reserve ${m}`, 2018) });
    const unsure = await scan(
      request,
      await sessionToken(c.email),
      await makeJpeg(page, { ...size2, words: "Reserve" }),
    );
    expect(unsure.outcome).not.toBe("found");
    // ...and another vintage is researched, not served the 2019 profile.
    const { call: cCall } = await apiClient(request, c.email);
    await cCall("post", "/bottles", { wineId: alphaId, year: 2018, quantity: 1 }, 201);
    const [v2018] = await sql<{ id: string }>(
      "select id from public.wine_vintages where wine_id = $1 and year = 2018",
      [alphaId],
    );
    await api(request, await sessionToken(c.email), "post", `/cellar/${v2018!.id}/insight`);
    expect(await research()).toBe(2);

    // ---- nothing private reached the catalogue or the shared profiles ----
    const catalogue = await sql<{ text: string }>(
      `select row_to_json(w)::text as text from public.wines w where w.producer_id =
         (select producer_id from public.wines where id = $1)`,
      [alphaId],
    );
    for (const h of households)
      for (const row of catalogue) expect(row.text).not.toContain(h.householdId);
    for (const h of households) await h.close();
  });

  test("an unknown wine still becomes the household's own, and an empty catalogue changes nothing", async ({
    page,
    request,
  }) => {
    const m = marker();
    const { email, householdId } = await arrive(page, "catown");
    const { call } = await apiClient(request, email);
    const own = (
      await call<{ id: string; catalog?: boolean }>(
        "post",
        "/wines",
        { producer: `Unknown Estate ${m}`, name: "Rouge", type: "red", countryCode: "FR" },
        201,
      )
    ).body;
    expect(own.catalog).toBeUndefined();
    const [row] = await sql<{ status: string; owner_household_id: string }>(
      "select status, owner_household_id from public.wines where id = $1",
      [own.id],
    );
    expect(row).toEqual({ status: "provisional", owner_household_id: householdId });
    await call("post", "/bottles", { wineId: own.id, year: 2020, quantity: 1 }, 201);
    // The same producer, name and colour typed for another country is another wine, even when the first one's
    // producer has no country (its wine got one later): never the French wine again.
    const noCountry = (
      await call<{ id: string }>(
        "post",
        "/wines",
        { producer: `Twin Estate ${m}`, name: "Blanc", type: "white" },
        201,
      )
    ).body;
    await sql("update public.wines set country_code = 'FR' where id = $1", [noCountry.id]);
    const italian = (
      await call<{ id: string; countryCode: string | null }>(
        "post",
        "/wines",
        { producer: `Twin Estate ${m}`, name: "Blanc", type: "white", countryCode: "IT" },
        201,
      )
    ).body;
    expect(italian.id).not.toBe(noCountry.id);
    expect(italian.countryCode).toBe("IT");
    // ...and typing it again finds the Italian one, not a third.
    const again = (
      await call<{ id: string }>(
        "post",
        "/wines",
        { producer: `Twin Estate ${m}`, name: "Blanc", type: "white", countryCode: "IT" },
        201,
      )
    ).body;
    expect(again.id).toBe(italian.id);
    // People still cannot write the catalogue.
    const token = await sessionToken(email);
    const direct = await fetch(`${STACK}/rest/v1/rpc/catalog_import`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: "sb_publishable_localstack_0000000000",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ p_entries: [], p_apply: true }),
    });
    expect(direct.ok).toBe(false);
  });
});
