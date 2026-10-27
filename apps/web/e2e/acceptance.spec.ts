import { expect, test, type BrowserContextOptions, type Page } from "@playwright/test";
import { codeFor, makeJpeg, onboardCreate, rateStars, sql, STACK, uniqueEmail } from "./helpers";

/**
 * The private-beta acceptance flow, start to finish, the way a new person goes through it on a phone:
 * account → code → PIN → household → scan → confirm → several bottles → place → front and back label →
 * find it → open one → rate it → sign out and back in with everything still there.
 *
 * Locally the label is read by the fake model; on the hosted app and a real iPhone the same steps are on the
 * manual checklist (docs/BETA-CHECKLIST.md).
 */

const shot = (name: string) => `test-results/shots/acceptance-${name}.png`;
const PIN = "482916";

async function tapPin(page: Page, pin: string) {
  for (const d of pin) await page.getByRole("button", { name: d, exact: true }).click();
}

/** A photo size nobody else uses: that is how the fake model knows which answer to give. */
async function programLabel(size: { width: number; height: number }) {
  const res = await fetch(`${STACK}/__test/openai`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...size,
      content: {
        is_wine_label: true,
        producer: "Château Musar",
        wine_name: "Château Musar Rouge",
        vintage: 2016,
        non_vintage: false,
        wine_type: "red",
        country_code: "LB",
        region: "Bekaa Valley",
        appellation: null,
        grapes: [],
        abv_percent: 14,
        volume_ml: 750,
        text_seen: "CHATEAU MUSAR 2016 BEKAA VALLEY",
        confidence: { producer: "high", wine_name: "high", vintage: "high" },
      },
    }),
  });
  expect(res.ok).toBe(true);
}

test("a new person, from the first code to signing back in, loses nothing", async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  const email = uniqueEmail("beta");

  // 1–2. An allowed address asks for a code and types it in.
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send me a code" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  await page.getByLabel("6-digit code").fill(await codeFor(email));

  // 3. The optional PIN: yes.
  const offer = page.getByTestId("pin-offer");
  await expect(offer.getByRole("heading", { name: "Sign in faster next time?" })).toBeVisible();
  await offer.getByRole("button", { name: "Set a PIN" }).click();
  await tapPin(page, PIN);
  await expect(page.getByText("And once more, to be sure.")).toBeVisible();
  await tapPin(page, PIN);

  // 4. A household, and a name.
  const household = `Beta House ${Date.now().toString(36)}${test.info().parallelIndex}`;
  await onboardCreate(page, household, "Joost");
  const [house] = await sql<{ id: string }>("select id from public.households where name = $1", [
    household,
  ]);
  const householdId = house!.id;

  // 5. Scan a label: the live camera is not there in this browser, so the phone's camera input takes the photo.
  const size = {
    width: 430 + test.info().parallelIndex * 37 + (Date.now() % 97),
    height: 571 + test.info().parallelIndex * 11,
  };
  await programLabel(size);
  await page.goto("/scan");
  await expect(page.getByTestId("shutter")).toBeVisible();
  await page.screenshot({ path: shot(`scan-${test.info().project.name}`) });
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "IMG_0001.jpg",
      mimeType: "image/jpeg",
      buffer: await makeJpeg(page, { ...size, exif: true, words: "Musar" }),
    });

  // 6. What was read is there to check; the vintage comes along.
  await expect(page.getByRole("heading", { name: "A new wine" })).toBeVisible();
  await expect(page.getByLabel("Producer")).toHaveValue("Château Musar");
  await expect(page.getByLabel("Wine name")).toHaveValue("Château Musar Rouge");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "How many, and where?" })).toBeVisible();
  await expect(page.getByLabel("Vintage")).toHaveValue("2016");

  // 7. Three bottles.
  const more = page.getByRole("button", { name: "One more" });
  await more.click();
  await more.click();
  await expect(page.getByRole("group", { name: "How many bottles?" }).locator("output")).toHaveText(
    "3",
  );

  // 8. A place for them, made right here.
  await page.getByRole("button", { name: /New place/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Create place" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByRole("radio", { name: /Wine fridge/ })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await page.getByRole("button", { name: "Add 3 bottles" }).click();
  await expect(page.getByText(/3 bottles of Château Musar Château Musar Rouge 2016/)).toBeVisible();
  await expect(page.getByText("In Wine fridge.")).toBeVisible();

  // 10. Find it in the cellar.
  await page.goto("/cellar");
  await page.getByLabel("Search your cellar").fill("musar");
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByText("3 bottles · 1 wine")).toBeVisible();
  await page.getByRole("article").getByRole("link").first().click();
  await expect(page.getByRole("heading", { level: 1, name: /Château Musar Rouge/ })).toBeVisible();
  // A long-lived Lebanese red, read off a label: never "past its best" from a rough rule.
  await expect(page.getByText("Past its best")).toHaveCount(0);

  // 9. The front label came with the scan; add the back label.
  await expect(page.getByRole("img", { name: /^Label of/ }).first()).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page
    .locator('input[type="file"]')
    .nth(1)
    .setInputFiles({
      name: "back.jpg",
      mimeType: "image/jpeg",
      buffer: await makeJpeg(page, { words: "Importer BV" }),
    });
  await expect(page.getByText("Photo saved.")).toBeVisible();
  await expect(page.getByRole("img", { name: /Back label of/ })).toBeVisible();
  const labels = await sql<{ front: boolean; back: boolean }>(
    `select front_image_id is not null as front, back_image_id is not null as back
       from public.bottles where household_id = $1`,
    [householdId],
  );
  expect(labels).toHaveLength(3);
  expect(labels.every((b) => b.front && b.back)).toBe(true);

  // 11. Open one: two are left.
  await page.getByRole("button", { name: "Open a bottle" }).click();
  await page
    .getByRole("dialog", { name: "Open a bottle" })
    .getByRole("button", { name: "Open it" })
    .click();
  await expect(page.getByText(/Enjoy!/)).toBeVisible();
  const statuses = await sql<{ status: string; n: string }>(
    "select status, count(*) n from public.bottles where household_id = $1 group by status order by status",
    [householdId],
  );
  expect(statuses).toEqual([
    { status: "in_cellar", n: "2" },
    { status: "opened", n: "1" },
  ]);

  // 12. Rate it, and see it in the history.
  await page.getByRole("button", { name: "How was it?" }).click();
  const sheet = page.getByRole("dialog", { name: "How was it?" });
  await rateStars(page, 4.5);
  await sheet.getByLabel("Your note").fill("Still young, lovely.");
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Thanks, saved.")).toBeVisible();
  await page.goto("/cellar/history");
  await expect(page.getByTestId("history-item")).toHaveCount(1);
  await expect(page.getByTestId("history-item")).toContainText("Opened");

  // 13. Sign out, then back in with the PIN: everything is still there.
  await page.goto("/profile");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await tapPin(page, PIN);
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"));
  await page.goto("/cellar");
  await expect(page.getByText("2 bottles · 1 wine")).toBeVisible();
  await expect(
    page.locator("article", { hasText: "Château Musar Rouge" }).getByText("Rated 4.5 out of 5"),
  ).toBeAttached();

  // …and on another device with the email code (no PIN on that one): the same cellar.
  const context = await browser.newContext(test.info().project.use as BrowserContextOptions);
  const other = await context.newPage();
  await other.goto("/sign-in");
  await other.getByLabel("Email").fill(email);
  await other.getByRole("button", { name: "Send me a code" }).click();
  await other.getByLabel("6-digit code").fill(await codeFor(email));
  await other.waitForURL((url) => !url.pathname.startsWith("/sign-in"));
  await other.goto("/cellar");
  await expect(other.getByText("2 bottles · 1 wine")).toBeVisible();
  await context.close();
});
