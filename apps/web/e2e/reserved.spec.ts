import { expect, test } from "@playwright/test";
import { apiClient, arrive, sql, STACK } from "./helpers";

const marker = () =>
  `[${test.info().parallelIndex}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}]`;

const soon = () => new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);

/** A wine with two bottles, one of them kept for Christmas dinner. */
async function furnish(
  request: Parameters<typeof apiClient>[0],
  email: string,
  name: string,
  quantity = 2,
) {
  const { call } = await apiClient(request, email);
  const wine = (
    await call<{ id: string }>(
      "post",
      "/wines",
      { producer: "Reserve Estate", name, type: "red", countryCode: "FR", region: "Bordeaux" },
      201,
    )
  ).body;
  const bottles = (
    await call<{ bottleIds: string[] }>(
      "post",
      "/bottles",
      { wineId: wine.id, year: 2012, quantity, locationId: null },
      201,
    )
  ).body.bottleIds;
  await call(
    "put",
    `/bottles/${bottles[0]}/extras`,
    { acquiredHow: null, giftFrom: null, occasionTitle: "Christmas dinner", occasionOn: soon() },
    200,
  );
  return { call, bottles };
}

test.describe("bottles kept for an occasion", () => {
  test("Tonight says so, and offers a bottle that is free", async ({ page, request }) => {
    const { email } = await arrive(page, "resvtonight");
    const { bottles } = await furnish(request, email, "Cuvée Gardée");
    await page.goto("/tonight");
    await page.getByRole("button", { name: "Nothing in particular" }).click();
    await page.getByRole("button", { name: "Find my wine" }).click();
    await expect(page.getByTestId("reserved-note").first()).toContainText(
      "1 of 2 kept for Christmas dinner",
    );
    await page.getByRole("button", { name: "Open this bottle" }).first().click();
    await expect(page.getByText(/Enjoy the/)).toBeVisible();
    // The bottle that was opened is the free one: the reserved one is still in the cellar.
    const status = await sql<{ id: string; status: string }>(
      "select id, status from public.bottles where id = any($1)",
      [bottles],
    );
    expect(status.find((b) => b.id === bottles[0])!.status).toBe("in_cellar");
    expect(status.find((b) => b.id === bottles[1])!.status).toBe("opened");
  });

  test("a wine whose only bottle is kept is still suggested, with the note", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "resvall");
    await furnish(request, email, "Cuvée Unique", 1);
    await page.goto("/tonight");
    await page.getByRole("button", { name: "Nothing in particular" }).click();
    await page.getByRole("button", { name: "Find my wine" }).click();
    await expect(page.getByTestId("reserved-note").first()).toContainText(
      "Kept for Christmas dinner",
    );
  });

  test("the sommelier is told, and the plain answer shows it too", async ({ page, request }) => {
    const { email } = await arrive(page, "resvsom");
    const m = marker();
    await furnish(request, email, `Cuvée ${m}`);
    await fetch(`${STACK}/__test/openai`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        match: m,
        content: { answer: "That one is reserved, but the other is free.", bottle_refs: [] },
      }),
    });
    await page.goto("/sommelier");
    await page.getByLabel("Your question").fill(`What about the cuvée ${m}?`);
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("That one is reserved")).toBeVisible();
    const calls = (await (
      await fetch(`${STACK}/__test/openai/calls?match=${encodeURIComponent(m)}`)
    ).json()) as {
      calls: Array<{ user: string; system: string }>;
    };
    expect(calls.calls[0]!.user).toContain('reserved: 1 of 2 kept for "Christmas dinner"');
    expect(calls.calls[0]!.system).toContain("reserved:");

    // Without an AI answer, the plain suggestion carries the note.
    await page.getByRole("button", { name: "New conversation" }).click();
    await page.getByRole("button", { name: "What is at its peak?" }).click();
    await expect(page.getByTestId("reserved-note").first()).toContainText(
      "kept for Christmas dinner",
    );
  });
});
