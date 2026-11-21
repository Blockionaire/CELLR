import { expect, test, type APIRequestContext } from "@playwright/test";
import { makeBottlePng, publishArt } from "./hero-art";
import { apiClient, arrive, bearer, sql, stamp } from "./helpers";

/**
 * Unified Scan, PR 3 (part B): the life of a 2D bottle picture. A picture belongs to a WINE, never to a bottle:
 * removing bottles leaves it, adding the wine again shows it at once, and a catalogue wine's picture is the same in
 * every household. A household's own wine keeps its picture to itself, and a similar name never borrows one.
 * See docs/sprints/unified-scan/ART-LIFECYCLE.md.
 */

const marker = () => `${test.info().parallelIndex}${stamp()}`;

type CellarItem = { vintageId: string; wineId: string; art?: { id: string; shared: boolean } | null };
type Call = Awaited<ReturnType<typeof apiClient>>["call"];

const artOf = async (call: Call, wineId: string) =>
  ((await call<{ items: CellarItem[] }>("get", "/cellar", undefined, 200)).body.items ?? []).find(
    (i) => i.wineId === wineId,
  )?.art ?? null;

const fetchArt = (request: APIRequestContext, token: string, artId: string) =>
  request.get(`/api/v1/bottle-art/${artId}`, { headers: bearer(token) });

const addBottle = async (call: Call, wineId: string, year = 2019) =>
  (
    await call<{ bottleIds: string[] }>(
      "post",
      "/bottles",
      { wineId, year, quantity: 1, locationId: null },
      201,
    )
  ).body.bottleIds[0]!;

/** A canonical catalogue wine (verified), as the catalogue import makes it. */
async function catalogueWine(m: string) {
  const producer = `Domaine Gedeeld ${m}`;
  await sql("select public.catalog_import($1::jsonb, true)", [
    JSON.stringify([
      {
        producer,
        producer_country: "FR",
        name: "Cuvée Commune",
        type: "red",
        region: "Rhône",
        vintages: [2019],
        aliases: [],
        sources: [{ name: "Producer website", url: `https://gedeeld-${m}.example/` }],
      },
    ]),
  ]);
  const [row] = await sql<{ id: string }>(
    `select w.id from public.wines w join public.producers p on p.id = w.producer_id
      where p.name = $1 and w.status = 'canonical'`,
    [producer],
  );
  return row!.id;
}

test.describe("a 2D bottle picture belongs to the wine", () => {
  test("removing the bottle leaves the picture; adding the wine again shows it at once", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "art-again");
    const { call, token } = await apiClient(request, email);
    const m = marker();
    const wine = (
      await call<{ id: string }>(
        "post",
        "/wines",
        { producer: `Clos Terug ${m}`, name: "Revenant", type: "red", countryCode: "FR" },
        201,
      )
    ).body;
    const bottle = await addBottle(call, wine.id);
    const artId = await publishArt(wine.id, await makeBottlePng(page, "#2a0d18", "#f1e6d2"));
    expect(await artOf(call, wine.id)).toMatchObject({ id: artId, shared: false });

    // the last bottle goes: the wine, its picture and the file stay
    await call("patch", `/bottles/${bottle}`, { action: "remove" }, 200);
    expect(await artOf(call, wine.id)).toBeNull(); // nothing of it in the cellar now
    expect(
      await sql("select 1 from public.wine_bottle_art where id = $1 and published_at is not null", [
        artId,
      ]),
    ).toHaveLength(1);
    expect((await fetchArt(request, token, artId)).status()).toBe(200);

    // the same wine again (another year even): its picture, the same one, straight away
    await addBottle(call, wine.id, 2020);
    expect(await artOf(call, wine.id)).toMatchObject({ id: artId });
    expect(
      await sql("select 1 from public.wine_bottle_art where wine_id = $1", [wine.id]),
    ).toHaveLength(1);
  });

  test("a catalogue wine's picture is the one every household sees", async ({
    page,
    browser,
    request,
  }) => {
    const m = marker();
    const wineId = await catalogueWine(m);
    const artId = await publishArt(wineId, await makeBottlePng(page, "#3b0f1c", "#efe3cf"));

    const { email: a } = await arrive(page, "art-share-a");
    const alice = await apiClient(request, a);
    await addBottle(alice.call, wineId);
    expect(await artOf(alice.call, wineId)).toMatchObject({ id: artId, shared: true });

    const other = await browser.newPage();
    const { email: b } = await arrive(other, "art-share-b");
    const bob = await apiClient(request, b);
    await addBottle(bob.call, wineId);
    expect(await artOf(bob.call, wineId)).toMatchObject({ id: artId, shared: true });
    const res = await fetchArt(request, bob.token, artId);
    expect(res.status()).toBe(200);
    // the same file for everyone: it may be kept
    expect(res.headers()["cache-control"]).toContain("immutable");
    await other.close();
  });

  test("a household's own picture stays theirs, and a similar name never borrows it", async ({
    page,
    browser,
    request,
  }) => {
    const m = marker();
    const { email: a } = await arrive(page, "art-own-a");
    const alice = await apiClient(request, a);
    const body = { producer: `Domaine Prive ${m}`, name: "Secret", type: "white", countryCode: "FR" };
    const mine = (await alice.call<{ id: string }>("post", "/wines", body, 201)).body;
    await addBottle(alice.call, mine.id);
    const artId = await publishArt(mine.id, await makeBottlePng(page, "#d8c98a", "#fbf6ea"));
    expect(await artOf(alice.call, mine.id)).toMatchObject({ id: artId, shared: false });
    const own = await fetchArt(request, alice.token, artId);
    expect(own.status()).toBe(200);
    // never kept by the browser: leaving the household takes it away at once
    expect(own.headers()["cache-control"]).toContain("no-store");

    // another household, the very same name: its own wine, no picture, and the first one is not theirs to see
    const other = await browser.newPage();
    const { email: b } = await arrive(other, "art-own-b");
    const bob = await apiClient(request, b);
    const theirs = (await bob.call<{ id: string }>("post", "/wines", body, 201)).body;
    expect(theirs.id).not.toBe(mine.id);
    await addBottle(bob.call, theirs.id);
    expect(await artOf(bob.call, theirs.id)).toBeNull();
    expect((await fetchArt(request, bob.token, artId)).status()).toBe(404);
    await other.close();
  });
});
