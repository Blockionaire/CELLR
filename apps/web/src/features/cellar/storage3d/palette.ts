import type {
  StorageAppearance,
  StorageColor,
  StorageLighting,
  StorageMaterial,
} from "@cellr/domain";

/**
 * What the named looks of the catalogue (packages/domain, storage-templates) ARE, as numbers: the renderer owns the
 * tones, the catalogue only the names. Plain data: no three.js here, so it can be tested and reused by a 2D swatch.
 * Nothing is fetched and nothing comes from a person: every value below is one of a fixed set.
 */

/** How a surface is drawn. `wood` and `brushed` wear a small procedural grain; the others are plain. */
export type SurfaceKind =
  "wood" | "brushed" | "steel" | "lacquer" | "matte" | "stone" | "glass" | "glow";

export interface SurfaceSpec {
  kind: SurfaceKind;
  color: string;
  roughness: number;
  metalness: number;
  /** How strongly the room is mirrored in it. */
  env: number;
  /** Glass and glow only. */
  opacity?: number;
  emissive?: string;
  emissiveIntensity?: number;
}

/** The parts of a place that can look different from one another. */
export const MATERIAL_ROLES = [
  "frame",
  "shelf",
  "back",
  "metal",
  "trim",
  "stone",
  "wall",
  "neutral",
  "slot",
  "glass",
  "glow",
  "glowB",
  "display",
] as const;
export type MaterialRole = (typeof MATERIAL_ROLES)[number];

export const TONES: Readonly<Record<StorageColor, string>> = {
  // wood
  oak: "#a47a4e",
  walnut: "#5b3a27",
  mahogany: "#4a2218",
  ebony: "#211b18",
  pine: "#c9a26b",
  // metal and lacquer
  black: "#18191b",
  graphite: "#2c2f34",
  stainless: "#a4a8ad",
  brass: "#a07e3e",
  white: "#e8e4dc",
  sage: "#7f917b",
  navy: "#1f2b45",
};

const FINISH: Readonly<
  Record<StorageMaterial, (color: StorageColor) => Omit<SurfaceSpec, "color">>
> = {
  wood: () => ({ kind: "wood", roughness: 0.6, metalness: 0, env: 0.55 }),
  // blackened steel is matte and plain; the lighter metals are brushed
  metal: (color) =>
    color === "black"
      ? { kind: "steel", roughness: 0.5, metalness: 0.7, env: 0.85 }
      : { kind: "brushed", roughness: color === "brass" ? 0.32 : 0.36, metalness: 0.85, env: 0.95 },
  lacquer: () => ({ kind: "lacquer", roughness: 0.22, metalness: 0, env: 0.75 }),
};

/** A tone a step darker (0..1), for backs and insides. */
export function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = 1 - amount;
  const c = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v * f)))
      .toString(16)
      .padStart(2, "0");
  return `#${c((n >> 16) & 255)}${c((n >> 8) & 255)}${c(n & 255)}`;
}

/** The colour of the light strip, or null when there is none. */
export const LIGHT_TONES: Readonly<Record<StorageLighting, string | null>> = {
  none: null,
  warm: "#ffd7a3",
  cool: "#dbe9ff",
};

export interface Look {
  surfaces: Readonly<Record<MaterialRole, SurfaceSpec>>;
  /** The light inside (a point light that is always in the scene: off is intensity 0). */
  light: { color: string; intensity: number };
}

/** What each template does with its appearance beyond the frame: where wood is not the frame, what the shelves are. */
export interface LookOptions {
  /** Shelves of their own material (a cooler's beech slide-outs), whatever the shell is. */
  shelf?: SurfaceSpec;
  /** The second light strip of a dual-zone cooler: cooler above, as its upper zone is. */
  secondGlow?: string;
}

const BEECH: SurfaceSpec = {
  kind: "wood",
  color: "#b08458",
  roughness: 0.62,
  metalness: 0,
  env: 0.5,
};
export const COOLER_SHELF = BEECH;

/**
 * The surfaces of a place for one appearance. Every role always has a surface, so a part never goes undrawn;
 * what a template does not use costs nothing.
 */
export function lookFor(appearance: StorageAppearance, options: LookOptions = {}): Look {
  const tone = TONES[appearance.color];
  const frame: SurfaceSpec = { ...FINISH[appearance.material](appearance.color), color: tone };
  const lightTone = LIGHT_TONES[appearance.lighting];
  const glow = (color: string | null): SurfaceSpec => ({
    kind: "glow",
    color: color ?? "#2a2a2a",
    roughness: 0.4,
    metalness: 0,
    env: 0.2,
    emissive: color ?? "#000000",
    emissiveIntensity: color ? 1.7 : 0,
  });
  return {
    surfaces: {
      frame,
      shelf: options.shelf ?? frame,
      // the inside and the back: the same finish, darker, and barely mirroring the room
      back: {
        ...frame,
        color: shade(tone, 0.55),
        roughness: 0.85,
        env: 0.25,
        metalness: frame.metalness * 0.4,
      },
      metal: { kind: "brushed", color: "#b9b4ab", roughness: 0.3, metalness: 0.9, env: 1 },
      trim: { kind: "matte", color: "#121314", roughness: 0.55, metalness: 0.1, env: 0.4 },
      stone: { kind: "stone", color: "#d9d5cd", roughness: 0.35, metalness: 0, env: 0.5 },
      wall: { kind: "matte", color: "#cfc8bb", roughness: 0.95, metalness: 0, env: 0.1 },
      neutral: { kind: "matte", color: "#8d8f93", roughness: 0.8, metalness: 0, env: 0.2 },
      slot: { kind: "matte", color: "#5d6066", roughness: 0.8, metalness: 0, env: 0.2 },
      glass: {
        kind: "glass",
        color: "#dfe9ee",
        roughness: 0.04,
        metalness: 0,
        env: 1.4,
        opacity: 0.14,
      },
      glow: glow(lightTone),
      glowB: glow(lightTone ? (options.secondGlow ?? lightTone) : null),
      display: {
        kind: "glow",
        color: "#0c1418",
        roughness: 0.3,
        metalness: 0,
        env: 0.4,
        emissive: "#8fd3ff",
        emissiveIntensity: 0.9,
      },
    },
    light: { color: lightTone ?? "#ffffff", intensity: lightTone ? 1 : 0 },
  };
}
