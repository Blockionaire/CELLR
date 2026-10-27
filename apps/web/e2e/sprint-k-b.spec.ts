import { expect, test } from "@playwright/test";
import { apiClient, arrive, rateStars, sql } from "./helpers";

/**
 * Sprint K, part B: Ratings is one tap from Home, explains what the ratings say (only with enough wines behind
 * each insight), and a new rating shows up in the taste profile without anything being asked of the AI.
 */

type Call = Awaited<ReturnType<typeof apiClient>>["call"];

async function opened(call: Call, wine: Record<string, string>, quantity = 1) {
  const w = (await call<{ id: string }>("post", "/wines", { countryCode: "FR", ...wine }, 201))
    .body;
  const { bottleIds } = (
    await call<{ bottleIds: string[] }>(
      "post",
      "/bottles",
      { wineId: w.id, year: 2018, quantity, locationId: null },
      201,
    )
  ).body;
  for (const id of bottleIds) await call("patch", `/bottles/${id}`, { action: "open" }, 200);
  const [v] = await sql<{ id: string }>("select id from public.wine_vintages where wine_id = $1", [
    w.id,
  ]);
  return { vintageId: v!.id, bottleIds };
}

test("from Home to Ratings, with honest insights; a new rating reaches the taste profile", async ({
  page,
  request,
}) => {
  const { email, householdId } = await arrive(page, "kratings");
  const { call } = await apiClient(request, email);
  // Three reds from Bourgogne I rate highly, three whites from the Loire I rate lower; one red rated twice.
  const reds = [];
  for (const i of [0, 1, 2])
    reds.push(
      await opened(
        call,
        { producer: `Rouge ${i}`, name: "Cuvée", type: "red", region: "Bourgogne" },
        i === 0 ? 2 : 1,
      ),
    );
  for (const [i, score] of [6, 7, 6.4].entries()) {
    const w = await opened(call, {
      producer: `Blanc ${i}`,
      name: "Cuvée",
      type: "white",
      region: "Loire",
    });
    await call("put", `/bottles/${w.bottleIds[0]}/tasting`, { score }, 200);
  }
  for (const [i, r] of reds.entries())
    await call("put", `/bottles/${r.bottleIds[0]}/tasting`, { score: [9, 8.4, 9][i] }, 200);
  await call("put", `/bottles/${reds[0]!.bottleIds[1]}/tasting`, { score: 10 }, 200); // same wine again

  // Home: six different wines rated (the same wine twice counts once), one tap to Ratings.
  await page.goto("/");
  const entry = page.getByTestId("home-ratings");
  await expect(entry).toContainText("6 wines rated");
  await entry.click();
  await expect(page).toHaveURL(/\/ratings$/);

  const insights = page.getByTestId("rating-insights");
  const byType = insights.getByTestId("insights-by-type");
  await expect(byType.getByRole("listitem")).toHaveCount(2);
  await expect(byType.getByRole("listitem").first()).toContainText("Red");
  await expect(byType.getByRole("listitem").first()).toContainText("3 wines");
  await expect(insights).toContainText("Bourgogne");
  await expect(insights).not.toContainText("Loire"); // rated too low to be a favourite
  // The distribution puts 4.2 stars in 4–4.4, not rounded up.
  await expect(page.getByText("4–4.4 stars: 1", { exact: false })).toBeAttached();

  // Rate a seventh wine in the app, then open the taste profile from Ratings: it already counts it.
  const extra = await opened(call, {
    producer: "Rouge 9",
    name: "Cuvée",
    type: "red",
    region: "Bourgogne",
  });
  await page.goto(`/cellar/${extra.vintageId}?rate=${extra.bottleIds[0]}`);
  const sheet = page.getByRole("dialog", { name: "How was it?" });
  await expect(sheet).toBeVisible();
  await rateStars(page, 4.6);
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet).toBeHidden();
  await page.goto("/ratings");
  await page.getByTestId("to-taste").click();
  await expect(page).toHaveURL(/\/taste-profile$/);
  await expect(page.getByText("Wines rated", { exact: true }).locator("..")).toContainText("7");
  // All of this was worked out from the ratings: no AI was asked.
  expect(
    await sql("select 1 from public.ai_usage where household_id = $1", [householdId]),
  ).toHaveLength(0);
});
