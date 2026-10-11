import type { CSSProperties } from "react";
import { cn } from "./cn";

export type BottleShape = "bordeaux" | "burgundy" | "champagne";
export type WineTint = "red" | "white" | "rose" | "sparkling" | "orange" | "dessert" | "fortified";

/** Silhouettes share one 60×200 box so they line up in rows and racks. */
const PATHS: Record<BottleShape, { body: string; foil: string }> = {
  bordeaux: {
    body: "M26 6H34V40C34 48 48 52 48 68V178Q48 190 36 190H24Q12 190 12 178V68C12 52 26 48 26 40Z",
    foil: "M26 6H34V24H26Z",
  },
  burgundy: {
    body: "M26 6H34V46C34 64 50 74 50 98V178Q50 190 38 190H22Q10 190 10 178V98C10 74 26 64 26 46Z",
    foil: "M26 6H34V26H26Z",
  },
  champagne: {
    body: "M25 6H35V52C35 72 52 84 52 108V176Q52 190 40 190H20Q8 190 8 176V108C8 84 25 72 25 52Z",
    foil: "M24 6H36V40H24Z",
  },
};

interface BottleGlyphProps {
  shape?: BottleShape;
  tint?: WineTint;
  /** Show a plain label panel (the "no photo yet" look). */
  label?: boolean;
  className?: string;
  style?: CSSProperties;
  /** Decorative by default; pass a title when the glyph carries meaning on its own. */
  title?: string;
}

/**
 * 2-D bottle silhouette: the placeholder wherever there is no label photo, and the 3D view's fallback.
 * Flat on purpose — the real label photo is the hero, never an illustration.
 */
export function BottleGlyph({
  shape = "bordeaux",
  tint = "red",
  label = true,
  className,
  style,
  title,
}: BottleGlyphProps) {
  const { body, foil } = PATHS[shape];
  const glass = `var(--wine-${tint})`;
  return (
    <svg
      viewBox="0 0 60 200"
      className={cn("h-auto w-full", className)}
      style={style}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <defs>
        <clipPath id={`glyph-${shape}`}>
          <path d={body} />
        </clipPath>
      </defs>
      <path d={body} fill="color-mix(in srgb, var(--ink) 9%, var(--canvas))" />
      <g clipPath={`url(#glyph-${shape})`}>
        <rect x="0" y="0" width="60" height="200" fill={glass} opacity="0.55" />
        {label && (
          <rect x="8" y="108" width="44" height="52" rx="2" fill="var(--ink)" opacity="0.16" />
        )}
        <rect x="14" y="60" width="3" height="120" rx="1.5" fill="var(--ink)" opacity="0.12" />
      </g>
      <path d={foil} fill="var(--accent)" opacity="0.9" />
      <path d={body} fill="none" stroke="var(--hairline)" strokeWidth="1" />
    </svg>
  );
}
