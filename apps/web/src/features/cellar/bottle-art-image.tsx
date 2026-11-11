"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { bottleArtUrl, type BottleArtRef } from "@cellr/domain";
import { cn } from "@/ui/cn";

/** Where the bottle is in its picture, as fractions of the picture (left, top, width, height). */
interface Box {
  l: number;
  t: number;
  w: number;
  h: number;
}

/** Measured once per picture and remembered (this tab, and this browser where it can keep it). */
const boxes = new Map<string, Box | null>();
const STORE = "cellr-art-box:";
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

function remembered(id: string): Box | null | undefined {
  if (boxes.has(id)) return boxes.get(id);
  try {
    const raw = localStorage.getItem(STORE + id);
    if (raw === null) return undefined;
    const box = JSON.parse(raw) as Box | null;
    boxes.set(id, box);
    return box;
  } catch {
    return undefined;
  }
}

function remember(id: string, box: Box | null) {
  boxes.set(id, box);
  listeners.forEach((l) => l());
  try {
    localStorage.setItem(STORE + id, JSON.stringify(box));
  } catch {
    // private mode or full: measuring again next time is fine
  }
}

/**
 * The bottle's own outline in a finished 2D picture: the box around every pixel that is not (nearly) transparent,
 * measured on a small copy. Null when there is no empty border worth cutting (or the picture cannot be read).
 */
export function measureBottle(img: HTMLImageElement): Box | null {
  const { naturalWidth: nw, naturalHeight: nh } = img;
  if (!nw || !nh) return null;
  const scale = Math.min(1, 160 / Math.max(nw, nh));
  const w = Math.max(1, Math.round(nw * scale));
  const h = Math.max(1, Math.round(nh * scale));
  try {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    let minX = w;
    let minY = h;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (data[(y * w + x) * 4 + 3]! > 24) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
    if (maxX < 0) return null;
    // one pixel of air around the bottle, so its edge and shadow are never cut
    minX = Math.max(0, minX - 1);
    minY = Math.max(0, minY - 1);
    maxX = Math.min(w - 1, maxX + 1);
    maxY = Math.min(h - 1, maxY + 1);
    const box = { l: minX / w, t: minY / h, w: (maxX - minX + 1) / w, h: (maxY - minY + 1) / h };
    return box.w > 0.94 && box.h > 0.94 ? null : box;
  } catch {
    return null;
  }
}

/**
 * A finished 2D bottle picture, cut to the bottle itself: pictures often come with a wide transparent border, which
 * would leave the bottle small in a card. The border is found once in the browser (the picture is same-origin), so
 * pictures already in the library benefit too. Until then, and for a picture without a border, it is shown whole.
 */
export function BottleArtImage({
  art,
  alt,
  className,
  contain = false,
}: {
  art: BottleArtRef;
  alt: string;
  className?: string;
  /**
   * Fill a frame instead of a height: the bottle as large as fits in its nearest size container (an element with
   * `container-type: size`), never stretched, never cut. The whole picture until the bottle's outline is known.
   */
  contain?: boolean;
}) {
  // the server (and the first paint) shows the whole picture; the browser then knows, or measures, the bottle's box
  const box = useSyncExternalStore(
    subscribe,
    () => remembered(art.id),
    () => undefined,
  );
  const ref = useRef<HTMLImageElement | null>(null);
  const measure = (img: HTMLImageElement | null) => {
    if (img && img.complete && img.naturalWidth && remembered(art.id) === undefined)
      remember(art.id, measureBottle(img));
  };
  // a picture that was already loaded (from the cache) before the page came alive fires no load event
  useEffect(() => measure(ref.current));
  const onLoad = () => measure(ref.current);
  const img = (style?: React.CSSProperties) => (
    // eslint-disable-next-line @next/next/no-img-element -- a private, same-origin picture: the optimiser cannot fetch it
    <img
      ref={ref}
      src={bottleArtUrl(art.id)}
      alt={alt}
      width={art.width}
      height={art.height}
      loading="lazy"
      decoding="async"
      draggable={false}
      onLoad={onLoad}
      style={style}
      className={style ? "absolute max-w-none" : cn("object-contain", className)}
    />
  );
  if (contain) {
    // the bottle's own proportions (the whole picture's until measured), fitted into the frame both ways
    const b = box ?? { l: 0, t: 0, w: 1, h: 1 };
    const ratio = (b.w * art.width) / (b.h * art.height);
    return (
      <span
        data-art-cropped={box ? "true" : undefined}
        className={cn("block", className)}
        style={{
          aspectRatio: `${b.w * art.width} / ${b.h * art.height}`,
          width: `min(100cqw, calc(100cqh * ${ratio.toFixed(5)}))`,
        }}
      >
        <span className="relative block size-full overflow-hidden">
          {img({
            width: `${100 / b.w}%`,
            height: `${100 / b.h}%`,
            left: `${(-b.l / b.w) * 100}%`,
            top: `${(-b.t / b.h) * 100}%`,
          })}
        </span>
      </span>
    );
  }
  if (!box) return img();
  return (
    <span
      data-art-cropped="true"
      className={cn("block", className, "max-w-none")}
      style={{ aspectRatio: `${box.w * art.width} / ${box.h * art.height}` }}
    >
      <span className="relative block size-full overflow-hidden">
        {img({
          width: `${100 / box.w}%`,
          height: `${100 / box.h}%`,
          left: `${(-box.l / box.w) * 100}%`,
          top: `${(-box.t / box.h) * 100}%`,
        })}
      </span>
    </span>
  );
}
