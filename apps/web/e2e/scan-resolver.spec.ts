import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContextOptions,
  type Page,
} from "@playwright/test";
import {
  apiClient,
  arrive,
  audit,
  bearer,
  FEATURES_URL,
  makeJpeg,
  sql,
  stamp,
  STACK,
} from "./helpers";

/**
 * Wine Intelligence WI-03: a label reading is matched through the wine resolver (the `scan_resolver` feature, on the
 * second test server): a bounded set of candidates, the same identity rules, and why each candidate is offered.
 * The readings are programmed (the local stack's fake model): this proves the pipeline, not recognition of real
 * photographs (REAL_LABEL_VALIDATION_PENDING).
 */
test.use({ baseURL: FEATURES_URL });

const marker = () => `${test.info().parallelIndex}${stamp()}`;

const label = (over: Record<string, unknown> = {}) => ({
  is_wine_label: true,
  producer: "x",
  wine_name: "y",
  vintage: 2019,
  non_vintage: false,
  wine_type: "red",
  country_code: "FR",
  region: null,
  appellation: null,
  grapes: [],
  abv_percent: null,
  volume_ml: 750,
  text_seen: "",
  confidence: { producer: "high", wine_name: "high", vintage: "high" },
  ...over,
});

let counter = 0;
const uniqueSize = () => {
  counter += 1;
  const worker = test.info().parallelIndex;
  return {
    width: 440 + worker * 43 + counter * 3 + (Date.now() % 83),
    height: 580 + counter * 7 + worker * 17,
  };
};
type Size = ReturnType<typeof uniqueSize>;
async function program(size: Size, content: unknown) {
  const res = await fetch(`${STACK}/__test/openai`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...size, content }),
  });
  expect(res.ok).toBe(true);
}
const modelCalls = async (size: Size) =>
  (
    (await (
      await fetch(`${STACK}/__test/openai/calls?size=${size.width}x${size.height}`)
    ).json()) as {
      calls: unknown[];
    }
  ).calls.length;

interface ScanBody {
  outcome: "found" | "choose" | "new" | "unread";
  fromText?: boolean;
  remembered?: boolean;
  facts: { year: number | null; nonVintage: boolean } | null;
  matches: Array<{ wine: { id: string; name: string; catalog?: boolean }; score: number }>;
  resolution?: { status: string; reasons: Record<string, string[]> };
}
async function scan(
  request: APIRequestContext,
  token: string,
  photo: Buffer,
  extra: Record<string, string> = {},
): Promise<ScanBody> {
  const res = await request.post("/api/v1/scans", {
    headers: bearer(token),
    multipart: {
      photo: { name: "photo.jpg", mimeType: "image/jpeg", buffer: photo },
      side: "front",
      ...extra,
    },
  });
  expect(res.status()).toBe(200);
  return (await res.json()) as ScanBody;
}

/** A producer with a wine (and its verified alias), its reserve, and a white of the same name as the red. */
async function seedCatalogue(m: string) {
  const producer = `Domaine Resolver ${m}`;
  const entry = (name: string, type: string, aliases: string[] = []) => ({
    producer,
    producer_country: "FR",
    name,
    type,
    region: "Bourgogne",
    vintages: [2018],
    aliases,
    sources: [
      {
        name: "Producer website",
        url: `https://resolver-${m}.example/${encodeURIComponent(name)}`,
      },
    ],
  });
  await sql("select public.catalog_import($1::jsonb, true)", [
    JSON.stringify([
      entry(`Cuvée Alpha ${m}`, "red", [`Alpha ${m}`]),
      entry(`Cuvée Alpha Réserve ${m}`, "red"),
      entry(`Cuvée Beta ${m}`, "red"),
      entry(`Cuvée Beta ${m}`, "white"),
    ]),
  ]);
  const rows = await sql<{ id: string; name: string; wine_type: string }>(
    `select w.id, w.name, w.wine_type from public.wines w join public.producers p on p.id = w.producer_id
      where p.name = $1 and w.status = 'canonical'`,
    [producer],
  );
  const id = (name: string, type = "red") =>
    rows.find((r) => r.name === name && r.wine_type === type)!.id;
  return {
    producer,
    alpha: id(`Cuvée Alpha ${m}`),
    reserve: id(`Cuvée Alpha Réserve ${m}`),
    betaRed: id(`Cuvée Beta ${m}`),
    betaWhite: id(`Cuvée Beta ${m}`, "white"),
  };
}

test.describe("the wine resolver behind a scan", () => {
  test("exact names are found, similar ones are a choice with reasons, and nothing is ever taken from another household or an external source", async ({
    page,
    request,
    browser,
  }) => {
    const m = marker();
    const cat = await seedCatalogue(m);
    const a = await arrive(page, "res-a");
    const { token, call } = await apiClient(request, a.email);
    const read = async (over: Record<string, unknown>, extra: Record<string, string> = {}) => {
      const size = uniqueSize();
      await program(size, label({ producer: cat.producer, ...over }));
      const body = await scan(request, token, await makeJpeg(page, size), extra);
      return { body, size };
    };

    // ---- the exact name: this catalogue wine, with the year as read ----
    const exact = await read({ wine_name: `Cuvée Alpha ${m}`, vintage: 2021 });
    expect(exact.body).toMatchObject({
      outcome: "found",
      facts: { year: 2021, nonVintage: false },
      resolution: { status: "exact_candidate" },
    });
    expect(exact.body.matches.map((x) => x.wine.id)).toEqual([cat.alpha]);
    expect(exact.body.resolution!.reasons[cat.alpha]).toContain("catalog_identity");
    expect(await modelCalls(exact.size)).toBe(1); // one label read: the resolver asks no model

    // ---- a verified alias, in capitals without accents ----
    const alias = await read({
      producer: cat.producer.toUpperCase(),
      wine_name: `ALPHA ${m}`.toUpperCase(),
    });
    expect(alias.body.outcome).toBe("found");
    expect(alias.body.matches[0]!.wine.id).toBe(cat.alpha);
    expect(alias.body.resolution!.reasons[cat.alpha]).toEqual(
      expect.arrayContaining(["catalog_identity", "alias"]),
    );

    // ---- the reserve is the reserve ----
    const reserve = await read({ wine_name: `Cuvée Alpha Réserve ${m}` });
    expect(reserve.body.outcome).toBe("found");
    expect(reserve.body.matches.map((x) => x.wine.id)).toEqual([cat.reserve]);

    // ---- a name that is exactly neither: a choice, never an assertion ----
    const near = await read({ wine_name: `Alpha Reserve Speciale ${m}` });
    expect(near.body.outcome).not.toBe("found");
    for (const id of Object.keys(near.body.resolution?.reasons ?? {}))
      expect(near.body.resolution!.reasons[id]).not.toContain("catalog_identity");

    // ---- red and white of one name: the colour read decides; without a colour nobody decides ----
    const white = await read({ wine_name: `Cuvée Beta ${m}`, wine_type: "white" });
    expect(white.body.outcome).toBe("found");
    expect(white.body.matches.map((x) => x.wine.id)).toEqual([cat.betaWhite]);
    const noColour = await read({ wine_name: `Cuvée Beta ${m}`, wine_type: null });
    expect(noColour.body.outcome).toBe("choose");
    // both colours are offered (a third, similar name of the producer may be too); nothing is asserted
    expect(noColour.body.matches.map((x) => x.wine.id)).toEqual(
      expect.arrayContaining([cat.betaRed, cat.betaWhite]),
    );
    expect(noColour.body.resolution!.status).toBe("ambiguous");

    // ---- an unknown year stays unknown; an impossible one is dropped; neither becomes "this year" or NV ----
    const noYear = await read({ wine_name: `Cuvée Alpha ${m}`, vintage: null });
    expect(noYear.body.facts).toMatchObject({ year: null, nonVintage: false });
    const future = await read({ wine_name: `Cuvée Alpha ${m}`, vintage: 2087 });
    expect(future.body).toMatchObject({
      outcome: "found",
      facts: { year: null, nonVintage: false },
    });

    // ---- printed text that names the wine exactly still needs no model at all ----
    const size = uniqueSize();
    const fromText = await scan(request, token, await makeJpeg(page, size), {
      labelText: `${cat.producer}\nCuvée Alpha Réserve ${m}\n2020`,
      labelTextMs: "640",
    });
    expect(fromText).toMatchObject({ outcome: "found", fromText: true, facts: { year: 2020 } });
    expect(fromText.matches[0]!.wine.id).toBe(cat.reserve);
    expect(await modelCalls(size)).toBe(0);

    // ---- the same photo again, once confirmed, is remembered: no model, and its one wine looked up by id ----
    const confirmed = uniqueSize();
    await program(
      confirmed,
      label({ producer: cat.producer, wine_name: `Cuvée Alpha Réserve ${m}`, vintage: 2017 }),
    );
    const photo = await makeJpeg(page, confirmed);
    const first = await scan(request, token, photo);
    expect(first.outcome).toBe("found");
    await call(
      "post",
      "/bottles",
      {
        wineId: cat.reserve,
        year: 2017,
        quantity: 1,
        imageId: (first as unknown as { image: { id: string } }).image.id,
      },
      201,
    );
    const again = await scan(request, token, photo);
    expect(again).toMatchObject({ outcome: "found", remembered: true });
    expect(again.matches[0]!.wine.id).toBe(cat.reserve);
    expect(await modelCalls(confirmed)).toBe(1);

    // ---- the household's own wine of the same name as a catalogue wine: the person chooses ----
    // (made directly, as an older household would have it: typing that name today would reuse the catalogue wine)
    const [own] = await sql<{ id: string }>(
      `with p as (insert into public.producers (name, country_code, status, owner_household_id, origin)
                  values ($1, 'FR', 'provisional', $2, 'user_entered') returning id)
       insert into public.wines (producer_id, name, wine_type, country_code, status, owner_household_id, origin)
       select p.id, $3, 'red', 'FR', 'provisional', $2, 'user_entered' from p returning id`,
      [cat.producer, a.householdId, `Cuvée Alpha ${m}`],
    );
    const both = await read({ wine_name: `Cuvée Alpha ${m}` });
    expect(both.body.outcome).toBe("choose");
    expect(both.body.matches.map((x) => x.wine.id)).toEqual(
      expect.arrayContaining([cat.alpha, own!.id]),
    );

    // ---- another household's wine of exactly the label's name is never a candidate ----
    const secret = `Cuvée Geheim ${m}`;
    const other = await browser.newContext({
      ...(test.info().project.use as BrowserContextOptions),
      baseURL: FEATURES_URL,
    });
    const b = await arrive(await other.newPage(), "res-b");
    const clientB = await apiClient(request, b.email);
    const theirs = await clientB.call<{ id: string }>(
      "post",
      "/wines",
      { producer: `Huis Anders ${m}`, name: secret, type: "red", countryCode: "FR" },
      201,
    );
    const stranger = await read({ producer: `Huis Anders ${m}`, wine_name: secret });
    // (this household's own similar names may be offered: the test's marker is in every name. Never theirs.)
    expect(stranger.body.outcome).not.toBe("found");
    expect(stranger.body.matches.map((x) => x.wine.name)).not.toContain(secret);
    expect(JSON.stringify(stranger.body)).not.toContain(theirs.body.id);
    expect(JSON.stringify(stranger.body.matches)).not.toContain("Huis Anders");
    await other.close();

    // ---- a record of an external source that names the label exactly is never an identity ----
    const provider = `e2er_${m}`.toLowerCase().slice(0, 30);
    await sql("select public.catalog_provider_register($1::jsonb)", [
      JSON.stringify({ id: provider, name: `Testbron ${m}` }),
    ]);
    await sql(
      "select public.admin_catalog_provider_rights($1, $2::jsonb, 'own test data', 'e2e')",
      [
        provider,
        JSON.stringify({
          license: "CC0-1.0",
          may_store: true,
          may_display: true,
          commercial_use: true,
          rights_status: "verified",
          rights_evidence: "Fictitious records written by CELLR for its own end-to-end tests",
          rights_verified_at: "2026-11-13",
          rights_verified_by: "e2e",
          search_scope: "public",
        }),
      ],
    );
    const [run] = await sql<{ id: string }>(
      "select public.catalog_import_run_start($1, 'e2e-1', null, null, null, now()) as id",
      [provider],
    );
    await sql("select public.catalog_external_import($1, $2, $3::jsonb, true)", [
      provider,
      run!.id,
      JSON.stringify([
        {
          external_id: `X${m}`,
          producer: `Bodega Extern ${m}`,
          name: `Tinto Bron ${m}`,
          wine_type: "red",
          country_code: "ES",
        },
      ]),
    ]);
    await sql("select public.catalog_import_run_finish($1, false, '{}'::jsonb)", [run!.id]);
    const external = await read({
      producer: `Bodega Extern ${m}`,
      wine_name: `Tinto Bron ${m}`,
      country_code: "ES",
    });
    expect(external.body.outcome).not.toBe("found");
    expect(external.body.matches.map((x) => x.wine.name)).not.toContain(`Tinto Bron ${m}`);
    expect(JSON.stringify(external.body.matches)).not.toContain("Bodega Extern");
    expect(JSON.stringify(external.body)).not.toContain("Testbron");
    await sql("select public.admin_catalog_provider_disable($1, 'e2e done', 'e2e', true)", [
      provider,
    ]);
  });

  test("on screen: the candidates say what tells them apart, and 'none of these' leads to the form", async ({
    page,
    request,
  }) => {
    const m = marker();
    const cat = await seedCatalogue(m);
    const { email } = await arrive(page, "res-ui");
    const { call } = await apiClient(request, email);
    await call("post", "/storage", { label: "Wine fridge", kind: "fridge", rows: 3, cols: 4 }, 201);
    const takePhoto = async (p: Page, photo: Buffer) =>
      p
        .locator('input[type="file"]')
        .first()
        .setInputFiles({ name: "IMG_1.jpg", mimeType: "image/jpeg", buffer: photo });

    // the colour was not read: red and white of the same name are offered apart, each with its colour and why
    const size = uniqueSize();
    await program(
      size,
      label({ producer: cat.producer, wine_name: `Cuvée Beta ${m}`, wine_type: null }),
    );
    await page.goto("/scan");
    await expect(page.getByRole("button", { name: "Use the camera" })).toBeVisible();
    await takePhoto(page, await makeJpeg(page, size));
    await expect(page.getByRole("heading", { name: "Is it one of these?" })).toBeVisible();
    const candidates = page.getByTestId("scan-candidate");
    // the red and the white of that name, each saying its colour (another similar name may be offered too)
    const beta = candidates.filter({ has: page.getByText(`Cuvée Beta ${m}`, { exact: true }) });
    await expect(beta).toHaveCount(2);
    await expect(beta.filter({ hasText: "White" })).toHaveCount(1);
    await expect(beta.filter({ hasText: "Red" })).toHaveCount(1);
    await expect(page.getByTestId("scan-why").first()).toContainText(
      "Exactly this name in the CELLR catalogue",
    );
    expect(await audit(page)).toEqual([]);
    await page.screenshot({
      path: `test-results/shots/wi03-scan-choose-${test.info().project.name}.png`,
      fullPage: true,
    });

    // "none of these": the form, with what was read, nothing created yet
    await page.getByRole("button", { name: "None of these: it is a new wine" }).click();
    await expect(page.getByRole("heading", { name: "A new wine" })).toBeVisible();
    await expect(page.getByLabel("Wine name")).toHaveValue(`Cuvée Beta ${m}`);

    // an exact reading: one wine, said to be exactly that name, still for the person to confirm or refuse
    const sure = uniqueSize();
    await program(
      sure,
      label({ producer: cat.producer, wine_name: `Cuvée Alpha ${m}`, vintage: 2020 }),
    );
    await page.goto("/scan");
    await expect(page.getByRole("button", { name: "Use the camera" })).toBeVisible();
    await takePhoto(page, await makeJpeg(page, sure));
    await expect(page.getByRole("heading", { name: "We found it" })).toBeVisible();
    await expect(page.getByTestId("scan-candidate")).toHaveAttribute("data-wine", cat.alpha);
    await expect(page.getByTestId("scan-why")).toContainText(
      "Exactly this name in the CELLR catalogue",
    );
    await expect(page.getByRole("button", { name: "Not this one" })).toBeVisible();
    await page.getByRole("button", { name: "Yes, add bottles" }).click();
    await expect(page.getByLabel("Vintage")).toHaveValue("2020");
  });
});
