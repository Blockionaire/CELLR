import { expect, test, type Page } from "@playwright/test";
import { apiClient, arrive } from "./helpers";

/**
 * Mobile bugfix: a sheet (here the wine's Edit sheet) never gets wider than the screen, so a sideways swipe cannot
 * drag its form out of view. The cause was the shared Sheet header: a long word in the title or description (a wine
 * name without spaces) could not wrap and pushed the header, and the close button, past the edge.
 */
test.skip(({ isMobile }) => !isMobile, "a phone");

const NAME = "CuvéeExceptionnellementLongueVieillesVignesRéserveSpécialeSélectionGrainsNobles";
const APPELLATION = "GevreyChambertinPremierCruLesCazetiersVieillesVignesMonopoleTrèsLongue";

/** Everything inside the open sheet, and the sheet's own scroller, against the screen's width. */
const measure = (page: Page) =>
  page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const dialog = document.querySelector("dialog[open]")!;
    const scroller = dialog.querySelector<HTMLElement>(".overflow-y-auto")!;
    const outside = [...dialog.querySelectorAll<HTMLElement>("*")]
      .filter((e) => e.getClientRects().length > 0)
      .map((e) => ({ e, b: e.getBoundingClientRect() }))
      .filter(({ b }) => b.right > vw + 0.5 || b.left < -0.5)
      .map(
        ({ e, b }) =>
          `${e.tagName}.${e.className.toString().slice(0, 40)} ${Math.round(b.left)}–${Math.round(b.right)}`,
      );
    return {
      vw,
      outside,
      scrollWidth: scroller.scrollWidth,
      clientWidth: scroller.clientWidth,
      scrollLeft: scroller.scrollLeft,
      scrollTop: scroller.scrollTop,
      dialogLeft: Math.round(dialog.getBoundingClientRect().left),
      pageX: window.scrollX + (window.visualViewport?.offsetLeft ?? 0),
    };
  });

/** A real finger (touch events, as on a phone) dragged across the screen. */
async function swipe(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const cdp = await page.context().newCDPSession(page);
  const steps = 8;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [from] });
  for (let i = 1; i <= steps; i++)
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps },
      ],
    });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(300);
}

for (const scheme of ["light", "dark"] as const)
  test(`the Edit sheet stays inside a phone's screen, whatever the names (${scheme})`, async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    await page.emulateMedia({ colorScheme: scheme });
    const { email } = await arrive(page, `sheetwidth${scheme}`);
    const { call } = await apiClient(request, email);
    const wine = (
      await call<{ id: string }>(
        "post",
        "/wines",
        {
          producer: "Domaine Large",
          name: NAME,
          type: "red",
          countryCode: "FR",
          region: "Bourgogne",
        },
        201,
      )
    ).body;
    await call(
      "post",
      "/bottles",
      { wineId: wine.id, year: 2015, quantity: 2, locationId: null },
      201,
    );
    await page.goto("/cellar");
    await page.getByText(NAME).first().click();
    await page.waitForURL(/\/cellar\/[0-9a-f-]{36}/);

    const dialog = page.getByRole("dialog");
    await expect(async () => {
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      await expect(dialog).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    await page.waitForTimeout(400); // the sheet has risen

    // A long appellation, typed as a person would, and the date field opened for the keyboard.
    const appellation = dialog.getByLabel("Appellation", { exact: true });
    await appellation.fill(APPELLATION);
    await expect(appellation).toHaveValue(APPELLATION);
    await appellation.press("Home");
    await appellation.press("End");
    await dialog.getByLabel("Purchase date").fill("2024-03-15");
    await expect(dialog.getByLabel("Purchase date")).toHaveValue("2024-03-15");
    await dialog.getByLabel("Purchase date").focus();

    // Nothing reaches past the screen's edge, the close button included.
    let m = await measure(page);
    expect(m.outside).toEqual([]);
    expect(m.scrollWidth).toBeLessThanOrEqual(m.clientWidth);
    await expect(dialog.getByRole("button", { name: "Close" })).toBeInViewport({ ratio: 1 });

    // A sideways swipe over the form moves nothing.
    const form = await page.evaluate(() => {
      const r = document.querySelector("dialog[open] .overflow-y-auto")!.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom };
    });
    const y = Math.round(form.top + (form.bottom - form.top) / 2);
    // Leftwards is where anything too wide would come from (the right edge); twice, over a field and a label.
    await swipe(page, { x: 350, y }, { x: 30, y: y - 10 });
    await swipe(page, { x: 350, y: y - 40 }, { x: 30, y: y - 40 });
    await expect(dialog).toBeVisible();
    m = await measure(page);
    expect(m.outside).toEqual([]);
    expect(m.scrollLeft).toBe(0);
    expect(m.dialogLeft).toBe(0);
    expect(m.pageX).toBe(0);

    // Every field is on screen, at full width, and still takes typing.
    for (const label of [
      "Wine name",
      "Region",
      "Country",
      "Appellation",
      "Purchase date",
      "Bought at",
    ]) {
      const field = dialog.getByLabel(label, { exact: true });
      await field.scrollIntoViewIfNeeded();
      const b = (await field.boundingBox())!;
      expect(b.x, label).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width, label).toBeLessThanOrEqual(m.vw);
    }
    await dialog.getByLabel("Bought at", { exact: true }).fill("Wijnhandel");
    await expect(dialog.getByLabel("Bought at", { exact: true })).toHaveValue("Wijnhandel");

    // Up and down still scrolls the form.
    await dialog.getByLabel("Wine name", { exact: true }).scrollIntoViewIfNeeded();
    const top = (await measure(page)).scrollTop;
    const name = (await dialog.getByLabel("Wine name", { exact: true }).boundingBox())!;
    await swipe(page, { x: 200, y: name.y + 200 }, { x: 200, y: name.y - 100 });
    expect((await measure(page)).scrollTop).toBeGreaterThan(top);

    await page.screenshot({ path: `test-results/shots/sheet-overflow-${scheme}.png` });
  });

test("other sheets with the same long name stay inside the screen too, and a sheet still drags down to close", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  const { email } = await arrive(page, "sheetwidthother");
  const { call } = await apiClient(request, email);
  const fridge = (
    await call<{ id: string }>(
      "post",
      "/storage",
      { label: "Wine fridge", kind: "fridge", rows: 3, cols: 4 },
      201,
    )
  ).body;
  const wine = (
    await call<{ id: string }>(
      "post",
      "/wines",
      { producer: "Domaine Large", name: NAME, type: "red", countryCode: "FR" },
      201,
    )
  ).body;
  await call(
    "post",
    "/bottles",
    { wineId: wine.id, year: 2015, quantity: 1, locationId: fridge.id },
    201,
  );
  await page.goto("/cellar");
  await page.getByText(NAME).first().click();
  await page.waitForURL(/\/cellar\/[0-9a-f-]{36}/);
  const dialog = page.getByRole("dialog");

  for (const action of ["Open a bottle", "Move"]) {
    await expect(async () => {
      await page.getByRole("button", { name: action, exact: true }).click();
      await expect(dialog).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    await page.waitForTimeout(400);
    const m = await measure(page);
    expect(m.outside, action).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  }

  // The handle still pulls the sheet down to close it.
  await page.getByRole("button", { name: "Move", exact: true }).click();
  await expect(dialog).toBeVisible();
  await page.waitForTimeout(400);
  const panel = (await dialog.locator(".sheet-panel").boundingBox())!;
  const handle = { x: panel.x + panel.width / 2, y: panel.y + 14 };
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(handle.x, handle.y + i * 25);
  await page.mouse.up();
  await expect(dialog).toBeHidden();
});

/**
 * Every field of the open sheet against the screen as the phone shows it (the visual viewport, not the document):
 * the same left edge and width as the form's column, nothing past the screen, and no sideways scroll range at all.
 */
const fields = (page: Page) =>
  page.evaluate(() => {
    const vv = window.visualViewport!;
    const scroller = document.querySelector<HTMLElement>("dialog[open] .overflow-y-auto")!;
    const form = scroller.querySelector("form")!.getBoundingClientRect();
    const tried = scroller.scrollLeft;
    scroller.scrollLeft = 200; // a sideways scroll, as a swipe would ask: there must be nowhere to go
    const after = scroller.scrollLeft;
    scroller.scrollLeft = tried;
    return {
      visible: { left: vv.offsetLeft, width: vv.width },
      column: { left: Math.round(form.left), width: Math.round(form.width) },
      scroller: { scrollWidth: scroller.scrollWidth, clientWidth: scroller.clientWidth, after },
      controls: [
        ...scroller.querySelectorAll<HTMLElement>("input:not([type=checkbox]), select"),
      ].map((e) => {
        const b = e.getBoundingClientRect();
        return {
          what: `${e.tagName.toLowerCase()}[${(e as HTMLInputElement).type}]`,
          left: Math.round(b.left),
          right: Math.round(b.right),
          width: Math.round(b.width),
        };
      }),
    };
  });

for (const scheme of ["light", "dark"] as const)
  test(`an ordinary wine: every field, the purchase date too, is exactly the column's width, focused or not (${scheme})`, async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    await page.emulateMedia({ colorScheme: scheme });
    const { email } = await arrive(page, `sheetfields${scheme}`);
    const { call } = await apiClient(request, email);
    const wine = (
      await call<{ id: string }>(
        "post",
        "/wines",
        {
          producer: "Domaine Leflaive",
          name: "Puligny-Montrachet",
          type: "white",
          countryCode: "FR",
          region: "Bourgogne",
        },
        201,
      )
    ).body;
    await call(
      "post",
      "/bottles",
      { wineId: wine.id, year: 2020, quantity: 2, locationId: null },
      201,
    );
    await page.goto("/cellar");
    await page.getByText("Puligny-Montrachet").first().click();
    await page.waitForURL(/\/cellar\/[0-9a-f-]{36}/);
    const dialog = page.getByRole("dialog");
    await expect(async () => {
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      await expect(dialog).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    await page.waitForTimeout(400);
    await dialog.getByLabel("Appellation", { exact: true }).fill("Puligny-Montrachet Premier Cru");
    await dialog.getByLabel("Purchase date").fill("2024-03-15");

    const check = async (when: string) => {
      const m = await fields(page);
      expect(m.visible.left, when).toBe(0);
      // the column sits inside the visible screen, with the sheet's own padding on both sides
      expect(m.column.left, when).toBeGreaterThanOrEqual(16);
      expect(m.column.left + m.column.width, when).toBeLessThanOrEqual(m.visible.width - 16);
      expect(m.scroller.scrollWidth, when).toBeLessThanOrEqual(m.scroller.clientWidth);
      expect(m.scroller.after, when).toBe(0);
      expect(m.controls.length, when).toBeGreaterThanOrEqual(7);
      for (const c of m.controls) {
        expect(c.left, `${when}: ${c.what}`).toBe(m.column.left);
        expect(c.width, `${when}: ${c.what}`).toBe(m.column.width);
      }
      return m;
    };
    const first = await check("closed keyboard");
    console.log(`measured (${scheme}):`, JSON.stringify(first));

    // Focus each field (as the keyboard or the date picker would), blur it, and swipe sideways after each.
    const form = await page.evaluate(() => {
      const r = document.querySelector("dialog[open] .overflow-y-auto")!.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom };
    });
    const y = Math.round((form.top + form.bottom) / 2);
    for (const label of ["Wine name", "Appellation", "Purchase date", "Bought at", "Year"]) {
      const field = dialog.getByLabel(label, { exact: true });
      await field.scrollIntoViewIfNeeded();
      await field.focus();
      await check(`${label} focused`);
      await swipe(page, { x: 350, y }, { x: 30, y: y - 10 });
      await check(`${label} focused, after a swipe`);
      await field.blur();
      await swipe(page, { x: 340, y: y + 20 }, { x: 20, y: y + 10 });
      await check(`${label} blurred, after a swipe`);
    }
    await expect(dialog.getByLabel("Purchase date")).toHaveValue("2024-03-15");
    await dialog.getByLabel("Purchase date").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `test-results/shots/sheet-fields-${scheme}.png` });
  });
