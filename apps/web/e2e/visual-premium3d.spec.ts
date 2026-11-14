import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { PREVIEW_URL } from "./helpers";

/**
 * Not a test: the photographer of the premium look (Smart Cellar 3D, sprint 2B.2). For the three reference models
 * it takes the look before the sprint and the look since from one build, in the light and in the dark studio, at
 * the three levels of detail, on a desktop-sized and a phone-sized stage.
 *   VISUAL_PREMIUM3D=1 SHOTS_DIR=/some/dir pnpm exec playwright test visual-premium3d --project=desktop
 */
test.skip(!process.env.VISUAL_PREMIUM3D, "only when asked for (VISUAL_PREMIUM3D=1)");
test.use({ deviceScaleFactor: 2, baseURL: PREVIEW_URL });

const OUT = process.env.SHOTS_DIR ?? "test-results/premium3d";
const REFERENCES = ["rack_classic", "cooler_dual", "wall_rails"] as const;
/** Other materials and colours a reference model offers. */
const COMBINATIONS: Array<[name: string, query: string]> = [
  ["rack-oak", "template=rack_classic&color=oak"],
  ["rack-mahogany-lit", "template=rack_classic&color=mahogany&lighting=warm"],
  ["rack-ebony", "template=rack_classic&color=ebony"],
  ["cooler-stainless", "template=cooler_dual&color=stainless&lighting=cool"],
  ["cooler-black-warm", "template=cooler_dual&color=black&lighting=warm"],
  ["cooler-solid-door", "template=cooler_dual&door=solid"],
  ["rails-brass", "template=wall_rails&color=brass"],
  ["rails-stainless", "template=wall_rails&color=stainless"],
  ["rails-graphite-two-deep", "template=wall_rails&color=graphite&cap=2&cols=2"],
];

test("photograph the premium look", async ({ page }) => {
  test.setTimeout(1_800_000);
  fs.mkdirSync(OUT, { recursive: true });
  const stage = page.getByTestId("gallery-stage");
  const shoot = async (name: string, query: string) => {
    await page.goto(`/design/cellar-3d?${query}`);
    await expect(stage.locator("canvas[data-engine]")).toHaveAttribute("data-frames", /^[1-9]/, {
      timeout: 60_000,
    });
    await page.waitForTimeout(1500);
    await stage.screenshot({ path: path.join(OUT, `${name}.png`) });
  };
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const id of REFERENCES) {
    for (const fidelity of ["classic", "premium"])
      for (const studio of ["light", "dark"])
        await shoot(
          `desktop-${id}-${fidelity}-${studio}`,
          `template=${id}&quality=high&fidelity=${fidelity}&studio=${studio}`,
        );
    for (const quality of ["high", "balanced", "low"])
      await shoot(`desktop-${id}-level-${quality}`, `template=${id}&fill=full&quality=${quality}`);
  }
  for (const [name, query] of COMBINATIONS)
    await shoot(`desktop-look-${name}`, `${query}&quality=high`);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const id of REFERENCES)
    for (const fidelity of ["classic", "premium"])
      await shoot(`phone-${id}-${fidelity}`, `template=${id}&fidelity=${fidelity}`);
  // the panel on a narrow screen that gives it no place of its own
  await page.goto(
    "/design/cellar-3d?template=rack_classic&rows=4&cols=4&fill=full&panel=inside&inspect=b-2:2:1",
  );
  await expect(page.getByTestId("inspectable-storage")).toHaveAttribute(
    "data-showcase",
    "inspecting",
    { timeout: 60_000 },
  );
  await page.waitForTimeout(1200);
  await stage.screenshot({ path: path.join(OUT, "phone-panel-inside.png") });
});
