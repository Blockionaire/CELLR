import { expect, test, type BrowserContextOptions, type Page } from "@playwright/test";
import { api, apiClient, arrive, bearer, makeJpeg, sessionToken, sql } from "./helpers";

/**
 * Sprint O: a profile photo; scanning straight from "Add a bottle"; a full review from Home.
 */
test.skip(({ isMobile }) => !isMobile, "the phone");

type Call = Awaited<ReturnType<typeof apiClient>>["call"];

const avatarOf = async (email: string) =>
  (
    await sql<{ avatar_path: string | null }>(
      "select p.avatar_path from public.profiles p join auth.users u on u.id = p.id where u.email = $1",
      [email],
    )
  )[0]!.avatar_path;
const stored = async (path: string) =>
  (
    await sql<{ n: string }>(
      "select count(*)::text as n from storage.objects where bucket_id = 'user-avatars' and name = $1",
      [path],
    )
  )[0]!.n === "1";

/** A real photo file, as the phone's library would hand it over. */
async function photoFile(page: Page, words: string, width = 1200, height = 900) {
  return {
    name: "IMG_0001.jpg",
    mimeType: "image/jpeg",
    buffer: await makeJpeg(page, { width, height, words, color: "#6e1f32" }),
  };
}

test("profile photo: set it, see it, replace it, remove it; a stranger never gets it", async ({
  browser,
  page,
  request,
}) => {
  test.setTimeout(90_000);
  const { email, householdId } = await arrive(page, "avatar");
  await page.goto("/profile");
  const avatar = page.getByRole("button", { name: "Add a profile photo" });
  await expect(avatar.getByTestId("person-avatar")).not.toHaveAttribute("data-photo", "true");

  // Choose a photo, place it, keep it.
  await avatar.click();
  const sheet = page.getByRole("dialog", { name: "Profile photo" });
  await sheet.locator('input[type="file"]').setInputFiles(await photoFile(page, "Me"));
  await expect(sheet.getByTestId("avatar-crop")).toBeVisible();
  await sheet.getByRole("slider").fill("1.6");
  await sheet.getByRole("button", { name: "Use photo" }).click();
  await expect(page.getByText("Profile photo saved.")).toBeVisible();
  const changed = page.getByRole("button", { name: "Change your profile photo" });
  await expect(changed.getByTestId("person-avatar")).toHaveAttribute("data-photo", "true");
  const first = await avatarOf(email);
  expect(first).toMatch(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/);
  expect(await stored(first!)).toBe(true);
  // It is a small square, not the camera original.
  const src = await changed.locator("img").getAttribute("src");
  const served = await page.request.get(src!);
  expect(served.status()).toBe(200);
  expect(served.headers()["content-type"]).toBe("image/jpeg");
  const size = await page.evaluate(async (url) => {
    const img = new Image();
    img.src = url;
    await img.decode();
    return [img.naturalWidth, img.naturalHeight];
  }, src!);
  expect(size).toEqual([512, 512]);
  // It shows in the household's member list too.
  await expect(
    page.getByRole("listitem").filter({ hasText: "(you)" }).getByTestId("person-avatar"),
  ).toHaveAttribute("data-photo", "true");

  // Replace it: the old file goes.
  await changed.click();
  await sheet.locator('input[type="file"]').setInputFiles(await photoFile(page, "New"));
  await sheet.getByRole("button", { name: "Use photo" }).click();
  await expect(sheet).toBeHidden();
  await expect.poll(() => avatarOf(email)).not.toBe(first);
  const second = await avatarOf(email);
  expect(await stored(second!)).toBe(true);
  expect(await stored(first!)).toBe(false);

  // Something that is not a photo is refused, in words.
  await changed.click();
  await sheet.locator('input[type="file"]').setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("not a photo"),
  });
  await expect(sheet.getByText("That isn't a photo we can open. Try another one.")).toBeVisible();

  // Remove it: back to the initials, and the file is gone.
  await sheet.getByRole("button", { name: "Remove photo" }).click();
  await expect(sheet).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Add a profile photo" }).getByTestId("person-avatar"),
  ).not.toHaveAttribute("data-photo", "true");
  expect(await avatarOf(email)).toBeNull();
  expect(await stored(second!)).toBe(false);

  // The server refuses a file that is too big, or not a JPEG, whatever the browser does.
  const token = await sessionToken(email);
  const put = (buffer: Buffer, mimeType = "image/jpeg") =>
    request.put("/api/v1/me/avatar", {
      headers: bearer(token),
      multipart: { photo: { name: "a.jpg", mimeType, buffer } },
    });
  const big = await makeJpeg(page, { width: 4000, height: 4000, words: "Big" });
  expect((await put(big)).status()).toBe(422);
  expect((await put(Buffer.from("<svg/>"), "image/svg+xml")).status()).toBe(422);

  // A stranger cannot see someone's photo; a member of the household can; nobody can change another's.
  const square = await makeJpeg(page, { width: 512, height: 512, words: "Sq" });
  expect((await put(square)).status()).toBe(200);
  const mine = await avatarOf(email);
  const myId = (
    await sql<{ id: string }>("select id from auth.users where email = $1", [email])
  )[0]!.id;
  const elsewhere = await browser.newContext(test.info().project.use as BrowserContextOptions);
  const stranger = await arrive(await elsewhere.newPage(), "avatarstranger");
  await elsewhere.close();
  const strangerToken = await sessionToken(stranger.email);
  expect((await api(request, strangerToken, "get", `/avatars/${myId}`)).status()).toBe(404);
  // the stranger's own upload only ever changes the stranger's own profile
  await request.put("/api/v1/me/avatar", {
    headers: bearer(strangerToken),
    multipart: { photo: { name: "a.jpg", mimeType: "image/jpeg", buffer: square } },
  });
  expect(await avatarOf(email)).toBe(mine);
  // …and once in the same household, they see it.
  const { code } = (await (
    await api(request, token, "post", `/households/${householdId}/invites`, {})
  ).json()) as { code: string };
  expect((await api(request, strangerToken, "post", "/households/join", { code })).status()).toBe(
    200,
  );
  expect((await api(request, strangerToken, "get", `/avatars/${myId}`)).status()).toBe(200);
});

test("Cellar → + → Scan wine opens the scanner; choosing and adding by hand are still there", async ({
  page,
  request,
}) => {
  const { email } = await arrive(page, "addscan");
  await openedBottle((await apiClient(request, email)).call); // a cellar with history: the "+" in its header
  const { call } = await apiClient(request, email);
  const w = (
    await call<{ id: string }>(
      "post",
      "/wines",
      { producer: "Domaine Test", name: "Chablis", type: "white", countryCode: "FR" },
      201,
    )
  ).body;
  await call("post", "/bottles", { wineId: w.id, year: 2020, quantity: 1, locationId: null }, 201);
  await page.goto("/cellar");
  await page.getByRole("link", { name: "Add", exact: true }).first().click();
  await expect(page).toHaveURL(/\/cellar\/add$/);
  const scan = page.getByTestId("scan-wine");
  await expect(scan).toContainText("Scan wine");
  // Scanning is the first thing on the screen; search and "add by hand" follow.
  const scanBox = (await scan.boundingBox())!;
  const search = (await page.getByRole("searchbox").boundingBox())!;
  expect(scanBox.y).toBeLessThan(search.y);
  await expect(page.getByRole("button", { name: /Add a new wine/ })).toBeVisible();
  await scan.click();
  await expect(page).toHaveURL(/\/scan$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // Back goes back to choosing.
  await page.goBack();
  await expect(page).toHaveURL(/\/cellar\/add$/);
});

async function openedBottle(call: Call) {
  const w = (
    await call<{ id: string }>(
      "post",
      "/wines",
      {
        producer: "Château Margaux",
        name: "Pavillon Rouge",
        type: "red",
        countryCode: "FR",
        region: "Bordeaux",
      },
      201,
    )
  ).body;
  const { bottleIds } = (
    await call<{ bottleIds: string[] }>(
      "post",
      "/bottles",
      { wineId: w.id, year: 2015, quantity: 1, locationId: null },
      201,
    )
  ).body;
  await call("patch", `/bottles/${bottleIds[0]}`, { action: "open" }, 200);
  return bottleIds[0]!;
}

const tastingsOf = (householdId: string) =>
  sql<{ score: string | null; descriptors: string[]; note: string | null }>(
    "select score::text as score, descriptors, note from public.tastings where household_id = $1",
    [householdId],
  );

test("a full review from Home: nothing is saved until Save review; then the question is gone", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  const { email, householdId } = await arrive(page, "homereview");
  const { call } = await apiClient(request, email);
  await openedBottle(call);
  const writes: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/tasting") && r.method() !== "GET") writes.push(r.method());
  });

  await page.goto("/");
  const nudge = page.getByTestId("rate-nudge");
  await expect(nudge.getByRole("heading", { name: "How was the Pavillon Rouge?" })).toBeVisible();

  // Opening, touching the stars and closing: nothing written, the question stays.
  await nudge.getByRole("button", { name: "Review wine" }).click();
  const sheet = page.getByRole("dialog", { name: "How was it?" });
  await expect(sheet).toBeVisible();
  const stars = sheet.getByTestId("stars-input");
  const box = (await stars.boundingBox())!;
  await page.mouse.move(box.x + 4, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(sheet.getByText("– / 5")).toHaveCount(0); // the stars show their value as they move
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  expect(writes).toEqual([]);
  expect(await tastingsOf(householdId)).toEqual([]);
  await expect(nudge).toBeVisible();

  // The whole review: 4.2 stars, two words, a note.
  await nudge.getByRole("button", { name: "Review wine" }).click();
  await stars.focus();
  await stars.press("Home");
  for (let i = 0; i < 32; i++) await stars.press("ArrowRight");
  await expect(sheet.getByText("4.2 / 5")).toBeVisible();
  await sheet.getByRole("button", { name: "Fruity" }).click();
  await sheet.getByRole("button", { name: "Smooth" }).click();
  await sheet.getByLabel(/note/i).fill("Cassis and cedar, lovely with the lamb.");

  // A save that fails keeps everything, to try again.
  await page.route("**/api/v1/bottles/*/tasting", (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: { code: "INTERNAL", message: "", retryable: true } }),
        })
      : route.fallback(),
  );
  await sheet.getByRole("button", { name: "Save review" }).click();
  await expect(sheet.getByRole("alert")).toBeVisible();
  await expect(sheet.getByText("4.2 / 5")).toBeVisible();
  await expect(sheet.getByLabel(/note/i)).toHaveValue("Cassis and cedar, lovely with the lamb.");
  await expect(sheet.getByRole("button", { name: "Fruity" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.unroute("**/api/v1/bottles/*/tasting");
  writes.length = 0;

  // Saved once; the question goes away; everything was kept.
  await sheet.getByRole("button", { name: "Save review" }).click();
  await expect(page.getByText("Thanks, saved.")).toBeVisible();
  await expect(page.getByTestId("rate-nudge")).toHaveCount(0);
  expect(writes).toEqual(["PUT"]);
  expect(await tastingsOf(householdId)).toEqual([
    {
      score: "8.4",
      descriptors: expect.arrayContaining(["fruity", "smooth"]),
      note: "Cassis and cedar, lovely with the lamb.",
    },
  ]);
  // Ratings know it straight away.
  await page.goto("/ratings");
  await expect(page.getByText("Pavillon Rouge").first()).toBeVisible();
  await expect(page.getByText("4.2").first()).toBeVisible();
  // …and Home does not ask again.
  await page.goto("/");
  await expect(page.getByTestId("rate-nudge")).toHaveCount(0);
});
