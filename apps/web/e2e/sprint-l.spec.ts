import { expect, test, type Locator, type Page } from "@playwright/test";
import { apiClient, arrive, audit, bearer, makeJpeg, sql } from "./helpers";

/**
 * Sprint L, the bottle screens: the quick preview in the racks view, the bottle on display in 3D, the wine's page.
 * What is checked is what a person sees: which bottle, where it lies, a name never cut off or hidden, nothing
 * under the action buttons, and the way back.
 */
test.skip(({ isMobile }) => !isMobile, "the bottle screens on a phone");

type Call = Awaited<ReturnType<typeof apiClient>>["call"];

const LONG = {
  producer: "Capichera",
  name: "Vign'Angena Vermentino di Gallura Superiore",
  type: "white",
  countryCode: "IT",
  region: "Vermentino di Gallura Superiore DOCG",
};
const SHORT = {
  producer: "Fratelli Giuliari",
  name: "Nemm",
  type: "red",
  countryCode: "IT",
  region: "Veneto",
};

async function seed(page: Page, request: Parameters<typeof apiClient>[0], label: string) {
  const { email, householdId } = await arrive(page, label);
  const { call, token } = await apiClient(request, email);
  const rack = (
    await call<{ id: string }>(
      "post",
      "/storage",
      { label: "Rack", kind: "rack", rows: 3, cols: 4 },
      201,
    )
  ).body.id;
  const add = async (wine: object, year: number) => {
    const w = (await call<{ id: string }>("post", "/wines", wine, 201)).body;
    const { bottleIds } = (
      await call<{ bottleIds: string[] }>(
        "post",
        "/bottles",
        { wineId: w.id, year, quantity: 1, locationId: null },
        201,
      )
    ).body;
    const [v] = await sql<{ vintage_id: string }>(
      "select vintage_id from public.bottles where id = $1",
      [bottleIds[0]],
    );
    return { bottleId: bottleIds[0]!, vintageId: v!.vintage_id };
  };
  const long = await add(LONG, 2025);
  const short = await add(SHORT, 2023);
  const place =
    "update public.bottles set location_id = $2, loc_row = $3, loc_col = $4 where id = $1";
  await sql(place, [long.bottleId, rack, 2, 3]);
  await sql(place, [short.bottleId, rack, 1, 1]);
  await photo(page, request, token, call, long.vintageId);
  return { householdId, long, short };
}

/** A front label photo (not straightened): it is shown as a print beside the drawn bottle. */
async function photo(
  page: Page,
  request: Parameters<typeof apiClient>[0],
  token: string,
  call: Call,
  vintageId: string,
) {
  const jpeg = await makeJpeg(page, { words: "Test label", color: "#efe6d2" });
  const res = await request.post("/api/v1/images", {
    headers: bearer(token),
    multipart: {
      photo: { name: "p.jpg", mimeType: "image/jpeg", buffer: jpeg },
      thumb: { name: "t.jpg", mimeType: "image/jpeg", buffer: jpeg },
      side: "front",
      blurColor: "#e8dcc2",
    },
  });
  expect(res.status()).toBe(201);
  const { id } = (await res.json()) as { id: string };
  await call("put", `/cellar/${vintageId}/photo`, { imageId: id, side: "front" }, 200);
}

const box = async (l: Locator) => (await l.boundingBox())!;
/** Whole inside the screen, and nothing wider than it. */
async function onScreen(page: Page, l: Locator) {
  const b = await box(l);
  const { width, height } = page.viewportSize()!;
  expect(b.y, "top on screen").toBeGreaterThanOrEqual(0);
  expect(b.y + b.height, "bottom on screen").toBeLessThanOrEqual(height + 0.5);
  expect(b.x).toBeGreaterThanOrEqual(0);
  expect(b.x + b.width).toBeLessThanOrEqual(width + 0.5);
}
const noSideScroll = async (page: Page) =>
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(0);

test("the quick preview: the bottle, its name, where it lies, three actions, and the way back", async ({
  page,
  request,
}) => {
  const { long } = await seed(page, request, "sprintl1");
  await page.goto("/cellar");
  await page.getByRole("radio", { name: "Racks" }).click();

  // A long name with a label photo.
  await page.getByRole("button", { name: /Vign'Angena .* 2025, shelf 2, position 3/ }).click();
  const sheet = page.getByRole("dialog", { name: LONG.name });
  await expect(sheet).toBeVisible();
  const peek = sheet.getByTestId("bottle-peek");
  await expect(peek.getByText(LONG.name, { exact: true })).toBeVisible();
  await onScreen(page, peek.getByText(LONG.name, { exact: true }));
  await expect(peek.getByText("Capichera", { exact: true })).toBeVisible();
  // (the drawn bottle's label carries the year too)
  await expect(peek.getByText("2025", { exact: true }).last()).toBeVisible();
  await expect(peek.getByTestId("peek-place")).toContainText("Shelf 2 · Position 3");
  await expect(peek.getByTestId("slot-map")).toBeVisible();
  await expect(peek.getByTestId("bottle-portrait")).toHaveAttribute("data-label", "print");
  // The three actions sit side by side, whole, on screen, and not over the text.
  const actions = [
    sheet.getByRole("button", { name: "Open", exact: true }),
    sheet.getByRole("button", { name: "Move", exact: true }),
    sheet.getByRole("link", { name: "Details" }),
  ];
  for (const a of actions) await onScreen(page, a);
  const [open, move, details] = await Promise.all(actions.map(box));
  expect(open!.x + open!.width).toBeLessThanOrEqual(move!.x);
  expect(move!.x + move!.width).toBeLessThanOrEqual(details!.x);
  const place = await box(peek.getByTestId("peek-place"));
  expect(place.y + place.height).toBeLessThanOrEqual(open!.y);
  expect(await audit(page)).toEqual([]);

  // Escape closes it; a short name without a photo has its typeset bottle.
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await page.getByRole("button", { name: /Nemm 2023, shelf 1, position 1/ }).click();
  const short = page.getByRole("dialog", { name: "Nemm" });
  await expect(short.getByTestId("bottle-portrait")).toHaveAttribute("data-label", "typeset");
  await short.getByRole("button", { name: "Close" }).click();
  await expect(short).toBeHidden();

  // Details goes to the wine's page; back returns to the racks.
  await page.getByRole("button", { name: /Vign'Angena .* 2025, shelf 2, position 3/ }).click();
  await sheet.getByRole("link", { name: "Details" }).click();
  await expect(page).toHaveURL(new RegExp(`/cellar/${long.vintageId}`));
  await page.goBack();
  await expect(page.getByRole("radio", { name: "Racks" })).toHaveAttribute("aria-checked", "true");
  await noSideScroll(page);
});

test("3D: the name stays in view, also after reading another bottle's details first", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await seed(page, request, "sprintl2");
  await page.goto("/cellar");
  await page.getByRole("radio", { name: "3D" }).click();
  const scene = page.getByTestId("cellar-3d");
  await expect(scene).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
  const list = page.getByRole("list", { name: /Bottles in Rack/ });
  const panel = page.getByTestId("bottle-showcase");
  const show = async (name: RegExp) => {
    await list.getByRole("button", { name }).focus();
    await page.keyboard.press("Enter");
    await expect(panel).toHaveAttribute("data-open", "true");
    // The panel slides in after the bottle has come out.
    await page.waitForTimeout(1200);
  };

  await show(/Nemm 2023/);
  // Read the details to the end, then put the bottle back.
  const body = panel.locator("[data-testid=showcase-heading] + div");
  await expect(panel.getByTestId("showcase-facts")).toBeAttached();
  await body.evaluate((el) => (el.scrollTop = el.scrollHeight));
  await panel.getByRole("button", { name: "Put it back" }).click();
  await expect(panel).toHaveAttribute("data-open", "false");
  await page.waitForTimeout(1500);

  // The next bottle, with a long name: its heading is whole and on screen, its details start at the top.
  await show(/Vign'Angena/);
  const heading = panel.getByRole("heading", { name: LONG.name });
  await expect(heading).toBeVisible();
  await onScreen(page, heading);
  const top = await box(panel);
  expect((await box(heading)).y).toBeGreaterThanOrEqual(top.y);
  expect(await body.evaluate((el) => el.scrollTop)).toBe(0);
  await expect(panel.getByTestId("showcase-heading")).toContainText("2025");
  // The actions are below the details, never over them, and all three are there.
  const opener = panel.getByRole("button", { name: "Open this bottle" });
  await onScreen(page, opener);
  expect((await box(opener)).y).toBeGreaterThanOrEqual(
    (await box(body)).y + (await box(body)).height,
  );
  await expect(panel.getByRole("button", { name: "Move" })).toBeVisible();
  await expect(panel.getByRole("link", { name: "Full page" })).toBeVisible();
  // Turning the bottle still works: a drag on the picture does not put it back.
  const canvas = (await box(scene.locator("canvas[data-engine]")))!;
  await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height * 0.25);
  await page.mouse.down();
  await page.mouse.move(canvas.x + canvas.width / 2 + 80, canvas.y + canvas.height * 0.25, {
    steps: 6,
  });
  await page.mouse.up();
  await expect(panel).toHaveAttribute("data-open", "true");
});

test("the wine's page: the bottle as the hero, at a glance, and nothing under the action bar", async ({
  page,
  request,
}) => {
  const { long, short } = await seed(page, request, "sprintl3");

  await page.goto(`/cellar/${long.vintageId}`);
  const h1 = page.getByRole("heading", { level: 1, name: LONG.name });
  await expect(h1).toBeVisible();
  await onScreen(page, h1);
  await expect(page.getByTestId("bottle-portrait")).toHaveAttribute("data-label", "print");
  const glance = page.getByTestId("at-a-glance");
  await expect(glance.getByTestId("bottle-count")).toHaveText("1");
  await expect(glance).toContainText("Rack");
  await noSideScroll(page);

  // The action bar sits clear of the bottom navigation's raised scan button.
  const opener = page.getByRole("button", { name: "Open a bottle" });
  const scan = page.getByRole("navigation").getByRole("link", { name: /Scan/ });
  const [o, s] = [await box(opener), await box(scan)];
  expect(o.y + o.height).toBeLessThanOrEqual(s.y);
  // At the end of the page, the last section is above the bar, not under it.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const last = await box(page.getByTestId("complete-wine"));
  const bar = await box(page.getByRole("group", { name: "Actions" }));
  expect(last.y + last.height).toBeLessThanOrEqual(bar.y + 1);

  // A wine without a photo: the drawn bottle, no print.
  await page.goto(`/cellar/${short.vintageId}`);
  await expect(page.getByRole("heading", { level: 1, name: "Nemm" })).toBeVisible();
  await expect(page.getByTestId("bottle-portrait")).toHaveAttribute("data-label", "typeset");
  expect(await audit(page)).toEqual([]);
});
