import { expect, test, type BrowserContextOptions } from "@playwright/test";
import { api, apiClient, arrive, audit, sessionToken, sql } from "./helpers";

const shot = (name: string) => `test-results/shots/${name}.png`;
const project = () => test.info().project.name;

/** A small backup in the shape the old Wijnkelder app makes, with the usual untidiness of a real one. */
const BACKUP = {
  app: "wijnkelder",
  versie: 3,
  flessen: [
    {
      id: "a",
      naam: "Pavillon Rouge",
      producent: "Château Margaux",
      land: "Frankrijk",
      regio: "Bordeaux",
      appellatie: "Margaux",
      kleur: "rood",
      jaargang: 2015,
      aantal: 3,
      aankoopPrijs: 48.5,
      aankoopDatum: "2021-06-12",
      leverancier: "Wijnhandel Smit",
      favoriet: true,
      notitie: "Cadeau",
      locatie: { kelder: "Kelder", rek: "1", rij: 2, vak: 3 },
      // The old app kept label photos inside the backup; the browser must not send them.
      foto: `data:image/jpeg;base64,${"A".repeat(120_000)}`,
    },
    {
      id: "b",
      naam: "Brut Réserve",
      producent: "Bollinger",
      land: "Frankrijk",
      regio: "Champagne",
      kleur: "mousserend",
      aantal: 2,
      formaat: "magnum",
      locatie: { kelder: "Kelder", rek: "2", rij: 1, vak: 1 },
    },
    {
      id: "c",
      naam: "Mystery",
      producent: "Nobody",
      land: "Atlantis",
      kleur: "wit",
      jaargang: 2020,
      aantal: 1,
      locatie: {},
    },
    { id: "d", naam: "", aantal: 4 },
  ],
  historie: [
    { type: "gedronken", flesId: "a", aantal: 2, datum: "2026-03-01" },
    {
      type: "gedronken",
      flesId: "gone",
      aantal: 1,
      datum: "2025-12-24",
      momentopname: { naam: "Old Friend", producent: "Domaine X", kleur: "wit", jaargang: 2010 },
    },
  ],
  notities: [
    { flesId: "a", datum: "2026-03-01", score: 4.5, tekst: "Prachtig", geur: "cassis" },
    { flesId: "gone", datum: "2025-12-24", score: 4, tekst: "" },
    { flesId: "nobody", datum: "2025-01-01", score: 3, tekst: "?" },
  ],
};

const upload = (page: import("@playwright/test").Page, content: string, name = "backup.json") =>
  page
    .locator('input[type="file"]')
    .setInputFiles({ name, mimeType: "application/json", buffer: Buffer.from(content) });

test.describe("bringing a cellar over from Wijnkelder", () => {
  test("choose the file, read what would come over, confirm: it is all there", async ({
    page,
    request,
  }) => {
    const { email, householdId } = await arrive(page, "imp");
    await page.goto("/profile");
    await page.getByRole("link", { name: "Bring your cellar over" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Bring your cellar over" }),
    ).toBeVisible();

    // Wrong files are explained, not just refused.
    await upload(page, "this is not json");
    await expect(
      page.getByRole("alert").filter({ hasText: "doesn’t look like a backup" }),
    ).toBeVisible();
    await upload(page, JSON.stringify({ app: "something else" }));
    await expect(
      page.getByRole("alert").filter({ hasText: "isn’t a Wijnkelder backup" }),
    ).toBeVisible();

    await upload(page, JSON.stringify(BACKUP), "wijnkelder-backup.json");
    await expect(page.getByText("In wijnkelder-backup.json")).toBeVisible();
    // Three bottles of one wine, two magnums, one more; two glasses of the first and one old friend drunk.
    const count = (label: string) =>
      page.locator("dl > div").filter({ hasText: label }).locator("dd");
    await expect(count("Bottles in the cellar")).toHaveText("6");
    await expect(count("Wines")).toHaveText("4");
    await expect(count("Bottles already opened")).toHaveText("3");
    await expect(count("Racks")).toHaveText("2");
    await expect(count("Ratings and notes")).toHaveText("2");
    await expect(count("Favourites")).toHaveText("1");
    // What could not be understood is said, not hidden.
    await expect(
      page.getByText(/1 wine has a country we didn’t recognise, like “Atlantis”/),
    ).toBeVisible();
    await expect(page.getByText("A bottle without a name was left out.")).toBeVisible();
    await expect(page.getByText(/A note about a bottle that isn’t in the backup/)).toBeVisible();
    // The photo never left the phone: the page shows no sign of it and nothing was written yet.
    expect(
      await sql("select 1 from public.bottles where household_id = $1", [householdId]),
    ).toHaveLength(0);
    await page.screenshot({ path: shot(`import-review-${project()}`), fullPage: true });

    // The scale was worked out (5-star); changing it re-reads the file.
    await expect(page.getByRole("radio", { name: "Out of 5" })).toBeChecked();

    await page.getByRole("button", { name: "Bring it all over" }).click();
    await expect(page.getByRole("heading", { name: "Your cellar is here" })).toBeVisible();
    await expect(
      page.getByText(
        /6 bottles now in your cellar, 3 more already opened, with 2 ratings and notes/,
      ),
    ).toBeVisible();
    await page.screenshot({ path: shot(`import-done-${project()}`) });

    // Everything is where the old app had it.
    const { call } = await apiClient(request, email);
    const cellar = (
      await call<{ items: Array<{ wineName: string; count: number; favorite: boolean }> }>(
        "get",
        "/cellar",
        undefined,
        200,
      )
    ).body.items;
    expect(cellar.map((i) => [i.wineName, i.count]).sort()).toEqual([
      ["Brut Réserve", 2],
      ["Mystery", 1],
      ["Pavillon Rouge", 3],
    ]);
    expect(cellar.find((i) => i.wineName === "Pavillon Rouge")?.favorite).toBe(true);

    const spots = await sql<{ label: string; loc_row: number; loc_col: number }>(
      `select l.label, b.loc_row, b.loc_col from public.bottles b
         join public.cellar_locations l on l.id = b.location_id
        where b.household_id = $1 and b.status = 'in_cellar' order by l.label, b.loc_row, b.loc_col`,
      [householdId],
    );
    // The first bottle sits exactly where the old app said (row 2, spot 3); its two siblings are beside it.
    expect(spots.filter((s) => s.label === "Rack 1")).toHaveLength(3);
    expect(spots).toContainEqual({ label: "Rack 1", loc_row: 2, loc_col: 3 });
    expect(spots.filter((s) => s.label === "Rack 2")).toHaveLength(2);

    const opened = await sql<{ opened_at: string }>(
      "select opened_at::date::text as opened_at from public.bottles where household_id = $1 and status = 'opened' order by opened_at",
      [householdId],
    );
    expect(opened.map((o) => o.opened_at)).toEqual(["2025-12-24", "2026-03-01", "2026-03-01"]);

    // 4.5 stars → 9, 4 stars → 8, each tied to the bottle that was drunk that day.
    const tastings = await sql<{
      score: number;
      note: string | null;
      tasted: string;
      bottle: boolean;
    }>(
      `select score::float8 as score, note, tasted_at::date::text as tasted, bottle_id is not null as bottle
         from public.tastings where household_id = $1 order by tasted_at`,
      [householdId],
    );
    expect(tastings).toEqual([
      { score: 8, note: null, tasted: "2025-12-24", bottle: true },
      { score: 9, note: "Prachtig\nNose: cassis", tasted: "2026-03-01", bottle: true },
    ]);

    // The cellar page shows it, and so does the wine's own page.
    await page.getByRole("link", { name: "Open my cellar" }).click();
    await expect(page.locator("article")).toHaveCount(3);
    await page.getByRole("link", { name: "Pavillon Rouge" }).click();
    await expect(page.getByRole("heading", { name: "Pavillon Rouge", level: 1 })).toBeVisible();
    await expect(page.getByText("Prachtig")).toBeVisible();
  });

  test("a dry run changes nothing; the answer is a report", async ({ page, request }) => {
    const { email, householdId } = await arrive(page, "dry");
    const { call } = await apiClient(request, email);
    const outcome = (
      await call<Record<string, unknown>>("post", "/import/wijnkelder", { backup: BACKUP }, 200)
    ).body;
    expect(outcome).toMatchObject({
      committed: false,
      written: null,
      report: { scoreScale: 5, counts: { bottlesInCellar: 6, wines: 4, units: 2 } },
    });
    for (const table of ["bottles", "cellar_locations", "tastings"]) {
      const rows = await sql(`select 1 from public.${table} where household_id = $1`, [
        householdId,
      ]);
      expect(rows, table).toHaveLength(0);
    }
  });

  test("it is yours alone: another household sees none of it, and strangers are turned away", async ({
    page,
    browser,
    request,
  }) => {
    const owner = await arrive(page, "impown");
    const { call } = await apiClient(request, owner.email);
    await call("post", "/import/wijnkelder", { backup: BACKUP, dryRun: false }, 200);

    const context = await browser.newContext(test.info().project.use as BrowserContextOptions);
    const otherPage = await context.newPage();
    const other = await arrive(otherPage, "impoth");
    const theirs = (await (
      await api(request, await sessionToken(other.email), "get", "/cellar")
    ).json()) as {
      items: unknown[];
    };
    expect(theirs.items).toEqual([]);
    const theirRacks = (await (
      await api(request, await sessionToken(other.email), "get", "/racks")
    ).json()) as {
      units: unknown[];
    };
    expect(theirRacks.units).toEqual([]);
    await context.close();

    // Not signed in, or signed in with nonsense.
    expect(
      (
        await request.post("/api/v1/import/wijnkelder", {
          headers: { authorization: "Bearer nope" },
          data: { backup: BACKUP },
        })
      ).status(),
    ).toBe(401);
    // Not a Wijnkelder file, and a request that is simply too big.
    const token = await sessionToken(owner.email);
    expect(
      (await api(request, token, "post", "/import/wijnkelder", { backup: { app: "x" } })).status(),
    ).toBe(422);
    const huge = { backup: { ...BACKUP, flessen: [{ naam: "x".repeat(4.5 * 1024 * 1024) }] } };
    expect((await api(request, token, "post", "/import/wijnkelder", huge)).status()).toBe(422);
  });

  test("bringing a cellar in is limited to a few times an hour", async ({ page, request }) => {
    const { email } = await arrive(page, "implim");
    const { token } = await apiClient(request, email);
    const tiny = {
      backup: { app: "wijnkelder", flessen: [], notities: [], historie: [] },
      dryRun: false,
    };
    // An empty backup writes nothing, but it still counts: nobody needs to do it dozens of times.
    for (let i = 0; i < 6; i++) {
      expect((await api(request, token, "post", "/import/wijnkelder", tiny)).status()).toBe(200);
    }
    expect((await api(request, token, "post", "/import/wijnkelder", tiny)).status()).toBe(429);
    // Looking is free.
    expect(
      (await api(request, token, "post", "/import/wijnkelder", { ...tiny, dryRun: true })).status(),
    ).toBe(200);
  });

  test("the import screens are accessible in both themes", async ({ page }) => {
    await arrive(page, "impa11y");
    await page.goto("/profile/import");
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await expect.poll(() => audit(page)).toEqual([]);
    }
    await upload(page, JSON.stringify(BACKUP));
    await expect(page.getByRole("button", { name: "Bring it all over" })).toBeVisible();
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await expect.poll(() => audit(page)).toEqual([]);
      await page.screenshot({ path: shot(`import-${scheme}-${project()}`), fullPage: true });
    }
  });
});
