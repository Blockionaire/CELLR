import type { CSSProperties } from "react";
import { cn } from "./cn";

/** Pixel sizes of the artwork in /public/brand (written by `pnpm icons`), so the box reserves the right shape. */
const ARTWORK = {
  lockup: { src: "/brand/logo-lockup.png", ratio: 687 / 708 },
  mark: { src: "/brand/logo-mark.png", ratio: 291 / 547 },
} as const;

interface LogoProps {
  /** "lockup" = the glass with the CELLR lettering; "mark" = the glass alone. */
  variant?: keyof typeof ARTWORK;
  /** Size it with a height (`h-24`); width follows the artwork. */
  className?: string;
}

/**
 * The CELLR logo, drawn as a mask over the current text colour — so one file serves light and dark
 * (burgundy on ivory, ivory on the dark canvas) and stays crisp at any size. Default colour: `text-logo`.
 */
export function Logo({ variant = "lockup", className }: LogoProps) {
  const { src, ratio } = ARTWORK[variant];
  const mask: CSSProperties = {
    aspectRatio: String(ratio),
    WebkitMaskImage: `url(${src})`,
    maskImage: `url(${src})`,
    WebkitMaskSize: "contain",
    maskSize: "contain",
    WebkitMaskRepeat: "no-repeat",
    maskRepeat: "no-repeat",
    WebkitMaskPosition: "center",
    maskPosition: "center",
  };
  return (
    <span
      role="img"
      aria-label="CELLR"
      className={cn("inline-block bg-current text-logo", className)}
      style={mask}
    />
  );
}
