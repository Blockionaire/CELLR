import type { ImageRef } from "@cellr/domain";
import { cn } from "@/ui/cn";

/** The address of a photo: the server checks the person is allowed to see it, and the browser keeps it. */
export const imageUrl = (id: string, size: "thumb" | "photo") =>
  `/api/v1/images/${id}?size=${size}`;

/**
 * A label photo. Until it has loaded, the box shows the picture's own average colour, so a grid of them
 * settles in instead of popping.
 */
export function LabelImage({
  image,
  size,
  alt = "",
  className,
}: {
  image: ImageRef;
  size: "thumb" | "photo";
  /** Empty for decoration (the wine's name is already on screen); a sentence when the photo is the content. */
  alt?: string;
  className?: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a private, same-origin photo: the optimiser cannot fetch it
    <img
      src={imageUrl(image.id, size)}
      alt={alt}
      width={image.width ?? undefined}
      height={image.height ?? undefined}
      loading="lazy"
      decoding="async"
      draggable={false}
      style={image.blurColor ? { backgroundColor: image.blurColor } : undefined}
      className={cn("object-cover", className)}
    />
  );
}
