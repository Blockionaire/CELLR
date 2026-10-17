import { useId, type CSSProperties } from "react";
import { cn } from "./cn";

export type BottleShape = "bordeaux" | "burgundy" | "champagne";
export type WineTint = "red" | "white" | "rose" | "sparkling" | "orange" | "dessert" | "fortified";

interface ShapeSpec {
  body: string;
  /** neck x-range and where the capsule ends */
  neck: [number, number];
  foilEnd: number;
  /** body x-range */
  wall: [number, number];
  label: { y: number; h: number };
  gloss: { y: number; h: number };
}

/** Silhouettes share one 100×320 box so they line up in rows and racks. */
const SHAPES: Record<BottleShape, ShapeSpec> = {
  bordeaux: {
    body: "M43 6H57V84C57 104 78 112 78 140V300Q78 312 66 312H34Q22 312 22 300V140C22 112 43 104 43 84Z",
    neck: [43, 57],
    foilEnd: 54,
    wall: [22, 78],
    label: { y: 176, h: 100 },
    gloss: { y: 130, h: 166 },
  },
  burgundy: {
    body: "M43 6H57V96C57 130 79 142 79 178V300Q79 312 67 312H33Q21 312 21 300V178C21 142 43 130 43 96Z",
    neck: [43, 57],
    foilEnd: 56,
    wall: [21, 79],
    label: { y: 196, h: 92 },
    gloss: { y: 160, h: 140 },
  },
  champagne: {
    body: "M42 6H58V70C58 100 84 118 84 168V298Q84 312 70 312H30Q16 312 16 298V168C16 118 42 100 42 70Z",
    neck: [42, 58],
    foilEnd: 92,
    wall: [16, 84],
    label: { y: 188, h: 98 },
    gloss: { y: 150, h: 150 },
  },
};

/** A label is always paper and ink, whatever the theme: it is a printed object. */
const PAPER = "#efe5d2";
const PAPER_INK = "#4a2b33";

interface BottleGlyphProps {
  shape?: BottleShape;
  tint?: WineTint;
  /** Show the label panel (the "no photo yet" look). */
  label?: boolean;
  /** Short producer mark printed on the label, e.g. "LÉOVILLE". */
  mark?: string | undefined;
  year?: string | undefined;
  /** The straightened label cut-out; when present it IS the label. */
  labelUrl?: string | undefined;
  className?: string;
  style?: CSSProperties;
  /** Decorative by default; pass a title when the glyph carries meaning on its own. */
  title?: string;
}

/**
 * The CELLR bottle: glass, capsule, a paper label with cylinder shading and a highlight.
 * Wherever there is no label photo it is typeset from the producer; with a label cut-out the real
 * label is shown. Never a made-up copy of a real label.
 */
export function BottleGlyph({
  shape = "bordeaux",
  tint = "red",
  label = true,
  mark,
  year,
  labelUrl,
  className,
  style,
  title,
}: BottleGlyphProps) {
  const id = useId();
  const k = SHAPES[shape];
  const [nl, nr] = k.neck;
  const [bl, br] = k.wall;
  const lx = bl + 3;
  const lw = br - bl - 6;
  const text = (mark ?? "").trim();
  const fontSize = Math.min(6.2, (lw - 2) / (Math.max(text.length, 1) * 0.74));
  const shade = `${id}-shade`;
  const clip = `${id}-label`;
  return (
    <svg
      viewBox="0 0 100 320"
      className={cn("h-auto w-full", className)}
      style={style}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <defs>
        <linearGradient id={shade} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#000" stopOpacity="0.4" />
          <stop offset="0.3" stopColor="#000" stopOpacity="0" />
          <stop offset="0.7" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.48" />
        </linearGradient>
        <clipPath id={clip}>
          <rect x={lx} y={k.label.y} width={lw} height={k.label.h} rx="1.6" />
        </clipPath>
      </defs>
      <ellipse cx="50" cy="316" rx="30" ry="3.2" fill="#000" opacity="0.16" />
      <path d={k.body} fill={`var(--glass-${tint})`} />
      <path
        d={`M${nl - 1.4} 6H${nr + 1.4}V${k.foilEnd}H${nl - 1.4}Z`}
        fill={`var(--foil-${tint})`}
      />
      <path d={`M${nl - 1.4} 6H${nr + 1.4}V${k.foilEnd}H${nl - 1.4}Z`} fill={`url(#${shade})`} />
      {label &&
        (labelUrl ? (
          <image
            href={labelUrl}
            x={lx}
            y={k.label.y}
            width={lw}
            height={k.label.h}
            preserveAspectRatio="xMidYMid slice"
            clipPath={`url(#${clip})`}
          />
        ) : (
          <>
            <rect x={lx} y={k.label.y} width={lw} height={k.label.h} rx="1.6" fill={PAPER} />
            <rect
              x={lx + 6}
              y={k.label.y + k.label.h * 0.2}
              width={lw - 12}
              height="0.9"
              fill={PAPER_INK}
              opacity="0.55"
            />
            {text && (
              <text
                x="50"
                y={k.label.y + k.label.h * 0.52}
                textAnchor="middle"
                fontFamily="Georgia, serif"
                fontWeight="700"
                fontSize={fontSize}
                letterSpacing="0.3"
                fill={PAPER_INK}
              >
                {text}
              </text>
            )}
            {text && year && (
              <text
                x="50"
                y={k.label.y + k.label.h * 0.78}
                textAnchor="middle"
                fontFamily="Georgia, serif"
                fontSize="6"
                fill={PAPER_INK}
              >
                {year}
              </text>
            )}
          </>
        ))}
      <path d={k.body} fill={`url(#${shade})`} />
      <rect
        x={bl + 5}
        y={k.gloss.y}
        width="3.2"
        height={k.gloss.h}
        rx="1.6"
        fill="#fff"
        opacity="0.26"
      />
      <rect
        x={br - 9}
        y={k.gloss.y}
        width="1.4"
        height={k.gloss.h}
        rx="0.7"
        fill="#fff"
        opacity="0.12"
      />
    </svg>
  );
}
