import type { WineType } from "@cellr/domain";
import { STAGE } from "@/features/cellar/wine-card";
import { labelMark, shapeFor } from "@/features/cellar/wine-visuals";
import { BottleGlyph } from "@/ui/bottle-glyph";
import { cn } from "@/ui/cn";

/** A small tinted stage with the wine's bottle on it: the thumbnail for rows that have no photo to show. */
export function StageThumb({
  type,
  producer,
  wineName,
  className,
}: {
  type: WineType;
  producer: string;
  wineName: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative flex shrink-0 items-end justify-center overflow-hidden rounded-[16px]",
        STAGE[type],
        className,
      )}
    >
      <span className="absolute -bottom-6 left-1/2 size-20 -translate-x-1/2 rounded-full bg-surface/45" />
      <BottleGlyph
        shape={shapeFor(type)}
        tint={type}
        mark={labelMark(producer, wineName)}
        className="relative mb-1 w-7"
      />
    </span>
  );
}
