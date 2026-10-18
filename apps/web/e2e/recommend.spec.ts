import { expect, test } from "@playwright/test";
import { apiClient, arrive, sql, wineBody } from "./helpers";

type Call = Awaited<ReturnType<typeof apiClient>>["call"];

const shot = (name: string) => `test-results/shots/${name}.png`;
const project = () => test.info().project.name;

async function befriend(a: Call, b: Call) {
  const bId = (await b<{ userId: string }>("get", "/me", undefined, 200)).body.userId;
  const aId = (await a<{ userId: string }>("get", "/me", undefined, 200)).body.userId;
  await a("post", "/friends", { userId: bId }, 200);
  await b("post", "/friends", { userId: aId }, 200);
  return { aId, bId };
}

test.describe("recommending a wine to a friend", () => {
  test("from the wine's page to a friend's wishlist, with who sent it and why", async ({
    page,
    browser,
    request,
  }) => {
    test.setTimeout(90_000);
    const anna = await arrive(page, "recanna");
    const annaApi = await apiClient(request, anna.email);
    const other = await browser.newPage();
    const bram = await arrive(other, "recbram");
    const bramApi = await apiClient(request, bram.email);
    await befriend(annaApi.call, bramApi.call);

    const wine = (await annaApi.call<{ id: string }>("post", "/wines", wineBody, 201)).body;
    await annaApi.call("post", "/bottles", { wineId: wine.id, year: 2019, quantity: 1 }, 201);
    const [v] = await sql<{ id: string }>(
      "select id from public.wine_vintages where wine_id = $1 and year = 2019",
      [wine.id],
    );

    // Anna recommends it from the wine's page.
    await page.goto(`/cellar/${v!.id}`);
    await page.getByRole("button", { name: "Recommend to a friend" }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("button", { name: "Choose a friend" })).toBeDisabled();
    await sheet.getByRole("checkbox").check({ force: true });
    await sheet.getByLabel("Why (optional)").fill("Perfect with oysters");
    await page.screenshot({ path: shot(`recommend-sheet-${project()}`), fullPage: true });
    await sheet.getByRole("button", { name: "Send to 1 friend" }).click();
    await expect(page.getByText("Recommended to 1 friend.")).toBeVisible();

    // Bram sees it on Home, opens it, and puts it on his wishlist.
    await other.goto("/");
    await other.getByTestId("new-recommendations").click();
    const card = other.getByTestId("recommendations");
    await expect(card).toContainText("Chablis Premier Cru");
    await expect(card).toContainText("Perfect with oysters");
    await other.screenshot({ path: shot(`recommendations-${project()}`), fullPage: true });
    await card.getByRole("button", { name: "Add to wishlist" }).click();
    await expect(card.getByRole("link", { name: "On your wishlist" })).toBeVisible();
    await other.goto("/wishlist");
    await expect(other.getByText("Recommended by Joost: Perfect with oysters")).toBeVisible();
    await expect(other.getByText("2019")).toBeVisible();

    // Seen now: no more notice on Home. Dismissing takes it away.
    await other.goto("/");
    await expect(other.getByTestId("new-recommendations")).toHaveCount(0);
    await other.goto("/friends");
    await other.getByTestId("recommendations").getByRole("button", { name: "Dismiss" }).click();
    await expect(other.getByTestId("recommendations")).toHaveCount(0);
    await other.close();
  });

  test("only to friends, only wines you can see, and nobody else reads them", async ({
    browser,
    request,
  }) => {
    const people = await Promise.all(
      ["recone", "rectwo", "recthree"].map(async (label) => {
        const page = await browser.newPage();
        const { email } = await arrive(page, label);
        await page.close();
        return (await apiClient(request, email)).call;
      }),
    );
    const [one, two, three] = people as [Call, Call, Call];
    const { bId: twoId } = await befriend(one, two);
    const threeId = (await three<{ userId: string }>("get", "/me", undefined, 200)).body.userId;

    const wine = (await one<{ id: string }>("post", "/wines", wineBody, 201)).body;
    await one("post", "/bottles", { wineId: wine.id, year: 2020, quantity: 1 }, 201);
    const [v] = await sql<{ id: string }>(
      "select id from public.wine_vintages where wine_id = $1 and year = 2020",
      [wine.id],
    );

    // A stranger is not a friend; a wine from another household is not yours to send.
    await one("post", "/recommendations", { vintageId: v!.id, friendIds: [threeId] }, 404);
    await three("post", "/recommendations", { vintageId: v!.id, friendIds: [twoId] }, 404);
    expect(
      (await one("post", "/recommendations", { vintageId: v!.id, friendIds: [twoId] }, 200)).body,
    ).toEqual({ sent: 1 });

    type View = { items: Array<{ id: string; wine: string }>; unseen: number };
    const got = (await two<View>("get", "/recommendations", undefined, 200)).body;
    expect(got.items).toHaveLength(1);
    expect(got.unseen).toBe(1);
    expect((await three<View>("get", "/recommendations", undefined, 200)).body.items).toHaveLength(
      0,
    );
    await three("delete", `/recommendations/${got.items[0]!.id}`, undefined, 404);
    await three("post", `/recommendations/${got.items[0]!.id}/save`, undefined, 404);
    await two("post", "/recommendations/seen", {}, 200);
    expect((await two<View>("get", "/recommendations", undefined, 200)).body.unseen).toBe(0);
  });
});
