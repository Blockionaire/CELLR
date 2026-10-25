import { expect, test, type APIRequestContext } from "@playwright/test";
import { apiClient, arrive, audit, sql } from "./helpers";

type Call = Awaited<ReturnType<typeof apiClient>>["call"];

/** A wine with one opened bottle, rated. Returns the bottle. */
async function rated(
  call: Call,
  wine: { producer: string; name: string; type: string; region?: string },
  score: number,
) {
  const w = (await call<{ id: string }>("post", "/wines", { countryCode: "ES", ...wine }, 201))
    .body;
  const { bottleIds } = (
    await call<{ bottleIds: string[] }>(
      "post",
      "/bottles",
      { wineId: w.id, year: 2015, quantity: 1, locationId: null },
      201,
    )
  ).body;
  await call("patch", `/bottles/${bottleIds[0]}`, { action: "open" }, 200);
  await call("put", `/bottles/${bottleIds[0]}/tasting`, { score }, 200);
  return bottleIds[0]!;
}

const client = async (request: APIRequestContext, email: string) =>
  (await apiClient(request, email)).call;

test("an established profile: favourites need three wines, kinds have their own tab, others never count", async ({
  page,
  browser,
  request,
}) => {
  // Someone else's household with many highly rated Bordeaux: never part of my profile.
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  const { email: otherEmail } = await arrive(otherPage, "taste-other");
  const otherCall = await client(request, otherEmail);
  for (const n of [1, 2, 3])
    await rated(
      otherCall,
      { producer: `Other ${n}`, name: "Claret", type: "red", region: "Bordeaux" },
      10,
    );
  await other.close();

  const { email } = await arrive(page, "taste");
  const call = await client(request, email);
  const bottles: string[] = [];
  for (const [n, s] of [
    [1, 10],
    [2, 9],
    [3, 8],
  ] as const)
    bottles.push(
      await rated(
        call,
        { producer: `Bodega ${n}`, name: "Reserva", type: "red", region: "Rioja" },
        s,
      ),
    );
  // The best one is archived: its only bottle is gone. Its tasting still counts; its page no longer opens.
  await sql("delete from public.bottles where id = $1::uuid", [bottles[0]]);
  await rated(
    call,
    { producer: "Domaine Blanc", name: "Chablis", type: "white", region: "Burgundy" },
    6,
  );

  // Reached from My Ratings.
  await page.goto("/ratings");
  await page.getByTestId("to-taste").click();
  await expect(page).toHaveURL(/\/taste-profile$/);
  const hero = page.getByRole("region", { name: "Your tasting so far" });
  await expect(hero.getByText("Wines tasted")).toBeVisible();
  await expect(hero.getByText("4", { exact: true }).first()).toBeVisible();

  const panel = page.getByRole("tabpanel");
  await expect(panel.getByText("Rioja", { exact: true })).toBeVisible();
  await expect(panel.getByText("Bordeaux")).toHaveCount(0);
  await expect(panel.getByText("From 3 different wines you rated").first()).toBeVisible();
  const archived = panel.getByTestId("example-archived").filter({ hasText: "Bodega 1 Reserva" });
  await expect(archived.first()).toBeVisible();
  await expect(panel.getByRole("link", { name: /Bodega 1 Reserva/ })).toHaveCount(0);
  await expect(panel.getByRole("link", { name: /Bodega 2 Reserva/ }).first()).toHaveAttribute(
    "href",
    /^\/cellar\/[0-9a-f-]{36}$/,
  );
  // No grapes known for these wines: said, not guessed.
  await expect(panel.getByText(/Grapes are not known for enough of your wines/)).toBeVisible();

  await page.getByRole("tab", { name: "White" }).click();
  // One rated white: too few for an average of its own.
  await expect(panel.getByText("1 wine tasted, 1 rated", { exact: true })).toBeVisible();
  await expect(panel.getByText(/Not enough yet/).first()).toBeVisible();
  await page.getByRole("tab", { name: "Rosé" }).click();
  await expect(panel.getByText("You have not rated any Rosé yet.")).toBeVisible();
  expect(await audit(page)).toEqual([]);
});

test("a new taster: a short, skippable onboarding; answers are kept and can be edited or cleared", async ({
  page,
}) => {
  await arrive(page, "taste-new");
  await page.goto("/profile");
  await page.getByTestId("taste-entry").click();
  await expect(
    page.getByText("Rate the bottles you open and your profile fills in here."),
  ).toBeVisible();

  await page.getByRole("button", { name: "Start" }).click();
  const sheet = page.getByRole("dialog", { name: "Your taste in a minute" });
  await sheet.getByRole("radio", { name: "Mostly red" }).click();
  await sheet.getByRole("radiogroup", { name: "Body" }).getByRole("radio", { name: "4" }).click();
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByText("You: Full")).toBeVisible();
  // The offer is gone once answered, and the answer survives a reload (stored on the server).
  await page.reload();
  await expect(page.getByText("You: Full")).toBeVisible();
  await expect(page.getByRole("button", { name: "Start" })).toHaveCount(0);

  // Edit: clear body again.
  await page.getByRole("button", { name: "Edit" }).click();
  const edit = page.getByRole("dialog", { name: "Your taste" });
  await edit.getByRole("radiogroup", { name: "Body" }).getByRole("radio", { name: "—" }).click();
  await edit.getByRole("button", { name: "Save" }).click();
  await expect(edit).toBeHidden();
  await expect(page.getByText("You: Full")).toHaveCount(0);
});
