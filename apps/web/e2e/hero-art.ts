import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import { sql, STACK } from "./helpers";

const SERVICE_KEY = "sb_secret_localstack_00000000000000";

/**
 * A finished 2D bottle picture, drawn in the browser (the test machine has no image tools): a bottle on a
 * transparent background, the way the library's pictures are made.
 */
export async function makeBottlePng(page: Page, glass: string, label: string): Promise<Buffer> {
  const dataUrl = await page.evaluate(
    ({ glass, label }) => {
      const c = document.createElement("canvas");
      c.width = 300;
      c.height = 900;
      const g = c.getContext("2d")!;
      g.fillStyle = glass;
      g.beginPath();
      g.roundRect(120, 40, 60, 260, 18); // neck
      g.roundRect(60, 260, 180, 620, 46); // body
      g.fill();
      g.fillStyle = label;
      g.fillRect(78, 520, 144, 190);
      g.fillStyle = "#2a1a10";
      g.fillRect(132, 20, 36, 40); // cork
      return c.toDataURL("image/png");
    },
    { glass, label },
  );
  return Buffer.from(dataUrl.split(",")[1]!, "base64");
}

/**
 * Publishes a picture for a wine, as the admin's library would: the file in the private bottle-art bucket and a
 * published row. Straight into the local stack (never a real project).
 */
export async function publishArt(wineId: string, png: Buffer): Promise<string> {
  const path = `${wineId}/${randomUUID()}.png`;
  const res = await fetch(`${STACK}/storage/v1/object/bottle-art/${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${SERVICE_KEY}`,
      apikey: SERVICE_KEY,
      "content-type": "image/png",
    },
    body: new Uint8Array(png),
  });
  expect(res.ok, await res.clone().text()).toBe(true);
  const [row] = await sql<{ id: string }>(
    `insert into public.wine_bottle_art (wine_id, path, content_type, width, height, published_at)
     values ($1, $2, 'image/png', 300, 900, now()) returning id`,
    [wineId, path],
  );
  return row!.id;
}
