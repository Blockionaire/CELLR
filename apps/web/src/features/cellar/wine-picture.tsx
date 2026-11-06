import { ViewTransition } from "react";
import {
  bottleArtUrl,
  formatVintage,
  type BottleArtRef,
  type ImageRef,
  type WineType,
} from "@cellr/domain";
import { BottleGlyph } from "@/ui/bottle-glyph";
import { cn } from "@/ui/cn";
import { LabelImage } from "./label-image";
import { labelMark, shapeFor, STAGE } from "./wine-visuals";

/**
 * Behind a finished 2D bottle picture: a neutral field (light on paper, dark on noir) with a soft light from above and
 * a shadow at the foot, so any bottle, light or dark glass, stands out the same way. Not the wine-type tint: the
 * picture has its own colours.
 */
const ART_STAGE =
  "bg-[radial-gradient(ellipse_90%_75%_at_50%_32%,var(--art-stage-hi)_0%,var(--art-stage-lo)_100%)]";

export interface PictureWine {
  vintageId: string;
  type: WineType;
  producer: string;
  wineName: string;
  year: number | null;
  image: ImageRef | null;
  /** The library's published 2D bottle picture of this wine, when there is one. */
  art?: BottleArtRef | null | undefined;
}

/** The name a wine's picture carries from a card into its page, so the two read as one object moving. */
export const pictureTransition = (vintageId: string) => `wine-${vintageId}`;

/**
 * The picture of a wine: the library's finished 2D bottle picture when the wine has one, else the person's own label
 * photo, otherwise the drawn bottle on its tinted stage with the year faint behind it. Decorative (the name is always
 * written beside it).
 *
 * `shared` gives it the cross-page name, for the one place on a screen the wine is the way into its page.
 */
export function WinePicture({
  wine,
  size = "thumb",
  shared = false,
  year = false,
  alt,
  className,
  bottleClassName,
  artClassName,
}: {
  wine: PictureWine;
  size?: "thumb" | "photo";
  shared?: boolean;
  /** Show the vintage, big and faint, behind a drawn bottle. */
  year?: boolean;
  /** When the photo is the content (the wine's own page): what it shows. Otherwise it is decoration. */
  alt?: string;
  className?: string;
  /** Sizes the drawn bottle, and the 2D picture unless artClassName is given. */
  bottleClassName?: string;
  /** Sizes the 2D picture only (it fills its frame differently from the drawn bottle). */
  artClassName?: string;
}) {
  const vintage = formatVintage(wine.year);
  const art = wine.art ?? null;
  const picture = (
    <div
      aria-hidden={alt && (art || wine.image) ? undefined : true}
      data-photo={!art && wine.image ? "true" : undefined}
      data-art={art ? "true" : undefined}
      className={cn(
        "relative isolate flex items-end justify-center overflow-hidden",
        art ? ART_STAGE : STAGE[wine.type],
        className,
      )}
    >
      {art ? (
        <>
          {/* the bottle's shadow on the floor */}
          <span className="absolute bottom-[5%] left-1/2 h-[7%] w-[62%] -translate-x-1/2 rounded-[50%] bg-black/25 blur-[6px]" />
          {/* eslint-disable-next-line @next/next/no-img-element -- a private, same-origin picture: the optimiser cannot fetch it */}
          <img
            src={bottleArtUrl(art.id)}
            alt={alt ?? ""}
            width={art.width}
            height={art.height}
            loading="lazy"
            decoding="async"
            draggable={false}
            className={cn(
              "relative mb-[6%] h-[88%] w-auto max-w-[92%] object-contain drop-shadow-[0_6px_10px_rgb(0_0_0/0.22)]",
              bottleClassName,
              artClassName,
            )}
          />
        </>
      ) : wine.image ? (
        <>
          <LabelImage
            image={wine.image}
            size={size}
            alt={alt ?? ""}
            className="absolute inset-0 size-full"
          />
          {/* a breath of shade at the foot, so pills and counts on top stay legible on a bright label */}
          <span className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-linear-to-t from-black/25 to-transparent" />
        </>
      ) : (
        <>
          {year && (
            <span
              data-year={vintage}
              className="pointer-events-none absolute inset-x-0 top-[7%] select-none text-center font-display text-[length:var(--year-size,7rem)] leading-none text-ink/[0.07] before:content-[attr(data-year)]"
            />
          )}
          <span className="absolute -bottom-[18%] left-1/2 aspect-square w-[78%] -translate-x-1/2 rounded-full bg-surface/45" />
          <BottleGlyph
            shape={shapeFor(wine.type)}
            tint={wine.type}
            mark={labelMark(wine.producer, wine.wineName)}
            year={vintage}
            className={cn("relative mb-[6%] h-[78%] w-auto", bottleClassName)}
          />
        </>
      )}
    </div>
  );
  return shared ? (
    // Only the move between pages animates; a refresh of the same page must not (it would cover the buttons).
    <ViewTransition
      name={pictureTransition(wine.vintageId)}
      share="wine-morph"
      update="none"
      enter="none"
      exit="none"
    >
      {picture}
    </ViewTransition>
  ) : (
    picture
  );
}
