import { expect, test, type BrowserContextOptions } from "@playwright/test";
import { api, apiClient, arrive, audit, sessionToken, sql, wineBody } from "./helpers";

const shot = (name: string) => `test-results/shots/${name}.png`;
const project = () => test.info().project.name;
type Call = Awaited<ReturnType<typeof apiClient>>["call"];

/** A wine with four bottles in a fridge, and a small cabinet with room for two. */
async function furnish(call: Call) {
  const fridge = (
    await call<{ id: string }>(
      "post",
      "/storage",
      { label: "Wine fridge", kind: "fridge", rows: 2, cols: 4 },
      201,
    )
  ).body;
  const cabinet = (
    await call<{ id: string }>(
      "post",
      "/storage",
      { label: "Cabinet", kind: "cabinet", rows: 1, cols: 2 },
      201,
    )
  ).body;
  const wine = (await call<{ id: string }>("post", "/wines", wineBody, 201)).body;
  const added = (
    await call<{ bottleIds: string[] }>(
      "post",
      "/bottles",
      { wineId: wine.id, year: 2019, quantity: 4, locationId: fridge.id, priceCents: 2500 },
      201,
    )
  ).body;
  const [v] = await sql<{ id: string }>("select id from public.wine_vintages where wine_id = $1", [
    wine.id,
  ]);
  return { fridge, cabinet, vintageId: v!.id, bottleIds: added.bottleIds };
}

const statusOf = async (id: string) =>
  (
    await sql<{ status: string; location_id: string | null }>(
      "select status, location_id from public.bottles where id = $1",
      [id],
    )
  )[0]!;

test.describe("several bottles at once", () => {
  test("remove a few with one Undo, give one away, and see them in the history", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "bulk");
    const { call } = await apiClient(request, email);
    const { vintageId, bottleIds } = await furnish(call);

    await page.goto(`/cellar/${vintageId}`);
    await expect(page.getByTestId("bottle-count")).toHaveText("4");
    await page.getByRole("button", { name: "Select bottles" }).click();
    const boxes = page.getByRole("checkbox", { name: /Select the bottle in/ });
    await expect(boxes).toHaveCount(4);
    await expect(page.getByText("Nothing selected")).toBeVisible();
    await boxes.nth(0).check();
    await boxes.nth(1).check();
    await expect(page.getByText("2 bottles selected")).toBeVisible();
    await page.screenshot({ path: shot(`bulk-${project()}`), fullPage: true });
    expect(await audit(page)).toEqual([]);

    await page.getByRole("button", { name: "Remove", exact: true }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toContainText("Remove 2 bottles?");
    await sheet.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(page.getByText("2 bottles removed.")).toBeVisible();
    await expect(page.getByTestId("bottle-count")).toHaveText("2");
    expect((await statusOf(bottleIds[0]!)).status).toBe("removed");

    // One Undo brings both back, in their old spots.
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByTestId("bottle-count")).toHaveText("4");
    expect((await statusOf(bottleIds[0]!)).location_id).not.toBeNull();

    // Give one away.
    await page.getByRole("button", { name: "Select bottles" }).click();
    await page
      .getByRole("checkbox", { name: /Select the bottle in/ })
      .first()
      .check();
    await page.getByRole("button", { name: "Gave away" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Gave away" }).click();
    await expect(page.getByText("1 bottle marked as given away.")).toBeVisible();
    await expect(page.getByTestId("bottle-count")).toHaveText("3");
    expect(
      await sql("select 1 from public.bottles where id = any($1) and status = 'gifted'", [
        bottleIds,
      ]),
    ).toHaveLength(1);

    // And it all shows in the history, with a way back.
    await page.goto("/cellar/history");
    await expect(page.getByRole("heading", { name: "History", level: 1 })).toBeVisible();
    await expect(page.getByTestId("history-item")).toHaveCount(1);
    await expect(page.getByTestId("history-item")).toContainText("Given away");
    await page.screenshot({ path: shot(`history-${project()}`), fullPage: true });
    expect(await audit(page)).toEqual([]);
    await page.getByRole("button", { name: /^Put .* back in the cellar$/ }).click();
    await expect(page.getByText("Back in your cellar.")).toBeVisible();
    await expect(page.getByTestId("history-item")).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Nothing has left your cellar yet" }),
    ).toBeVisible();
  });

  test("move several to a place: they take the next free spots, and what doesn't fit stays put", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "bulkmove");
    const { call } = await apiClient(request, email);
    const { vintageId, bottleIds, cabinet } = await furnish(call);

    await page.goto(`/cellar/${vintageId}`);
    await page.getByRole("button", { name: "Select bottles" }).click();
    await page.getByRole("button", { name: "Select all" }).click();
    await expect(page.getByText("4 bottles selected")).toBeVisible();
    await page.getByRole("button", { name: "Move to…" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /Cabinet/ })
      .click();
    await expect(
      page.getByText(/2 moved to Cabinet\. 2 bottles stayed where they were: no room\./),
    ).toBeVisible();
    const inCabinet = await sql(
      "select 1 from public.bottles where location_id = $1 and vintage_id = $2",
      [cabinet.id, vintageId],
    );
    expect(inCabinet).toHaveLength(2);

    // Undo puts them back where they were.
    await page.getByRole("button", { name: "Undo" }).click();
    await expect
      .poll(
        async () =>
          (await sql("select 1 from public.bottles where location_id = $1", [cabinet.id])).length,
      )
      .toBe(0);
    expect(bottleIds).toHaveLength(4);
  });
});

test.describe("the history, on its own", () => {
  test("is the household's alone, and shows what was opened with the stars you gave", async ({
    page,
    browser,
    request,
  }) => {
    const { email } = await arrive(page, "hist");
    const { call, token } = await apiClient(request, email);
    const { bottleIds, vintageId } = await furnish(call);
    await call("patch", `/bottles/${bottleIds[0]}`, { action: "open" }, 200);
    await call("put", `/bottles/${bottleIds[0]}/tasting`, { score: 9 }, 200);
    await call("patch", `/bottles/${bottleIds[1]}`, { action: "remove", reason: "gifted" }, 200);
    await call("patch", `/bottles/${bottleIds[2]}`, { action: "remove" }, 200);
    expect((await statusOf(bottleIds[1]!)).status).toBe("gifted");

    await page.goto("/cellar/history");
    await expect(page.getByTestId("history-item")).toHaveCount(3);
    await expect(page.getByTestId("history-item").filter({ hasText: "Opened" })).toContainText(
      "4.5 stars",
    );
    await expect(page.getByTestId("history-item").filter({ hasText: "Removed" })).toHaveCount(1);
    // Only an opened bottle's wine has a page to go to.
    await expect(
      page.getByTestId("history-item").filter({ hasText: "Opened" }).getByRole("link"),
    ).toHaveAttribute("href", `/cellar/${vintageId}`);

    const context = await browser.newContext(test.info().project.use as BrowserContextOptions);
    const otherPage = await context.newPage();
    const other = await arrive(otherPage, "histother");
    const theirs = (await (
      await api(request, await sessionToken(other.email), "get", "/cellar/history")
    ).json()) as { items: unknown[] };
    expect(theirs.items).toHaveLength(0);
    // ...and cannot put your bottle back.
    const restore = await api(
      request,
      await sessionToken(other.email),
      "patch",
      `/bottles/${bottleIds[2]}`,
      { action: "restore" },
    );
    expect(restore.ok()).toBe(false);
    await context.close();
    expect((await statusOf(bottleIds[2]!)).status).toBe("removed");
    void token;
  });

  test("the API knows only the two ways to leave", async ({ page, request }) => {
    const { email } = await arrive(page, "reason");
    const { call } = await apiClient(request, email);
    const { bottleIds } = await furnish(call);
    expect(
      (await call("patch", `/bottles/${bottleIds[0]}`, { action: "remove", reason: "stolen" }))
        .status,
    ).toBe(422);
    expect(
      (await call("patch", `/bottles/${bottleIds[0]}`, { action: "remove", reason: "removed" }))
        .status,
    ).toBe(200);
  });
});
