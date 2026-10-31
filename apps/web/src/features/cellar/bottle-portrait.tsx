import {
  bottleArtUrl,
  formatVintage,
  type BottleArtRef,
  type ImageRef,
  type WineType,
} from "@cellr/domain";
import { BottleGlyph } from "@/ui/bottle-glyph";
import { cn } from "@/ui/cn";
import { imageUrl, LabelImage } from "./label-image";
import { labelMark, shapeFor } from "./wine-visuals";

export interface PortraitWine {
  type: WineType;
  producer: string;
  wineName: string;
  year: number | null;
  image: ImageRef | null;
  /** The library's published 2D bottle picture of this wine, when there is one: it stands in for the drawn bottle. */
  art?: BottleArtRef | null | undefined;
}

/**
 * The bottle as the hero of a screen: standing in a soft pool of its own colour, no box around it. When the library
 * has a finished 2D picture of the wine, that is the bottle. Otherwise it wears the household's straightened label
 * when there is one; a label photo that was never straightened leans against it as
 * a print. Without a photo the label is typeset from the producer, never an imitation of a real label.
 * Decorative unless `printAlt` is given (the name is always written beside it).
 */
export function BottlePortrait({
  wine,
  className,
  printAlt,
}: {
  wine: PortraitWine;
  /** Size it with a height and a width; the bottle fills the height. */
  className?: string;
  printAlt?: string;
}) {
  const art = wine.art ?? null;
  const textured = !art && wine.image?.texture === true;
  const print = !art && wine.image && !textured ? wine.image : null;
  return (
    <div
      aria-hidden={(print || art) && printAlt ? undefined : true}
      data-testid="bottle-portrait"
      data-label={art ? "art" : textured ? "photo" : print ? "print" : "typeset"}
      className={cn("relative isolate flex items-end justify-center", className)}
    >
      <span
        aria-hidden="true"
        className="absolute inset-x-[-18%] bottom-[-4%] top-[8%] -z-10"
        style={{
          background: `radial-gradient(closest-side, var(--stage-${wine.type}), transparent)`,
        }}
      />
      {art ? (
        // eslint-disable-next-line @next/next/no-img-element -- a private, same-origin picture: the optimiser cannot fetch it
        <img
          src={bottleArtUrl(art.id)}
          alt={printAlt ?? ""}
          width={art.width}
          height={art.height}
          decoding="async"
          draggable={false}
          className="relative h-full w-auto max-w-[140%] object-contain drop-shadow-[0_10px_16px_rgb(0_0_0/0.22)]"
        />
      ) : (
        <BottleGlyph
          shape={shapeFor(wine.type)}
          tint={wine.type}
          mark={labelMark(wine.producer, wine.wineName)}
          year={formatVintage(wine.year)}
          labelUrl={textured ? imageUrl(wine.image!.id, "texture") : undefined}
          className={cn("relative h-full w-auto", print && "-translate-x-[30%]")}
        />
      )}
      {print && (
        <span className="absolute bottom-[4%] right-[-4%] w-[46%] rotate-[4deg] rounded-[5px] bg-[#f4eee2] p-[3px] shadow-raised ring-1 ring-black/5">
          <LabelImage
            image={print}
            size="thumb"
            alt={printAlt ?? ""}
            className="aspect-[4/5] w-full rounded-[3px]"
          />
        </span>
      )}
    </div>
  );
}

/**
 * A wine's name in the display face, sized by how long it is so a short name has presence and a long one still
 * reads in two or three lines. Never cut off: it wraps, between words where it can.
 */
export function nameSize(name: string, scale: "sheet" | "page" = "sheet"): string {
  const n = name.length;
  if (scale === "page") {
    if (n <= 16) return "text-[3rem] leading-[1.02]";
    if (n <= 30) return "text-[2.5rem] leading-[1.04]";
    return "text-[2.125rem] leading-[1.06]";
  }
  if (n <= 14) return "text-[2.25rem] leading-[1.04]";
  if (n <= 28) return "text-[1.875rem] leading-[1.06]";
  return "text-[1.625rem] leading-[1.08]";
}

/**
 * Where in its place a bottle lies, drawn: one dot per spot, the bottle's own lit. For places too big to read as
 * dots it draws nothing (the words beside it say the same).
 */
export function SlotMap({
  rows,
  cols,
  row,
  col,
  className,
}: {
  rows: number;
  cols: number;
  row: number;
  col: number;
  className?: string;
}) {
  if (rows > 12 || cols > 12) return null;
  return (
    <span
      aria-hidden="true"
      data-testid="slot-map"
      className={cn("grid shrink-0 gap-[3px]", className)}
      style={{ gridTemplateColumns: `repeat(${cols}, 5px)` }}
    >
      {Array.from({ length: rows * cols }, (_, i) => {
        const here = Math.floor(i / cols) + 1 === row && (i % cols) + 1 === col;
        return (
          <span
            key={i}
            className={cn(
              "size-[5px] rounded-full",
              here ? "scale-[1.6] bg-accent-fg" : "bg-ink/15",
            )}
          />
        );
      })}
    </span>
  );
}
