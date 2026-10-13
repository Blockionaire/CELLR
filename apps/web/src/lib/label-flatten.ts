import { flatSize, type Quad } from "@cellr/domain";
import { affineFromTriangles, applyMatrix, squareToQuad } from "./warp-math";

/** How finely the label is cut into little triangles; each is carried over exactly, so the whole is near-perfect. */
const GRID = 24;

/**
 * Makes the label flat again: takes what lies between four corners of the photo and draws it as an upright
 * rectangle, correcting for the angle it was photographed at. Done on the phone; only the result is sent.
 */
export async function flattenLabel(photo: Blob, quad: Quad, maxEdge = 1024): Promise<Blob> {
  const bitmap = await createImageBitmap(photo);
  try {
    const { width, height } = flatSize(quad, bitmap.width, bitmap.height, maxEdge);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingQuality = "high";

    const toPixels = (p: { x: number; y: number }) => ({
      x: p.x * bitmap.width,
      y: p.y * bitmap.height,
    });
    const map = squareToQuad([
      toPixels(quad[0]),
      toPixels(quad[1]),
      toPixels(quad[2]),
      toPixels(quad[3]),
    ]);
    const src = (i: number, j: number) => applyMatrix(map, i / GRID, j / GRID);
    const dst = (i: number, j: number) => ({ x: (i / GRID) * width, y: (j / GRID) * height });

    const triangle = (
      s: [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }],
      d: [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }],
    ) => {
      // Grown by a hair from its middle, so no thin seam shows between neighbours.
      const cx = (d[0].x + d[1].x + d[2].x) / 3;
      const cy = (d[0].y + d[1].y + d[2].y) / 3;
      const grow = (p: { x: number; y: number }) => {
        const dx = p.x - cx;
        const dy = p.y - cy;
        const len = Math.hypot(dx, dy) || 1;
        return { x: p.x + (dx / len) * 0.6, y: p.y + (dy / len) * 0.6 };
      };
      const [a, b, c] = d.map(grow) as [
        { x: number; y: number },
        { x: number; y: number },
        { x: number; y: number },
      ];
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(c.x, c.y);
      ctx.closePath();
      ctx.clip();
      const [m0, m1, m2, m3, m4, m5] = affineFromTriangles(s, d);
      ctx.setTransform(m0, m1, m2, m3, m4, m5);
      ctx.drawImage(bitmap, 0, 0);
      ctx.restore();
    };

    for (let j = 0; j < GRID; j++) {
      for (let i = 0; i < GRID; i++) {
        triangle(
          [src(i, j), src(i + 1, j), src(i, j + 1)],
          [dst(i, j), dst(i + 1, j), dst(i, j + 1)],
        );
        triangle(
          [src(i + 1, j), src(i + 1, j + 1), src(i, j + 1)],
          [dst(i + 1, j), dst(i + 1, j + 1), dst(i, j + 1)],
        );
      }
    }

    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("no picture"))), "image/jpeg", 0.88),
    );
  } finally {
    bitmap.close();
  }
}
