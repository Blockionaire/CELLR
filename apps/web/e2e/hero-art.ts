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

/** The shapes the library's pictures come in, as a product shot would draw them (proportions of real bottles). */
export type BottleShape = "flute" | "bordeaux" | "burgundy";

/**
 * A realistic finished 2D picture: a big transparent canvas (as the library's pictures come, with room around the
 * bottle), the bottle in real proportions (an Alsace flute is about 1 : 4.5, a Bordeaux 1 : 4, a Burgundy 1 : 3.5)
 * with shaded glass, a capsule and a label, and a soft floor shadow drawn into the picture itself.
 */
export async function makeRealisticBottlePng(page: Page, shape: BottleShape): Promise<Buffer> {
  const dataUrl = await page.evaluate((shape) => {
    const W = 1024;
    const H = 1536;
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const g = c.getContext("2d")!;
    const spec = {
      flute: {
        h: 1240,
        w: 270,
        neck: 0.42,
        glass: ["#d9d79a", "#b9b86a", "#8f8f45"],
        label: "#f4eedd",
      },
      bordeaux: {
        h: 1180,
        w: 300,
        neck: 0.3,
        glass: ["#2f3d2b", "#1b2618", "#0e150c"],
        label: "#efe6d0",
      },
      burgundy: {
        h: 1120,
        w: 330,
        neck: 0.36,
        glass: ["#5d5a2a", "#3d3b19", "#24230e"],
        label: "#ece2c8",
      },
    }[shape];
    const cx = W / 2;
    const bottom = H - 150;
    const top = bottom - spec.h;
    const neckW = spec.w * 0.3;
    const shoulder = top + spec.h * spec.neck;
    // soft floor shadow, part of the picture (as product shots have)
    const shadow = g.createRadialGradient(cx, bottom + 10, 10, cx, bottom + 10, spec.w * 0.9);
    shadow.addColorStop(0, "rgba(0,0,0,0.35)");
    shadow.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = shadow;
    g.beginPath();
    g.ellipse(cx, bottom + 10, spec.w * 0.9, 34, 0, 0, Math.PI * 2);
    g.fill();
    // the glass, shaded left to right
    const glass = g.createLinearGradient(cx - spec.w / 2, 0, cx + spec.w / 2, 0);
    glass.addColorStop(0, spec.glass[2]!);
    glass.addColorStop(0.3, spec.glass[0]!);
    glass.addColorStop(0.55, spec.glass[1]!);
    glass.addColorStop(1, spec.glass[2]!);
    g.fillStyle = glass;
    g.beginPath();
    g.moveTo(cx - neckW / 2, top);
    g.lineTo(cx + neckW / 2, top);
    if (shape === "bordeaux") {
      g.lineTo(cx + neckW / 2, shoulder - 70);
      g.quadraticCurveTo(cx + spec.w / 2, shoulder - 40, cx + spec.w / 2, shoulder + 40);
    } else {
      g.bezierCurveTo(
        cx + neckW / 2,
        shoulder - 140,
        cx + spec.w / 2,
        shoulder - 40,
        cx + spec.w / 2,
        shoulder + 90,
      );
    }
    g.lineTo(cx + spec.w / 2, bottom - 24);
    g.quadraticCurveTo(cx + spec.w / 2, bottom, cx + spec.w / 2 - 24, bottom);
    g.lineTo(cx - spec.w / 2 + 24, bottom);
    g.quadraticCurveTo(cx - spec.w / 2, bottom, cx - spec.w / 2, bottom - 24);
    if (shape === "bordeaux") {
      g.lineTo(cx - spec.w / 2, shoulder + 40);
      g.quadraticCurveTo(cx - spec.w / 2, shoulder - 40, cx - neckW / 2, shoulder - 70);
    } else {
      g.lineTo(cx - spec.w / 2, shoulder + 90);
      g.bezierCurveTo(
        cx - spec.w / 2,
        shoulder - 40,
        cx - neckW / 2,
        shoulder - 140,
        cx - neckW / 2,
        top,
      );
    }
    g.closePath();
    g.fill();
    // a highlight down the glass
    g.fillStyle = "rgba(255,255,255,0.18)";
    g.fillRect(cx - spec.w * 0.28, shoulder + 120, spec.w * 0.06, spec.h * 0.45);
    // capsule
    g.fillStyle = shape === "flute" ? "#c8a24a" : "#6b1424";
    g.fillRect(cx - neckW / 2 - 2, top, neckW + 4, spec.h * 0.12);
    // label
    const labelTop = shoulder + (bottom - shoulder) * 0.35;
    g.fillStyle = spec.label;
    g.fillRect(cx - spec.w * 0.42, labelTop, spec.w * 0.84, (bottom - shoulder) * 0.38);
    g.fillStyle = "#3a2a1a";
    g.fillRect(cx - spec.w * 0.3, labelTop + 40, spec.w * 0.6, 18);
    g.fillRect(cx - spec.w * 0.2, labelTop + 80, spec.w * 0.4, 10);
    return c.toDataURL("image/png");
  }, shape);
  return Buffer.from(dataUrl.split(",")[1]!, "base64");
}

/** As `publishArt`, for a picture of any size. */
export async function publishArtSized(
  wineId: string,
  png: Buffer,
  width: number,
  height: number,
): Promise<string> {
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
     values ($1, $2, 'image/png', $3, $4, now()) returning id`,
    [wineId, path, width, height],
  );
  return row!.id;
}
