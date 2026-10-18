import { createECDH, randomBytes, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { apiClient, arrive, stamp, STACK, wineBody } from "./helpers";

type Call = Awaited<ReturnType<typeof apiClient>>["call"];

const shot = (name: string) => `test-results/shots/${name}.png`;
const project = () => test.info().project.name;

/** A phone that allowed notifications, at the fake push service. */
function phone() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const id = randomUUID();
  return {
    id,
    subscription: {
      endpoint: `https://localhost:54331/push/${id}`,
      keys: {
        p256dh: ecdh.getPublicKey().toString("base64url"),
        auth: randomBytes(16).toString("base64url"),
      },
    },
  };
}
const pushed = async (id: string) =>
  ((await (await fetch(`${STACK}/__test/push/calls?id=${id}`)).json()) as { calls: unknown[] })
    .calls;

/** Short, unique account names (3–20 characters). */
const handle = (label: string) => `${label}${stamp()}`.slice(0, 20).toLowerCase();

/** A rack with two bottles of one wine, one of them opened and rated. */
async function furnish(call: Call) {
  const rack = (
    await call<{ id: string }>(
      "post",
      "/storage",
      { label: "Kitchen rack", kind: "rack", rows: 2, cols: 3 },
      201,
    )
  ).body;
  const wine = (await call<{ id: string }>("post", "/wines", wineBody, 201)).body;
  const { bottleIds } = (
    await call<{ bottleIds: string[] }>(
      "post",
      "/bottles",
      { wineId: wine.id, year: 2019, quantity: 3, locationId: rack.id },
      201,
    )
  ).body;
  await call("patch", `/bottles/${bottleIds[0]}`, { action: "open" }, 200);
  await call(
    "put",
    `/bottles/${bottleIds[0]}/tasting`,
    { score: 9, descriptors: ["mineral", "fresh"], note: "Lovely with oysters." },
    200,
  );
}

test.describe("friends", () => {
  test("find by account name or code, ask, accept, and see only what is shared", async ({
    browser,
    request,
  }) => {
    test.setTimeout(90_000);
    const people = await Promise.all(
      ["fanna", "fbram", "fcas"].map(async (label) => {
        const page = await browser.newPage();
        const { email } = await arrive(page, label);
        await page.close();
        return { label, ...(await apiClient(request, email)) };
      }),
    );
    const [anna, bram, cas] = people as [
      (typeof people)[0],
      (typeof people)[0],
      (typeof people)[0],
    ];

    // Account names: unique, and only letters, digits, dots and underscores.
    const annaName = handle("anna");
    await anna.call("put", "/me/handle", { handle: `@${annaName.toUpperCase()}` }, 200);
    await bram.call("put", "/me/handle", { handle: annaName }, 409);
    await bram.call("put", "/me/handle", { handle: "no spaces" }, 422);
    await bram.call("put", "/me/handle", { handle: "ab" }, 422);
    const annaView = (
      await anna.call<{ ready: boolean; me: { handle: string; friendCode: string } }>(
        "get",
        "/friends",
        undefined,
        200,
      )
    ).body;
    expect(annaView.ready).toBe(true);
    expect(annaView.me.handle).toBe(annaName);
    expect(annaView.me.friendCode).toMatch(/^[A-Z2-9]{8}$/);
    const idOf = async (who: typeof anna) =>
      (await who.call<{ userId: string }>("get", "/me", undefined, 200)).body.userId;
    const annaId = await idOf(anna);

    // Found by exact name or code (any case, with spaces), never by a part of it, and never yourself.
    type Found = { person: { userId: string; relation: string } | null };
    const find = (who: typeof anna, q: string) =>
      who.call<Found>("get", `/friends/search?q=${encodeURIComponent(q)}`, undefined, 200);
    expect((await find(bram, `@${annaName}`)).body.person).toMatchObject({
      userId: annaId,
      relation: "none",
    });
    const code = annaView.me.friendCode;
    expect(
      (await find(bram, `${code.slice(0, 4)} ${code.slice(4)}`.toLowerCase())).body.person,
    ).toMatchObject({ userId: annaId });
    expect((await find(bram, annaName.slice(0, -2))).body.person).toBeNull();
    expect((await find(anna, annaName)).body.person).toBeNull();

    // Not friends yet: nothing to see.
    await bram.call("get", `/friends/${annaId}`, undefined, 404);

    // Anna has a phone with notifications on: Bram's request reaches it.
    const annaPhone = phone();
    await anna.call("post", "/push", annaPhone.subscription, 200);
    expect((await bram.call("post", "/friends", { userId: annaId }, 200)).body).toEqual({
      result: "sent",
    });
    expect((await bram.call("post", "/friends", { userId: annaId }, 200)).body).toEqual({
      result: "already",
    });
    await expect.poll(async () => (await pushed(annaPhone.id)).length).toBe(1);
    expect((await find(bram, annaName)).body.person?.relation).toBe("requested");
    await bram.call("get", `/friends/${annaId}`, undefined, 404); // asked is not accepted

    type Overview = {
      friends: Array<{ userId: string }>;
      incoming: Array<{ friendshipId: string; userId: string }>;
      outgoing: Array<{ userId: string }>;
    };
    const incoming = (await anna.call<Overview>("get", "/friends", undefined, 200)).body.incoming;
    expect(incoming).toHaveLength(1);
    // Only the person asked can answer.
    await bram.call(
      "post",
      `/friends/requests/${incoming[0]!.friendshipId}`,
      { accept: true },
      404,
    );
    await anna.call(
      "post",
      `/friends/requests/${incoming[0]!.friendshipId}`,
      { accept: true },
      200,
    );

    // Cas asks too, and Anna accepts by asking back.
    const [casId, bramId] = [await idOf(cas), await idOf(bram)];
    await cas.call("post", "/friends", { userId: annaId }, 200);
    expect((await anna.call("post", "/friends", { userId: casId }, 200)).body).toEqual({
      result: "accepted",
    });

    await furnish(anna.call);

    type View = {
      access: Record<string, boolean>;
      ratings: Array<{ stars: number; words: string[]; note: string }> | null;
      taste: { tastings: number; average: number } | null;
      cellar: { wines: Array<{ bottles: number }>; racks: Array<{ bottles: unknown[] }> } | null;
    };
    const look = async (who: typeof anna) =>
      (await who.call<View>("get", `/friends/${annaId}`, undefined, 200)).body;

    // The defaults: ratings and taste for friends, the cellar for nobody.
    let seen = await look(bram);
    expect(seen.access).toEqual({ ratings: true, taste: true, cellar: false });
    expect(seen.ratings).toEqual([
      expect.objectContaining({
        stars: 4.5,
        words: ["mineral", "fresh"],
        note: "Lovely with oysters.",
      }),
    ]);
    expect(seen.taste).toMatchObject({ tastings: 1, average: 4.5 });
    expect(seen.cellar).toBeNull();

    // The cellar for Bram only; ratings for nobody. A stranger's id in the list is simply ignored.
    await anna.call(
      "put",
      "/sharing",
      {
        modes: { ratings: "none", taste: "friends", cellar: "chosen" },
        picks: { ratings: [], taste: [], cellar: [bramId, randomUUID()] },
      },
      200,
    );
    expect(
      (await anna.call<{ picks: { cellar: string[] } }>("get", "/sharing", undefined, 200)).body
        .picks.cellar,
    ).toEqual([bramId]);
    seen = await look(bram);
    expect(seen.ratings).toBeNull();
    expect(seen.cellar?.wines).toEqual([expect.objectContaining({ bottles: 2 })]);
    expect(seen.cellar?.racks[0]?.bottles).toHaveLength(2);
    const casSees = await look(cas);
    expect(casSees.access).toEqual({ ratings: false, taste: true, cellar: false });
    expect(casSees.cellar).toBeNull();

    // Unfriending ends all of it, both ways, and the choice for Bram is forgotten.
    await bram.call("delete", `/friends/${annaId}`, undefined, 200);
    await bram.call("get", `/friends/${annaId}`, undefined, 404);
    await anna.call("get", `/friends/${bramId}`, undefined, 404);
    expect(
      (await anna.call<{ picks: { cellar: string[] } }>("get", "/sharing", undefined, 200)).body
        .picks.cellar,
    ).toEqual([]);
    expect((await find(bram, annaName)).body.person?.relation).toBe("none");
  });

  test("on the phone: pick a name, find a friend, accept, and look at their wines", async ({
    page,
    browser,
    request,
  }) => {
    test.setTimeout(90_000);
    const { email } = await arrive(page, "fui");
    const anna = await apiClient(request, email);
    await furnish(anna.call);

    // Anna picks her account name on the Friends page (reached from Profile).
    await page.goto("/profile");
    await page.getByTestId("friends-entry").click();
    await expect(page).toHaveURL(/\/friends$/);
    const me = page.getByTestId("me");
    const annaName = handle("ui");
    await me.getByLabel("Account name").fill("x");
    await me.getByRole("button", { name: "Save" }).click();
    await expect(me.getByRole("alert")).toBeVisible();
    await me.getByLabel("Account name").fill(`@${annaName}`);
    await me.getByRole("button", { name: "Save" }).click();
    await expect(page.getByTestId("my-handle")).toHaveText(`@${annaName}`);
    await expect(page.getByTestId("my-code")).toHaveText(/^[A-Z2-9]{4} [A-Z2-9]{4}$/);
    await page.screenshot({ path: shot(`friends-${project()}`), fullPage: true });

    // Bram finds her by name and asks.
    const other = await browser.newPage();
    await arrive(other, "fuib");
    await other.goto("/friends");
    const findCard = other.getByTestId("find");
    await findCard.getByLabel("Account name or friend code").fill("nobody-here");
    await findCard.getByRole("button", { name: "Find" }).click();
    await expect(findCard.getByText(/Nobody with that account name/)).toBeVisible();
    await findCard.getByLabel("Account name or friend code").fill(`@${annaName}`);
    await findCard.getByRole("button", { name: "Find" }).click();
    await findCard.getByTestId("found").getByRole("button", { name: "Add friend" }).click();
    await expect(findCard.getByTestId("found").getByText("Request sent")).toBeVisible();
    await expect(other.getByTestId("outgoing")).toBeVisible();

    // Anna sees it on Home and accepts.
    await page.goto("/");
    await page.getByTestId("friend-requests").click();
    await expect(page).toHaveURL(/\/friends$/);
    await page.getByTestId("incoming").getByRole("button", { name: "Accept" }).click();
    await expect(page.getByTestId("friends").getByRole("link")).toHaveCount(1);

    // She shares her cellar with Bram only.
    const cellar = page.getByTestId("share-cellar");
    await cellar.getByRole("radio", { name: "Chosen" }).click();
    await cellar.getByRole("checkbox").check({ force: true });
    await page.getByTestId("sharing").getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();

    // Bram looks: taste first, then ratings, then the cellar and its rack.
    await other.goto("/friends");
    await other.getByTestId("friends").getByRole("link").click();
    await expect(other.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(other.getByTestId("taste-headline")).toContainText("Drinks mostly white");
    await other.screenshot({ path: shot(`friend-taste-${project()}`), fullPage: true });
    await other.getByRole("radio", { name: "Ratings" }).click();
    await expect(other.getByTestId("friend-ratings")).toContainText("Lovely with oysters.");
    await other.getByRole("radio", { name: "Cellar" }).click();
    await expect(other.getByTestId("friend-cellar")).toContainText("2 bottles");
    await other.getByRole("radio", { name: "Racks" }).click();
    await expect(other.getByText("Kitchen rack")).toBeVisible();
    await other.screenshot({ path: shot(`friend-cellar-${project()}`), fullPage: true });

    // Unfriend from the friend's page.
    await other.getByRole("button", { name: "Remove friend" }).click();
    await other.getByRole("dialog").getByRole("button", { name: "Remove friend" }).click();
    await expect(other).toHaveURL(/\/friends$/);
    await expect(other.getByTestId("friends")).toContainText("No friends yet");
    await other.close();
  });
});
