import {
  expect as baseExpect,
  type APIRequestContext,
  type Browser,
  type Page,
  type TestInfo,
} from "@playwright/test";
import {
  PREVIEW_URL,
  apiClient,
  onboardCreate,
  signIn,
  sql,
  stamp,
  uniqueEmail,
  wineBody,
} from "./helpers";

// a shared machine: several browsers at once, each waiting for the same small server
const expect = baseExpect.configure({ timeout: 30_000 });

/**
 * Shared by the browser specs of shared racks (ADR-010): real people, each in a browser of their own with a
 * household of their own, on the preview server (where shared racks are open and write to the local stack).
 */

/** A device without 3D: the rack is then the flat grid, which does everything the 3D picture does. */
export const noWebGL = () => {
  const original = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (
    this: HTMLCanvasElement,
    type: string,
    ...rest: unknown[]
  ) {
    if (type === "webgl" || type === "webgl2" || type === "experimental-webgl") return null;
    return (original as (...a: unknown[]) => unknown).call(this, type, ...rest);
  } as typeof original;
};

export interface Person {
  name: string;
  email: string;
  userId: string;
  householdId: string;
  friendCode: string;
  page: Page;
  /** Everything the API answered this person's browser, as text: for proving what never reached it. */
  heard: string[];
  call: Awaited<ReturnType<typeof apiClient>>["call"];
  /** Bottles of one new wine of this person's own, without a place. */
  bottles: (wine: string, quantity?: number) => Promise<string[]>;
  close: () => Promise<void>;
}

/** Someone signs in in a browser of their own (the project's device), makes a household and gives their name. */
export async function arriveAs(
  browser: Browser,
  request: APIRequestContext,
  info: TestInfo,
  name: string,
  options: { webgl?: boolean } = {},
): Promise<Person> {
  const use = info.project.use;
  const context = await browser.newContext({
    baseURL: PREVIEW_URL,
    ...(use.viewport ? { viewport: use.viewport } : {}),
    ...(use.userAgent ? { userAgent: use.userAgent } : {}),
    ...(use.deviceScaleFactor ? { deviceScaleFactor: use.deviceScaleFactor } : {}),
    ...(use.isMobile ? { isMobile: use.isMobile } : {}),
    ...(use.hasTouch ? { hasTouch: use.hasTouch } : {}),
  });
  if (options.webgl === false) await context.addInitScript(noWebGL);
  await context.addInitScript(() => window.sessionStorage.setItem("cellr:3d-debug", "1"));
  const page = await context.newPage();
  const heard: string[] = [];
  page.on("response", (response) => {
    if (!response.url().includes("/api/v1/")) return;
    void response
      .text()
      .then((text) => heard.push(`${response.url()}\n${text}`))
      .catch(() => {});
  });
  const email = uniqueEmail(name.toLowerCase());
  await signIn(page, email);
  await onboardCreate(page, `${name} home ${stamp()}`, name);
  const [who] = await sql<{ id: string; friend_code: string; household_id: string }>(
    `select p.id, p.friend_code, m.household_id from public.profiles p
       join auth.users u on u.id = p.id join public.household_members m on m.user_id = p.id where u.email = $1`,
    [email],
  );
  const { call } = await apiClient(request, email);
  const bottles = async (wine: string, quantity = 1) => {
    const made = await call<{ id: string }>("post", "/wines", { ...wineBody, name: wine }, 201);
    const added = await call<{ bottleIds: string[] }>(
      "post",
      "/bottles",
      { wineId: made.body.id, year: 2019, quantity, locationId: null },
      201,
    );
    return added.body.bottleIds;
  };
  return {
    name,
    email,
    userId: who!.id,
    householdId: who!.household_id,
    friendCode: who!.friend_code,
    page,
    heard,
    call,
    bottles,
    close: () => context.close(),
  };
}

export const RACK_LAYOUT = (rows: number, cols: number) => ({
  structure: { template: "rack_classic", rows, cols, cellCapacity: 1, zones: [] },
  appearance: { v: 1, material: "wood", color: "oak", lighting: "none", door: "none" },
});

/** The cellar's 3D screen. */
export async function open3D(page: Page) {
  await page.goto("/cellar");
  await page.getByRole("radio", { name: "3D" }).click();
  await expect(page.getByTestId("shared-racks-entry")).toBeVisible({ timeout: 30_000 });
}

/** A shared rack, chosen from the row of places. */
export async function openRack(page: Page, name: string) {
  await open3D(page);
  await page.getByTestId("shared-rack-chip").filter({ hasText: name }).click();
  await expect(page.getByTestId("shared-rack-name")).toHaveText(name);
  await expect(page.getByTestId("shared-rack-stage")).toBeVisible();
}

export const stage = (page: Page) => page.getByTestId("shared-rack-stage");
export const bottleAt = (page: Page, spot: string) =>
  page.locator(`[data-testid="shared-rack-cell"][data-spot="${spot}"]`);
export const freeAt = (page: Page, spot: string) =>
  page.locator(`[data-testid="shared-rack-free"][data-spot="${spot}"]`);

/** Puts one of my bottles on a free spot, through the flat grid. */
export async function addBottle(page: Page, spot: string, wine: string | RegExp) {
  await page.getByTestId("shared-rack-add").click();
  await freeAt(page, spot).click();
  await page.getByTestId("shared-rack-candidate").filter({ hasText: wine }).first().click();
}

export const placements = (rackId: string) =>
  sql<{ bottle_id: string; owner_user_id: string; loc_row: number; loc_col: number }>(
    "select bottle_id, owner_user_id, loc_row, loc_col from private.shared_rack_placements where rack_id = $1 order by loc_row, loc_col",
    [rackId],
  );
export const eventTypes = (rackId: string) =>
  sql<{ event_type: string; actor_id: string | null; owner_id: string | null }>(
    "select event_type, actor_id, owner_id from private.shared_rack_events where rack_id = $1 order by seq",
    [rackId],
  );
