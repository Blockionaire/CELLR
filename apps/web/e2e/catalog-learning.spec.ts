import { expect, test, type APIRequestContext, type BrowserContextOptions } from "@playwright/test";
import {
  api,
  apiClient,
  arrive,
  bearer,
  makeJpeg,
  sessionToken,
  signIn,
  sql,
  STACK,
} from "./helpers";

/**
 * Catalogue learning, end to end: households scan and add a wine exactly as before; behind the scenes their
 * confirmations become one candidate (counted per household); the admin reviews and publishes it; then the next
 * households find the catalogue wine and reuse its researched profile. No extra AI call anywhere.
 */

const ADMIN_ID = "00000000-0000-4000-8000-00000000ad01";
const ADMIN_EMAIL = "feedback-admin@cellr.invalid";

const marker = () =>
  `${test.info().parallelIndex}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

async function program(plan: Record<string, unknown>) {
  const res = await fetch(`${STACK}/__test/openai`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(plan),
  });
  expect(res.ok).toBe(true);
}
const calls = async (query: string) =>
  ((await (await fetch(`${STACK}/__test/openai/calls?${query}`)).json()) as { calls: unknown[] })
    .calls.length;

async function scan(request: APIRequestContext, token: string, photo: Buffer) {
  const res = await request.post("/api/v1/scans", {
    headers: bearer(token),
    multipart: {
      photo: { name: "photo.jpg", mimeType: "image/jpeg", buffer: photo },
      side: "front",
    },
  });
  expect(res.status()).toBe(200);
  return (await res.json()) as { outcome: string; image: { id: string } };
}

test.describe("catalogue learning", () => {
  test.afterEach(async () => {
    // The switch is shared by every test: leave it as it ships.
    await sql("update public.catalog_learning set mode = 'off'");
  });

  test("households confirm, the admin publishes, the next households find it and reuse its profile", async ({
    page,
    browser,
    request,
  }) => {
    test.setTimeout(240_000);
    const m = marker();
    const producer = `Domaine Learning ${m}`;
    const wine = `Cuvée Gamma ${m}`;
    const label = {
      is_wine_label: true,
      producer,
      wine_name: wine,
      vintage: 2019,
      non_vintage: false,
      wine_type: "red",
      country_code: "FR",
      region: "Bourgogne",
      appellation: null,
      grapes: [],
      abv_percent: null,
      volume_ml: 750,
      text_seen: `${producer} ${wine} 2019`,
      confidence: { producer: "high", wine_name: "high", vintage: "high" },
    };
    const size = { width: 470 + test.info().parallelIndex * 17, height: 610 + (Date.now() % 53) };
    await program({ ...size, content: label });
    const visionCalls = () => calls(`size=${size.width}x${size.height}`);

    // ---- the admin switches learning on (opt-out), after updating the privacy text ----
    await sql("insert into auth.users (id, email) values ($1, $2) on conflict do nothing", [
      ADMIN_ID,
      ADMIN_EMAIL,
    ]);
    const adminContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const admin = await adminContext.newPage();
    await signIn(admin, ADMIN_EMAIL);
    await admin.goto("/admin/catalog");
    await admin.getByLabel("Catalogue learning").selectOption("opt_out");
    await admin.getByRole("button", { name: "Save" }).click();
    await expect(admin.getByText("Catalogue learning is now opt_out.")).toBeVisible();

    // ---- five households scan the same label and add bottles, exactly as before ----
    const people: Array<{ email: string; householdId: string; close: () => Promise<void> }> = [];
    for (let i = 0; i < 7; i++) {
      const context = await browser.newContext(test.info().project.use as BrowserContextOptions);
      const who = await arrive(await context.newPage(), `learn${i}`);
      people.push({ ...who, close: () => context.close() });
    }
    const photo = await makeJpeg(page, { ...size, words: "Gamma" });
    for (const [i, who] of people.slice(0, 5).entries()) {
      const token = await sessionToken(who.email);
      const read = await scan(request, token, photo);
      expect(read.outcome).toBe("new");
      const { call } = await apiClient(request, who.email);
      const created = (
        await call<{ id: string }>(
          "post",
          "/wines",
          { producer, name: wine, type: "red", countryCode: "FR", region: "Bourgogne" },
          201,
        )
      ).body;
      // Household A adds five bottles: still one confirmation.
      await call(
        "post",
        "/bottles",
        { wineId: created.id, year: 2019, quantity: i === 0 ? 5 : 1, imageId: read.image.id },
        201,
      );
    }
    // One vision call per scan, nothing more for the catalogue.
    expect(await visionCalls()).toBe(5);
    const [candidate] = await sql<{ id: string; status: string }>(
      "select id, status from public.catalog_candidates where producer = $1",
      [producer],
    );
    expect(candidate).toMatchObject({ status: "open" });
    expect(
      await sql<{ n: string }>(
        "select count(*) as n from public.catalog_evidence where candidate_id = $1 and source = 'scan'",
        [candidate!.id],
      ),
    ).toEqual([{ n: "5" }]);
    // Nothing is published by reaching the threshold.
    expect(
      await sql("select 1 from public.wines where status = 'canonical' and name = $1", [wine]),
    ).toHaveLength(0);

    // ---- a signed-in tester cannot open the review (or a candidate) ----
    await arrive(page, "learntester");
    expect((await page.goto("/admin/catalog"))?.status()).toBe(404);
    expect((await page.goto(`/admin/catalog/${candidate!.id}`))?.status()).toBe(404);

    // ---- the admin reviews: ready, no households named, a verified source, approve ----
    await admin.goto("/admin/catalog?state=review_ready&sort=households");
    const row = admin.getByRole("row").filter({ hasText: wine });
    await expect(row).toContainText("5 label");
    await expect(row).toContainText("Ready for review");
    for (const who of people)
      await expect(admin.locator("body")).not.toContainText(who.householdId);
    await row.getByRole("link").click();
    await expect(admin.getByRole("heading", { level: 1 })).toContainText(wine);
    await admin.getByLabel("Name", { exact: true }).fill("Producer website");
    await admin.getByLabel("https link").fill(`https://learning-${m}.example/gamma`);
    await admin.getByLabel("I checked it names this exact wine").check();
    await admin.getByRole("button", { name: "Save source" }).click();
    await expect(admin.getByText("Source saved.")).toBeVisible();
    await admin.getByRole("button", { name: "Approve and publish" }).click();
    await expect(admin.getByText("Published to the catalogue (created).")).toBeVisible();
    const [canonical] = await sql<{ id: string }>(
      "select id from public.wines where status = 'canonical' and name = $1",
      [wine],
    );
    expect(canonical).toBeTruthy();
    // The households' own wines and bottles are untouched.
    expect(
      await sql("select 1 from public.wines where status = 'provisional' and name = $1", [wine]),
    ).toHaveLength(5);

    // ---- the next household types it and gets the catalogue wine; its profile is researched once ----
    await program({
      match: wine,
      consulted: [`https://learning-${m}.example/gamma`],
      content: {
        summary: `${wine}: a precise Burgundy.`,
        style: "Red",
        grapes: ["Pinot Noir"],
        tasting: "Cherry.",
        serving_temp_min_c: 15,
        serving_temp_max_c: 17,
        decant_minutes: 20,
        abv_percent: 13,
        pairings: ["Duck"],
        aging: "Ten years.",
        body: 3,
        tannin: 3,
        sweetness: 1,
        acidity: 4,
        flavors: [{ group: "red_fruit", notes: ["Cherry"] }],
        pairing_kinds: ["poultry"],
        drink_from_year: 2022,
        drink_until_year: 2032,
        country_code: "FR",
        region: "Bourgogne",
        appellation: null,
        confidence: "high",
        evidence: "exact_wine",
        sources: [{ name: "Producer", url: `https://learning-${m}.example/gamma` }],
      },
    });
    const research = () => calls(`match=${encodeURIComponent(wine)}`);
    const [f, g] = [people[5]!, people[6]!];
    for (const who of [f, g]) {
      const { call } = await apiClient(request, who.email);
      const typed = (
        await call<{ id: string; catalog?: boolean }>(
          "post",
          "/wines",
          { producer: producer.toUpperCase(), name: wine, type: "red", countryCode: "FR" },
          201,
        )
      ).body;
      expect(typed).toMatchObject({ id: canonical!.id, catalog: true });
      await call("post", "/bottles", { wineId: canonical!.id, year: 2019, quantity: 1 }, 201);
    }
    const [v] = await sql<{ id: string }>(
      "select id from public.wine_vintages where wine_id = $1 and year = 2019",
      [canonical!.id],
    );
    expect(
      (
        await api(request, await sessionToken(f.email), "post", `/cellar/${v!.id}/insight`)
      ).status(),
    ).toBe(200);
    expect(await research()).toBe(1);
    expect(
      (
        await api(request, await sessionToken(g.email), "post", `/cellar/${v!.id}/insight`)
      ).status(),
    ).toBe(200);
    expect(await research()).toBe(1); // reused: no second research call

    // ---- a person sees the choice in Profile, and can say no ----
    const profile = await browser.newContext(test.info().project.use as BrowserContextOptions);
    const p = await profile.newPage();
    await signIn(p, people[1]!.email);
    await p.goto("/profile");
    const section = p.getByTestId("catalog-contribution");
    await expect(section).toContainText("You are helping.");
    await section.getByRole("button", { name: "Stop helping" }).click();
    await expect(section).toContainText("You are not helping");
    expect(
      await sql(
        "select 1 from public.catalog_evidence e join public.wines w on w.id = e.wine_id where w.owner_household_id = $1",
        [people[1]!.householdId],
      ),
    ).toHaveLength(0);

    await profile.close();
    await adminContext.close();
    for (const who of people) await who.close();
  });
});
