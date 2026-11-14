import { expect, test, type Browser, type BrowserContextOptions } from "@playwright/test";
import { APP_URL, arrive, audit, FEATURES_URL, signIn, sql, stamp } from "./helpers";

/**
 * Wine Intelligence WI-06: /admin/sources (the sources' rights and imports, the link review queue, the off switch)
 * and the anonymous usage events of the search and Koopcheck.
 */
test.skip(({ isMobile }) => isMobile, "the admin dashboard is desktop-first: the desktop project");

const ADMIN_ID = "00000000-0000-4000-8000-00000000ad01";
const ADMIN_EMAIL = "feedback-admin@cellr.invalid";

async function asAdmin(browser: Browser) {
  await sql("insert into auth.users (id, email) values ($1, $2) on conflict do nothing", [
    ADMIN_ID,
    ADMIN_EMAIL,
  ]);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const admin = await context.newPage();
  await signIn(admin, ADMIN_EMAIL);
  return { admin, close: () => context.close() };
}

/** A catalogue wine, and a cleared test source with two records that name it exactly and one that does not. */
async function seed(m: string) {
  const producer = `Weingut Beheer ${m}`;
  await sql("select public.catalog_import($1::jsonb, true)", [
    JSON.stringify([
      {
        producer,
        producer_country: "DE",
        name: `Riesling Kabinett ${m}`,
        type: "white",
        region: "Mosel",
        vintages: [2021],
        aliases: [`Kabinett Riesling ${m}`],
        sources: [{ name: "Producer website", url: `https://beheer-${m}.example/kabinett` }],
      },
    ]),
  ]);
  const [wine] = await sql<{ id: string }>(
    `select w.id from public.wines w join public.producers p on p.id = w.producer_id
      where p.name = $1 and w.status = 'canonical'`,
    [producer],
  );
  const provider = `e2eadm_${m}`.toLowerCase().slice(0, 30);
  const providerName = `Beheerbron ${m}`;
  await sql("select public.catalog_provider_register($1::jsonb)", [
    JSON.stringify({ id: provider, name: providerName }),
  ]);
  await sql("select public.admin_catalog_provider_rights($1, $2::jsonb, $3, $4)", [
    provider,
    JSON.stringify({
      license: "CC BY 4.0",
      attribution: `${providerName} (CELLR test fixture, not real data)`,
      may_store: true,
      may_display: true,
      commercial_use: true,
      rights_status: "verified",
      rights_evidence: "Fictitious records written by CELLR for its own end-to-end tests",
      rights_verified_at: "2026-11-13",
      rights_verified_by: "e2e",
      search_scope: "public",
    }),
    "CELLR's own test data",
    "e2e",
  ]);
  const [run] = await sql<{ id: string }>(
    "select public.catalog_import_run_start($1, 'e2e-1', null, null, null, now()) as id",
    [provider],
  );
  await sql("select public.catalog_external_import($1, $2, $3::jsonb, true)", [
    provider,
    run!.id,
    JSON.stringify([
      {
        external_id: `K1${m}`,
        producer,
        name: `Riesling Kabinett ${m}`,
        wine_type: "white",
        country_code: "DE",
        vintages: [2019, 2021],
      },
      {
        external_id: `K2${m}`,
        producer,
        name: `Kabinett Riesling ${m}`,
        wine_type: "white",
        country_code: "DE",
      },
      {
        external_id: `K3${m}`,
        producer,
        name: `Riesling Spätlese ${m}`,
        wine_type: "white",
        country_code: "DE",
      },
    ]),
  ]);
  await sql("select public.catalog_import_run_finish($1, false, $2::jsonb)", [
    run!.id,
    JSON.stringify({ inserted: 3 }),
  ]);
  return { provider, providerName, wineId: wine!.id, k1: `K1${m}`, k2: `K2${m}`, k3: `K3${m}` };
}

const linkOf = async (externalId: string) =>
  (
    await sql<{ state: string; reason: string | null }>(
      `select l.state, l.reason from public.catalog_record_links l
         join public.catalog_external_records e on e.id = l.record_id where e.external_id = $1`,
      [externalId],
    )
  )[0] ?? null;

test.describe("admin: external sources", () => {
  test("only the admin; rights are shown, links are reviewed with a reason, and a source can only be switched off", async ({
    page,
    browser,
  }) => {
    const m = stamp();
    const src = await seed(m);

    // someone who is not the admin does not learn the page exists
    await arrive(page, "nonadmin");
    const denied = await page.goto("/admin/sources");
    expect(denied?.status()).toBe(404);

    const { admin, close } = await asAdmin(browser);
    await admin.goto(`/admin/sources?source=${src.provider}`);
    await expect(admin.getByRole("heading", { level: 1, name: "External sources" })).toBeVisible();
    await expect(
      admin
        .getByRole("navigation", { name: "Admin" })
        .getByRole("link", { name: "External sources" }),
    ).toHaveAttribute("aria-current", "page");
    await expect(admin.getByTestId("rights-notice")).toContainText(
      "Clearing a source is a human decision",
    );
    // nothing on the page can switch a source on or mark rights as verified
    await expect(
      admin.getByRole("button", { name: /switch on|enable|verify|make public|clear/i }),
    ).toHaveCount(0);

    const card = admin.locator(`[data-testid="source-card"][data-source="${src.provider}"]`);
    await expect(card).toContainText(src.providerName);
    await expect(card).toContainText("Rights: verified");
    await expect(card).toContainText("Shown to people");
    await expect(card).toContainText("CC BY 4.0");
    await expect(card).toContainText("Fictitious records written by CELLR");
    await expect(card).toContainText("3 active");
    await expect(card).toContainText("2 to review");
    await expect(card).toContainText("e2e-1");
    expect(await audit(admin)).toEqual([]);

    // the queue: the two exact identities, side by side with the catalogue wine; the Spätlese was never suggested
    const k1 = admin.locator(`[data-testid="link-card"][data-record="${src.k1}"]`);
    const k2 = admin.locator(`[data-testid="link-card"][data-record="${src.k2}"]`);
    await expect(k1).toContainText("Same producer and name");
    await expect(k1).toContainText("Vintages listed: 2019, 2021");
    await expect(k1).toContainText("other record of this source on the same wine");
    await expect(k2).toContainText("Matches a verified alias");
    await expect(admin.locator(`[data-testid="link-card"][data-record="${src.k3}"]`)).toHaveCount(
      0,
    );
    await admin.screenshot({ path: "test-results/shots/wi06-admin-sources.png", fullPage: true });

    // needs investigation: stays a suggestion, with the note; logged
    await k2.getByLabel("Reason (logged)").fill("word order differs: check the label");
    await k2.getByRole("button", { name: "Needs investigation" }).click();
    await expect(admin.getByTestId("action-message")).toContainText(
      "Marked as needing investigation",
    );
    expect(await linkOf(src.k2)).toEqual({
      state: "suggested",
      reason: "needs investigation: word order differs: check the label",
    });
    await expect(admin.locator(`[data-testid="link-card"][data-record="${src.k2}"]`)).toContainText(
      "needs investigation: word order differs",
    );

    // approve the exact one: it moves to "Approved", and the decision is logged with the admin and the reason
    const again = admin.locator(`[data-testid="link-card"][data-record="${src.k1}"]`);
    await again.getByLabel("Reason (logged)").fill("same producer, name, colour and country");
    await again.getByRole("button", { name: "Approve" }).click();
    await expect(admin.getByTestId("action-message")).toContainText("Link approved");
    expect(await linkOf(src.k1)).toEqual({
      state: "verified",
      reason: "same producer, name, colour and country",
    });
    expect(
      await sql<{ action: string; actor: string }>(
        `select a.action, a.actor::text from public.master_audit a
          where a.wine_id = $1 and a.entity_type = 'link' order by a.at`,
        [src.wineId],
      ),
    ).toEqual([
      { action: "external_record_needs_investigation", actor: ADMIN_ID },
      { action: "external_record_verified", actor: ADMIN_ID },
    ]);
    await admin.goto(`/admin/sources?state=verified&source=${src.provider}`);
    const approved = admin.locator(`[data-testid="link-card"][data-record="${src.k1}"]`);
    await expect(approved).toBeVisible();
    await expect(approved.getByRole("button", { name: "Approve" })).toHaveCount(0);
    // and it can be taken back
    await approved.getByLabel("Reason (logged)").fill("on second thought: another bottling");
    await approved.getByRole("button", { name: "Reject" }).click();
    await expect(admin.getByTestId("action-message")).toContainText("Link rejected");
    expect((await linkOf(src.k1))?.state).toBe("rejected");

    // the off switch: one audited step, out of people's search and blocked for imports
    await admin.goto("/admin/sources");
    const live = admin.locator(`[data-testid="source-card"][data-source="${src.provider}"]`);
    await live.getByLabel(/Reason for switching/).fill("e2e: licence withdrawn by the source");
    await live.getByLabel("Also block further imports").check();
    await live.getByRole("button", { name: "Switch off" }).click();
    await expect(admin.getByTestId("action-message")).toContainText("switched off and blocked");
    const off = admin.locator(`[data-testid="source-card"][data-source="${src.provider}"]`);
    await expect(off).toContainText("Rights: blocked");
    await expect(off).toContainText("Off");
    await expect(off.getByRole("button", { name: "Switch off" })).toHaveCount(0);
    expect(
      await sql("select search_scope, rights_status from public.catalog_providers where id = $1", [
        src.provider,
      ]),
    ).toEqual([{ search_scope: "off", rights_status: "blocked" }]);
    expect(
      await sql<{ actor: string; reason: string }>(
        "select actor, reason from public.catalog_provider_rights_log where provider_id = $1 order by at desc limit 1",
        [src.provider],
      ),
    ).toEqual([{ actor: `admin:${ADMIN_ID}`, reason: "e2e: licence withdrawn by the source" }]);
    await off.getByText(/Rights history/).click();
    await expect(off).toContainText("verified / public → blocked / off");
    await close();
  });

  // The two admin actions are plain form posts, reachable by anyone who can build the request. The same request is
  // sent three ways; only the admin's own, from the app's own address, does anything.
  test("a link decision posted from another site, or by someone who is not the admin, does nothing", async ({
    page,
    browser,
  }) => {
    const m = stamp();
    const src = await seed(m);
    const { admin, close } = await asAdmin(browser);
    await admin.goto(`/admin/sources?source=${src.provider}`);
    // exactly what the admin's browser would post: the form's hidden fields (the action reference included)
    const hidden = await admin
      .locator(`[data-testid="link-card"][data-record="${src.k1}"] form input[type="hidden"]`)
      .evaluateAll((els) =>
        els.map((e) => [(e as HTMLInputElement).name, (e as HTMLInputElement).value] as const),
      );
    expect(hidden.some(([n]) => n.startsWith("$ACTION_"))).toBe(true);
    const form = {
      ...Object.fromEntries(hidden),
      reason: "posted by hand: same producer and name",
      state: "verified",
    };
    const suggested = await linkOf(src.k1);
    expect(suggested?.state).toBe("suggested");

    // 1. the admin's own session, but the request comes from another site: refused before the action runs
    const foreign = await admin.request.post("/admin/sources", {
      headers: { origin: "https://elsewhere.example" },
      multipart: form,
      maxRedirects: 0,
    });
    expect(foreign.status(), "from another site").toBeGreaterThanOrEqual(400);
    expect(await linkOf(src.k1)).toEqual(suggested);

    // 2. a signed-in person who is not the admin, from the app's own address: not found
    await arrive(page, "notadmin");
    const stranger = await page.request.post("/admin/sources", {
      headers: { origin: APP_URL },
      multipart: form,
      maxRedirects: 0,
    });
    expect(stranger.status(), "not the admin").toBe(404);
    expect(await linkOf(src.k1)).toEqual(suggested);
    expect(
      await sql("select 1 from public.master_audit where wine_id = $1 and entity_type = 'link'", [
        src.wineId,
      ]),
    ).toEqual([]);

    // 3. the very same request from the admin, from the app's own address: it is a valid request, and it works
    const own = await admin.request.post("/admin/sources", {
      headers: { origin: APP_URL },
      multipart: form,
      maxRedirects: 0,
    });
    expect(own.status(), "the admin, same site").toBe(303);
    expect(await linkOf(src.k1)).toEqual({
      state: "verified",
      reason: "posted by hand: same producer and name",
    });
    await close();
  });

  test("usage events of the search and Koopcheck are counts and fixed words: never what was typed", async ({
    browser,
  }) => {
    const m = stamp();
    const src = await seed(m);
    const context = await browser.newContext({
      ...(test.info().project.use as BrowserContextOptions),
      baseURL: FEATURES_URL,
    });
    const page = await context.newPage();
    const me = await arrive(page, "telemetry");
    await page.goto("/sommelier/purchase-check");
    await page.getByRole("button", { name: "Search by name instead" }).click();
    const typed = `riesling kabinett ${m}`;
    await page.getByRole("combobox", { name: "Search for the wine in the shop" }).fill(typed);
    await page
      .getByTestId("wine-option")
      .filter({ has: page.getByText(`Riesling Kabinett ${m}`, { exact: true }) })
      .first()
      .click();
    await page.getByRole("button", { name: "Compare with my cellar" }).click();
    await expect(page.getByTestId("pc-result")).toBeVisible();

    const events = async () =>
      sql<{ name: string; props: Record<string, unknown> }>(
        `select e.name, e.props from public.analytics_events e join auth.users u on u.id = e.user_id
          where u.email = $1 and e.name in ('wine_search_session', 'purchase_check_completed') order by e.at`,
        [me.email],
      );
    await expect.poll(async () => (await events()).length).toBe(2);
    const [search, check] = await events();
    expect(search!.name).toBe("wine_search_session");
    expect(search!.props).toMatchObject({
      surface: "koopcheck",
      outcome: "selected",
      zero_results: false,
      limited: false,
      failed: false,
    });
    expect(["catalog", "provider"]).toContain(search!.props.source);
    expect(["1", "2_3", "4_8", "9_plus"]).toContain(search!.props.rank);
    expect(typeof search!.props.requests).toBe("number");
    expect(check!.name).toBe("purchase_check_completed");
    expect(check!.props).toMatchObject({ entry: "search", priced: false });
    expect(["vintage_profile", "stable_facts", "catalog_only", "none"]).toContain(
      check!.props.knowledge,
    );
    // nothing typed, no wine, no source name, no id
    const text = JSON.stringify([search!.props, check!.props]).toLowerCase();
    for (const secret of ["riesling", "kabinett", m.toLowerCase(), src.wineId, "beheer"])
      expect(text).not.toContain(secret);
    await context.close();

    // the admin sees them only as counts
    const { admin, close } = await asAdmin(browser);
    await admin.goto("/admin/sources");
    const metrics = admin.getByTestId("wi-metrics");
    await expect(metrics).toContainText("Search fields used");
    await expect(metrics).toContainText("koopcheck:");
    await expect(metrics).not.toContainText(m);
    await close();
  });
});
