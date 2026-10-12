import { readFileSync } from "node:fs";
import { expect, test, type BrowserContextOptions } from "@playwright/test";
import {
  api,
  apiClient,
  arrive,
  audit,
  bearer,
  makeJpeg,
  sessionToken,
  sql,
  wineBody,
} from "./helpers";

const shot = (name: string) => `test-results/shots/${name}.png`;
const project = () => test.info().project.name;

async function furnish(call: Awaited<ReturnType<typeof apiClient>>["call"]) {
  const fridge = (
    await call<{ id: string }>(
      "post",
      "/storage",
      { label: "Wine fridge", kind: "fridge", rows: 3, cols: 4 },
      201,
    )
  ).body;
  const wine = (await call<{ id: string }>("post", "/wines", wineBody, 201)).body;
  const bought = (
    await call<{ bottleIds: string[] }>(
      "post",
      "/bottles",
      { wineId: wine.id, year: 2019, quantity: 3, locationId: fridge.id, priceCents: 2450 },
      201,
    )
  ).body;
  return { wineId: wine.id, bottleIds: bought.bottleIds };
}

test.describe("household settings", () => {
  test("the owner renames the household and changes its currency", async ({ page }) => {
    const { householdId } = await arrive(page, "hhedit");
    await page.goto("/profile");
    const section = page
      .getByRole("region", { name: "Household settings" })
      .or(page.locator("section").filter({ hasText: "Household settings" }));
    await expect(section.getByLabel("Household name")).toHaveValue(/House /);
    await expect(section.getByRole("button", { name: "Save household" })).toHaveCount(0); // nothing changed yet
    await section.getByLabel("Household name").fill("Joost & Merel");
    await section.getByLabel("Currency").selectOption("CHF");
    await page.screenshot({ path: shot(`profile-household-${project()}`), fullPage: true });
    await section.getByRole("button", { name: "Save household" }).click();
    await expect(page.getByText("Household updated.")).toBeVisible();
    const [row] = await sql<{ name: string; currency: string }>(
      "select name, currency from public.households where id = $1",
      [householdId],
    );
    expect(row).toEqual({ name: "Joost & Merel", currency: "CHF" });
    await page.reload();
    await expect(page.getByRole("heading", { name: "Joost & Merel" })).toBeVisible();

    // An empty name is explained, not saved.
    await section.getByLabel("Household name").fill("  ");
    await section.getByRole("button", { name: "Save household" }).click();
    await expect(page.getByRole("alert").filter({ hasText: /.+/ }).first()).toBeVisible();
    const [again] = await sql<{ name: string }>(
      "select name from public.households where id = $1",
      [householdId],
    );
    expect(again!.name).toBe("Joost & Merel");
  });

  test("a member sees who is in the household but cannot change or delete it", async ({
    page,
    browser,
    request,
  }) => {
    const owner = await arrive(page, "hhown");
    const ownerClient = await apiClient(request, owner.email);
    const invite = (
      await ownerClient.call<{ code: string }>(
        "post",
        `/households/${owner.householdId}/invites`,
        {},
        201,
      )
    ).body;

    const context = await browser.newContext(test.info().project.use as BrowserContextOptions);
    const memberPage = await context.newPage();
    const member = await arrive(memberPage, "hhmem");
    const memberToken = await sessionToken(member.email);
    expect(
      (await api(request, memberToken, "post", "/households/join", { code: invite.code })).status(),
    ).toBe(200);
    await api(request, memberToken, "put", "/households/active", {
      householdId: owner.householdId,
    });
    await memberPage.goto("/profile");
    await expect(memberPage.getByRole("heading", { name: "Household settings" })).toHaveCount(0);

    // Straight at the API, too.
    expect(
      (
        await api(request, memberToken, "patch", `/households/${owner.householdId}`, {
          name: "Mine now",
        })
      ).status(),
    ).toBeGreaterThanOrEqual(400);
    expect(
      (await api(request, memberToken, "delete", `/households/${owner.householdId}`)).status(),
    ).toBeGreaterThanOrEqual(400);
    const [row] = await sql<{ name: string }>("select name from public.households where id = $1", [
      owner.householdId,
    ]);
    expect(row!.name).not.toBe("Mine now");
    await context.close();
  });

  test("deleting the household asks for its name, and takes everything with it: rows and photos", async ({
    page,
    request,
  }) => {
    const { email, householdId } = await arrive(page, "hhdel");
    const { call, token } = await apiClient(request, email);
    await furnish(call);
    const photo = await makeJpeg(page);
    const upload = await request.post("/api/v1/images", {
      headers: bearer(token),
      multipart: {
        photo: { name: "p.jpg", mimeType: "image/jpeg", buffer: photo },
        thumb: { name: "t.jpg", mimeType: "image/jpeg", buffer: photo },
      },
    });
    expect(upload.status()).toBe(201);
    expect(
      await sql("select 1 from storage.objects where name like $1", [`${householdId}/%`]),
    ).toHaveLength(2);

    await page.goto("/profile");
    await page.getByRole("button", { name: "Delete household…" }).click();
    const sheet = page.getByRole("dialog");
    await expect(
      sheet.getByText(/removes every bottle, rating, note, photo and wish/),
    ).toBeVisible();
    const confirm = sheet.getByRole("button", { name: "Delete everything" });
    await expect(confirm).toBeDisabled();
    await sheet.getByLabel("Type the household’s name to confirm").fill("not the name");
    await expect(confirm).toBeDisabled();
    await page.screenshot({ path: shot(`profile-delete-${project()}`) });
    const [{ name }] = (await sql<{ name: string }>(
      "select name from public.households where id = $1",
      [householdId],
    )) as [{ name: string }];
    await sheet.getByLabel("Type the household’s name to confirm").fill(name);
    await expect(confirm).toBeEnabled();
    await confirm.click();

    await expect
      .poll(
        async () =>
          (await sql("select 1 from public.households where id = $1", [householdId])).length,
      )
      .toBe(0);
    expect(
      await sql("select 1 from public.bottles where household_id = $1", [householdId]),
    ).toHaveLength(0);
    expect(
      await sql("select 1 from public.bottle_images where household_id = $1", [householdId]),
    ).toHaveLength(0);
    // The photos are gone from storage too, not left behind.
    expect(
      await sql("select 1 from storage.objects where name like $1", [`${householdId}/%`]),
    ).toHaveLength(0);
    // The person is taken to where they can start again.
    await expect(page).not.toHaveURL(/\/profile/);
  });
});

test.describe("taking your data with you", () => {
  test("one click downloads a readable file of everything", async ({ page, request }) => {
    const { email } = await arrive(page, "export");
    const { call } = await apiClient(request, email);
    const { wineId, bottleIds } = await furnish(call);
    await call("patch", `/bottles/${bottleIds[0]}`, { action: "open" }, 200);
    await call("put", `/wines/${wineId}/favorite`, { favorite: true }, 200);
    await call(
      "post",
      "/wishlist",
      { wineId, year: 2020, note: "next vintage", maxPriceCents: 3000 },
      201,
    );

    await page.goto("/profile");
    await page.screenshot({ path: shot(`profile-data-${project()}`), fullPage: true });
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download my data" }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toMatch(/^cellr-\d{4}-\d{2}-\d{2}\.json$/);
    const data = JSON.parse(readFileSync((await download.path())!, "utf8"));

    expect(data).toMatchObject({ app: "cellr", version: 1, household: { currency: "EUR" } });
    expect(data.places).toEqual([
      { name: "Wine fridge", kind: "fridge", shelves: 3, positionsPerShelf: 4 },
    ]);
    expect(data.bottles).toHaveLength(3);
    expect(data.bottles.filter((b: { status: string }) => b.status === "opened")).toHaveLength(1);
    expect(data.bottles[0]).toMatchObject({
      producer: "Domaine Test",
      wine: "Chablis Premier Cru",
      vintage: 2019,
      price: 24.5,
      currency: "EUR",
    });
    expect(data.favorites).toEqual([{ producer: "Domaine Test", wine: "Chablis Premier Cru" }]);
    expect(data.wishlist).toMatchObject([
      { wine: "Chablis Premier Cru", vintage: 2020, note: "next vintage", maxPrice: 30 },
    ]);
    // Words, not ids: nothing in it points back into the app's own database.
    expect(JSON.stringify(data)).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/,
    );
  });

  test("the file is only ever your own household's, and only for you", async ({
    page,
    browser,
    request,
  }) => {
    const owner = await arrive(page, "expown");
    const ownerCall = (await apiClient(request, owner.email)).call;
    await furnish(ownerCall);

    const context = await browser.newContext(test.info().project.use as BrowserContextOptions);
    const otherPage = await context.newPage();
    const other = await arrive(otherPage, "expoth");
    const res = await api(request, await sessionToken(other.email), "get", "/export");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-disposition"]).toContain("attachment");
    expect(res.headers()["cache-control"]).toBe("no-store");
    const theirs = await res.json();
    expect(theirs.bottles).toEqual([]);
    expect(JSON.stringify(theirs)).not.toContain("Chablis");
    await context.close();

    expect((await request.get("/api/v1/export", { headers: bearer("nope") })).status()).toBe(401);
    expect((await request.get("/api/v1/export")).status()).toBe(401);
  });

  test("it is limited to a few times an hour", async ({ page, request }) => {
    const { email } = await arrive(page, "explim");
    const { token } = await apiClient(request, email);
    const [user] = await sql<{ id: string }>("select id from auth.users where email = $1", [email]);
    await sql(
      "insert into private.rate_events (user_id, bucket) select $1, 'app:export' from generate_series(1, 10)",
      [user!.id],
    );
    expect((await api(request, token, "get", "/export")).status()).toBe(429);
  });
});

test.describe("deleting your account", () => {
  test("it asks for your email, then removes you and the household only you were in, photos and all", async ({
    page,
    request,
  }) => {
    const { email, householdId } = await arrive(page, "acctdel");
    const { call, token } = await apiClient(request, email);
    await furnish(call);
    const photo = await makeJpeg(page);
    await request.post("/api/v1/images", {
      headers: bearer(token),
      multipart: { photo: { name: "p.jpg", mimeType: "image/jpeg", buffer: photo } },
    });
    const [user] = await sql<{ id: string }>("select id from auth.users where email = $1", [email]);

    await page.goto("/profile");
    await page.getByRole("button", { name: "Delete my account…" }).click();
    const sheet = page.getByRole("dialog");
    const confirm = sheet.getByRole("button", { name: "Delete my account" });
    await expect(confirm).toBeDisabled();
    await sheet.getByLabel("Type your email address to confirm").fill("someone@else.com");
    await expect(confirm).toBeDisabled();
    await page.screenshot({ path: shot(`account-delete-${project()}`) });
    await sheet.getByLabel("Type your email address to confirm").fill(email.toUpperCase());
    await expect(confirm).toBeEnabled();
    await confirm.click();

    await expect(page).toHaveURL(/\/sign-in/);
    expect(await sql("select 1 from auth.users where id = $1", [user!.id])).toHaveLength(0);
    expect(await sql("select 1 from public.profiles where id = $1", [user!.id])).toHaveLength(0);
    expect(await sql("select 1 from public.households where id = $1", [householdId])).toHaveLength(
      0,
    );
    expect(
      await sql("select 1 from public.bottles where household_id = $1", [householdId]),
    ).toHaveLength(0);
    expect(
      await sql("select 1 from storage.objects where name like $1", [`${householdId}/%`]),
    ).toHaveLength(0);
  });

  test("a household you share with others is left alone: you step out, they keep their cellar", async ({
    page,
    browser,
    request,
  }) => {
    const owner = await arrive(page, "acctown");
    const ownerClient = await apiClient(request, owner.email);
    await furnish(ownerClient.call);
    const invite = (
      await ownerClient.call<{ code: string }>(
        "post",
        `/households/${owner.householdId}/invites`,
        {},
        201,
      )
    ).body;

    const context = await browser.newContext(test.info().project.use as BrowserContextOptions);
    const memberPage = await context.newPage();
    const member = await arrive(memberPage, "acctmem");
    const memberToken = await sessionToken(member.email);
    expect(
      (await api(request, memberToken, "post", "/households/join", { code: invite.code })).status(),
    ).toBe(200);
    const [memberUser] = await sql<{ id: string }>("select id from auth.users where email = $1", [
      member.email,
    ]);

    const res = await request.delete("/api/v1/me", {
      headers: bearer(memberToken),
      data: { email: member.email },
    });
    expect(res.status()).toBe(204);
    expect(await sql("select 1 from auth.users where id = $1", [memberUser!.id])).toHaveLength(0);
    // The owner's household and everything in it are untouched; only the member's own place in it went.
    expect(
      await sql("select 1 from public.households where id = $1", [owner.householdId]),
    ).toHaveLength(1);
    expect(
      await sql("select 1 from public.bottles where household_id = $1", [owner.householdId]),
    ).toHaveLength(3);
    const members = await sql<{ n: string }>(
      "select count(*) as n from public.household_members where household_id = $1",
      [owner.householdId],
    );
    expect(Number(members[0]!.n)).toBe(1);
    await context.close();
  });

  test("the only owner of a household that still has others in it is asked to sort that out first", async ({
    page,
    browser,
    request,
  }) => {
    const owner = await arrive(page, "acctstuck");
    const ownerClient = await apiClient(request, owner.email);
    const invite = (
      await ownerClient.call<{ code: string }>(
        "post",
        `/households/${owner.householdId}/invites`,
        {},
        201,
      )
    ).body;
    const context = await browser.newContext(test.info().project.use as BrowserContextOptions);
    const otherPage = await context.newPage();
    const other = await arrive(otherPage, "acctoth");
    await api(request, await sessionToken(other.email), "post", "/households/join", {
      code: invite.code,
    });
    await context.close();

    await page.goto("/profile");
    await page.getByRole("button", { name: "Delete my account…" }).click();
    const sheet = page.getByRole("dialog");
    await sheet.getByLabel("Type your email address to confirm").fill(owner.email);
    await sheet.getByRole("button", { name: "Delete my account" }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: /only owner of .* still has other people in it/ }),
    ).toBeVisible();
    // Nothing was touched.
    expect(await sql("select 1 from auth.users where email = $1", [owner.email])).toHaveLength(1);
    expect(
      await sql("select 1 from public.households where id = $1", [owner.householdId]),
    ).toHaveLength(1);
    await expect(page).toHaveURL(/\/profile/);
  });

  test("the API wants your own email, and a signed-in person", async ({ page, request }) => {
    const { email } = await arrive(page, "acctapi");
    const token = await sessionToken(email);
    for (const data of [{}, { email: "" }, { email: "someone@else.com" }]) {
      const res = await request.delete("/api/v1/me", { headers: bearer(token), data });
      expect(res.status()).toBe(422);
    }
    expect(
      (await request.delete("/api/v1/me", { headers: bearer("nope"), data: { email } })).status(),
    ).toBe(401);
    expect(await sql("select 1 from auth.users where email = $1", [email])).toHaveLength(1);
  });
});

test.describe("accessibility", () => {
  test("the profile with its settings, and the delete sheet, in both themes", async ({ page }) => {
    await arrive(page, "profa11y");
    await page.goto("/profile");
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await expect.poll(() => audit(page)).toEqual([]);
    }
    await page.getByRole("button", { name: "Delete household…" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await expect.poll(() => audit(page)).toEqual([]);
    }
  });
});
