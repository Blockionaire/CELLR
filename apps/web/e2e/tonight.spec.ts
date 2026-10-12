import { expect, test, type BrowserContextOptions } from "@playwright/test";
import { api, apiClient, arrive, audit, sessionToken, sql } from "./helpers";

const shot = (name: string) => `test-results/shots/${name}.png`;
const project = () => test.info().project.name;
type Call = Awaited<ReturnType<typeof apiClient>>["call"];

const YEAR = new Date().getFullYear();
const WINES = [
  {
    producer: "Château Test",
    name: "Claret",
    type: "red",
    region: "Bordeaux",
    countryCode: "FR",
    year: YEAR - 6,
    cents: 3000,
  },
  {
    producer: "Domaine Test",
    name: "Chablis",
    type: "white",
    region: "Chablis",
    countryCode: "FR",
    year: YEAR - 2,
    cents: 2400,
  },
  {
    producer: "Maison Test",
    name: "Brut",
    type: "sparkling",
    region: "Champagne",
    countryCode: "FR",
    year: YEAR - 3,
    cents: 6500,
  },
  {
    producer: "Cantina Test",
    name: "Barolo",
    type: "red",
    region: "Barolo",
    countryCode: "IT",
    year: YEAR - 12,
    cents: 9000,
  },
];

async function furnish(call: Call) {
  const fridge = (
    await call("post", "/storage", { label: "Wine fridge", kind: "fridge", rows: 4, cols: 5 }, 201)
  ).body as { id: string };
  for (const w of WINES) {
    const wine = (
      await call(
        "post",
        "/wines",
        {
          producer: w.producer,
          name: w.name,
          type: w.type,
          countryCode: w.countryCode,
          region: w.region,
        },
        201,
      )
    ).body as { id: string };
    await call(
      "post",
      "/bottles",
      { wineId: wine.id, year: w.year, quantity: 2, locationId: fridge.id, priceCents: w.cents },
      201,
    );
  }
}

test.describe("what shall we drink tonight", () => {
  test("an empty cellar invites you to add a bottle first", async ({ page }) => {
    await arrive(page, "tonightempty");
    await page.goto("/tonight");
    await expect(page.getByRole("heading", { name: "Add a few bottles first" })).toBeVisible();
    await page.getByRole("link", { name: "Add a bottle" }).click();
    await expect(page).toHaveURL(/\/cellar\/add/);
  });

  test("Home leads here; choose a dish and an occasion, get three bottles with reasons, open one", async ({
    page,
    request,
  }) => {
    const { email, householdId } = await arrive(page, "tonight");
    const { call } = await apiClient(request, email);
    await furnish(call);

    await page.goto("/");
    await page.getByRole("link", { name: /What should we drink tonight/ }).click();
    await expect(page).toHaveURL(/\/tonight/);

    // Nothing can be asked until something has been answered.
    const find = page.getByRole("button", { name: "Find my wine" });
    await expect(find).toBeDisabled();
    await page.getByRole("searchbox", { name: "Find a dish" }).fill("shell");
    await expect(page.getByRole("button", { name: "Steak" })).toHaveCount(0);
    await page.getByRole("button", { name: "Shellfish and oysters" }).click();
    await expect(page.getByTestId("dish-tip")).toContainText("Oysters and Muscadet");
    await page.getByRole("button", { name: "A celebration" }).click();
    await expect(page.getByText("Bubbles and the bottles you waited for.")).toBeVisible();
    await page.screenshot({ path: shot(`tonight-form-${project()}`), fullPage: true });
    await expect(find).toBeEnabled();
    await find.click();

    // Picks, each with where it is and why. Shellfish makes the red wines poor contenders, so two are honest.
    const picks = page.getByTestId("tonight-picks");
    await expect(picks.getByRole("article").first()).toBeVisible();
    expect(await picks.getByRole("article").count()).toBeGreaterThanOrEqual(2);
    await expect(picks.getByRole("article").first()).toContainText("Best match");
    // Shellfish and a celebration: white or bubbles, not the Barolo.
    const best = picks.getByRole("article").first();
    await expect(best.getByRole("heading")).toHaveText(/Chablis|Brut/);
    await expect(best).toContainText("Wine fridge · Shelf");
    await expect(best).toContainText("2 bottles in the cellar");
    await expect(best.getByRole("listitem").first()).toBeVisible();
    await expect(page.getByText("Chose from 4 wines.")).toBeVisible();
    await page.screenshot({ path: shot(`tonight-picks-${project()}`), fullPage: true });

    // Open the best one: the cellar changes, and it asks how it was.
    const name = (await best.getByRole("heading").textContent())!;
    await best.getByRole("button", { name: "Open this bottle" }).click();
    await expect(best.getByRole("status")).toContainText(`Enjoy the ${name}!`);
    await expect
      .poll(
        async () =>
          (
            await sql<{ n: string }>(
              "select count(*)::text as n from public.bottles where household_id = $1 and status = 'opened'",
              [householdId],
            )
          )[0]?.n,
      )
      .toBe("1");
    await best.getByRole("link", { name: "How was it?" }).click();
    await expect(page.getByRole("dialog", { name: "How was it?" })).toBeVisible();
  });

  test("'nothing in particular' works too, and the answers can be changed", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "tonightany");
    const { call } = await apiClient(request, email);
    await furnish(call);
    await page.goto("/tonight");
    await page.getByRole("button", { name: "Nothing in particular" }).click();
    await page.getByRole("button", { name: "A weeknight" }).click();
    await page.getByRole("button", { name: "Find my wine" }).click();
    await expect(page.getByTestId("tonight-picks").getByRole("article").first()).toBeVisible();
    // A weeknight: not the €90 Barolo first.
    await expect(page.getByTestId("tonight-picks").getByRole("article").first()).not.toContainText(
      "Barolo",
    );
    await page.getByRole("button", { name: "Change my answers" }).click();
    await expect(page.getByRole("button", { name: "Find my wine" })).toBeEnabled();
  });

  test("the API: valid requests, refused ones, and nobody else's cellar", async ({
    page,
    browser,
    request,
  }) => {
    const owner = await arrive(page, "tonightapi");
    const { call, token } = await apiClient(request, owner.email);
    await furnish(call);

    type Tonight = {
      picks: Array<{ slot: string; bottleId: string; reasons: string[] }>;
      considered: number;
    };
    const ok = (await call<Tonight>("post", "/tonight", { dish: "steak", occasion: "guests" }, 200))
      .body;
    expect(ok.considered).toBe(4);
    expect(ok.picks[0]?.slot).toBe("best");
    expect(ok.picks.every((p) => p.reasons.length <= 3)).toBe(true);
    // An empty request is "anything goes".
    expect((await call<Tonight>("post", "/tonight", {}, 200)).body.picks.length).toBeGreaterThan(0);
    // A dish that is not on the list, or an occasion that does not exist, is refused.
    expect((await call("post", "/tonight", { dish: "moon cheese" })).status).toBe(422);
    expect((await call("post", "/tonight", { occasion: "wedding" })).status).toBe(422);
    // Not signed in (a token that means nothing): no.
    expect(
      (
        await request.post("/api/v1/tonight", {
          data: {},
          headers: { authorization: "Bearer not-a-real-token" },
        })
      ).status(),
    ).toBe(401);

    // Someone else's cellar never shows up in your picks, nor yours in theirs.
    const context = await browser.newContext(test.info().project.use as BrowserContextOptions);
    const otherPage = await context.newPage();
    const other = await arrive(otherPage, "tonightoth");
    const theirs = await (
      await api(request, await sessionToken(other.email), "post", "/tonight", {})
    ).json();
    expect(theirs).toMatchObject({ considered: 0, picks: [] });
    expect(token).toBeTruthy();
    await context.close();
  });

  test("the form and the results are accessible in both themes", async ({ page, request }) => {
    const { email } = await arrive(page, "tonighta11y");
    const { call } = await apiClient(request, email);
    await furnish(call);
    await page.goto("/tonight");
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await expect.poll(() => audit(page)).toEqual([]);
    }
    await page.getByRole("button", { name: "Steak" }).click();
    await page.getByRole("button", { name: "Find my wine" }).click();
    await expect(page.getByTestId("tonight-picks")).toBeVisible();
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await expect.poll(() => audit(page)).toEqual([]);
      await page.screenshot({ path: shot(`tonight-${scheme}-${project()}`), fullPage: true });
    }
  });
});
