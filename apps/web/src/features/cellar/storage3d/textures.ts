import * as THREE from "three";

/**
 * The pictures the premium look is made of (Smart Cellar 3D, sprint 2B.2): drawn here on small canvases, in shades
 * of grey so that one picture serves every colour of a material. Nothing is downloaded.
 *
 * WHO OWNS THEM: nobody's scene. Each is made once per page, the first time it is asked for, and shared by every
 * scene after that, exactly as the existing view's pictures are (../three/materials). An `Owned` never holds
 * them, so closing a scene never takes a picture away from another one. `sharedTextureCount()` says how many
 * exist: it has a ceiling (the number of functions below), whatever is opened and closed.
 *
 * Every pattern wraps on both sides without a seam, and every one is the same on every visit (seeded).
 */
const cache = new Map<string, THREE.Texture>();
export const sharedTextureCount = (): number => cache.size;

function canvasTexture(
  key: string,
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  options: { colour?: boolean; repeat?: boolean; anisotropy?: number } = {},
): THREE.Texture {
  const known = cache.get(key);
  if (known) return known;
  let texture: THREE.Texture;
  if (typeof document === "undefined") {
    // nowhere to draw (a server render, a unit test): the picture is blank, and still the one shared picture
    texture = new THREE.Texture();
  } else {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (ctx) draw(ctx, width, height);
    texture = new THREE.CanvasTexture(canvas);
  }
  if (options.repeat !== false) texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = options.colour === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  texture.anisotropy = options.anisotropy ?? 8;
  cache.set(key, texture);
  return texture;
}

/** A seeded random (the same picture on every visit). */
export function seededRandom(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/** Draws something three times, shifted by the picture's height, so that what crosses an edge comes back in. */
function wrapped(h: number, draw: (dy: number) => void) {
  for (const dy of [-h, 0, h]) draw(dy);
}

/**
 * Wood, along the board. Not lines on a flat colour: bands of early and late wood of uneven width, each a little
 * lighter or darker; fine grain lines that follow one slow wave together (as growth rings cut lengthwise do), so
 * they never cross; short dark pores; and here and there the pale fleck of a ray. Long and narrow, so the grain
 * can run far before it repeats: 1024 across for a board 3 units long.
 */
export function fineWoodTexture(): THREE.Texture {
  return canvasTexture("fine-wood", 1024, 512, (ctx, w, h) => {
    const rnd = seededRandom(4127);
    ctx.fillStyle = "#cfcfcf";
    ctx.fillRect(0, 0, w, h);
    // the slow wave every line follows: whole numbers of waves across, so the left edge meets the right
    // (gentle: a board's narrow edge shows a strip only 20 pixels high, and a strong wave reads as a squiggle there)
    const waves = [1, 2, 3, 5].map((n) => ({
      n,
      a: (1.5 + rnd() * 3.5) / n,
      p: rnd() * Math.PI * 2,
    }));
    const sway = (x: number, depth: number) =>
      waves.reduce((sum, v) => sum + Math.sin((x / w) * Math.PI * 2 * v.n + v.p) * v.a, 0) * depth;
    const line = (y0: number, depth: number) => {
      ctx.beginPath();
      for (let x = 0; x <= w; x += 6) {
        const y = y0 + sway(x, depth);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };
    // broad bands: the tone of the wood changes across a board
    let y = 0;
    while (y < h) {
      const band = 14 + rnd() * 46;
      const tone = 150 + Math.floor(rnd() * 80);
      ctx.strokeStyle = `rgba(${tone},${tone},${tone},0.55)`;
      ctx.lineWidth = band;
      wrapped(h, (dy) => line(y + band / 2 + dy, 1));
      y += band * 0.8;
    }
    // the grain: many fine lines, closer together where the wood grew slowly
    y = 0;
    while (y < h) {
      const dense = rnd() < 0.3;
      y += dense ? 1.1 + rnd() * 1.6 : 2.2 + rnd() * 4.5;
      const tone = 70 + Math.floor(rnd() * 70);
      ctx.strokeStyle = `rgba(${tone},${tone},${tone},${0.1 + rnd() * (dense ? 0.3 : 0.2)})`;
      ctx.lineWidth = 0.5 + rnd() * (dense ? 1.2 : 0.9);
      wrapped(h, (dy) => line(y + dy, 1));
    }
    // pores: short dark dashes along the grain
    for (let i = 0; i < 2600; i++) {
      const x = rnd() * w;
      const py = rnd() * h;
      const len = 3 + rnd() * 14;
      const tone = 40 + Math.floor(rnd() * 50);
      ctx.strokeStyle = `rgba(${tone},${tone},${tone},${0.12 + rnd() * 0.22})`;
      ctx.lineWidth = 0.6 + rnd() * 0.7;
      ctx.beginPath();
      ctx.moveTo(x, py + sway(x, 1));
      ctx.lineTo(x + len, py + sway(x + len, 1));
      ctx.stroke();
    }
    // rays: a few pale flecks across the grain
    for (let i = 0; i < 220; i++) {
      const x = rnd() * w;
      const py = rnd() * h;
      ctx.fillStyle = `rgba(245,245,245,${0.05 + rnd() * 0.09})`;
      ctx.fillRect(x, py + sway(x, 1), 5 + rnd() * 16, 0.8 + rnd() * 1.4);
    }
  });
}

/**
 * Brushed metal: very many hair-fine scratches all one way, of uneven length, over an even ground. Read by the
 * material as its colour (a little) and as its relief (the scratches catch the light in streaks).
 */
export function brushedMetalTexture(): THREE.Texture {
  return canvasTexture("brushed-metal", 512, 256, (ctx, w, h) => {
    const rnd = seededRandom(977);
    ctx.fillStyle = "#c6c6c6";
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 5200; i++) {
      const y = rnd() * h;
      const x = rnd() * w;
      const len = 30 + rnd() * 260;
      const light = rnd() < 0.5;
      const tone = light ? 225 + Math.floor(rnd() * 30) : 120 + Math.floor(rnd() * 60);
      ctx.strokeStyle = `rgba(${tone},${tone},${tone},${0.05 + rnd() * 0.12})`;
      ctx.lineWidth = 0.4 + rnd() * 0.6;
      for (const dx of [-w, 0]) {
        ctx.beginPath();
        ctx.moveTo(x + dx, y);
        ctx.lineTo(x + dx + len, y);
        ctx.stroke();
      }
    }
  });
}

/**
 * A fine, even speckle: the skin of powder-coated steel, of a painted wall, of lacquer that is not a mirror. Used
 * as relief only, so it is not a colour picture.
 */
export function speckleTexture(): THREE.Texture {
  return canvasTexture(
    "speckle",
    256,
    256,
    (ctx, w, h) => {
      const rnd = seededRandom(31337);
      const image = ctx.createImageData(w, h);
      for (let i = 0; i < w * h; i++) {
        // a soft speckle: the mean of a few draws, so most of it is mid grey with gentle bumps
        const v = Math.round(((rnd() + rnd() + rnd()) / 3) * 255);
        image.data[i * 4] = image.data[i * 4 + 1] = image.data[i * 4 + 2] = v;
        image.data[i * 4 + 3] = 255;
      }
      ctx.putImageData(image, 0, 0);
    },
    { colour: false },
  );
}

/**
 * The sheen of a pane of glass: mostly clear, with two soft slanting bands where the room lies in it. Its alpha is
 * what the pane takes from it (white bands, see-through between), so the bottles behind stay readable. It does
 * not repeat: one picture across the door.
 */
export function glassSheenTexture(): THREE.Texture {
  return canvasTexture(
    "glass-sheen",
    256,
    256,
    (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      // an even, faint film over all of it (so the pane is there at all)
      ctx.fillStyle = "rgba(255,255,255,0.36)";
      ctx.fillRect(0, 0, w, h);
      // two slanting bands of reflection, soft at both edges
      const band = (at: number, width: number, strength: number) => {
        const g = ctx.createLinearGradient(0, 0, w, h * 0.55);
        const [a, b] = [Math.max(0, at - width), Math.min(1, at + width)];
        g.addColorStop(0, "rgba(255,255,255,0)");
        g.addColorStop(a, "rgba(255,255,255,0)");
        g.addColorStop(at, `rgba(255,255,255,${strength})`);
        g.addColorStop(b, "rgba(255,255,255,0)");
        g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      };
      band(0.3, 0.13, 0.5);
      band(0.52, 0.05, 0.3);
      // a little denser towards the top and the edges, as a pane seen at a slant is
      const edge = ctx.createLinearGradient(0, 0, 0, h);
      edge.addColorStop(0, "rgba(255,255,255,0.22)");
      edge.addColorStop(0.25, "rgba(255,255,255,0)");
      edge.addColorStop(1, "rgba(255,255,255,0.06)");
      ctx.fillStyle = edge;
      ctx.fillRect(0, 0, w, h);
    },
    { repeat: false },
  );
}

/**
 * A soft shadow with no hard edge anywhere: dense in the middle, gone at the rim. Under a piece of furniture on
 * the floor, behind a mount on a wall, behind a bottle on that wall. White with alpha, drawn in black by its
 * material.
 */
export function softShadowTexture(): THREE.Texture {
  return canvasTexture(
    "soft-shadow",
    128,
    128,
    (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      g.addColorStop(0, "rgba(255,255,255,0.95)");
      g.addColorStop(0.35, "rgba(255,255,255,0.7)");
      g.addColorStop(0.7, "rgba(255,255,255,0.22)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    },
    { repeat: false },
  );
}

/** The glow round a strip of light: bright along the strip, fading out above and below it. Added to what is behind. */
export function haloTexture(): THREE.Texture {
  return canvasTexture(
    "halo",
    64,
    64,
    (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, "rgba(255,255,255,0)");
      g.addColorStop(0.42, "rgba(255,255,255,0.22)");
      g.addColorStop(0.5, "rgba(255,255,255,0.75)");
      g.addColorStop(0.58, "rgba(255,255,255,0.22)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      // and fading towards both ends of the strip
      ctx.globalCompositeOperation = "destination-in";
      const ends = ctx.createLinearGradient(0, 0, w, 0);
      ends.addColorStop(0, "rgba(0,0,0,0)");
      ends.addColorStop(0.12, "rgba(0,0,0,1)");
      ends.addColorStop(0.88, "rgba(0,0,0,1)");
      ends.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = ends;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = "source-over";
    },
    { repeat: false },
  );
}

/**
 * What a label looks like from across a room: paper with a fine printed border, a block where the name stands and
 * two thin lines under it. No words (none could be read at that size, and none are made up). In shades of grey:
 * each bottle's own paper colour comes from its instance. Wraps once round the bottle; the print faces the front.
 */
export function distantLabelTexture(): THREE.Texture {
  return canvasTexture(
    "distant-label",
    256,
    128,
    (ctx, w, h) => {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
      // A cylinder's picture starts at the side the label faces (u = 0, the bottle's own front) and runs once
      // round, so the print is drawn half at the left edge and half at the right: it meets itself at the seam.
      const half = w * 0.2;
      for (const cx of [0, w]) {
        ctx.strokeStyle = "rgba(60,50,45,0.55)";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(cx - half, h * 0.1, half * 2, h * 0.8);
        ctx.fillStyle = "rgba(60,50,45,0.6)";
        ctx.fillRect(cx - half * 0.62, h * 0.3, half * 1.24, h * 0.13);
        ctx.fillStyle = "rgba(60,50,45,0.4)";
        ctx.fillRect(cx - half * 0.45, h * 0.52, half * 0.9, h * 0.045);
        ctx.fillRect(cx - half * 0.3, h * 0.63, half * 0.6, h * 0.04);
      }
      // the paper itself is not one flat white
      const rnd = seededRandom(88);
      for (let i = 0; i < 900; i++) {
        ctx.fillStyle = `rgba(120,110,100,${rnd() * 0.05})`;
        ctx.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1);
      }
    },
    { anisotropy: 4 },
  );
}
