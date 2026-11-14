import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

/**
 * Not a test: a photographer for the template gallery (Smart Cellar 3D, sprint 2A). Takes every storage template
 * in its default look and in another look it offers, on a phone-sized and a desktop-sized stage, plus the neutral
 * picture, the existing view, and the flat pictures.
 *   VISUAL_STORAGE3D=1 SHOTS_DIR=/some/dir pnpm exec playwright test visual-storage3d --project=desktop
 */
test.skip(!process.env.VISUAL_STORAGE3D, "only when asked for (VISUAL_STORAGE3D=1)");
test.use({ deviceScaleFactor: 2 });

const OUT = process.env.SHOTS_DIR ?? "test-results/storage3d";

/** Each template, and another look it offers (material, colour, light, door: all from its own list). */
const TEMPLATES: Array<[id: string, alternate: string]> = [
  ["rack_classic", "color=oak&lighting=warm"],
  ["rack_double_depth", "material=metal&color=graphite&cap=3"],
  ["rack_metal", "color=brass"],
  ["shelving_open", "material=lacquer&color=sage&lighting=warm"],
  ["cabinet_closed", "material=lacquer&color=navy&door=glass&lighting=warm"],
  ["rack_generic", "material=lacquer&color=white&lighting=cool"],
  ["cube_modular", "material=lacquer&color=black&lighting=warm"],
  ["diamond_bins", "color=ebony&lighting=warm&rows=3&cols=4"],
  ["crate_storage", "color=oak&rows=2&cols=3&cap=12"],
  ["wall_pegs", "material=wood&color=oak&rows=4&cols=4"],
  ["wall_rails", "color=brass&cols=3&cap=2&rows=6"],
  ["cooler_single", "material=lacquer&color=white&lighting=cool"],
  ["cooler_dual", "color=stainless&lighting=cool"],
  ["cooler_undercounter", "color=stainless&door=solid&lighting=none"],
];
const SIZES = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "phone", width: 390, height: 844 },
] as const;

test("photograph every template", async ({ page }) => {
  test.setTimeout(1_800_000);
  fs.mkdirSync(OUT, { recursive: true });
  const stage = page.getByTestId("gallery-stage");
  const shoot = async (name: string, query: string, what: "stage" | "map" | "page" = "stage") => {
    await page.goto(`/design/cellar-3d?${query}`);
    await expect(stage.locator("canvas")).toBeVisible({ timeout: 60_000 });
    if (!query.includes("sample=legacy"))
      await expect(stage.locator("canvas")).toHaveAttribute("data-frames", /^[1-9]/, {
        timeout: 60_000,
      });
    await page.waitForTimeout(1500);
    const file = path.join(OUT, `${name}.png`);
    if (what === "page") await page.screenshot({ path: file, fullPage: true });
    else await (what === "map" ? page.getByTestId("layout-map") : stage).screenshot({ path: file });
  };
  for (const size of SIZES) {
    await page.setViewportSize({ width: size.width, height: size.height });
    for (const [id, alternate] of TEMPLATES) {
      await shoot(`${size.name}-default-${id}`, `template=${id}&quality=high`);
      // the look the address asked for is the look that was drawn: nothing fell back to the default
      if (size.name === "desktop") {
        await shoot(`${size.name}-alternate-${id}`, `template=${id}&quality=high&${alternate}`);
        for (const pair of alternate.split("&")) {
          const [key, value] = pair.split("=");
          expect(new URL(page.url()).searchParams.get(key!), `${id}: ${pair}`).toBe(value);
        }
      }
    }
    await shoot(`${size.name}-neutral`, "sample=unknown&unknown=bins-as-depth&quality=high");
    await shoot(`${size.name}-legacy`, "sample=legacy&rows=5&cols=8");
    await shoot(`${size.name}-map-depth`, "template=rack_double_depth&cap=3", "map");
    await shoot(`${size.name}-map-count`, "template=diamond_bins&rows=3&cols=4", "map");
    await shoot(`${size.name}-map-unknown`, "sample=unknown&unknown=pegs-three-each", "map");
    await shoot(`${size.name}-page`, "template=cooler_dual&quality=high", "page");
  }
});
