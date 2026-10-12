import { expect, test } from "@playwright/test";
import { api, apiClient, arrive } from "./helpers";

/**
 * A real cellar is not three bottles. These tests bring in 500 and 2000 bottles (through the importer, so
 * it is measured too) and hold the screens that read the whole cellar to a time budget. The budgets are
 * deliberately loose (this runs on a shared machine with a local database); what they catch is a query
 * that quietly turns from one round trip into one per bottle.
 */

/** A backup of `bottles` bottles: wines of 8..17 bottles each, in racks of 20 × 25 (500 spots). */
function backupOf(bottles: number) {
  const flessen: Array<Record<string, unknown>> = [];
  const countries = ["Frankrijk", "Italië", "Spanje", "Duitsland", "Portugal"];
  const colours = ["rood", "rood", "wit", "mousserend", "rose"];
  let left = bottles;
  let nextSpot = 0;
  for (let i = 0; left > 0; i++) {
    const quantity = Math.min(left, 8 + ((i * 7) % 10));
    left -= quantity;
    // Wines of a rack stay together; each wine is one old-style record with a count.
    const rack = Math.floor(nextSpot / 500) + 1;
    const spot = nextSpot % 500;
    nextSpot += quantity;
    flessen.push({
      id: `w${i}`,
      naam: `Cuvée ${i}`,
      producent: `Domaine ${i % 40}`,
      land: countries[i % countries.length],
      regio: `Region ${i % 12}`,
      kleur: colours[i % colours.length],
      jaargang: 1995 + (i % 28),
      aantal: quantity,
      aankoopPrijs: 12 + (i % 60),
      favoriet: i % 9 === 0,
      locatie: {
        kelder: "Kelder",
        rek: String(rack),
        rij: Math.floor(spot / 25) + 1,
        vak: (spot % 25) + 1,
      },
    });
  }
  return { app: "wijnkelder", flessen, notities: [], historie: [] };
}

const timed = async <T>(work: () => Promise<T>) => {
  const start = performance.now();
  const result = await work();
  return { ms: performance.now() - start, result };
};
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

for (const { bottles, importBudget, readBudget } of [
  { bottles: 500, importBudget: 20_000, readBudget: 1_500 },
  { bottles: 2000, importBudget: 45_000, readBudget: 3_000 },
]) {
  test(`a cellar of ${bottles} bottles comes over in good time and stays quick to read`, async ({
    page,
    request,
  }, info) => {
    test.skip(info.project.name !== "desktop", "one device is enough to measure the server");
    test.setTimeout(180_000);
    const { email } = await arrive(page, `perf${bottles}`);
    const { token, call } = await apiClient(request, email);

    const imported = await timed(() =>
      call<{ written: { bottles: number } }>(
        "post",
        "/import/wijnkelder",
        { backup: backupOf(bottles), dryRun: false },
        200,
      ),
    );
    expect(imported.result.body.written.bottles).toBe(bottles);

    const reads: Record<string, number> = {};
    for (const [name, path] of [
      ["cellar", "/cellar"],
      ["racks", "/racks"],
      ["home", "/home"],
    ] as const) {
      const samples: number[] = [];
      for (let i = 0; i < 3; i++) {
        const t = await timed(async () => (await api(request, token, "get", path)).status());
        expect(t.result).toBe(200);
        samples.push(t.ms);
      }
      reads[name] = Math.round(median(samples));
    }
    const tonight = await timed(async () =>
      (
        await api(request, token, "post", "/tonight", { dish: null, occasion: "anything" })
      ).status(),
    );
    expect(tonight.result).toBe(200);
    reads.tonight = Math.round(tonight.ms);

    // The page itself: the first card is on screen, and the list does not freeze the browser.
    const navigation = await timed(async () => {
      await page.goto("/cellar");
      await expect(page.locator("article").first()).toBeVisible({ timeout: 20_000 });
    });

    const summary = {
      bottles,
      importMs: Math.round(imported.ms),
      pageMs: Math.round(navigation.ms),
      ...reads,
    };
    console.log(`PERF ${JSON.stringify(summary)}`);
    info.annotations.push({ type: "perf", description: JSON.stringify(summary) });

    expect(imported.ms, "import").toBeLessThan(importBudget);
    for (const [name, ms] of Object.entries(reads)) expect(ms, name).toBeLessThan(readBudget);
    expect(navigation.ms, "cellar page").toBeLessThan(readBudget * 3);
  });
}
