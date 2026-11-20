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
async function seedSource(m: string, options: { shown?: boolean; type?: string } = {}) {
  const shown = options.shown ?? true;
  const provider = `e2e_rec_${m}`.toLowerCase().slice(0, 30);
  const providerName = `Fictieve Bron ${m}`;
  const producer = `Bodega Extern ${m}`;
  const name = `Tinto Fixture ${m}`;
  await sql("select public.catalog_provider_register($1::jsonb)", [
    JSON.stringify({ id: provider, name: providerName }),
  ]);
  const rights = (scope: "public" | "off") =>
    sql("select public.admin_catalog_provider_rights($1, $2::jsonb, $3, $4)", [
      provider,
      JSON.stringify({
        license: "CC0-1.0",
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
    const canonicalBefore = await sql(
      "select count(*)::int as n from public.wines where status = 'canonical'",
    );

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
    await expect(page.getByTestId("record-suggestion-credit")).toHaveText(
      `Source: ${ext.providerName} · licence CC0-1.0 · not verified by CELLR`,
    );
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

    // confirmed, then the bottle (the year read off the label)
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "How many, and where?" })).toBeVisible();
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
    expect(
      await sql("select count(*)::int as n from public.wines where status = 'canonical'"),
    ).toEqual(canonicalBefore);
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
});
