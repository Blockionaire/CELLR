"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { bottleArtUrl, type BottleArtRef } from "@cellr/domain";
import { cn } from "@/ui/cn";
import { clearFaintAndMeasure, cornersOpaque } from "./hero-art-pixels";

/**
 * The hero's bottle, prepared once per picture per visit: the library's picture is decoded, scaled to the hero's
 * size, every pixel the bottle's outline does not count (alpha at or below ALPHA_FLOOR, the same rule as the outline
 * measure) made truly transparent, and cut to the bottle. That derivative (a PNG with its alpha) lives in this tab's
 * memory only, never in storage: a household's picture is still asked of the server on every new visit, as its
 * no-store rule wants, but going from Home to the cellar and back shows it at once, without a second request,
 * decode or entrance.
 *
 * A picture whose background is not transparent at all (an opaque studio background) cannot be made to float
 * without cutting the bottle out of it, which this does not attempt: it is not shown in the hero (no rectangle).
 */

/** The tallest the derivative is made (a ~200px frame at 3× is 600 device pixels). */
const MAX_HEIGHT = 640;

type Prepared = { url: string; width: number; height: number } | "unusable";

const prepared = new Map<string, Prepared>();
const pending = new Map<string, Promise<void>>();
/** Pictures that have already made their entrance in this tab: they never make it again. */
const entered = new Set<string>();
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const settle = (id: string, value: Prepared) => {
  prepared.set(id, value);
  listeners.forEach((l) => l());
};

/**
 * Decodes, cleans and cuts one picture (see above). Runs once per picture per tab, however often Home is shown.
 * `source` is the page's own <img> of it, already asked for with the page: its bytes are used, never asked again.
 */
export function prepareHeroArt(art: BottleArtRef, source?: HTMLImageElement | null): Promise<void> {
  const known = pending.get(art.id);
  if (known) return known;
  const run = (async () => {
    const img = source ?? new Image();
    if (!source) img.src = bottleArtUrl(art.id);
    // loaded is enough to draw it: no decode() (WebKit may ask a picture that may not be stored for its bytes again)
    if (!img.complete || img.naturalWidth === 0)
      await new Promise<void>((resolve, reject) => {
        img.addEventListener("load", () => resolve(), { once: true });
        img.addEventListener("error", () => reject(new Error("unreadable")), { once: true });
      });
    const scale = Math.min(1, MAX_HEIGHT / img.naturalHeight);
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("no canvas");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, w, h);
    const frame = ctx.getImageData(0, 0, w, h);
    const px = frame.data;
    if (cornersOpaque(px, w, h)) return settle(art.id, "unusable");
    // what the outline does not count is not drawn either: no faint veil, no box of shadow around it
    const box = clearFaintAndMeasure(px, w, h);
    if (!box) return settle(art.id, "unusable");
    const { x: minX, y: minY, w: cw, h: ch } = box;
    const out = document.createElement("canvas");
    out.width = cw;
    out.height = ch;
    out.getContext("2d")!.putImageData(frame, -minX, -minY, minX, minY, cw, ch);
    const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("no png");
    const url = URL.createObjectURL(blob);
    // decoded before it is shown, so it appears in one frame at its final size
    const ready = new Image();
    ready.src = url;
    await ready.decode().catch(() => undefined);
    settle(art.id, { url, width: cw, height: ch });
  })().catch(() => {
    // unreadable now (offline, taken away): nothing is shown, and a later visit may try again
    pending.delete(art.id);
  });
  pending.set(art.id, run);
  return run;
}

/**
 * The bottle for the hero, with its floor shadow, inside a frame that is a size container (the server sets its
 * size, so nothing moves when the picture arrives): nothing until the picture is ready, then the bottle in one frame,
 * fading in only the first time this tab shows it.
 */
export function HeroArt({
  art,
  wideOnly = false,
}: {
  art: BottleArtRef;
  /** Shown on wide screens only: not fetched on a phone. */
  wideOnly?: boolean;
}) {
  const ready = useSyncExternalStore(
    subscribe,
    () => prepared.get(art.id),
    () => undefined,
  );
  // entered before this mount (Home seen already in this tab): straight in, no entrance
  const [enter] = useState(() => !entered.has(art.id));
  const source = useRef<HTMLImageElement>(null);
  useEffect(() => {
    if (prepared.has(art.id)) return;
    if (wideOnly && !window.matchMedia("(min-width: 48rem)").matches) return;
    void prepareHeroArt(art, source.current);
  }, [art, wideOnly]);
  useEffect(() => {
    if (ready && ready !== "unusable") entered.add(art.id);
  }, [ready, art.id]);
  if (ready === "unusable") return null;
  if (!ready)
    // Not ready yet (a new visit): the picture itself, asked for with the page, ahead of other pictures (eager, high
    // priority), but not shown: it is the source of the clean bottle, not what is drawn. A wide-only bottle waits.
    return wideOnly ? null : (
      // in a <picture>: React then adds no <link rel="preload"> of its own (WebKit would not reuse it for a picture that
      // may not be stored: a second download)
      <picture>
        <img
          ref={source}
          src={bottleArtUrl(art.id)}
          alt=""
          aria-hidden="true"
          // A shared (catalogue) picture may be kept, so the browser's early look-ahead download is the one used:
          // eager. A household's own picture may not be stored (no-store), and WebKit does not reuse that early
          // download for it but asks again (measured: two downloads): it starts as soon as the bottle's place is laid
          // out instead, once. Both at high priority.
          loading={art.shared ? "eager" : "lazy"}
          fetchPriority="high"
          decoding="async"
          data-testid="hero-art-source"
          className="pointer-events-none absolute size-px opacity-0"
        />
      </picture>
    );
  const ratio = ready.width / ready.height;
  return (
    <>
      {/* its shadow on the floor: a dark contact shadow under a wider, softer one */}
      <span
        className={cn(
          "absolute bottom-0.5 left-1/2 h-3 w-[70%] -translate-x-1/2 rounded-[50%] bg-black/35 blur-[6px]",
          enter && "hero-art-in",
        )}
      />
      <span
        className={cn(
          "absolute bottom-1 left-1/2 h-1.5 w-[40%] -translate-x-1/2 rounded-[50%] bg-black/55 blur-[3px]",
          enter && "hero-art-in",
        )}
      />
      {/* eslint-disable-next-line @next/next/no-img-element -- a picture made here, in this tab (a blob) */}
      <img
        src={ready.url}
        alt=""
        width={ready.width}
        height={ready.height}
        draggable={false}
        data-testid="hero-art"
        data-art-id={art.id}
        className={cn(
          "relative block max-w-none drop-shadow-[0_12px_16px_rgb(0_0_0/0.45)]",
          enter && "hero-art-in",
        )}
        style={{
          aspectRatio: `${ready.width} / ${ready.height}`,
          width: `min(100cqw, calc(100cqh * ${ratio.toFixed(5)}))`,
          height: "auto",
        }}
      />
    </>
  );
}
