import { expect, test, type Page } from "@playwright/test";
import { apiClient, arrive, audit, makeJpeg, sql, STACK, chooseFile } from "./helpers";

/**
 * Sprint Z — Koopcheck: standing in a shop, photograph a bottle, correct what was read, and see whether it is worth
 * buying given this household's real cellar and the person's own ratings. The photo is never kept, nothing is
 * added, and a correction is compared again without another photo read.
 */

type Call = Awaited<ReturnType<typeof apiClient>>["call"];

const label = (over: Record<string, unknown> = {}) => ({
  is_wine_label: true,
  producer: "Château Koopcheck",
  wine_name: "Grand Vin",
  vintage: 2019,
  non_vintage: false,
  wine_type: "red",
  country_code: "FR",
  region: "Bordeaux",
  appellation: null,
  grapes: [],
  abv_percent: 13.5,
  volume_ml: 750,
  text_seen: "CHATEAU KOOPCHECK GRAND VIN 2019",
  confidence: { producer: "high", wine_name: "high", vintage: "high" },
  ...over,
});

/** Each test's photo has a size nobody else uses: that is how the fake model knows which answer to give. */
let counter = 0;
const uniqueSize = () => {
  counter += 1;
  const worker = test.info().parallelIndex;
  return {
    width: 430 + worker * 37 + counter * 5 + (Date.now() % 71),
    height: 560 + counter * 9 + worker * 11,
  };
};
async function program(
  size: { width: number; height: number },
  plan: { content?: unknown; status?: number },
) {
  const res = await fetch(`${STACK}/__test/openai`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...size, ...plan }),
  });
  expect(res.ok).toBe(true);
}
async function aiCallsFor(size: { width: number; height: number }) {
  const res = await fetch(`${STACK}/__test/openai/calls?size=${size.width}x${size.height}`);
  return ((await res.json()) as { calls: unknown[] }).calls.length;
}

async function addWine(
  call: Call,
  wine: { producer: string; name: string; type?: string; region?: string; countryCode?: string },
  year: number,
  quantity: number,
) {
  const w = (
    await call<{ id: string }>("post", "/wines", { type: "red", countryCode: "FR", ...wine }, 201)
  ).body;
  const { bottleIds } = (
    await call<{ bottleIds: string[] }>(
      "post",
      "/bottles",
      { wineId: w.id, year, quantity, locationId: null },
      201,
    )
  ).body;
  return { wineId: w.id, bottleIds };
}

/** A wine I opened and rated (1..10). */
async function rated(call: Call, producer: string, region: string, score: number) {
  const { bottleIds } = await addWine(call, { producer, name: "Cuvée", region }, 2015, 1);
  await call("patch", `/bottles/${bottleIds[0]}`, { action: "open" }, 200);
  await call("put", `/bottles/${bottleIds[0]}/tasting`, { score }, 200);
}

const counts = async (householdId: string) => {
  const [row] = await sql<{ bottles: string; images: string; reads: string }>(
    `select (select count(*) from public.bottles where household_id = $1) as bottles,
            (select count(*) from public.bottle_images where household_id = $1) as images,
            (select count(*) from public.catalog_scan_reads where household_id = $1) as reads`,
    [householdId],
  );
  return row!;
};

const takePhoto = (page: Page, photo: Buffer) =>
  chooseFile(page.locator('input[type="file"]').first(), {
    name: "IMG_0001.jpg",
    mimeType: "image/jpeg",
    buffer: photo,
  });

/** Chooses a photo once the page is live (a file chosen before it hydrates is not seen), until its preview shows. */
const choosePhoto = (page: Page, photo: Buffer) =>
  expect(async () => {
    await takePhoto(page, photo);
    await expect(page.getByAltText("The photo you chose")).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });

test("from the Sommelier: photograph, correct, compare with the real cellar and taste, nothing kept", async ({
  page,
  browser,
  request,
}) => {
  test.setTimeout(120_000);
  // Another household owns the exact wine: never part of my answer.
  const other = await browser.newPage();
  const them = await arrive(other, "pcother");
  const theirs = (await apiClient(request, them.email)).call;
  await addWine(
    theirs,
    { producer: "Château Koopcheck", name: "Grand Vin", region: "Bordeaux" },
    2019,
    6,
  );
  await other.close();

  const { email, householdId } = await arrive(page, "pcmine");
  const { call } = await apiClient(request, email);
  // This wine, another vintage; a comparable Bordeaux; something unrelated.
  await addWine(
    call,
    { producer: "Château Koopcheck", name: "Grand Vin", region: "Bordeaux" },
    2016,
    2,
  );
  await addWine(call, { producer: "Château Voisin", name: "Rouge", region: "Bordeaux" }, 2018, 3);
  await addWine(
    call,
    { producer: "Domaine Loire", name: "Blanc", type: "white", region: "Loire" },
    2021,
    1,
  );
  // Three Bordeaux reds I liked: a supported match.
  for (const [n, score] of [8, 9, 8].entries())
    await rated(call, `Liked Bordeaux ${n}`, "Bordeaux", score);
  const before = await counts(householdId);

  await page.goto("/sommelier");
  await page.getByTestId("purchase-check-entry").click();
  await expect(page).toHaveURL(/\/sommelier\/purchase-check$/);
  await expect(page.getByRole("heading", { name: "Purchase Check", level: 1 })).toBeVisible();

  const size = uniqueSize();
  await program(size, { content: label() });
  // The chosen photo is shown, and can be removed before anything is sent.
  await choosePhoto(page, await makeJpeg(page, { ...size, words: "Koopcheck" }));
  await page.getByRole("button", { name: "Remove photo" }).click();
  await expect(page.getByAltText("The photo you chose")).toHaveCount(0);
  await choosePhoto(page, await makeJpeg(page, { ...size, words: "Koopcheck" }));
  await page.getByRole("button", { name: "Read this label" }).click();

  const confirm = page.getByTestId("pc-confirm");
  await expect(confirm.getByLabel("Producer", { exact: true })).toHaveValue("Château Koopcheck");
  await expect(confirm.getByLabel("Wine name or cuvée")).toHaveValue("Grand Vin");
  await expect(confirm.getByLabel("Vintage", { exact: true })).toHaveValue("2019");
  await confirm.getByLabel("Asking price per bottle (optional)").fill("24,50");
  await confirm.getByRole("button", { name: "Compare with my cellar" }).click();

  const result = page.getByTestId("pc-result");
  await expect(result).toBeVisible();
  await expect(page.getByTestId("pc-owned")).toHaveAttribute("data-kind", "other_vintages");
  await expect(page.getByTestId("pc-price")).toContainText("24.50");
  const owned = result.locator("section", { has: page.getByTestId("pc-owned") });
  await expect(owned.getByTestId("pc-bottle")).toHaveCount(1);
  await expect(owned.getByTestId("pc-count")).toHaveText("2 bottles"); // mine, not the other household's 6
  const similar = result.locator("section", {
    has: page.getByRole("heading", { name: "Similar wines you already own" }),
  });
  await expect(similar.getByTestId("pc-bottle")).toHaveCount(1);
  await expect(similar.getByText("Château Voisin")).toBeVisible();
  await expect(similar.getByText("Same region: Bordeaux · Same country")).toBeVisible();
  await expect(page.getByTestId("pc-taste")).toHaveAttribute("data-fit", "positive");
  await expect(page.getByTestId("pc-verdict")).toHaveAttribute("data-verdict", "consider");
  await expect(page.getByText(/not a guarantee/)).toBeVisible();
  expect(await audit(page)).toEqual([]);
  if (test.info().project.name === "phone")
    await page.screenshot({ path: "test-results/shots/sprint-z-result-light.png", fullPage: true });

  // Correct the vintage: compared again, without another photo read.
  await result.getByRole("button", { name: "Correct the wine" }).click();
  await confirm.getByLabel("Vintage", { exact: true }).fill("2016");
  await confirm.getByRole("button", { name: "Compare with my cellar" }).click();
  await expect(page.getByTestId("pc-owned")).toHaveAttribute("data-kind", "exact");
  expect(await aiCallsFor(size)).toBe(1);
  const usage = await sql<{ task: string; status: string }>(
    `select u.task, u.status from public.ai_usage u join auth.users a on a.id = u.user_id
      where a.email = $1`,
    [email],
  );
  expect(usage).toEqual([{ task: "purchase_check", status: "ok" }]);

  // Nothing was kept or added: no photo, no catalogue signal, no bottle.
  expect(await counts(householdId)).toEqual(before);

  // The similar wine opens its own page in this household.
  await similar.getByTestId("pc-bottle").getByRole("link").first().click();
  await expect(page).toHaveURL(/\/cellar\/[0-9a-f-]{36}/);
});

test("the label can't be read: type it in, with an empty cellar and no ratings the claims stay small", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await arrive(page, "pcmanual");
  await page.goto("/sommelier/purchase-check");
  const size = uniqueSize();
  await program(size, { status: 500, content: { error: { message: "down" } } });
  await choosePhoto(page, await makeJpeg(page, size));
  await page.getByRole("button", { name: "Read this label" }).click();
  const confirm = page.getByTestId("pc-confirm");
  await expect(
    confirm.getByText("The label couldn't be read just now. Type the wine in below."),
  ).toBeVisible();
  await expect(confirm.getByLabel("Producer", { exact: true })).toHaveValue("");
  await confirm.getByRole("button", { name: "Compare with my cellar" }).click();
  await expect(confirm.getByText("Fill in the producer.")).toBeVisible();
  await confirm.getByLabel("Producer", { exact: true }).fill("Bodega Nueva");
  await confirm.getByRole("button", { name: "Red" }).click();
  await confirm.getByRole("button", { name: "Compare with my cellar" }).click();

  await expect(page.getByTestId("pc-owned")).toHaveAttribute("data-kind", "none");
  await expect(
    page.getByText("Your cellar is still empty, so there's nothing to compare it with yet."),
  ).toBeVisible();
  await expect(page.getByTestId("pc-taste")).toHaveText(
    "Not enough information about your preferences yet.",
  );
  await expect(page.getByTestId("pc-verdict")).toHaveAttribute("data-verdict", "depends");

  await page.getByRole("button", { name: "Check another wine" }).click();
  await expect(page.getByTestId("pc-photo")).toBeVisible();
});

test("in Dutch, and in the dark: the entry and the result read as CELLR", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  const { email, householdId } = await arrive(page, "pcnl");
  await sql(
    "update public.profiles set locale = 'nl' where id = (select id from auth.users where email = $1)",
    [email],
  );
  const { call } = await apiClient(request, email);
  await addWine(
    call,
    { producer: "Château Koopcheck", name: "Grand Vin", region: "Bordeaux" },
    2019,
    3,
  );
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/sommelier");
  await expect(page.getByText("Koopcheck — Is deze wijn het kopen waard?")).toBeVisible();
  await page.getByTestId("purchase-check-entry").click();
  // Typing it in: at once, or (with the wine search on) one step past the search.
  const manual = page.getByTestId("pc-manual");
  await expect(manual).toHaveText(/^(Typ de wijn liever zelf in|Handmatig zoeken)$/);
  await manual.click();
  const confirm = page.getByTestId("pc-confirm");
  const typeIt = page.getByTestId("pc-type");
  await expect(confirm.or(typeIt)).toBeVisible();
  if (await typeIt.isVisible()) await typeIt.click();
  await confirm.getByLabel("Producent", { exact: true }).fill("Château Koopcheck");
  await confirm.getByLabel("Wijnnaam of cuvée").fill("Grand Vin");
  await confirm.getByLabel("Jaargang", { exact: true }).fill("2019");
  await confirm.getByRole("button", { name: "Rood" }).click();
  await confirm.getByRole("button", { name: "Vergelijk met mijn kelder" }).click();
  await expect(page.getByTestId("pc-owned")).toHaveAttribute("data-kind", "exact");
  await expect(
    page.getByText("Je hebt al 3 flessen van precies deze wijn en jaargang."),
  ).toBeVisible();
  await expect(page.getByTestId("pc-verdict")).toHaveAttribute("data-verdict", "skip");
  expect(await audit(page)).toEqual([]);
  if (test.info().project.name === "phone")
    await page.screenshot({
      path: "test-results/shots/sprint-z-result-dark-nl.png",
      fullPage: true,
    });
  expect((await counts(householdId)).images).toBe("0");
});

test("the API: signed in only, bounded and validated input, one household's data", async ({
  page,
  request,
}) => {
  // No session: refused before anything is read (no credentials at all, or a token that is not one).
  const body = { data: { wine: { producer: "X" } } };
  expect((await request.post("/api/v1/sommelier/purchase-check/compare", body)).status()).toBe(403);
  expect(
    (
      await request.post("/api/v1/sommelier/purchase-check/compare", {
        ...body,
        headers: { authorization: "Bearer nope" },
      })
    ).status(),
  ).toBe(401);

  const { email } = await arrive(page, "pcapi");
  const { call } = await apiClient(request, email);
  expect(
    (await call("post", "/sommelier/purchase-check/compare", { wine: { producer: "" } })).status,
  ).toBe(422);
  expect(
    (
      await call("post", "/sommelier/purchase-check/compare", {
        wine: { producer: "X", year: 3000 },
      })
    ).status,
  ).toBe(422);
  const ok = await call<{ ownership: { kind: string }; cellarBottles: number }>(
    "post",
    "/sommelier/purchase-check/compare",
    { wine: { producer: "Château Koopcheck", name: "Grand Vin", year: 2019, type: "red" } },
    200,
  );
  // Others own this wine (the tests above), this household does not.
  expect(ok.body).toMatchObject({ ownership: { kind: "none" }, cellarBottles: 0 });
});
