import { expect, test, type Page } from "@playwright/test";
import { makeBottlePng, publishArt } from "./hero-art";
import { apiClient, arrive, audit, chooseFile, makeJpeg, sql, stamp, STACK } from "./helpers";

/**
 * Unified Scan, PR 3: on the scan's review, an optional invitation to send 1 to 3 whole-bottle photos for the 2D
 * bottle library. The photos stay on the device until the bottles are saved, and are sent only then, with the
 * explicit yes, to the vintage just added. Adding never waits for them or depends on them.
 */

const marker = () => `${test.info().parallelIndex}${stamp()}`;

const label = (over: Record<string, unknown> = {}) => ({
  is_wine_label: true,
  producer: "x",
  wine_name: "y",
  vintage: 2021,
  non_vintage: false,
  wine_type: "red",
  country_code: "FR",
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
    width: 461 + worker * 53 + counter * 3 + (Date.now() % 73),
    height: 603 + counter * 7 + worker * 23,
  };
};
async function program(size: { width: number; height: number }, content: unknown) {
  const res = await fetch(`${STACK}/__test/openai`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...size, content }),
  });
  expect(res.ok).toBe(true);
}
async function scanLabel(page: Page, content: unknown) {
  const size = uniqueSize();
  await program(size, content);
  await page.goto("/scan");
  await expect(page.getByTestId("shutter")).toBeVisible();
  await chooseFile(page.locator('input[type="file"]').first(), {
    name: "IMG_0001.jpg",
    mimeType: "image/jpeg",
    buffer: await makeJpeg(page, size),
  });
  await expect(page.getByTestId("scan-review")).toBeVisible();
}

const userOf = async (email: string) =>
  (await sql<{ id: string }>("select id from auth.users where email = $1", [email]))[0]!.id;
const contributions = (userId: string) =>
  sql<{ vintage: string; photos: number; status: string }>(
    `select s.source_vintage_id as vintage, s.status,
            (select count(*)::int from public.bottle_photo_images i where i.submission_id = s.id) as photos
       from public.bottle_photo_submissions s where s.user_id = $1`,
    [userId],
  );
const vintageOf = async (householdId: string) =>
  (
    await sql<{ id: string }>(
      "select distinct vintage_id as id from public.bottles where household_id = $1",
      [householdId],
    )
  ).map((r) => r.id);

const invite = (page: Page) => page.getByTestId("scan-photo-invite");

/** In the invitation's sheet: `n` photos, the yes (unless refused), and "keep". */
async function keepPhotos(page: Page, n: number) {
  await invite(page).getByRole("button", { name: "Take bottle photos" }).click();
  const sheet = page.getByTestId("scan-photo-sheet");
  await expect(sheet).toBeVisible();
  for (let i = 0; i < n; i++)
    await chooseFile(sheet.locator('input[type="file"]'), {
      name: `bottle-${i}.jpg`,
      mimeType: "image/jpeg",
      buffer: await makeJpeg(page, { width: 900 + i, height: 1600 }),
    });
  await expect(sheet.getByTestId("bottle-photo-previews").locator("li")).toHaveCount(n);
  const keep = sheet.getByRole("button", { name: /^Keep/ });
  // nothing is kept without the explicit yes
  await expect(keep).toBeDisabled();
  await sheet.getByRole("checkbox").check();
  await keep.click();
  await expect(invite(page)).toHaveAttribute("data-state", "kept");
  await expect(invite(page).getByTestId("scan-photo-kept").locator("img")).toHaveCount(n);
}

test.describe("the invitation on the scan's review", () => {
  for (const n of [1, 2, 3])
    test(`a new wine with ${n} photo${n > 1 ? "s" : ""}: kept on the device, sent once the bottle is added`, async ({
      page,
    }) => {
      const { email, householdId } = await arrive(page, `invite${n}`);
      const user = await userOf(email);
      const m = marker();
      await scanLabel(page, label({ producer: `Domaine Foto ${m}`, wine_name: `Cuvée ${n}` }));
      await expect(invite(page)).toBeVisible();
      await expect(
        invite(page).getByRole("heading", { name: "Make your bottle visible in CELLR" }),
      ).toBeVisible();
      await expect(invite(page)).toContainText(
        "Take 1–3 photos of your bottle and help build the 2D bottle library.",
      );
      let uploads = 0;
      page.on("request", (r) => {
        if (r.method() === "POST" && r.url().endsWith("/api/v1/bottle-photos")) uploads += 1;
      });
      await keepPhotos(page, n);
      if (n === 1) {
        expect(await audit(page)).toEqual([]);
        await page.screenshot({
          path: `test-results/shots/scan-photo-invite-${test.info().project.name}.png`,
          fullPage: true,
        });
      }
      // kept, not sent: nothing has left the phone, and nothing is made in the database
      expect(uploads).toBe(0);
      expect(await contributions(user)).toEqual([]);

      await page.getByRole("button", { name: "Add 1 bottle" }).click();
      await expect(page.getByTestId("scan-photo-result")).toHaveAttribute("data-state", "sent");
      expect(uploads).toBe(1);
      const [added] = await vintageOf(householdId);
      expect(await contributions(user)).toEqual([{ vintage: added, photos: n, status: "pending" }]);
      // asked on the review: not a second time on the "added" screen
      await expect(page.getByTestId("bottle-photo-offer")).toHaveCount(0);
    });

  test("'maybe later' and a refused yes: nothing is sent, the bottle is added, the flow does not ask again", async ({
    page,
  }) => {
    const { email } = await arrive(page, "invitelater");
    const user = await userOf(email);
    const m = marker();
    await scanLabel(page, label({ producer: `Domaine Later ${m}`, wine_name: "Un" }));
    // photos chosen but the yes not given: the sheet is closed, nothing is kept
    await invite(page).getByRole("button", { name: "Take bottle photos" }).click();
    const sheet = page.getByTestId("scan-photo-sheet");
    await chooseFile(sheet.locator('input[type="file"]'), {
      name: "b.jpg",
      mimeType: "image/jpeg",
      buffer: await makeJpeg(page, { width: 910, height: 1600 }),
    });
    await expect(sheet.getByRole("button", { name: /^Keep/ })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(invite(page)).toHaveAttribute("data-state", "ask");
    await invite(page).getByRole("button", { name: "Maybe later" }).click();
    await expect(invite(page)).toHaveCount(0);
    await page.getByRole("button", { name: "Add 1 bottle" }).click();
    await expect(page.getByText(/1 bottle of Domaine Later/)).toBeVisible();
    await expect(page.getByTestId("scan-photo-result")).toHaveCount(0);
    expect(await contributions(user)).toEqual([]);

    // the next bottle in this flow: not asked again
    await page.getByRole("button", { name: "Scan another" }).click();
    const size = uniqueSize();
    await program(size, label({ producer: `Domaine Later ${m}`, wine_name: "Deux" }));
    await chooseFile(page.locator('input[type="file"]').first(), {
      name: "IMG_0002.jpg",
      mimeType: "image/jpeg",
      buffer: await makeJpeg(page, size),
    });
    await expect(page.getByTestId("scan-review")).toBeVisible();
    await expect(invite(page)).toHaveCount(0);
  });

  test("an upload that fails leaves the bottle added; trying again sends it once", async ({
    page,
  }) => {
    const { email, householdId } = await arrive(page, "inviteretry");
    const user = await userOf(email);
    const m = marker();
    await scanLabel(page, label({ producer: `Domaine Retry ${m}`, wine_name: "Encore" }));
    await keepPhotos(page, 2);
    let failed = 0;
    await page.route("**/api/v1/bottle-photos", (route) => {
      if (route.request().method() === "POST" && failed === 0) {
        failed += 1;
        return route.abort("internetdisconnected");
      }
      return route.continue();
    });
    await page.getByRole("button", { name: "Add 1 bottle" }).click();
    const result = page.getByTestId("scan-photo-result");
    await expect(result).toHaveAttribute("data-state", "failed");
    await expect(result).toContainText("The bottle is added.");
    expect(await vintageOf(householdId)).toHaveLength(1);
    expect(await contributions(user)).toEqual([]);
    await result.getByRole("button", { name: "Try again" }).click();
    await expect(result).toHaveAttribute("data-state", "sent");
    expect(await contributions(user)).toHaveLength(1);
    expect((await contributions(user))[0]!.photos).toBe(2);
  });

  test("leaving the 'added' screen while the photos are on their way: a failure is still offered again", async ({
    page,
  }) => {
    const { email } = await arrive(page, "inviteleave");
    const user = await userOf(email);
    const m = marker();
    await scanLabel(page, label({ producer: `Domaine Weg ${m}`, wine_name: "Vertrek" }));
    await keepPhotos(page, 1);
    let failed = 0;
    await page.route("**/api/v1/bottle-photos", async (route) => {
      if (route.request().method() === "POST" && failed === 0) {
        failed += 1;
        await new Promise((r) => setTimeout(r, 1500));
        return route.abort("internetdisconnected");
      }
      return route.continue();
    });
    await page.getByRole("button", { name: "Add 1 bottle" }).click();
    await expect(page.getByTestId("scan-photo-result")).toHaveAttribute("data-state", "sending");
    // on to the next bottle before the photos are through
    await page.getByRole("button", { name: "Scan another" }).click();
    const retries = page.getByTestId("scan-photo-retries");
    await expect(retries).toContainText(`Bottle photos for Domaine Weg ${m} Vertrek weren’t sent.`);
    expect(failed).toBe(1);
    await retries.getByRole("button", { name: "Try again" }).click();
    await expect(retries).toHaveCount(0);
    await expect.poll(async () => (await contributions(user)).length).toBe(1);
  });

  test("not asked for a wine with a published picture, or one the person already sent photos of", async ({
    page,
    request,
  }) => {
    const { email, householdId } = await arrive(page, "invitenone");
    const { call } = await apiClient(request, email);
    const m = marker();
    // a wine of theirs with a published 2D picture
    const pictured = await call<{ id: string }>(
      "post",
      "/wines",
      { producer: `Clos Beeld ${m}`, name: "Afgebeeld", type: "red", countryCode: "FR" },
      201,
    );
    await publishArt(pictured.body.id, await makeBottlePng(page, "#3a1020", "#f4ead8"));
    await scanLabel(page, label({ producer: `Clos Beeld ${m}`, wine_name: "Afgebeeld" }));
    await expect(page.getByRole("heading", { name: "We found it" })).toBeVisible();
    await expect(invite(page)).toHaveCount(0);

    // a wine they sent photos of from an earlier scan: a new flow does not ask again
    await scanLabel(page, label({ producer: `Domaine Eerder ${m}`, wine_name: "Verstuurd" }));
    await keepPhotos(page, 1);
    await page.getByRole("button", { name: "Add 1 bottle" }).click();
    await expect(page.getByTestId("scan-photo-result")).toHaveAttribute("data-state", "sent");
    await scanLabel(page, label({ producer: `Domaine Eerder ${m}`, wine_name: "Verstuurd" }));
    await expect(page.getByRole("heading", { name: "We found it" })).toBeVisible();
    await expect(page.getByLabel("Vintage")).toHaveValue("2021");
    await expect(invite(page)).toHaveCount(0);
    await page.getByRole("button", { name: "Add 1 bottle" }).click();
    await expect(page.getByText(/1 bottle of Domaine Eerder/)).toBeVisible();
    const [bottles] = await sql<{ n: number }>(
      "select count(*)::int as n from public.bottles where household_id = $1",
      [householdId],
    );
    expect(bottles!.n).toBe(2);
  });

  test("a batch: asked once, never in the way; the photos of one bottle go to that bottle's wine", async ({
    page,
  }) => {
    const { email, householdId } = await arrive(page, "invitebatch");
    const user = await userOf(email);
    const m = marker();
    const sizes = [uniqueSize(), uniqueSize()];
    await program(sizes[0]!, label({ producer: `Domaine Rij ${m}`, wine_name: "Eerste" }));
    await program(
      sizes[1]!,
      label({ producer: "Clos Anders", wine_name: "Tweede", country_code: "IT" }),
    );
    await page.goto("/scan");
    await page.waitForLoadState("networkidle");
    await page.getByRole("radio", { name: "Batch" }).click();
    await chooseFile(page.locator('input[type="file"]:not([capture])'), [
      { name: "a.jpg", mimeType: "image/jpeg", buffer: await makeJpeg(page, sizes[0]!) },
      { name: "b.jpg", mimeType: "image/jpeg", buffer: await makeJpeg(page, sizes[1]!) },
    ]);
    const tray = page.getByTestId("series");
    await expect(tray.locator('li[data-status="ready"]')).toHaveCount(2, { timeout: 15_000 });
    await tray.getByRole("button", { name: "Add", exact: true }).first().click();
    await expect(invite(page)).toBeVisible();
    // whichever photo was read first: its photos go to its own wine
    const firstName = await page.getByLabel("Wine name").inputValue();
    expect(["Eerste", "Tweede"]).toContain(firstName);
    await keepPhotos(page, 1);
    await page.getByRole("button", { name: "Add 1 bottle" }).click();
    // on to the next photo at once; the invitation is not made again
    await expect(page.getByLabel("Wine name")).toHaveValue(
      firstName === "Eerste" ? "Tweede" : "Eerste",
    );
    await expect(invite(page)).toHaveCount(0);
    await page.getByRole("button", { name: "Add 1 bottle" }).click();
    await expect(page.getByTestId("series-counts")).toHaveText(/2 added/);
    await expect.poll(async () => (await contributions(user)).length).toBe(1);
    const [first] = await sql<{ id: string }>(
      `select v.id from public.wine_vintages v join public.wines w on w.id = v.wine_id
        where w.owner_household_id = $1 and w.name = $2`,
      [householdId, firstName],
    );
    expect((await contributions(user))[0]!.vintage).toBe(first!.id);
  });
});
