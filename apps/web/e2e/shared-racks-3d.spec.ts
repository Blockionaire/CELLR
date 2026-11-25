import { expect as baseExpect, test, type Page } from "@playwright/test";
import { PREVIEW_URL, sql } from "./helpers";
import { arriveAs, bottleAt, openRack, placements, stage, RACK_LAYOUT } from "./shared-racks-ui";

/**
 * A shared rack DRAWN IN 3D by the cellar's own storage view (ADR-010): bottles by placement id with their owner in
 * the panel, free spots tapped in the picture to add and to move, and the same rack as a list by choice. This spec
 * draws a 3D scene, so it belongs to the 3D suite (playwright.config.ts THREE_D_SPECS).
 */
test.setTimeout(240_000);
test.use({ baseURL: PREVIEW_URL });
const expect = baseExpect.configure({ timeout: 20_000 });

const canvas = (page: Page) => stage(page).locator("canvas[data-engine]");
const drawn = (page: Page) =>
  expect(canvas(page)).toHaveAttribute("data-frames", /^[1-9]/, { timeout: 90_000 });

/** Taps the marker of a free spot in the picture, where the view itself says it is. */
async function tapSpot(page: Page, row: number, col: number, touch: boolean) {
  await expect(canvas(page)).toHaveAttribute("data-spots", /^[1-9]/);
  await canvas(page).scrollIntoViewIfNeeded();
  const at = await page.evaluate(
    ([r, c]) =>
      (
        window as unknown as {
          __cellrStorage3d: {
            locateSpot: (r: number, c: number) => { x: number; y: number } | null;
          };
        }
      ).__cellrStorage3d.locateSpot(r!, c!),
    [row, col],
  );
  expect(at, `marker ${row}:${col}`).not.toBeNull();
  const box = (await canvas(page).boundingBox())!;
  if (touch) await page.touchscreen.tap(box.x + at!.x, box.y + at!.y);
  else await page.mouse.click(box.x + at!.x, box.y + at!.y);
}

test("a shared rack in 3D: whose bottle it is, adding my own on a tapped spot, moving someone else's", async ({
  browser,
  request,
}, info) => {
  const touch = info.project.use.hasTouch === true;
  const ann = await arriveAs(browser, request, info, "Ann");
  const bob = await arriveAs(browser, request, info, "Bob");
  const [annBottle] = await ann.bottles("Ann Riesling");
  await bob.bottles("Bob Barolo");
  const rackName = `3D rack ${info.project.name}`;
  const rack = (
    await ann.call<{ id: string }>(
      "post",
      "/shared-racks",
      { name: rackName, ...RACK_LAYOUT(3, 4) },
      201,
    )
  ).body.id;
  const invited = await ann.call<{ invitationId: string }>(
    "post",
    `/shared-racks/${rack}/invitations`,
    { userId: bob.userId },
    201,
  );
  await bob.call(
    "post",
    `/shared-racks/invitations/${invited.body.invitationId}`,
    { accept: true },
    200,
  );
  await ann.call(
    "post",
    `/shared-racks/${rack}/bottles`,
    { bottleId: annBottle, to: { row: 1, col: 1, index: 1 } },
    201,
  );
  const [{ id: annPlacement }] = (await sql<{ id: string }>(
    "select id from private.shared_rack_placements where bottle_id = $1",
    [annBottle],
  )) as [{ id: string }];

  // Bob opens the rack from his row of places: it is drawn in 3D, with Ann's bottle in it
  await openRack(bob.page, rackName);
  await expect(stage(bob.page)).toHaveAttribute("data-view", "3d");
  await drawn(bob.page);
  await expect(stage(bob.page)).toHaveAttribute("data-bottles", "1");

  // Ann's bottle, taken out to look at (by the keyboard list, as a screen reader would): whose it is, who put it there
  await bob.page.getByTestId("shared-rack-list").getByRole("button").first().focus();
  await bob.page.keyboard.press("Enter");
  const panel = bob.page.getByTestId("inspection-panel");
  await expect(bob.page.getByTestId("shared-rack-move")).toBeVisible({ timeout: 30_000 });
  await expect(panel).toContainText("Owner");
  await expect(panel).toContainText("Ann");
  // no photo of Ann's label is asked for: the label is drawn from the names
  expect(bob.heard.filter((text) => text.includes("/api/v1/images/"))).toEqual([]);

  // Bob moves Ann's bottle by tapping a free spot in the picture
  await bob.page.getByTestId("shared-rack-move").click();
  {
    // DIAGNOSTIC (temporary)
    const seen: string[] = [];
    for (let i = 0; i < 30; i++) {
      seen.push(
        `${await stage(bob.page).getAttribute("data-mode")}/${await stage(bob.page).getAttribute("data-view")}`,
      );
      await bob.page.waitForTimeout(100);
    }
    console.log("DIAG modes", seen.join(" "));
    console.log("DIAG placements", JSON.stringify(await placements(rack)));
    console.log("DIAG status", await bob.page.locator("body").innerText());
  }
  await expect(stage(bob.page)).toHaveAttribute("data-mode", "move");
  await tapSpot(bob.page, 2, 3, touch);
  await expect(
    bob.page.getByText(/Ann Riesling 2019 now stands on shelf 2, spot 3\./),
  ).toBeVisible();
  expect(await placements(rack)).toEqual([
    { bottle_id: annBottle, owner_user_id: ann.userId, loc_row: 2, loc_col: 3 },
  ]);
  expect(
    await sql(
      "select actor_id, owner_id, placement_id from private.shared_rack_events where rack_id = $1 and event_type = 'bottle_moved'",
      [rack],
    ),
  ).toEqual([{ actor_id: bob.userId, owner_id: ann.userId, placement_id: annPlacement }]);

  // Bob adds his own bottle on a spot he taps
  await bob.page.getByTestId("shared-rack-add").click();
  await expect(stage(bob.page)).toHaveAttribute("data-mode", "add");
  await tapSpot(bob.page, 1, 1, touch);
  await bob.page.getByTestId("shared-rack-candidate").first().click();
  await expect(
    bob.page.getByText(
      /Bob Barolo 2019 now stands on shelf 1, spot 1\. It is yours in this rack\./,
    ),
  ).toBeVisible();
  await expect(stage(bob.page)).toHaveAttribute("data-bottles", "2");
  expect((await placements(rack)).map((p) => [p.owner_user_id, p.loc_row, p.loc_col])).toEqual([
    [bob.userId, 1, 1],
    [ann.userId, 2, 3],
  ]);

  // the same rack as a list, by choice: the same bottles, the same owners
  await bob.page.getByTestId("shared-rack-flat-toggle").click();
  await expect(stage(bob.page)).toHaveAttribute("data-view", "grid");
  await expect(bottleAt(bob.page, "1:1")).toHaveAccessibleName(/bottle of you/);
  await expect(bottleAt(bob.page, "2:3")).toHaveAccessibleName(/bottle of Ann/);

  // Ann sees it in 3D too, with both bottles
  await openRack(ann.page, rackName);
  await drawn(ann.page);
  await expect(stage(ann.page)).toHaveAttribute("data-bottles", "2");
  await Promise.all([ann.close(), bob.close()]);
});
