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

/**
 * How a place is drawn. `classic`: as sprints 2A and 2B.1 drew it (kept so the two can be compared side by side,
 * in the gallery and in measurements; to be removed once `premium` is accepted). `premium`: sprint 2B.2.
 */
export const FIDELITIES = ["classic", "premium"] as const;
export type Fidelity = (typeof FIDELITIES)[number];

/** The relief a surface has under light (premium only, and only at the highest level of detail). */
export type Relief = "grain" | "brushed" | "speckle";

export interface SurfaceSpec {
  kind: SurfaceKind;
  color: string;
  roughness: number;
  metalness: number;
  /** How strongly the room is mirrored in it. */
  env: number;
  /** Premium: which fine picture it wears as relief, and how deep. */
  relief?: Relief;
  reliefDepth?: number;
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
  /** The colour of the light strips: the top one, and the one under a zone bar. Null: not lit. */
  zoneLights: readonly [string | null, string | null];
}

/**
 * The premium finishes (sprint 2B.2). What changed against `FINISH`, and why:
 * - wood: a little less rough (an oiled or waxed board has a soft sheen, not a chalky face), mirrors the room
 *   less (wood is not glossy), and wears its grain as relief;
 * - blackened steel is POWDER-COATED: paint over metal, so it is barely metallic, fairly rough, with a fine skin;
 * - brushed stainless and brass: fully metal, rough enough that the room is a soft streak in them and never a
 *   mirror, with the brushing as relief;
 * - lacquer: satin, not a mirror.
 */
const PREMIUM_FINISH: Readonly<
  Record<StorageMaterial, (color: StorageColor) => Omit<SurfaceSpec, "color">>
> = {
  wood: () => ({
    kind: "wood",
    roughness: 0.5,
    metalness: 0,
    env: 0.42,
    relief: "grain",
    reliefDepth: 1.1,
  }),
  metal: (color) =>
    color === "black" || color === "graphite"
      ? {
          kind: "steel",
          roughness: 0.58,
          metalness: 0.3,
          env: 0.7,
          relief: "speckle",
          reliefDepth: 0.25,
        }
      : {
          kind: "brushed",
          roughness: color === "brass" ? 0.34 : 0.4,
          metalness: 1,
          env: 0.85,
          relief: "brushed",
          reliefDepth: 0.5,
        },
  lacquer: () => ({
    kind: "lacquer",
    roughness: 0.3,
    metalness: 0,
    env: 0.65,
    relief: "speckle",
    reliefDepth: 0.08,
  }),
};

/** The premium tones: the same names, a touch richer where the classic ones were flat. */
export const PREMIUM_TONES: Readonly<Record<StorageColor, string>> = {
  ...TONES,
  oak: "#a9794a",
  walnut: "#5e3a25",
  mahogany: "#51241a",
  pine: "#cba56e",
  graphite: "#2a2d32",
  stainless: "#b3b6ba",
  brass: "#a8823f",
};

/** What each template does with its appearance beyond the frame: where wood is not the frame, what the shelves are. */
export interface LookOptions {
  /** Shelves of their own material (a cooler's beech slide-outs), whatever the shell is. */
  shelf?: SurfaceSpec;
  /** The second light strip of a dual-zone cooler: cooler above, as its upper zone is. */
  secondGlow?: string;
  /** How it is drawn. Left out: premium. */
  fidelity?: Fidelity;
  /**
   * Premium: a place with two zones lit apart. The upper zone's light is the cooler of the two, the lower the
   * warmer, whatever the chosen colour of light: that is what tells the zones apart at a glance. (It says how the
   * zones are LIT. It is not a temperature, measured or set.)
   */
  twoZones?: boolean;
}

/** The light of each of two zones, for a chosen colour of light: [upper, lower]. */
export const ZONE_LIGHTS: Readonly<
  Record<Exclude<StorageLighting, "none">, readonly [string, string]>
> = {
  warm: ["#fff0d8", "#ffc37a"],
  cool: ["#d2e4ff", "#ffe6c2"],
};

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
  const premium = (options.fidelity ?? "premium") === "premium";
  const tone = (premium ? PREMIUM_TONES : TONES)[appearance.color];
  const frame: SurfaceSpec = {
    ...(premium ? PREMIUM_FINISH : FINISH)[appearance.material](appearance.color),
    color: tone,
  };
  const chosen = LIGHT_TONES[appearance.lighting];
  const zoned = premium && options.twoZones && appearance.lighting !== "none";
  const [upper, lower] = zoned
    ? ZONE_LIGHTS[appearance.lighting as "warm" | "cool"]
    : [chosen, chosen ? (options.secondGlow ?? chosen) : null];
  const glow = (color: string | null): SurfaceSpec => ({
    kind: "glow",
    color: color ?? "#2a2a2a",
    roughness: 0.4,
    metalness: 0,
    env: 0.2,
    emissive: color ?? "#000000",
    emissiveIntensity: color ? (premium ? 2.2 : 1.7) : 0,
  });
  const shelf = options.shelf ?? frame;
  return {
    surfaces: {
      frame,
      shelf:
        premium && options.shelf
          ? { ...shelf, roughness: 0.55, env: 0.4, relief: "grain", reliefDepth: 0.9 }
          : shelf,
      // the inside and the back: the same finish, darker, and barely mirroring the room
      back: {
        ...frame,
        color: shade(tone, premium ? 0.42 : 0.55),
        roughness: 0.85,
        env: premium ? 0.18 : 0.25,
        metalness: frame.metalness * 0.4,
      },
      metal: premium
        ? {
            kind: "brushed",
            color: "#bdb9b1",
            roughness: 0.36,
            metalness: 1,
            env: 0.85,
            relief: "brushed",
            reliefDepth: 0.45,
          }
        : { kind: "brushed", color: "#b9b4ab", roughness: 0.3, metalness: 0.9, env: 1 },
      trim: { kind: "matte", color: "#121314", roughness: 0.55, metalness: 0.1, env: 0.4 },
      stone: premium
        ? {
            kind: "stone",
            color: "#d6d1c8",
            roughness: 0.42,
            metalness: 0,
            env: 0.45,
            relief: "speckle",
            reliefDepth: 0.12,
          }
        : { kind: "stone", color: "#d9d5cd", roughness: 0.35, metalness: 0, env: 0.5 },
      wall: premium
        ? {
            kind: "matte",
            color: "#d6cfc2",
            roughness: 0.96,
            metalness: 0,
            env: 0.06,
            relief: "speckle",
            reliefDepth: 0.2,
          }
        : { kind: "matte", color: "#cfc8bb", roughness: 0.95, metalness: 0, env: 0.1 },
      neutral: { kind: "matte", color: "#8d8f93", roughness: 0.8, metalness: 0, env: 0.2 },
      slot: { kind: "matte", color: "#5d6066", roughness: 0.8, metalness: 0, env: 0.2 },
      // premium glass: a faint cool tint, the room in it as two soft bands, and still see-through between them
      glass: premium
        ? {
            kind: "glass",
            color: "#d3e0e6",
            roughness: 0.03,
            metalness: 0,
            env: 1.9,
            opacity: 0.34,
          }
        : {
            kind: "glass",
            color: "#dfe9ee",
            roughness: 0.04,
            metalness: 0,
            env: 1.4,
            opacity: 0.14,
          },
      glow: glow(upper),
      glowB: glow(lower),
      display: {
        kind: "glow",
        color: "#0c1418",
        roughness: 0.3,
        metalness: 0,
        env: 0.4,
        emissive: premium ? "#9fdcff" : "#8fd3ff",
        emissiveIntensity: premium ? 1.25 : 0.9,
      },
    },
    light: { color: (zoned ? upper : chosen) ?? "#ffffff", intensity: chosen ? 1 : 0 },
    zoneLights: [upper, lower],
  };
}
