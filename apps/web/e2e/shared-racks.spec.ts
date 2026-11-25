import { expect as baseExpect, test } from "@playwright/test";
import {
  APP_URL,
  FEATURES_URL,
  PREVIEW_URL,
  apiClient,
  arrive,
  audit,
  settled,
  sql,
  wineBody,
} from "./helpers";
import {
  addBottle,
  arriveAs,
  bottleAt,
  chooseBottle,
  eventTypes,
  focusInSheet,
  focusKept,
  freeAt,
  open3D,
  openRack,
  placements,
  stage,
  RACK_LAYOUT,
} from "./shared-racks-ui";

/**
 * Shared racks in the product (ADR-010): three people from three households, each in a browser of their own, on the
 * preview server (shared racks open, writing to the local stack: real Postgres, PostgREST and the database's own
 * authorisation). Everything here is done through the FLAT GRID, on a device without 3D: so this is also the proof
 * that the 2D alternative does every flow, and no 3D scene is drawn (the 3D picture has its own spec, in the 3D suite).
 */
test.setTimeout(240_000);
test.use({ baseURL: PREVIEW_URL });
const expect = baseExpect.configure({ timeout: 15_000 });

test("three households share one rack: invite, place, move, take out, open at home, remove", async ({
  browser,
  request,
}, info) => {
  const ann = await arriveAs(browser, request, info, "Ann", { webgl: false });
  const bob = await arriveAs(browser, request, info, "Bob", { webgl: false });
  const cy = await arriveAs(browser, request, info, "Cy", { webgl: false });
  const annBoth = await ann.bottles("Ann Riesling", 2);
  const bobBoth = await bob.bottles("Bob Barolo", 2);
  // two bottles of one wine look the same in a list: which of the two each of them puts in first is read back below
  let [annFirst, annSecond] = annBoth;
  let [bobFirst, bobSecond] = bobBoth;
  await cy.bottles("Cy Chenin");
  // what must never reach anyone else: Ann's private facts, on the bottles that go into the rack too
  await sql(
    "update public.bottles set purchase_price_cents = 987654, purchased_from = 'ANNSECRETSHOP', notes = 'ANNSECRETNOTE' where household_id = $1",
    [ann.householdId],
  );
  const rackName = `Office rack ${info.project.name}`;

  await test.step("Ann makes a shared rack from the cellar's 3D screen", async () => {
    await open3D(ann.page);
    await ann.page.getByTestId("shared-racks-entry").click();
    await expect(ann.page.getByTestId("shared-racks-none")).toBeVisible();
    await focusInSheet(ann.page);
    await settled(ann.page.getByRole("dialog"));
    expect(await audit(ann.page), "the shared racks sheet").toEqual([]);
    await ann.page.getByTestId("shared-rack-new").click();
    await ann.page.getByTestId("shared-rack-name").fill(rackName);
    await ann.page.getByTestId("shared-rack-rows").fill("2");
    await ann.page.getByTestId("shared-rack-cols").fill("3");
    expect(await audit(ann.page), "the new rack form").toEqual([]);
    await ann.page.getByTestId("shared-rack-create").click();
    await expect(ann.page.getByTestId("shared-rack-name")).toHaveText(rackName);
    await focusKept(ann.page);
    // in the row of places, marked as shared in words (not by colour): its name, and how many are in it
    await expect(
      ann.page.getByRole("button", { name: `Shared rack ${rackName}, 1 member` }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(ann.page.getByTestId("shared-rack-meta")).toContainText("Shared rack · 1 member");
    await expect(stage(ann.page)).toHaveAttribute("data-view", "grid");
  });
  const [{ id: rackId }] = (await sql<{ id: string }>(
    "select id from private.shared_racks where name = $1",
    [rackName],
  )) as [{ id: string }];

  await test.step("Ann invites Bob and Cy by friend code; takes one invitation back and sends it again", async () => {
    await ann.page.getByTestId("shared-rack-people-open").click();
    await focusInSheet(ann.page);
    for (const person of [bob, cy]) {
      await ann.page.getByTestId("shared-rack-invite-q").fill(person.friendCode);
      await ann.page.getByRole("button", { name: "Find" }).click();
      await expect(ann.page.getByTestId("shared-rack-found")).toContainText(person.name);
      await ann.page.getByTestId("shared-rack-invite").click();
      await expect(
        ann.page.getByTestId("shared-rack-pending").filter({ hasText: person.name }),
      ).toBeVisible();
    }
    await settled(ann.page.getByRole("dialog"));
    expect(await audit(ann.page), "the people sheet").toEqual([]);
    // someone who does not exist is said plainly, and is not an invitation
    await ann.page.getByTestId("shared-rack-invite-q").fill("ZZZZZZZZ");
    await ann.page.getByRole("button", { name: "Find" }).click();
    await expect(ann.page.getByTestId("shared-rack-not-found")).toBeVisible();
    // Cy's invitation is taken back, and sent again
    await ann.page
      .getByTestId("shared-rack-pending")
      .filter({ hasText: "Cy" })
      .getByTestId("shared-rack-cancel-invitation")
      .click();
    await expect(ann.page.getByTestId("shared-rack-pending")).toHaveCount(1);
    await ann.page.getByTestId("shared-rack-invite-q").fill(cy.friendCode);
    await ann.page.getByRole("button", { name: "Find" }).click();
    await ann.page.getByTestId("shared-rack-invite").click();
    await expect(ann.page.getByTestId("shared-rack-pending")).toHaveCount(2);
    // the last owner is told she cannot leave, before any request is made
    await expect(ann.page.getByTestId("shared-rack-last-owner")).toBeVisible();
    await expect(ann.page.getByTestId("shared-rack-leave")).toHaveCount(0);
    await ann.page.keyboard.press("Escape");
    // closed, the focus is back on what opened it
    await expect(ann.page.getByTestId("shared-rack-people-open")).toBeFocused();
  });

  await test.step("Bob sees the invitation in his cellar and accepts; Cy reads hers in Dutch and declines", async () => {
    await open3D(bob.page);
    await expect(bob.page.getByTestId("shared-racks-badge")).toHaveText("1 invitation");
    // before accepting: no rack in his row of places
    await expect(bob.page.getByTestId("shared-rack-chip")).toHaveCount(0);
    await bob.page.getByTestId("shared-rack-invitations-chip").click();
    await focusInSheet(bob.page);
    await expect(bob.page.getByTestId("shared-rack-invitation")).toContainText(
      `Ann invites you to ${rackName}`,
    );
    await bob.page.getByTestId("shared-rack-accept").click();
    // after accepting, the rack is the place on screen, and in his row of places
    await expect(bob.page.getByTestId("shared-rack-name")).toHaveText(rackName);
    await focusKept(bob.page);
    await expect(
      bob.page.getByRole("button", { name: `Shared rack ${rackName}, 2 members` }),
    ).toBeVisible();

    await cy.page.goto("/profile");
    await cy.page.getByRole("radio", { name: "Nederlands" }).click();
    await expect(cy.page.locator("html")).toHaveAttribute("lang", "nl");
    await cy.page.goto("/cellar");
    await cy.page.getByRole("radio", { name: "3D" }).click();
    await cy.page.getByTestId("shared-racks-entry").click();
    await expect(cy.page.getByRole("dialog", { name: "Gedeelde kasten" })).toBeVisible();
    await focusInSheet(cy.page);
    await expect(cy.page.getByTestId("shared-rack-invitation")).toContainText(
      `Ann nodigt je uit voor ${rackName}`,
    );
    await cy.page.getByTestId("shared-rack-decline").click();
    await expect(cy.page.getByText("Uitnodiging afgeslagen.")).toBeVisible();
    await expect(cy.page.getByTestId("shared-rack-invitation")).toHaveCount(0);
    await expect(cy.page.getByTestId("shared-racks-none")).toHaveText(
      "Je zit nog niet in een gedeelde kast.",
    );
    // someone who declined is not asked again straight away: Ann is told so
    await ann.page.getByTestId("shared-rack-people-open").click();
    await expect(ann.page.getByTestId("shared-rack-member")).toHaveCount(2);
    await ann.page.getByTestId("shared-rack-invite-q").fill(cy.friendCode);
    await ann.page.getByRole("button", { name: "Find" }).click();
    await ann.page.getByTestId("shared-rack-invite").click();
    await expect(
      ann.page.getByText("They declined a little while ago. Try again later."),
    ).toBeVisible();
    await ann.page.keyboard.press("Escape");
    await expect(ann.page.getByTestId("shared-rack-people-open")).toBeFocused();
  });

  await test.step("Ann and Bob each put a bottle of their own in; both see the same rack with the right owners", async () => {
    await openRack(ann.page, rackName);
    await addBottle(ann.page, "1:1", "Ann Riesling");
    await expect(
      ann.page.getByText(
        /Ann Riesling 2019 now stands on shelf 1, spot 1\. It is yours in this rack\./,
      ),
    ).toBeVisible();
    await openRack(bob.page, rackName);
    // only his own bottles are offered to him: never Ann's
    await bob.page.getByTestId("shared-rack-add").click();
    await freeAt(bob.page, "1:2").click();
    await expect(bob.page.getByTestId("shared-rack-candidate")).toHaveCount(2);
    await focusInSheet(bob.page);
    await expect(bob.page.getByTestId("shared-rack-add-sheet")).not.toContainText("Ann Riesling");
    await settled(bob.page.getByRole("dialog"));
    expect(await audit(bob.page), "the add sheet").toEqual([]);
    await bob.page.getByTestId("shared-rack-candidate").first().click();
    await expect(bottleAt(bob.page, "1:2")).toBeVisible();
    // the spot that opened the sheet is a bottle now: the focus is on that bottle
    await expect(bottleAt(bob.page, "1:2")).toBeFocused();
    const first = await placements(rackId);
    annFirst = first.find((p) => p.owner_user_id === ann.userId)?.bottle_id;
    annSecond = annBoth.find((id) => id !== annFirst);
    bobFirst = first.find((p) => p.owner_user_id === bob.userId)?.bottle_id;
    bobSecond = bobBoth.find((id) => id !== bobFirst);
    expect([annFirst, annSecond, bobFirst, bobSecond].every(Boolean)).toBe(true);

    await openRack(ann.page, rackName);
    for (const page of [ann.page, bob.page]) {
      await expect(stage(page)).toHaveAttribute("data-bottles", "2");
      await expect(bottleAt(page, "1:1")).toHaveAccessibleName(
        new RegExp(
          `Shelf 1, spot 1: Domaine Test Ann Riesling 2019, bottle of ${page === ann.page ? "you" : "Ann"}`,
        ),
      );
      await expect(bottleAt(page, "1:2")).toHaveAccessibleName(
        new RegExp(
          `Shelf 1, spot 2: Domaine Test Bob Barolo 2019, bottle of ${page === bob.page ? "you" : "Bob"}`,
        ),
      );
    }
    expect((await placements(rackId)).map((p) => p.owner_user_id)).toEqual([
      ann.userId,
      bob.userId,
    ]);
  });

  await test.step("the owner filter only chooses what is shown: nothing moves", async () => {
    const filter = bob.page.getByTestId("shared-rack-filter");
    await expect(filter.getByRole("button")).toHaveText(["Everyone · 2", "Mine · 1", "Ann · 1"]);
    await filter.getByRole("button", { name: "Ann · 1" }).click();
    await expect(bottleAt(bob.page, "1:2")).toHaveAttribute("data-dimmed", "true");
    await expect(bottleAt(bob.page, "1:1")).toHaveAttribute("data-dimmed", "false");
    await expect(bob.page.getByTestId("shared-rack-filter-note")).toContainText(
      "Showing 1 of 2 bottles",
    );
    await expect(bottleAt(bob.page, "1:2")).toHaveAccessibleName(
      /left out by the filter, still in the rack/,
    );
    await filter.getByRole("button", { name: "Mine · 1" }).click();
    await expect(bottleAt(bob.page, "1:1")).toHaveAttribute("data-dimmed", "true");
    await filter.getByRole("button", { name: "Everyone · 2" }).click();
    expect(await placements(rackId)).toHaveLength(2);
  });

  await test.step("Bob moves Ann's bottle: it stays Ann's, and the history names both", async () => {
    await bottleAt(bob.page, "1:1").click();
    const chosen = bob.page.getByTestId("shared-rack-chosen");
    await expect(chosen).toContainText("Ann Riesling");
    await expect(chosen).toContainText("Owner");
    await expect(chosen.getByText("Ann", { exact: true }).first()).toBeVisible();
    await chosen.getByTestId("shared-rack-move").click();
    await expect(bob.page.getByTestId("shared-rack-choosing")).toContainText(
      "Choose a free spot for Domaine Test Ann Riesling 2019",
    );
    await freeAt(bob.page, "2:3").click();
    await expect(
      bob.page.getByText(/Ann Riesling 2019 now stands on shelf 2, spot 3\./),
    ).toBeVisible();
    await expect(bottleAt(bob.page, "2:3")).toHaveAccessibleName(/bottle of Ann/);
    expect((await placements(rackId)).find((p) => p.bottle_id === annFirst)).toMatchObject({
      owner_user_id: ann.userId,
      loc_row: 2,
      loc_col: 3,
    });
    await openRack(ann.page, rackName);
    await expect(bottleAt(ann.page, "2:3")).toHaveAccessibleName(/bottle of you/);
    await ann.page.getByTestId("shared-rack-activity-open").click();
    await focusInSheet(ann.page);
    const events = ann.page.getByTestId("shared-rack-event");
    await expect(events.first()).toHaveText(
      /Bob moved Ann’s Domaine Test Ann Riesling 2019 from shelf 1, spot 1 to shelf 2, spot 3\./,
    );
    await expect(events.first().locator("time")).toHaveText(/\d{4}/);
    await settled(ann.page.getByRole("dialog"));
    expect(await audit(ann.page), "the history sheet").toEqual([]);
    // filtered by who did it
    await ann.page.getByTestId("shared-rack-activity-actor").selectOption({ label: "Bob" });
    await expect(events).toHaveText([
      /Bob moved Ann’s/,
      /Bob put .*Bob Barolo.* on shelf 1, spot 2/,
      /Bob joined/,
    ]);
    await ann.page.keyboard.press("Escape");
    await expect(ann.page.getByTestId("shared-rack-activity-open")).toBeFocused();
    // the history of one bottle, from the bottle itself
    await chooseBottle(ann.page, "2:3");
    await ann.page.getByTestId("shared-rack-bottle-history").click();
    await focusInSheet(ann.page);
    await expect(ann.page.getByTestId("shared-rack-activity-bottle")).toContainText("Ann Riesling");
    await expect(events).toHaveText([
      /Bob moved Ann’s/,
      /Ann put .*Ann Riesling.* on shelf 1, spot 1/,
    ]);
    await ann.page.keyboard.press("Escape");
    await focusKept(ann.page);
  });

  await test.step("two browsers, one spot: one bottle gets it, the other person is told and sees the rack as it is", async () => {
    // Bob looks at the rack and starts choosing a spot; his picture of the rack is from before Ann's bottle
    await bob.page.getByTestId("shared-rack-add").click();
    await expect(freeAt(bob.page, "2:1")).toBeVisible();
    await addBottle(ann.page, "2:1", "Ann Riesling");
    await expect(bottleAt(ann.page, "2:1")).toBeVisible();
    await freeAt(bob.page, "2:1").click();
    await bob.page.getByTestId("shared-rack-candidate").first().click();
    await expect(
      bob.page.getByText(
        /That spot was just taken\. Pick another\. The rack was read again: this is how it is now\./,
      ),
    ).toBeVisible();
    // refreshed: Ann's bottle is on that spot, Bob's second bottle is in no rack, and nothing was tried elsewhere
    await expect(bottleAt(bob.page, "2:1")).toHaveAccessibleName(/bottle of Ann/);
    await expect(stage(bob.page)).toHaveAttribute("data-bottles", "3");
    expect((await placements(rackId)).filter((p) => p.bottle_id === bobSecond)).toEqual([]);
    expect((await eventTypes(rackId)).filter((e) => e.event_type === "bottle_placed")).toHaveLength(
      3,
    );
  });

  await test.step("Bob takes Ann's bottle out: said honestly, recorded, and it is still Ann's, unopened, at home", async () => {
    await chooseBottle(bob.page, "2:3");
    await bob.page.getByTestId("shared-rack-chosen").getByTestId("shared-rack-takeout").click();
    await focusInSheet(bob.page);
    const sheet = bob.page.getByTestId("shared-rack-takeout-sheet");
    await expect(sheet).toContainText("Taking it out is not drinking it");
    await expect(sheet).toContainText(
      "It is Ann’s bottle and stays Ann’s. Only Ann can say it was drunk.",
    );
    await settled(bob.page.getByRole("dialog"));
    expect(await audit(bob.page), "the take-out sheet").toEqual([]);
    await bob.page.getByTestId("shared-rack-takeout-confirm").click();
    await expect(
      bob.page.getByText(/Recorded: you took .*Ann Riesling 2019 out\. It is still Ann’s bottle/),
    ).toBeVisible();
    await expect(bottleAt(bob.page, "2:3")).toHaveCount(0);
    // the bottle that opened the sheet is gone: the focus is not lost with it
    await focusKept(bob.page);
    expect(
      await sql(
        "select status, household_id, location_id, opened_at from public.bottles where id = $1",
        [annFirst],
      ),
    ).toEqual([
      { status: "in_cellar", household_id: ann.householdId, location_id: null, opened_at: null },
    ]);
    expect((await eventTypes(rackId)).at(-1)).toEqual({
      event_type: "bottle_taken_out",
      actor_id: bob.userId,
      owner_id: ann.userId,
    });
    await openRack(ann.page, rackName);
    await ann.page.getByTestId("shared-rack-activity-open").click();
    await expect(ann.page.getByTestId("shared-rack-event").first()).toHaveText(
      /Bob took Ann’s Domaine Test Ann Riesling 2019 out \(from shelf 2, spot 3\)\. It is still Ann’s\. · left the rack/,
    );
    await ann.page.keyboard.press("Escape");
  });

  await test.step("Ann opens her other bottle at home: it leaves the rack, and the history says opened, by Ann", async () => {
    await ann.call("patch", `/bottles/${annSecond}`, { action: "open" }, 200);
    await openRack(bob.page, rackName);
    await expect(stage(bob.page)).toHaveAttribute("data-bottles", "1");
    await expect(bottleAt(bob.page, "2:1")).toHaveCount(0);
    await bob.page.getByTestId("shared-rack-activity-open").click();
    await expect(bob.page.getByTestId("shared-rack-event").first()).toHaveText(
      /Ann opened Domaine Test Ann Riesling 2019\. · left the rack/,
    );
    await bob.page.keyboard.press("Escape");
  });

  await test.step("Bob takes his own bottle out and is offered his own cellar's next steps; then puts it back", async () => {
    await chooseBottle(bob.page, "1:2");
    await bob.page.getByTestId("shared-rack-chosen").getByTestId("shared-rack-takeout").click();
    await expect(bob.page.getByTestId("shared-rack-takeout-sheet")).toContainText(
      "It is your bottle: afterwards it is in your own cellar, without a place.",
    );
    await bob.page.getByTestId("shared-rack-takeout-confirm").click();
    await expect(bob.page.getByTestId("shared-rack-takeout-done")).toContainText(
      "is out of the rack",
    );
    await expect(bob.page.getByTestId("shared-rack-takeout-wine")).toHaveAttribute(
      "href",
      /\/cellar\/[0-9a-f-]{36}$/,
    );
    await bob.page.getByRole("button", { name: "Later" }).click();
    expect(
      await sql("select status, location_id from public.bottles where id = $1", [bobFirst]),
    ).toEqual([{ status: "in_cellar", location_id: null }]);
    await addBottle(bob.page, "1:2", "Bob Barolo");
    await expect(bottleAt(bob.page, "1:2")).toBeVisible();
  });

  await test.step("Ann removes Bob: his open screen stops at the next action, and his own cellar still has his bottle", async () => {
    await openRack(ann.page, rackName);
    await ann.page.getByTestId("shared-rack-people-open").click();
    const row = ann.page.getByTestId("shared-rack-member").filter({ hasText: "Bob" });
    await row.getByTestId("shared-rack-remove-member").click();
    await expect(row.getByTestId("shared-rack-confirm")).toContainText(
      "Bob’s bottles stay Bob’s. They stay where they stand, under Bob’s name, until someone records taking them out.",
    );
    await row.getByTestId("shared-rack-confirm-yes").click();
    await expect(ann.page.getByTestId("shared-rack-member")).toHaveCount(1);
    await ann.page.keyboard.press("Escape");
    // Bob's bottle still stands in the rack, under his name, as someone who is no longer in it
    await openRack(ann.page, rackName);
    await chooseBottle(ann.page, "1:2");
    await expect(ann.page.getByTestId("shared-rack-chosen")).toContainText(
      "Bob (no longer in this rack; the bottle is still theirs)",
    );

    // Bob's screen still shows the rack as he last saw it; his next action is refused, clearly, and changes nothing
    const before = await placements(rackId);
    await chooseBottle(bob.page, "1:2");
    await bob.page.getByTestId("shared-rack-chosen").getByTestId("shared-rack-move").click();
    await freeAt(bob.page, "2:2").click();
    await expect(
      bob.page.getByText("You are no longer a member of this rack. Nothing was changed."),
    ).toBeVisible();
    await expect(bob.page.getByTestId("shared-rack-no-access")).toBeVisible();
    // the control he used went with the rack: the focus is on what is said instead
    await expect(bob.page.getByTestId("shared-rack-no-access")).toBeFocused();
    // nothing of the rack is left on his screen
    await expect(stage(bob.page)).toHaveCount(0);
    expect(await placements(rackId)).toEqual(before);
    await bob.page.getByTestId("shared-rack-back").click();
    await expect(bob.page.getByTestId("shared-rack-chip")).toHaveCount(0);

    // his own cellar: the bottle is his, and is said to stand in a shared rack he cannot open (not which, not where)
    await bob.page.getByRole("radio", { name: "Racks" }).click();
    const note = bob.page.getByTestId("shared-rack-unplaced-note");
    await expect(note).toContainText("1 of your bottles stands in a shared rack");
    await expect(note.getByTestId("shared-rack-unplaced-bottle")).toHaveAttribute(
      "data-access",
      "false",
    );
    await expect(note).toContainText("in a shared rack you are not (or no longer) a member of");
    await expect(note).not.toContainText(rackName);
    expect(await audit(bob.page), "the racks view with the note").toEqual([]);
    await note.getByTestId("shared-rack-withdraw").click();
    await expect(note).toContainText("The bottle itself does not change");
    await note.getByTestId("shared-rack-withdraw-confirm").click();
    await expect(bob.page.getByTestId("shared-rack-unplaced-note")).toHaveCount(0);
    expect(await placements(rackId)).toEqual([]);
    // he is no longer in the rack, so the rack's history does not name him as the one who did it: only whose
    // bottle it was
    expect((await eventTypes(rackId)).at(-1)).toEqual({
      event_type: "bottle_withdrawn",
      actor_id: null,
      owner_id: bob.userId,
    });
    await openRack(ann.page, rackName);
    await ann.page.getByTestId("shared-rack-activity-open").click();
    await expect(ann.page.getByTestId("shared-rack-event").first()).toHaveText(
      /Someone of Bob’s household said .*Bob Barolo.* is no longer in the rack\./,
    );
    await ann.page.keyboard.press("Escape");
    await expect(ann.page.getByRole("dialog")).toHaveCount(0);
    expect(
      await sql("select status, household_id from public.bottles where id = $1", [bobFirst]),
    ).toEqual([{ status: "in_cellar", household_id: bob.householdId }]);
  });

  await test.step("nothing of Ann's own cellar ever reached Bob or Cy: not on screen, not in any answer", async () => {
    for (const person of [bob, cy]) {
      const everything = person.heard.join("\n");
      expect(everything.length, `${person.name} heard the API`).toBeGreaterThan(1000);
      for (const secret of [
        "ANNSECRET",
        "987654",
        ann.householdId,
        annFirst!,
        annSecond!,
        ann.email,
      ])
        expect(everything, `${person.name}: ${secret}`).not.toContain(secret);
      expect(await person.page.locator("body").innerText()).not.toContain("ANNSECRET");
    }
    // and Bob did see what he was meant to: the label of Ann's bottle while it stood in the rack
    expect(bob.heard.join("\n")).toContain("Ann Riesling");
  });

  await test.step("Ann archives the rack, with what that means said first", async () => {
    await ann.page.getByTestId("shared-rack-settings-open").click();
    await expect(ann.page.getByTestId("shared-rack-rename")).toBeVisible();
    await focusInSheet(ann.page);
    await ann.page.getByTestId("shared-rack-rename").fill(`${rackName} (old)`);
    await ann.page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(ann.page.getByTestId("shared-rack-name")).toHaveText(`${rackName} (old)`);
    await settled(ann.page.getByRole("dialog"));
    expect(await audit(ann.page), "the settings sheet").toEqual([]);
    await ann.page.getByTestId("shared-rack-archive").click();
    await expect(ann.page.getByTestId("shared-rack-confirm")).toContainText(
      "Every bottle stays its owner’s and stays where it stands. Bottles can still be taken out.",
    );
    await ann.page.getByTestId("shared-rack-confirm-yes").click();
    await expect(ann.page.getByTestId("shared-rack-restore")).toBeVisible();
    await ann.page.keyboard.press("Escape");
    await expect(ann.page.getByTestId("shared-rack-settings-open")).toBeFocused();
    await expect(ann.page.getByTestId("shared-rack-archived")).toBeVisible();
    await expect(ann.page.getByTestId("shared-rack-add")).toHaveCount(0);
  });

  await Promise.all([ann.close(), bob.close(), cy.close()]);
});

test("a layout saved against an older version of the rack is refused, said, and the fields take the latest", async ({
  browser,
  request,
}, info) => {
  const ann = await arriveAs(browser, request, info, "Ann", { webgl: false });
  const [bottle] = await ann.bottles("Ann Riesling");
  const rack = (
    await ann.call<{ id: string }>(
      "post",
      "/shared-racks",
      { name: "Layout rack", ...RACK_LAYOUT(3, 4) },
      201,
    )
  ).body.id;
  await ann.call(
    "post",
    `/shared-racks/${rack}/bottles`,
    { bottleId: bottle, to: { row: 3, col: 4, index: 1 } },
    201,
  );
  await openRack(ann.page, "Layout rack");
  await ann.page.getByTestId("shared-rack-settings-open").click();
  // a layout that would take the bottle's spot away is not saved
  await ann.page.getByTestId("shared-rack-rows").fill("2");
  await ann.page.getByTestId("shared-rack-save-layout").click();
  await expect(ann.page.getByTestId("shared-rack-layout-error")).toContainText(
    "There are still bottles in the part you're removing. Move them first.",
  );
  // meanwhile the rack is changed elsewhere (another device of hers): her draft is from an older version
  await ann.page.getByTestId("shared-rack-rows").fill("5");
  await ann.page.route("**/api/v1/shared-racks/*/bottles", (route) => route.abort());
  await ann.call("put", `/shared-racks/${rack}/layout`, RACK_LAYOUT(4, 4), 200);
  await ann.page.getByTestId("shared-rack-save-layout").click();
  await expect(ann.page.getByTestId("shared-rack-layout-error")).toContainText(
    "This place was changed since you opened it. Reload it to see the latest version.",
  );
  await ann.page.unroute("**/api/v1/shared-racks/*/bottles");
  // nothing of her stale draft was saved; the fields now start from the rack as it is
  expect(await sql("select grid_rows from private.shared_racks where id = $1", [rack])).toEqual([
    { grid_rows: 4 },
  ]);
  await ann.page.keyboard.press("Escape");
  await openRack(ann.page, "Layout rack");
  await ann.page.getByTestId("shared-rack-settings-open").click();
  await expect(ann.page.getByTestId("shared-rack-rows")).toHaveValue("4");
  await ann.page.getByTestId("shared-rack-rows").fill("6");
  await ann.page.getByTestId("shared-rack-save-layout").click();
  await expect(ann.page.getByText("The layout was saved.")).toBeVisible();
  expect(await sql("select grid_rows from private.shared_racks where id = $1", [rack])).toEqual([
    { grid_rows: 6 },
  ]);
  await ann.close();
});

test("a small phone (375 × 667): the rack and its sheets fit, and every control is big enough to tap", async ({
  browser,
  request,
}, info) => {
  const ann = await arriveAs(browser, request, info, "Ann", { webgl: false });
  await ann.page.setViewportSize({ width: 375, height: 667 });
  const [bottle] = await ann.bottles("Ann Riesling");
  const rack = (
    await ann.call<{ id: string }>(
      "post",
      "/shared-racks",
      { name: "Small rack", ...RACK_LAYOUT(5, 12) },
      201,
    )
  ).body.id;
  await ann.call(
    "post",
    `/shared-racks/${rack}/bottles`,
    { bottleId: bottle, to: { row: 1, col: 1, index: 1 } },
    201,
  );
  await openRack(ann.page, "Small rack");
  const fits = () =>
    ann.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  expect(await fits(), "the rack's screen does not scroll sideways").toBe(true);
  // a rack of 12 across scrolls inside its own box, not the page
  await expect(ann.page.getByTestId("shared-rack-grid")).toBeVisible();
  const small = async (scope: string) =>
    ann.page.evaluate((selector) => {
      const out: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>(
        `${selector} button, ${selector} a, ${selector} select`,
      )) {
        const box = el.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) continue;
        if (box.height < 44 || box.width < 44)
          out.push(
            `${el.textContent?.trim().slice(0, 30)} ${Math.round(box.width)}x${Math.round(box.height)}`,
          );
      }
      return out;
    }, scope);
  expect(await small('[data-testid="shared-rack-top"]'), "the rack's actions").toEqual([]);
  expect(await small('[data-testid="shared-rack-filter"]'), "the owner filter").toEqual([]);
  expect(await small('[data-testid="shared-rack-grid"]'), "the grid").toEqual([]);
  expect(await audit(ann.page), "the rack's screen").toEqual([]);
  for (const [opener, inside] of [
    ["shared-rack-people-open", "shared-rack-people"],
    ["shared-rack-activity-open", "shared-rack-activity"],
    ["shared-rack-settings-open", "shared-rack-settings"],
  ] as const) {
    await ann.page.getByTestId(opener).click();
    await expect(ann.page.getByTestId(inside)).toBeVisible();
    await settled(ann.page.getByRole("dialog"));
    expect(await fits(), `${inside} does not scroll sideways`).toBe(true);
    expect(await small(`[data-testid="${inside}"]`), inside).toEqual([]);
    await ann.page.keyboard.press("Escape");
    await expect(ann.page.getByTestId(inside)).toBeHidden();
  }
  await ann.close();
});

for (const [name, base] of [
  ["not switched on", APP_URL],
  ["switched on, on a production build", FEATURES_URL],
] as const)
  test.describe(`gate closed (${name})`, () => {
    test.use({ baseURL: base });
    test("nothing of shared racks is shown, asked for or downloaded", async ({ page, request }) => {
      const asked: string[] = [];
      const code: Array<Promise<string>> = [];
      page.on("request", (request) => {
        if (request.url().includes("shared-racks")) asked.push(request.url());
      });
      page.on("response", (response) => {
        if (/\/_next\/static\/.*\.js/.test(response.url()))
          code.push(response.text().catch(() => ""));
      });
      // (a cellar with a bottle in it: an empty one has no choice of views at all)
      const { email } = await arrive(page, "srclosed");
      const { call } = await apiClient(request, email);
      const wine = (await call<{ id: string }>("post", "/wines", wineBody, 201)).body;
      const added = await call<{ bottleIds: string[] }>(
        "post",
        "/bottles",
        { wineId: wine.id, year: 2019, quantity: 2 },
        201,
      );
      await call("post", "/storage", { label: "Home rack", kind: "rack", rows: 2, cols: 2 }, 201);
      // the wine's page: a bottle without a place is "Not placed yet", and Move gives it one, exactly as before
      const [{ vintage_id: vintageId }] = (await sql<{ vintage_id: string }>(
        "select vintage_id from public.bottles where id = $1",
        [added.body.bottleIds[0]],
      )) as [{ vintage_id: string }];
      await page.goto(`/cellar/${vintageId}`);
      await expect(page.getByTestId("bottle-places")).toContainText("Not placed yet");
      await page.getByRole("button", { name: "Move", exact: true }).click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Shelf 2, position 2, empty" })
        .click();
      await expect(page.getByText("Moved to Home rack · Shelf 2 · Position 2.")).toBeVisible();
      await expect(page.locator('[data-testid^="shared-"]')).toHaveCount(0);
      await page.goto("/cellar");
      for (const view of ["3D", "List", "Racks"]) {
        await page.getByRole("radio", { name: view }).click();
        await page.waitForTimeout(1_500);
        await expect(page.locator('[data-testid^="shared-"]')).toHaveCount(0);
        await expect(page.getByText("Shared racks")).toHaveCount(0);
      }
      // a bottle without a place gets one, exactly as before: nothing is said about shared racks, nothing is asked
      await page
        .getByRole("region", { name: "Home rack" })
        .getByRole("button", { name: "Shelf 1, position 1, empty" })
        .click();
      await page.getByRole("dialog").getByRole("button", { name: /2019/ }).click();
      await expect(page.getByText("Moved to Home rack · Shelf 1 · Position 1.")).toBeVisible();
      await expect(page.locator('[data-testid^="shared-"]')).toHaveCount(0);
      expect(asked, "no request names shared racks").toEqual([]);
      const scripts = await Promise.all(code);
      expect(scripts.length).toBeGreaterThan(3);
      // the rack's screen has this name in its code, and in no other code; so has the line that says where a bottle
      // of mine stands in a shared rack (the wine's page, its Move)
      expect(scripts.filter((text) => text.includes("shared-rack-stage"))).toEqual([]);
      expect(scripts.filter((text) => text.includes("shared-place-line"))).toEqual([]);
    });
  });

test("my own cellar: a bottle that stands in a shared rack is said so where it is offered for a place, and asked about first", async ({
  browser,
  request,
}, info) => {
  const ann = await arriveAs(browser, request, info, "Ann");
  const [inRack] = await ann.bottles("Ann Riesling");
  await ann.bottles("Ann Chablis");
  const rack = (
    await ann.call<{ id: string }>(
      "post",
      "/shared-racks",
      { name: "Club rack", ...RACK_LAYOUT(2, 3) },
      201,
    )
  ).body.id;
  await ann.call(
    "post",
    `/shared-racks/${rack}/bottles`,
    { bottleId: inRack, to: { row: 2, col: 3, index: 1 } },
    201,
  );
  const home = (
    await ann.call<{ id: string }>(
      "post",
      "/storage",
      { label: "Home rack", kind: "rack", rows: 2, cols: 3 },
      201,
    )
  ).body.id;
  await ann.call(
    "put",
    `/smart-cellar/storage/${home}/layout`,
    {
      structure: { template: "rack_classic", rows: 2, cols: 3, cellCapacity: 1, zones: [] },
      appearance: { v: 1, material: "wood", color: "walnut", lighting: "none", door: "none" },
    },
    200,
  );
  const where = () =>
    sql<{ location_id: string | null; status: string }>(
      "select location_id, status from public.bottles where id = $1",
      [inRack],
    );
  const ask = ann.page.getByTestId("shared-place-confirm");

  await test.step("the racks view: the list of a tapped spot says where it stands; No changes nothing", async () => {
    await ann.page.goto("/cellar");
    await ann.page.getByRole("radio", { name: "Racks" }).click();
    const spot = (col: number) =>
      ann.page
        .getByRole("region", { name: "Home rack" })
        .getByRole("button", { name: `Shelf 1, position ${col}, empty` });
    await spot(1).click();
    const sheet = ann.page.getByRole("dialog").filter({ hasText: "Place a bottle here" });
    await expect(sheet.getByTestId("shared-place-badge")).toHaveText(
      "In shared rack Club rack · shelf 2, spot 3",
    );
    // a bottle that stands in no shared rack goes through at once
    await sheet.getByRole("button", { name: /Ann Chablis/ }).click();
    await expect(ann.page.getByText("Moved to Home rack · Shelf 1 · Position 1.")).toBeVisible();
    await expect(ask).toHaveCount(0);
    // the one in the shared rack is asked about first
    await spot(2).click();
    await sheet.getByRole("button", { name: /Ann Riesling/ }).click();
    await expect(ask).toContainText(
      "Ann Riesling 2019 stands in the shared rack Club rack, on shelf 2, spot 3. Giving it a place here takes it out of the shared rack",
    );
    await focusInSheet(ann.page);
    await settled(ann.page.getByRole("dialog").filter({ has: ask }));
    expect(await audit(ann.page), "the question").toEqual([]);
    await ann.page.getByTestId("shared-place-confirm-no").click();
    await expect(ask).toHaveCount(0);
    // the question is gone, and the focus is back on the bottle that was chosen
    await expect(sheet.getByRole("button", { name: /Ann Riesling/ })).toBeFocused();
    expect(await placements(rack)).toHaveLength(1);
    expect(await where()).toEqual([{ location_id: null, status: "in_cellar" }]);
    await ann.page.keyboard.press("Escape");
  });

  await test.step("the 3D view's placing: said in the list, asked on confirm; Yes moves it home and out of the rack", async () => {
    await ann.page.getByRole("radio", { name: "3D" }).click();
    const list = ann.page.getByTestId("placement-unplaced");
    await expect(list.getByTestId("shared-place-badge")).toHaveText(
      "In shared rack Club rack · shelf 2, spot 3",
    );
    await list.getByRole("button", { name: "Place" }).click();
    await ann.page.getByTestId("spot-picker").locator('[data-spot="2:2:1"]').click();
    await ann.page.getByTestId("placement-confirm").click();
    await expect(ask).toContainText("takes it out of the shared rack");
    // nothing has moved while the question is open
    expect(await where()).toEqual([{ location_id: null, status: "in_cellar" }]);
    await ann.page.getByTestId("shared-place-confirm-yes").click();
    await expect(ann.page.getByText(/is now at Home rack · shelf 2 · spot 2/)).toBeVisible();
    expect(await where()).toEqual([{ location_id: home, status: "in_cellar" }]);
    expect(await placements(rack)).toEqual([]);
    expect((await eventTypes(rack)).at(-1)).toEqual({
      event_type: "bottle_relocated",
      actor_id: ann.userId,
      owner_id: ann.userId,
    });
  });
  await ann.close();
});

test("the wine's page: a bottle in a shared rack is said to stand there, and moving it home is asked first", async ({
  browser,
  request,
}, info) => {
  const ann = await arriveAs(browser, request, info, "Ann");
  const code: Array<Promise<string>> = [];
  ann.page.on("response", (response) => {
    if (/\/_next\/static\/.*\.js/.test(response.url())) code.push(response.text().catch(() => ""));
  });
  const [inRack] = await ann.bottles("Ann Riesling");
  const rack = (
    await ann.call<{ id: string }>(
      "post",
      "/shared-racks",
      { name: "Club rack", ...RACK_LAYOUT(2, 3) },
      201,
    )
  ).body.id;
  await ann.call(
    "post",
    `/shared-racks/${rack}/bottles`,
    { bottleId: inRack, to: { row: 2, col: 3, index: 1 } },
    201,
  );
  const home = (
    await ann.call<{ id: string }>(
      "post",
      "/storage",
      { label: "Home rack", kind: "rack", rows: 2, cols: 3 },
      201,
    )
  ).body.id;
  const [{ vintage_id: vintageId }] = (await sql<{ vintage_id: string }>(
    "select vintage_id from public.bottles where id = $1",
    [inRack],
  )) as [{ vintage_id: string }];
  const where = () =>
    sql<{ location_id: string | null; status: string }>(
      "select location_id, status from public.bottles where id = $1",
      [inRack],
    );
  // (the question is a sheet of its own, inside the Move sheet)
  const ask = ann.page.getByRole("dialog", { name: "This bottle stands in a shared rack" });
  const line = "In shared rack Club rack · shelf 2, spot 3";

  await test.step("the page says where it stands, not that it has no place", async () => {
    await ann.page.goto(`/cellar/${vintageId}`);
    const places = ann.page.getByTestId("bottle-places");
    await expect(places.getByTestId("shared-place-line").first()).toHaveText(line);
    await expect(places).not.toContainText("Not placed yet");
    // the group and the bottle, and the "Where" tile at the top
    await expect(places.getByTestId("shared-place-line")).toHaveText([line, line]);
    await expect(ann.page.locator("dd").getByTestId("shared-place-line")).toHaveText(line);
    expect(await audit(ann.page), "the wine's page").toEqual([]);
  });

  const spot = (col: number) =>
    ann.page.getByRole("dialog").getByRole("button", { name: `Shelf 1, position ${col}, empty` });
  await test.step("Move to a spot at home: asked first; No changes nothing and gives the focus back", async () => {
    await ann.page.getByRole("button", { name: "Move", exact: true }).click();
    await expect(spot(1)).toBeVisible();
    await spot(1).click();
    await expect(ask).toContainText(
      "Ann Riesling 2019 stands in the shared rack Club rack, on shelf 2, spot 3. Giving it a place here takes it out of the shared rack",
    );
    // the question has the focus, and nothing has moved while it is open
    await expect.poll(() => ask.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    expect(await where()).toEqual([{ location_id: null, status: "in_cellar" }]);
    await settled(ask);
    expect(await audit(ann.page), "the question").toEqual([]);
    await ann.page.getByTestId("shared-place-confirm-no").click();
    await expect(ann.page.getByTestId("shared-place-confirm")).toHaveCount(0);
    await expect(spot(1)).toBeFocused();
    expect(await where()).toEqual([{ location_id: null, status: "in_cellar" }]);
    expect(await placements(rack)).toHaveLength(1);
  });

  await test.step("Yes does what Move does: the bottle is home, out of the rack, and the page says so", async () => {
    await spot(1).click();
    await ann.page.getByTestId("shared-place-confirm-yes").click();
    await expect(ann.page.getByText("Moved to Home rack · Shelf 1 · Position 1.")).toBeVisible();
    expect(await where()).toEqual([{ location_id: home, status: "in_cellar" }]);
    expect(await placements(rack)).toEqual([]);
    expect((await eventTypes(rack)).at(-1)).toEqual({
      event_type: "bottle_relocated",
      actor_id: ann.userId,
      owner_id: ann.userId,
    });
    await expect(ann.page.getByTestId("bottle-places")).toContainText("Shelf 1 · Position 1");
    await expect(ann.page.getByTestId("shared-place-line")).toHaveCount(0);
  });

  await test.step("without a place again it is asked about no more: it stands in no shared rack now", async () => {
    await ann.page.getByRole("button", { name: "Move", exact: true }).click();
    await ann.page
      .getByRole("dialog")
      .getByRole("button", { name: "Take it out of its place" })
      .click();
    await expect(ann.page.getByText("Taken out of its place.")).toBeVisible();
    await expect(ann.page.getByTestId("bottle-places")).toContainText("Not placed yet");
    await ann.page.getByRole("button", { name: "Move", exact: true }).click();
    await spot(2).click();
    await expect(ann.page.getByText("Moved to Home rack · Shelf 1 · Position 2.")).toBeVisible();
    await expect(ann.page.getByTestId("shared-place-confirm")).toHaveCount(0);
  });
  // the gate-closed test looks for this name in the downloaded code: here, with shared racks open, it is there
  expect((await Promise.all(code)).some((text) => text.includes("shared-place-line"))).toBe(true);
  await ann.close();
});

test("gate open: the same check finds the code once a shared rack is opened (so the check above can see it)", async ({
  browser,
  request,
}, info) => {
  const ann = await arriveAs(browser, request, info, "Ann", { webgl: false });
  const code: Array<Promise<string>> = [];
  ann.page.on("response", (response) => {
    if (/\/_next\/static\/.*\.js/.test(response.url())) code.push(response.text().catch(() => ""));
  });
  await ann.bottles("Ann Riesling");
  await ann.call("post", "/shared-racks", { name: "Seen rack", ...RACK_LAYOUT(2, 2) }, 201);
  await openRack(ann.page, "Seen rack");
  await ann.page.waitForTimeout(1_500);
  expect((await Promise.all(code)).some((text) => text.includes("shared-rack-stage"))).toBe(true);
  await ann.close();
});
