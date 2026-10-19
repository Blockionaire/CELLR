import { expect, test } from "@playwright/test";
import { apiClient, arrive, sql, wineBody } from "./helpers";

/** Sprint B: the collection comes first, the wine page reads before it asks, Tonight leads to the glass. */

type Call = Awaited<ReturnType<typeof apiClient>>["call"];

async function stock(call: Call, n = 4) {
  const fridge = (
    await call<{ id: string }>(
      "post",
      "/storage",
      { label: "Wine fridge", kind: "fridge", rows: 4, cols: 6 },
      201,
    )
  ).body;
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const w = (
      await call<{ id: string }>(
        "post",
        "/wines",
        { ...wineBody, name: `${wineBody.name} ${i + 1}` },
        201,
      )
    ).body;
    const added = (
      await call<{ bottleIds: string[] }>(
        "post",
        "/bottles",
        { wineId: w.id, year: 2019, quantity: 2, locationId: fridge.id },
        201,
      )
    ).body;
    const [v] = await sql<{ vintage_id: string }>(
      "select vintage_id from public.bottles where id = $1",
      [added.bottleIds[0]],
    );
    ids.push(v!.vintage_id);
  }
  return ids;
}

test.describe("collection first", () => {
  test("on a phone, a whole row of wines is on screen before any scrolling", async ({
    page,
    request,
  }) => {
    test.skip(test.info().project.name !== "phone", "a phone layout");
    const { email } = await arrive(page, "rowfirst");
    const { call } = await apiClient(request, email);
    await stock(call);
    await page.goto("/cellar");
    const cards = page.getByRole("article");
    await expect(cards).toHaveCount(4);
    const nav = await page.getByRole("navigation", { name: /Main/ }).last().boundingBox();
    for (const i of [0, 1]) {
      const box = (await cards.nth(i).boundingBox())!;
      expect(box.y + box.height).toBeLessThanOrEqual(nav!.y);
    }
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test("the other cellar pages sit behind one quiet button", async ({ page, request }) => {
    const { email } = await arrive(page, "cellarmore");
    const { call } = await apiClient(request, email);
    await stock(call, 1);
    await page.goto("/cellar");
    await page.getByRole("button", { name: "More from your cellar" }).click();
    const sheet = page.getByRole("dialog", { name: "More from your cellar" });
    await sheet.getByRole("link", { name: "Wishlist" }).click();
    await expect(page).toHaveURL(/\/wishlist$/);
  });
});

test.describe("the wine page", () => {
  test("what is missing waits, folded, at the end", async ({ page, request }) => {
    const { email } = await arrive(page, "complete");
    const { call } = await apiClient(request, email);
    const [vintage] = await stock(call, 1);
    await page.goto(`/cellar/${vintage}`);
    const complete = page.getByTestId("complete-wine");
    // It comes after the reading: below the bottles and their history.
    const after = await page.evaluate(() => {
      const bottles = [...document.querySelectorAll("h2")].find(
        (h) => h.textContent === "The bottles",
      );
      const box = document.querySelector('[data-testid="complete-wine"]');
      return Boolean(
        bottles && box && bottles.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING,
      );
    });
    expect(after).toBe(true);
    // Open while the label photo is missing (the one thing most worth adding), and it folds away on a tap.
    await expect(complete.getByText("Front label", { exact: true })).toBeVisible();
    await expect(
      complete.getByRole("button", { name: "This wine is in here twice…" }),
    ).toBeVisible();
    await complete.locator("summary").click();
    await expect(complete.getByText("Front label", { exact: true })).toBeHidden();
  });
});

test.describe("from Tonight to the glass", () => {
  test("'Take this bottle' opens it, the cellar counts one less, and Undo puts it back", async ({
    page,
    request,
  }) => {
    const { email, householdId } = await arrive(page, "takeit");
    const { call } = await apiClient(request, email);
    const [vintage] = await stock(call, 1);
    // A question nobody taught the test model: the answer comes from the cellar itself (steak → this red).
    const question = `Steak with friends ${Date.now().toString(36)}`;
    await page.goto(`/tonight?ask=${encodeURIComponent(question)}`);
    const take = page.getByRole("link", { name: "Take this bottle" }).first();
    await expect(take).toBeVisible();
    await take.click();
    await expect(page).toHaveURL(new RegExp(`/cellar/${vintage}\\?pick=1$`));
    const sheet = page.getByRole("dialog", { name: "Open a bottle" });
    await expect(sheet.getByText("Easiest to reach")).toBeVisible();
    await sheet.getByRole("button", { name: "Open it" }).click();
    await expect(page.getByText(/Enjoy! 1 bottle left\./)).toBeVisible();
    await expect(page.getByTestId("bottle-count")).toHaveText("1");
    const count = async () =>
      (
        await sql<{ n: string }>(
          "select count(*) n from public.bottles where household_id = $1 and status = 'in_cellar'",
          [householdId],
        )
      )[0]!.n;
    expect(await count()).toBe("1");
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByTestId("bottle-count")).toHaveText("2");
    await expect.poll(count).toBe("2");
  });
});

test.describe("motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("with reduced motion, nothing travels: cards and answers just appear", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "calm");
    const { call } = await apiClient(request, email);
    await stock(call, 2);
    await page.goto("/");
    const durations = await page.evaluate(() =>
      [...document.querySelectorAll(".reveal, .fan-card")].map(
        (el) => parseFloat(getComputedStyle(el).animationDuration) * 1000,
      ),
    );
    expect(durations.length).toBeGreaterThan(0);
    for (const ms of durations) expect(ms).toBeLessThan(1);
  });
});
