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
 * (`drawLabel`, unchanged), set at TWICE the size, on paper that has a tooth. Seen as large as the bottle is on
 * display, the existing 640 px label is soft on a phone's sharp screen; the same drawing at 1280 px is crisp.
 *
 * What a label SAYS is not made here: producer, name, year and place come from the caller, and in the gallery
 * they are made-up wines. No label of a real producer is imitated, and nothing is downloaded: a label with a photo
 * of a real one (the app's own, later) is the existing view's business and is handed straight to it.
 */
const SCALE = 2;

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

/** The tooth of the paper: a fine, uneven grain, and fibres here and there. The same on every label. */
function paperGrain(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const rnd = seededRandom(2718);
  for (let i = 0; i < 16000; i++) {
    const dark = rnd() < 0.6;
    ctx.fillStyle = dark ? `rgba(70,55,40,${rnd() * 0.035})` : `rgba(255,255,255,${rnd() * 0.05})`;
    ctx.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2.5, 1 + rnd() * 1.5);
  }
  for (let i = 0; i < 180; i++) {
    ctx.strokeStyle = `rgba(90,70,50,${0.02 + rnd() * 0.04})`;
    ctx.lineWidth = 0.6 + rnd() * 0.8;
    const [x, y, a, len] = [rnd() * w, rnd() * h, rnd() * Math.PI, 6 + rnd() * 26];
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(
      x + Math.cos(a) * len * 0.5 + 3,
      y + Math.sin(a) * len * 0.5,
      x + Math.cos(a) * len,
      y + Math.sin(a) * len,
    );
    ctx.stroke();
  }
  // the sheet is a little darker towards its edges, where it curves away round the glass
  const edge = ctx.createLinearGradient(0, 0, w, 0);
  edge.addColorStop(0, "rgba(40,30,20,0.16)");
  edge.addColorStop(0.12, "rgba(40,30,20,0)");
  edge.addColorStop(0.88, "rgba(40,30,20,0)");
  edge.addColorStop(1, "rgba(40,30,20,0.16)");
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, w, h);
}

/** A drawn label at twice the existing size, on toothed paper. A photo label: the existing view's, as it is. */
export async function makeFineLabelTexture(
  spec: LabelSpec,
  maxAnisotropy = 8,
): Promise<THREE.Texture> {
  if (spec.photoUrl) return makeLabelTexture(spec, maxAnisotropy);
  await fonts();
  const canvas = document.createElement("canvas");
  canvas.width = LABEL_W * SCALE;
  canvas.height = LABEL_H * SCALE;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.save();
    ctx.scale(SCALE, SCALE);
    drawLabel(ctx, spec);
    ctx.restore();
    paperGrain(ctx, canvas.width, canvas.height);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(16, maxAnisotropy);
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.userData = { aspect: LABEL_W / LABEL_H, photo: false, fine: true };
  return texture;
}

/** How many pixels across a drawn label is, at each fidelity (the existing view's, and twice that). */
export const LABEL_PIXELS = { classic: LABEL_W, premium: LABEL_W * SCALE } as const;
