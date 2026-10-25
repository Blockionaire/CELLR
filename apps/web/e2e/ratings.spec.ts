import { expect, test, type APIRequestContext } from "@playwright/test";
import { apiClient, arrive, audit, sql } from "./helpers";

type Call = Awaited<ReturnType<typeof apiClient>>["call"];

/** A wine with two opened bottles: one rated with stars, words and a note; one with a note only. */
async function stock(call: Call, producer: string, name: string, type = "red") {
  const wine = (
    await call<{ id: string }>("post", "/wines", { producer, name, type, countryCode: "FR" }, 201)
  ).body;
  const { bottleIds } = (
    await call<{ bottleIds: string[] }>(
      "post",
      "/bottles",
      { wineId: wine.id, year: 2018, quantity: 2, locationId: null },
      201,
    )
  ).body;
  for (const id of bottleIds) await call("patch", `/bottles/${id}`, { action: "open" }, 200);
  const [v] = await sql<{ id: string }>(
    "select id from public.wine_vintages where wine_id = $1 and year = 2018",
    [wine.id],
  );
  return { vintageId: v!.id, bottleIds };
}

async function client(request: APIRequestContext, email: string) {
  return (await apiClient(request, email)).call;
}

test("my ratings: my own tastings in my household, summarised, searchable, and edited in place", async ({
  page,
  browser,
  request,
}) => {
  // Someone else's household, with a tasting that must never show up here.
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  const { email: otherEmail } = await arrive(otherPage, "journal-other");
  const otherCall = await client(request, otherEmail);
  const theirs = await stock(otherCall, "Voisin", "Secret Cuvée");
  await otherCall(
    "put",
    `/bottles/${theirs.bottleIds[0]}/tasting`,
    { score: 2, note: "Not for you." },
    200,
  );
  await other.close();

  const { email } = await arrive(page, "journal");
  const call = await client(request, email);
  const musar = await stock(call, "Château Musar", "Rouge");
  const blanc = await stock(call, "Carbonnieux", "Blanc", "white");
  await call(
    "put",
    `/bottles/${musar.bottleIds[0]}/tasting`,
    { score: 9, descriptors: ["fruity"], note: "Lovely with lamb." },
    200,
  );
  await call("put", `/bottles/${blanc.bottleIds[0]}/tasting`, { score: 6 }, 200);
  await call(
    "put",
    `/bottles/${blanc.bottleIds[1]}/tasting`,
    { note: "Only a note, no stars." },
    200,
  );

  // Found from the cellar's related pages.
  await page.goto("/cellar");
  await page.getByRole("button", { name: "More from your cellar" }).click();
  await page.getByRole("link", { name: "My ratings" }).click();
  await expect(page).toHaveURL(/\/ratings$/);
  await expect(page.getByRole("heading", { name: "My ratings" })).toBeVisible();

  const list = page.getByRole("list", { name: "Your tastings" });
  await expect(list.locator(":scope > li")).toHaveCount(3);
  await expect(page.getByText("Secret Cuvée")).toHaveCount(0);
  await expect(page.getByText("Not for you.")).toHaveCount(0);
  // 3 tastings, 2 wines, average of 9 and 6 = 7.5 → 3.8 stars; the note without stars is still there.
  await expect(page.getByText("Average of 2 ratings")).toBeVisible();
  await expect(page.getByText("3.8", { exact: true })).toBeVisible();
  await expect(list.getByText("Only a note, no stars.")).toBeVisible();
  await expect(list.getByText("No stars", { exact: true })).toBeVisible();

  // Highest first; search; kind of wine.
  await page.getByRole("radio", { name: "Highest" }).click();
  await expect(list.locator("h3").first()).toHaveText("Château Musar");
  await page.getByLabel("Search your ratings").fill("carbonnieux");
  await expect(list.locator(":scope > li")).toHaveCount(2);
  await page.getByLabel("Search your ratings").fill("");
  await page
    .getByRole("group", { name: "Kind of wine" })
    .getByRole("button", { name: "Red" })
    .click();
  await expect(list.locator(":scope > li")).toHaveCount(1);
  expect(await audit(page)).toEqual([]);

  // Edit opens the existing rating sheet for that wine and bottle; the journal follows.
  const edit = list.getByTestId("journal-edit").first();
  await expect(edit).toHaveAttribute(
    "href",
    `/cellar/${musar.vintageId}?rate=${musar.bottleIds[0]}`,
  );
  await edit.click();
  const sheet = page.getByRole("dialog", { name: "How was it?" });
  await expect(sheet).toBeVisible();
  await page.locator("label", { hasText: /^3 stars$/ }).click();
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet).toBeHidden();
  await page.goto("/ratings");
  await expect(page.getByText("Average of 2 ratings")).toBeVisible();
  await expect(
    page
      .getByRole("list", { name: "Your tastings" })
      .getByRole("listitem")
      .filter({ hasText: "Château Musar" })
      .getByText("3", { exact: true }),
  ).toBeVisible();
});

test("an empty journal invites the first tasting, and Profile leads here", async ({ page }) => {
  await arrive(page, "journal-empty");
  await page.goto("/profile");
  await page.getByTestId("ratings-entry").click();
  await expect(page.getByRole("heading", { name: "Your journal is still empty" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Go to your cellar" })).toBeVisible();
});

test("an older bottle's tasting is edited in place; an archived one stays readable without a dead link", async ({
  page,
  request,
}) => {
  const { email } = await arrive(page, "journal-old");
  const call = await client(request, email);
  const wine = (
    await call<{ id: string }>(
      "post",
      "/wines",
      { producer: "Lopez de Heredia", name: "Tondonia", type: "red", countryCode: "ES" },
      201,
    )
  ).body;
  const { bottleIds } = (
    await call<{ bottleIds: string[] }>(
      "post",
      "/bottles",
      { wineId: wine.id, year: 2010, quantity: 14, locationId: null },
      201,
    )
  ).body;
  for (const id of bottleIds) await call("patch", `/bottles/${id}`, { action: "open" }, 200);
  // The first one opened longest ago: outside the 12 the wine's page lists.
  const oldest = bottleIds[0]!;
  await sql("update public.bottles set opened_at = now() - interval '1 year' where id = $1", [
    oldest,
  ]);
  await call("put", `/bottles/${oldest}/tasting`, { score: 8, note: "From the old days." }, 200);

  await page.goto("/ratings");
  const card = page.getByRole("list", { name: "Your tastings" }).locator(":scope > li").first();
  await card.getByTestId("journal-edit").click();
  const sheet = page.getByRole("dialog", { name: "How was it?" });
  await expect(sheet).toBeVisible();
  // The existing tasting is loaded: this edits it, it does not start a second one.
  await expect(sheet.getByLabel("Your note")).toHaveValue("From the old days.");
  await sheet.getByLabel("Your note").fill("Still lovely.");
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet).toBeHidden();
  const rows = await sql<{ n: string }>(
    "select count(*)::text as n from public.tastings where bottle_id = $1",
    [oldest],
  );
  expect(rows[0]!.n).toBe("1");

  // Every bottle of the wine is gone (hard-deleted): the tasting stays, archived, with nowhere broken to go.
  await sql("delete from public.bottles where id = any($1::uuid[])", [bottleIds]);
  await page.goto("/ratings");
  const archived = page.getByRole("list", { name: "Your tastings" }).locator(":scope > li").first();
  await expect(archived.getByText("Still lovely.")).toBeVisible();
  await expect(archived.getByTestId("journal-archived")).toBeVisible();
  await expect(archived.getByTestId("journal-edit")).toHaveCount(0);
  await expect(archived.getByRole("link")).toHaveCount(0);
});
