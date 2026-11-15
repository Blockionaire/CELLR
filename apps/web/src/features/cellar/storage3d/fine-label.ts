import * as THREE from "three";
import {
  LABEL_H,
  LABEL_W,
  drawLabel,
  makeLabelTexture,
  type LabelSpec,
} from "../three/label-texture";
import { seededRandom } from "./textures";

/**
 * The front label of the bottle on display, premium (sprint 2B.2): the existing view's own drawing of a label
 * (`drawLabel`, unchanged), on paper that has a tooth.
 *
 * NOT LARGER THAN IT WAS. The first version of this drew the label at twice the size. Measured, that made taking a
 * bottle out four times slower to answer (about 20 ms became 80), and worked out, it bought nothing: on display
 * the label is at most some 500 device pixels tall on any screen, and the existing 640×760 label already has
 * more. So the size is the existing one, and the paper's grain is a small tile drawn once per page and laid over
 * every label as a pattern: one fill, not sixteen thousand.
 *
 * What a label SAYS is not made here: producer, name, year and place come from the caller, and in the gallery
 * they are made-up wines. No label of a real producer is imitated, and nothing is downloaded: a label with a photo
 * of a real one (the app's own, later) is the existing view's business and is handed straight to it.
 */
let fontsLoaded: Promise<void> | null = null;
/**
 * The fonts a label is set in, fetched once. The existing view loads them when it draws a label (a canvas does not
 * wait for fonts by itself), so one label is drawn by it and thrown away.
 */
function fonts(): Promise<void> {
  fontsLoaded ??= makeLabelTexture(
    { producer: "", name: "", year: null, place: "", type: "red" },
    1,
  )
    .then((t) => t.dispose())
    .catch(() => undefined);
  return fontsLoaded;
}

/** The side of the grain's tile, in pixels. */
export const GRAIN_TILE = 256;
let grain: HTMLCanvasElement | null = null;
/** The tooth of the paper: a fine, uneven grain and a few fibres, on a tile that repeats. Drawn once per page. */
function grainTile(): HTMLCanvasElement {
  if (grain) return grain;
  const tile = document.createElement("canvas");
  tile.width = tile.height = GRAIN_TILE;
  const ctx = tile.getContext("2d");
  if (ctx) {
    const rnd = seededRandom(2718);
    for (let i = 0; i < 1100; i++) {
      const dark = rnd() < 0.6;
      ctx.fillStyle = dark
        ? `rgba(70,55,40,${rnd() * 0.035})`
        : `rgba(255,255,255,${rnd() * 0.05})`;
      ctx.fillRect(rnd() * GRAIN_TILE, rnd() * GRAIN_TILE, 0.6 + rnd() * 1.4, 0.6 + rnd() * 0.9);
    }
    for (let i = 0; i < 14; i++) {
      ctx.strokeStyle = `rgba(90,70,50,${0.02 + rnd() * 0.04})`;
      ctx.lineWidth = 0.4 + rnd() * 0.5;
      const [x, y, a, len] = [
        20 + rnd() * (GRAIN_TILE - 40),
        20 + rnd() * (GRAIN_TILE - 40),
        rnd() * Math.PI,
        4 + rnd() * 14,
      ];
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(
        x + Math.cos(a) * len * 0.5 + 2,
        y + Math.sin(a) * len * 0.5,
        x + Math.cos(a) * len,
        y + Math.sin(a) * len,
      );
      ctx.stroke();
    }
  }
  grain = tile;
  return tile;
}

/** Lays the paper over a drawn label: the grain, and a darkening towards the edges where it curves away. */
function paper(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const pattern = ctx.createPattern(grainTile(), "repeat");
  if (pattern) {
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, w, h);
  }
  const edge = ctx.createLinearGradient(0, 0, w, 0);
  edge.addColorStop(0, "rgba(40,30,20,0.16)");
  edge.addColorStop(0.12, "rgba(40,30,20,0)");
  edge.addColorStop(0.88, "rgba(40,30,20,0)");
  edge.addColorStop(1, "rgba(40,30,20,0.16)");
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, w, h);
}

/** A drawn label on toothed paper, at the existing size. A photo label: the existing view's, as it is. */
export async function makeFineLabelTexture(
  spec: LabelSpec,
  maxAnisotropy = 8,
): Promise<THREE.Texture> {
  if (spec.photoUrl) return makeLabelTexture(spec, maxAnisotropy);
  await fonts();
  const canvas = document.createElement("canvas");
  canvas.width = LABEL_W;
  canvas.height = LABEL_H;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    drawLabel(ctx, spec);
    paper(ctx, canvas.width, canvas.height);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(16, maxAnisotropy);
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.userData = { aspect: LABEL_W / LABEL_H, photo: false, fine: true };
  return texture;
}
