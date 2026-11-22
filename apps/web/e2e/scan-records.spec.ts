import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import {
  apiClient,
  arrive,
  audit,
  bearer,
  chooseFile,
  FEATURES_URL,
  makeJpeg,
  sql,
  stamp,
  STACK,
} from "./helpers";

/**
 * Sprint 004C: the whole chain for a wine nobody in CELLR has added yet, but which a source shown to people knows.
 * Scan → reading → no CELLR wine → "Could be this wine" (the external record, named with its source and licence)
 * → the person uses it → the new-wine form, filled in and marked as not verified → confirmed → the wine and its
 * bottle → the wine page credits the source the data came from (R-27). Switching the source off removes the credit,
 * never the wine or the bottles.
 *
 * Every source and record here is fictitious, written by these tests (the local stack's fake label model does the
 * reading). No real X-Wines or LWIN data is used: those sources stay off for people.
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
  country_code: "ES",
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
    width: 452 + worker * 41 + counter * 3 + (Date.now() % 79),
    height: 596 + counter * 7 + worker * 13,
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

interface RecordHit {
  recordId: string;
  producer: string;
  name: string;
  type: string | null;
  provider: { id: string; name: string } | null;
}
interface ScanBody {
  outcome: "found" | "choose" | "new" | "unread";
  matches: Array<{ wine: { id: string } }>;
  resolution?: {
    status: string;
    records?: Array<{ hit: RecordHit; reasons: string[] }>;
  };
}
async function scan(request: APIRequestContext, token: string, photo: Buffer): Promise<ScanBody> {
  const res = await request.post("/api/v1/scans", {
    headers: bearer(token),
    multipart: {
      photo: { name: "photo.jpg", mimeType: "image/jpeg", buffer: photo },
      side: "front",
    },
  });
  expect(res.status()).toBe(200);
  return (await res.json()) as ScanBody;
}

/** A fictitious source with one red Rioja. `shown: false`: its records are stored, then the source is taken out of
 * people's search (scope "off", what X-Wines and LWIN are today; unverified sources cannot even be imported here). */
async function seedSource(
  m: string,
  options: {
    shown?: boolean;
    type?: string;
    producer?: string;
    name?: string;
    licenseUrl?: string;
  } = {},
) {
  const shown = options.shown ?? true;
  const provider = `e2e_rec_${m}`.toLowerCase().slice(0, 30);
  const providerName = `Fictieve Bron ${m}`;
  const producer = options.producer ?? `Bodega Extern ${m}`;
  const name = options.name ?? `Tinto Fixture ${m}`;
  await sql("select public.catalog_provider_register($1::jsonb)", [
    JSON.stringify({ id: provider, name: providerName }),
  ]);
  const rights = (scope: "public" | "off") =>
    sql("select public.admin_catalog_provider_rights($1, $2::jsonb, $3, $4)", [
      provider,
      JSON.stringify({
        license: "CC0-1.0",
        ...(options.licenseUrl ? { license_url: options.licenseUrl } : {}),
        attribution: "CELLR test fixture (not real data)",
        may_store: true,
        may_display: true,
        commercial_use: true,
        rights_status: "verified",
        rights_evidence: "Fictitious records written by CELLR for its own end-to-end tests",
        rights_verified_at: "2026-11-20",
        rights_verified_by: "e2e",
        search_scope: scope,
      }),
      "CELLR's own test data",
      "e2e",
    ]);
  await rights("public");
  const [run] = await sql<{ id: string }>(
    "select public.catalog_import_run_start($1, 'e2e-1', null, null, null, now()) as id",
    [provider],
  );
  await sql("select public.catalog_external_import($1, $2, $3::jsonb, true)", [
    provider,
    run!.id,
    JSON.stringify([
      {
        external_id: `R${m}`,
        producer,
        name,
        wine_type: options.type ?? "red",
        country_code: "ES",
        region: "Rioja",
        vintages: [2019, 2020],
      },
    ]),
  ]);
  await sql("select public.catalog_import_run_finish($1, false, '{}'::jsonb)", [run!.id]);
  if (!shown) await rights("off");
  const [rec] = await sql<{ id: string }>(
    "select id from public.catalog_external_records where provider_id = $1 and external_id = $2",
    [provider, `R${m}`],
  );
  return { provider, providerName, producer, name, recordId: rec!.id };
}

const disable = (provider: string) =>
  sql("select public.admin_catalog_provider_disable($1, $2, $3, true)", [
    provider,
    "rights withdrawn (e2e)",
    "e2e",
  ]);

/** A new run of the source that no longer lists any record: what it listed before is withdrawn. */
async function withdrawAll(provider: string) {
  const [run] = await sql<{ id: string }>(
    "select public.catalog_import_run_start($1, 'e2e-2', null, null, null, now()) as id",
    [provider],
  );
  await sql("select public.catalog_import_run_finish($1, true, '{}'::jsonb)", [run!.id]);
}

const countOf = async (query: string, params: unknown[]) =>
  (await sql<{ n: number }>(query, params))[0]!.n;
const winesOf = (householdId: string) =>
  countOf("select count(*)::int as n from public.wines where owner_household_id = $1", [
    householdId,
  ]);
const originsOf = (householdId: string) =>
  countOf("select count(*)::int as n from public.wine_record_origins where household_id = $1", [
    householdId,
  ]);

const takePhoto = async (p: Page, photo: Buffer) =>
  chooseFile(p.locator('input[type="file"]').first(), {
    name: "IMG_1.jpg",
    mimeType: "image/jpeg",
    buffer: photo,
  });

async function openSources(page: Page) {
  const section = page.getByTestId("sources");
  await expect(section).toBeVisible();
  await section.getByText("Sources & reliability", { exact: true }).click();
  await expect(page.getByTestId("sources-identity")).toBeVisible();
  return section;
}

test.describe("scan → an external record → a wine of your own, with where it came from", () => {
  test("the record is offered, used, confirmed and credited; switching the source off keeps the wine", async ({
    page,
  }) => {
    const m = marker();
    const ext = await seedSource(m);
    const { householdId } = await arrive(page, "rec-ui");

    // the label is read; CELLR has no such wine, a source shown to people does
    const size = uniqueSize();
    await program(size, label({ producer: ext.producer, wine_name: ext.name, vintage: 2019 }));
    await page.goto("/scan");
    await expect(page.getByRole("button", { name: "Use the camera" })).toBeVisible();
    await takePhoto(page, await makeJpeg(page, size));
    await expect(page.getByRole("heading", { name: "A new wine" })).toBeVisible();

    const suggestions = page.getByTestId("record-suggestions");
    await expect(suggestions).toBeVisible();
    await expect(suggestions.getByRole("heading", { name: "Could be this wine" })).toBeVisible();
    const card = page.getByTestId("record-suggestion");
    await expect(card).toHaveCount(1);
    await expect(card).toHaveAttribute("data-record", ext.recordId);
    await expect(card).toContainText(`${ext.producer} — ${ext.name}`);
    // the credit the licence asks for, on the card: the source's own attribution, the licence, not verified, and
    // that the source does not endorse CELLR (the source names no licence link: none is shown)
    await expect(page.getByTestId("record-suggestion-credit")).toHaveText(
      "Source: CELLR test fixture (not real data) · licence CC0-1.0 · not verified by CELLR",
    );
    await expect(page.getByTestId("record-suggestion-endorsement")).toHaveText(
      `${ext.providerName} is not affiliated with and does not endorse CELLR.`,
    );
    await expect(page.getByTestId("record-suggestion-license")).toHaveCount(0);
    await expect(
      card.getByRole("button", { name: "Use these details" }),
    ).toHaveAccessibleDescription(`${ext.producer} — ${ext.name}`);
    expect(await audit(page)).toEqual([]);
    await page.screenshot({
      path: `test-results/shots/004c-scan-record-${test.info().project.name}.png`,
      fullPage: true,
    });
    // offering created nothing
    expect(
      await sql("select count(*)::int as n from public.wines where owner_household_id = $1", [
        householdId,
      ]),
    ).toEqual([{ n: 0 }]);

    // "use these details": the form, filled in from the record, named as not verified, every field open
    await card.getByRole("button", { name: "Use these details" }).click();
    await expect(page.getByTestId("record-suggestions")).toHaveCount(0);
    await expect(page.getByTestId("new-wine-notice")).toContainText(ext.providerName);
    await expect(page.getByTestId("new-wine-notice")).toContainText("has not verified");
    await expect(page.getByLabel("Producer")).toHaveValue(ext.producer);
    await expect(page.getByLabel("Wine name")).toHaveValue(ext.name);
    await expect(page.getByLabel("Region")).toHaveValue("Rioja");
    expect(await audit(page)).toEqual([]);

    // confirmed with the bottle, on the same screen (the year read off the label)
    await page.getByRole("button", { name: "Add 1 bottle" }).click();
    await expect(page.getByText(new RegExp(`1 bottle of ${ext.producer}`))).toBeVisible();

    const wines = await sql<{ id: string; status: string; origin: string }>(
      "select id, status, origin from public.wines where owner_household_id = $1",
      [householdId],
    );
    expect(wines).toHaveLength(1);
    expect(wines[0]).toMatchObject({ status: "provisional", origin: "user_entered" });
    const wineId = wines[0]!.id;
    // where it came from is kept (R-27), with the record as it was when used
    expect(
      await sql(
        `select provider_id, external_id, record_producer, record_name, matches_record, unlinked_at
           from public.wine_record_origins where wine_id = $1`,
        [wineId],
      ),
    ).toEqual([
      {
        provider_id: ext.provider,
        external_id: `R${m}`,
        record_producer: ext.producer,
        record_name: ext.name,
        matches_record: true,
        unlinked_at: null,
      },
    ]);
    // the catalogue is untouched and the record is not made a CELLR identity
    // (scoped to this producer: other workers import catalogue wines at the same time)
    expect(
      await sql(
        `select count(*)::int as n from public.wines w join public.producers p on p.id = w.producer_id
          where w.status = 'canonical' and p.name = $1`,
        [ext.producer],
      ),
    ).toEqual([{ n: 0 }]);
    expect(
      await sql("select count(*)::int as n from public.catalog_record_links where record_id = $1", [
        ext.recordId,
      ]),
    ).toEqual([{ n: 0 }]);

    // the wine page credits the source the details were taken from
    const [vintage] = await sql<{ id: string }>(
      "select id from public.wine_vintages where wine_id = $1 and year = 2019",
      [wineId],
    );
    await page.goto(`/cellar/${vintage!.id}`);
    await openSources(page);
    const derived = page.getByTestId("source-derived-from");
    await expect(derived).toBeVisible();
    await expect(derived).toContainText("taken from this source");
    await expect(derived.getByTestId("source-credit")).toContainText(ext.providerName);
    expect(await audit(page)).toEqual([]);
    await page.screenshot({
      path: `test-results/shots/004c-wine-derived-${test.info().project.name}.png`,
      fullPage: true,
    });

    // the source is switched off: the credit goes; the wine, the bottle and the history stay
    await disable(ext.provider);
    await page.reload();
    await openSources(page);
    await expect(page.getByTestId("source-derived-from")).toHaveCount(0);
    expect(
      await sql(
        `select (select count(*)::int from public.wines where id = $1) as wines,
                (select count(*)::int from public.bottles b join public.wine_vintages v on v.id = b.vintage_id
                  where v.wine_id = $1) as bottles,
                (select count(*)::int from public.wine_record_origins where wine_id = $1) as origins`,
        [wineId],
      ),
    ).toEqual([{ wines: 1, bottles: 1, origins: 1 }]);
  });

  test("never offered: a known CELLR wine, a source not shown to people, a contradicting colour; a switched-off source records nothing", async ({
    page,
    request,
  }) => {
    const m = marker();
    const shown = await seedSource(`${m}s`);
    const hidden = await seedSource(`${m}h`, { shown: false });
    const white = await seedSource(`${m}w`, { type: "white" });
    const a = await arrive(page, "rec-api");
    const { token, call } = await apiClient(request, a.email);
    const read = async (over: Record<string, unknown>) => {
      const size = uniqueSize();
      await program(size, label(over));
      return scan(request, token, await makeJpeg(page, size));
    };
    const recordIds = (b: ScanBody) => (b.resolution?.records ?? []).map((r) => r.hit.recordId);

    // the shown source: offered, as a record (never as a wine), with its source named
    const offered = await read({ producer: shown.producer, wine_name: shown.name });
    expect(offered.outcome).toBe("new");
    expect(recordIds(offered)).toEqual([shown.recordId]);
    expect(offered.resolution!.records![0]!.hit.provider).toMatchObject({ id: shown.provider });
    expect(offered.matches.map((x) => x.wine.id)).not.toContain(shown.recordId);

    // a source not shown to people (scope off): its record does not exist for people
    // (the names here differ from the shown source's by one character, so its record may be offered as a similar
    // name: a suggestion of a shown source is allowed; the hidden record never is)
    const notShown = await read({ producer: hidden.producer, wine_name: hidden.name });
    expect(recordIds(notShown)).not.toContain(hidden.recordId);
    for (const r of notShown.resolution?.records ?? [])
      expect(r.hit.provider?.id).toBe(shown.provider);

    // a red label never suggests a white record
    const contradicted = await read({ producer: white.producer, wine_name: white.name });
    expect(recordIds(contradicted)).not.toContain(white.recordId);
    for (const r of contradicted.resolution?.records ?? []) expect(r.hit.type).toBe("red");

    // a wine the household already has, read exactly: the wine is found, no record is offered
    const made = await call<{ id: string }>(
      "post",
      "/wines",
      { producer: shown.producer, name: shown.name, type: "red", countryCode: "ES" },
      201,
    );
    const known = await read({ producer: shown.producer, wine_name: shown.name });
    expect(known.outcome).toBe("found");
    expect(known.matches.map((x) => x.wine.id)).toEqual([made.body.id]);
    expect(known.resolution?.records ?? []).toEqual([]);
    // a Reserva label of that wine, or its white: offered as a choice, never "found" (review of Sprint 004C)
    for (const over of [{ wine_name: `${shown.name} Reserva` }, { wine_type: "white" }]) {
      const other = await read({ producer: shown.producer, wine_name: shown.name, ...over });
      expect(other.outcome).toBe("choose");
      expect(other.resolution?.status).toBe("ambiguous");
      expect(other.matches.map((x) => x.wine.id)).toContain(made.body.id);
    }

    // a record of a source switched off since it was shown: the wine is still created, no origin is kept
    await disable(shown.provider);
    const later = await call<{ id: string }>(
      "post",
      "/wines",
      {
        producer: `${shown.producer} Twee`,
        name: shown.name,
        type: "red",
        countryCode: "ES",
        sourceRecordId: shown.recordId,
      },
      201,
    );
    expect(
      await sql("select count(*)::int as n from public.wine_record_origins where wine_id = $1", [
        later.body.id,
      ]),
    ).toEqual([{ n: 0 }]);
    // and an unknown record id is no error either
    const unknown = await call<{ id: string }>(
      "post",
      "/wines",
      {
        producer: `${shown.producer} Drie`,
        name: shown.name,
        type: "red",
        countryCode: "ES",
        sourceRecordId: "00000000-0000-4000-8000-000000000000",
      },
      201,
    );
    expect(
      await sql("select count(*)::int as n from public.wine_record_origins where wine_id = $1", [
        unknown.body.id,
      ]),
    ).toEqual([{ n: 0 }]);
  });
  test("in Dutch, on a dropped connection and with an expired session: nothing half-made, nothing twice", async ({
    page,
  }) => {
    const m = marker();
    const ext = await seedSource(m);
    const second = await seedSource(`${m}b`, {
      producer: `Casa Segunda ${m}`,
      name: `Garnacha Lenta ${m}`,
      licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    });
    const { email, householdId } = await arrive(page, "rec-nl");
    await sql(
      "update public.profiles set locale = 'nl' where id = (select id from auth.users where email = $1)",
      [email],
    );
    const size = uniqueSize();
    await program(size, label({ producer: ext.producer, wine_name: ext.name }));
    await page.goto("/scan");
    // the app switches itself to the profile's language with a reload: wait for it before anything is sent
    await expect(page.getByRole("heading", { level: 1, name: "Scan een etiket" })).toBeVisible();
    await takePhoto(page, await makeJpeg(page, size));
    await expect(page.getByRole("heading", { name: "Een nieuwe wijn" })).toBeVisible();
    const suggestions = page.getByTestId("record-suggestions");
    await expect(suggestions.getByRole("heading", { name: "Mogelijk deze wijn" })).toBeVisible();
    await expect(page.getByTestId("record-suggestion-credit")).toHaveText(
      "Bron: CELLR test fixture (not real data) · licentie CC0-1.0 · niet geverifieerd door CELLR",
    );
    await expect(page.getByTestId("record-suggestion-endorsement")).toHaveText(
      `${ext.providerName} is niet verbonden aan CELLR en onderschrijft CELLR niet.`,
    );
    expect(await audit(page)).toEqual([]);
    await page.screenshot({
      path: `test-results/shots/004c-scan-record-nl-${test.info().project.name}.png`,
      fullPage: true,
    });
    // the whole review (wine, labels, bottles) on one screen, in Dutch: nothing sticks out sideways on a phone
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
    await page.getByRole("button", { name: "Gebruik deze gegevens" }).click();
    await expect(page.getByTestId("new-wine-notice")).toContainText("niet heeft geverifieerd");

    // the connection drops as the wine is saved: said so, nothing created, the form keeps what was there
    let dropped = 0;
    await page.route("**/api/v1/wines", (route) => {
      if (route.request().method() === "POST" && dropped === 0) {
        dropped += 1;
        return route.abort("internetdisconnected");
      }
      return route.continue();
    });
    await page.getByRole("button", { name: "1 fles toevoegen" }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "We konden CELLR niet bereiken" }),
    ).toBeVisible();
    expect(dropped).toBe(1);
    expect(await winesOf(householdId)).toBe(0);
    await expect(page.getByLabel("Producent")).toHaveValue(ext.producer);

    // tried again: one wine and one origin, however often it was tried
    await page.getByRole("button", { name: "1 fles toevoegen" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Toegevoegd aan je kelder." }),
    ).toBeVisible();
    expect(await winesOf(householdId)).toBe(1);
    expect(await originsOf(householdId)).toBe(1);

    // a second label, and the session runs out before it is confirmed: nothing is created behind the person's back
    const again = uniqueSize();
    await program(again, label({ producer: second.producer, wine_name: second.name }));
    await page.goto("/scan");
    await takePhoto(page, await makeJpeg(page, again));
    // (the test marker the two wines share makes the one just added look alike: "is het een van deze?", where the
    // record is offered beneath the household's own wine)
    await expect(page.getByRole("heading", { name: "Is het een van deze?" })).toBeVisible();
    const secondCard = page.locator(
      `[data-testid="record-suggestion"][data-record="${second.recordId}"]`,
    );
    await expect(secondCard.getByTestId("record-suggestion-license")).toHaveAttribute(
      "href",
      "https://creativecommons.org/publicdomain/zero/1.0/",
    );
    await expect(secondCard.getByTestId("record-suggestion-license")).toHaveText(
      "Licentie: CC0-1.0",
    );
    await page
      .locator(`[data-testid="record-suggestion"][data-record="${second.recordId}"]`)
      .getByRole("button", { name: "Gebruik deze gegevens" })
      .click();
    await expect(page.getByTestId("new-wine-notice")).toContainText(second.providerName);
    await expect(page.getByLabel("Producent")).toHaveValue(second.producer);
    await page.context().clearCookies();
    await page.getByRole("button", { name: "1 fles toevoegen" }).click();
    // named: after a client-side navigation Next.js also renders an (empty) route announcer with role="alert"
    await expect(
      page.getByRole("alert").filter({ hasText: "Log in om verder te gaan." }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Toegevoegd aan je kelder." })).toHaveCount(0);
    expect(await winesOf(householdId)).toBe(1);
    expect(await originsOf(householdId)).toBe(1);
  });

  test("readings that cannot be trusted, and a record withdrawn while it is on screen", async ({
    page,
  }) => {
    const m = marker();
    const ext = await seedSource(m);
    const other = await seedSource(`${m}o`, {
      producer: `Viña Lejana ${m}`,
      name: `Crianza Distinta ${m}`,
    });
    const { householdId } = await arrive(page, "rec-edge");
    const scanWith = async (over: Record<string, unknown>) => {
      const size = uniqueSize();
      await program(size, label(over));
      await page.goto("/scan");
      await takePhoto(page, await makeJpeg(page, size));
    };

    // not a wine label: nothing is suggested, the person fills it in
    await scanWith({ is_wine_label: false, producer: ext.producer, wine_name: ext.name });
    await expect(page.getByRole("heading", { name: "Fill it in yourself" })).toBeVisible();
    await expect(page.getByTestId("record-suggestions")).toHaveCount(0);

    // only the producer was read: that producer's record, never another producer's
    await scanWith({ producer: other.producer, wine_name: null });
    await expect(page.getByTestId("record-suggestions")).toBeVisible();
    for (const id of await page
      .getByTestId("record-suggestion")
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-record"))))
      expect(id).toBe(other.recordId);

    // a producer nobody knows: no suggestions at all, the form as read
    await scanWith({ producer: `Onbekend Wijnhuis ${m}`, wine_name: `Nergens ${m}` });
    await expect(page.getByRole("heading", { name: "A new wine" })).toBeVisible();
    await expect(page.getByLabel("Wine name")).toHaveValue(`Nergens ${m}`);
    await expect(page.getByTestId("record-suggestions")).toHaveCount(0);

    // the record is on screen, then its source stops listing it: the wine can still be made, credited to no-one
    await scanWith({ producer: ext.producer, wine_name: ext.name });
    await expect(page.getByTestId("record-suggestion")).toHaveAttribute(
      "data-record",
      ext.recordId,
    );
    await withdrawAll(ext.provider);
    await page.getByRole("button", { name: "Use these details" }).click();
    await page.getByRole("button", { name: "Add 1 bottle" }).click();
    await expect(page.getByText(new RegExp(`1 bottle of ${ext.producer}`))).toBeVisible();
    expect(await winesOf(householdId)).toBe(1);
    expect(await originsOf(householdId)).toBe(0);
    const [vintage] = await sql<{ id: string }>(
      `select v.id from public.wine_vintages v join public.wines w on w.id = v.wine_id
        where w.owner_household_id = $1`,
      [householdId],
    );
    await page.goto(`/cellar/${vintage!.id}`);
    await openSources(page);
    await expect(page.getByTestId("source-derived-from")).toHaveCount(0);
    // and the next scan of that label no longer suggests it
    await scanWith({ producer: ext.producer, wine_name: ext.name });
    await expect(page.getByRole("heading", { name: "We found it" })).toBeVisible();
    await expect(page.getByTestId("record-suggestions")).toHaveCount(0);
  });
});
