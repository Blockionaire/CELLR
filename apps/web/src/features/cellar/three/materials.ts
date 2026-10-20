import * as THREE from "three";
import type { StorageLook } from "./layout";

/**
 * The materials of the storage, drawn here on small canvases (nothing is downloaded): a wood grain, a brushed
 * metal, a soft contact shadow. Each picture is made once per page and shared by every board that uses it.
 */

const cache = new Map<string, THREE.Texture>();

function canvasTexture(
  key: string,
  size: number,
  draw: (ctx: CanvasRenderingContext2D, size: number) => void,
) {
  const known = cache.get(key);
  if (known) return known;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) draw(ctx, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  cache.set(key, texture);
  return texture;
}

/** A seeded random, so the grain is the same on every visit. */
function random(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

/**
 * Wood grain along the board: long, slightly wavering lines of darker late wood over a lighter ground, with a few
 * pores. Drawn in shades of grey so one picture serves every wood: the material's colour gives the species.
 */
export function woodTexture(): THREE.Texture {
  return canvasTexture("wood", 512, (ctx, size) => {
    const rnd = random(11);
    ctx.fillStyle = "#d9d9d9";
    ctx.fillRect(0, 0, size, size);
    // fine, nearly straight late-wood lines, closer together in places, like quarter-sawn timber
    for (let i = 0; i < 260; i++) {
      const y0 = rnd() * size;
      const amp = 0.4 + rnd() * 1.8;
      const freq = 0.003 + rnd() * 0.008;
      const phase = rnd() * Math.PI * 2;
      const shade = 120 + Math.floor(rnd() * 70);
      ctx.strokeStyle = `rgba(${shade},${shade},${shade},${0.08 + rnd() * 0.22})`;
      ctx.lineWidth = 0.4 + rnd() * 1.6;
      ctx.beginPath();
      for (let x = 0; x <= size; x += 8) {
        const y = y0 + Math.sin(x * freq + phase) * amp;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    for (let i = 0; i < 1400; i++) {
      ctx.fillStyle = `rgba(90,90,90,${0.08 + rnd() * 0.12})`;
      ctx.fillRect(rnd() * size, rnd() * size, 1 + rnd() * 3, 0.8);
    }
  });
}

/** Brushed metal: thousands of fine straight scratches, all one way. */
export function brushedTexture(): THREE.Texture {
  return canvasTexture("brushed", 256, (ctx, size) => {
    const rnd = random(5);
    ctx.fillStyle = "#c8c8c8";
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 2600; i++) {
      const v = 160 + Math.floor(rnd() * 90);
      ctx.fillStyle = `rgba(${v},${v},${v},0.35)`;
      ctx.fillRect(rnd() * size, rnd() * size, 8 + rnd() * 60, 0.7);
    }
  });
}

/** A soft dark oval: the shadow a lying bottle casts on the shelf right under it. */
export function contactShadowTexture(): THREE.Texture {
  return canvasTexture("contact", 128, (ctx, size) => {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, "rgba(0,0,0,0.6)");
    g.addColorStop(0.45, "rgba(0,0,0,0.32)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  });
}

export interface LookMaterials {
  frame: THREE.MeshStandardMaterial;
  shelf: THREE.MeshStandardMaterial;
  back: THREE.MeshStandardMaterial;
  lip: THREE.MeshStandardMaterial;
  glow: THREE.MeshStandardMaterial;
  dispose: () => void;
}

function surface(tone: string, kind: "wood" | "brushed" | "steel", repeat: [number, number]) {
  const base = kind === "wood" ? woodTexture() : kind === "brushed" ? brushedTexture() : null;
  // Each material gets its own view of the shared picture, so boards can tile it to their own size.
  const map = base ? base.clone() : null;
  if (map) {
    map.repeat.set(...repeat);
    map.needsUpdate = true;
  }
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(tone),
    map,
    roughness: kind === "wood" ? 0.62 : kind === "brushed" ? 0.36 : 0.48,
    metalness: kind === "wood" ? 0 : kind === "brushed" ? 0.82 : 0.7,
    envMapIntensity: kind === "wood" ? 0.55 : 0.9,
  });
  return { material, map };
}

/** The materials for one storage unit, sized to it (so the grain is not stretched). Dispose with `dispose`. */
export function lookMaterials(look: StorageLook, width: number, height: number): LookMaterials {
  const frame = surface(look.frame.tone, look.frame.material, [Math.max(1, width / 3), 1]);
  const shelf = surface(look.shelf.tone, look.shelf.material, [Math.max(1, width / 3), 0.6]);
  const back = surface(look.back, look.frame.material === "wood" ? "wood" : "brushed", [
    Math.max(1, width / 4),
    Math.max(1, height / 4),
  ]);
  back.material.roughness = 0.85;
  back.material.envMapIntensity = 0.25;
  const lip = new THREE.MeshStandardMaterial({ color: "#b9b4ab", roughness: 0.3, metalness: 0.9 });
  const glow = new THREE.MeshStandardMaterial({
    color: "#fff1d6",
    emissive: new THREE.Color("#ffd9a0"),
    emissiveIntensity: 1.6,
    roughness: 0.4,
  });
  return {
    frame: frame.material,
    shelf: shelf.material,
    back: back.material,
    lip,
    glow,
    dispose: () => {
      for (const part of [frame, shelf, back]) {
        part.material.dispose();
        part.map?.dispose();
      }
      lip.dispose();
      glow.dispose();
    },
  };
}
