"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { DEFAULT_QUAD, isUsableQuad, type Point, type Quad } from "@cellr/domain";
import { Button } from "@/ui/button";
import { Sheet } from "@/ui/sheet";
import {
  MAX_ZOOM,
  panView,
  pinchView,
  toBox,
  toPhoto,
  WHOLE_PHOTO,
  zoomAt,
  type FramerView,
} from "./framer-zoom";

const CORNERS = ["tl", "tr", "br", "bl"] as const;
/** How close (px on screen) a finger must land to pick up a corner. */
const GRAB = 30;

type Gesture =
  | { kind: "corner"; index: number; id: number; from: Point }
  | { kind: "pan"; id: number; at: Point; view: FramerView }
  | { kind: "pinch"; start: { view: FramerView; distance: number; mid: Point } };

const gap = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const middle = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/**
 * "Show us where the label is": the photo with four corners to drag onto the label's own corners. What lies
 * between them is straightened and wrapped round the 3D bottle. Every corner can also be moved with the arrow
 * keys, and the whole photo is always an option.
 *
 * Pinch (or the + / − buttons) to zoom in for precise corners; one finger pans the zoomed photo, unless it lands
 * on a corner, which it then drags. A second finger always means zoom: a corner being dragged goes back to where
 * it was. Zoom only changes the view: corners are kept as fractions of the photo itself, so the crop is the same
 * at any zoom.
 */
export function LabelFramer({
  open,
  onClose,
  photo,
  initial,
  busy,
  onConfirm,
  onSkip,
}: {
  open: boolean;
  onClose: () => void;
  photo: Blob;
  /** Where the AI thinks the label is; the default frame when it has no idea. */
  initial: Quad | null;
  busy: boolean;
  onConfirm: (quad: Quad) => void;
  onSkip: () => void;
}) {
  const t = useTranslations("framer");
  const tc = useTranslations("common");
  const [quad, setQuad] = useState<Quad>(initial ?? DEFAULT_QUAD);
  const [url, setUrl] = useState<string | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const [view, setView] = useState<FramerView>(WHOLE_PHOTO);
  const [showError, setShowError] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture | null>(null);

  useEffect(() => {
    const made = URL.createObjectURL(photo);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- an object URL must be made and revoked with the component
    setUrl(made);
    return () => URL.revokeObjectURL(made);
  }, [photo]);

  // The box the photo is shown in (unzoomed px): what every zoom and corner is worked out against.
  useEffect(() => {
    const el = frame.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const seen = new ResizeObserver(() => {
      if (el.clientWidth > 0 && el.clientHeight > 0) {
        setBox({ w: el.clientWidth, h: el.clientHeight });
        setView(WHOLE_PHOTO);
      }
    });
    seen.observe(el);
    return () => seen.disconnect();
  }, [url]);

  const move = (index: number, point: Point) =>
    setQuad((q) => q.map((p, i) => (i === index ? point : p)) as Quad);

  /** Where a pointer is, in box px. */
  const local = (event: PointerEvent): Point => {
    const rect = frame.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const onDown = (event: PointerEvent) => {
    if (!box) return;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // a synthetic or already-gone pointer: the gesture still works without capture
    }
    const at = local(event);
    pointers.current.set(event.pointerId, at);
    setShowError(false);
    const g = gesture.current;
    if (pointers.current.size === 2) {
      // Two fingers: zoom. A corner picked up by the first finger goes back where it was.
      if (g?.kind === "corner") move(g.index, g.from);
      const [a, b] = [...pointers.current.values()] as [Point, Point];
      gesture.current = { kind: "pinch", start: { view, distance: gap(a, b), mid: middle(a, b) } };
      return;
    }
    if (pointers.current.size > 2) return;
    const nearest = quad
      .map((p, index) => ({ index, d: gap(toBox(p, view, box.w, box.h), at) }))
      .sort((a, b) => a.d - b.d)[0]!;
    if (nearest.d <= GRAB) {
      gesture.current = {
        kind: "corner",
        index: nearest.index,
        id: event.pointerId,
        from: quad[nearest.index]!,
      };
      move(nearest.index, toPhoto(at, view, box.w, box.h));
    } else if (view.scale > 1) {
      gesture.current = { kind: "pan", id: event.pointerId, at, view };
    } else gesture.current = null;
  };

  const onMove = (event: PointerEvent) => {
    if (!box || !pointers.current.has(event.pointerId)) return;
    const at = local(event);
    pointers.current.set(event.pointerId, at);
    const g = gesture.current;
    if (g?.kind === "corner" && g.id === event.pointerId)
      move(g.index, toPhoto(at, view, box.w, box.h));
    else if (g?.kind === "pan" && g.id === event.pointerId)
      setView(panView(g.view, at.x - g.at.x, at.y - g.at.y, box.w, box.h));
    else if (g?.kind === "pinch" && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()] as [Point, Point];
      setView(pinchView(g.start, gap(a, b), middle(a, b), box.w, box.h));
    }
  };

  const onUp = (event: PointerEvent) => {
    pointers.current.delete(event.pointerId);
    const g = gesture.current;
    const left = [...pointers.current.entries()][0];
    // From a pinch, the finger still down carries on panning; anything else simply ends.
    gesture.current =
      g?.kind === "pinch" && left && view.scale > 1
        ? { kind: "pan", id: left[0], at: left[1], view }
        : null;
  };

  const zoomBy = (factor: number) =>
    box && setView(zoomAt(view, view.scale * factor, { x: box.w / 2, y: box.h / 2 }, box.w, box.h));

  const onKey = (index: number, event: KeyboardEvent) => {
    const step = event.shiftKey ? 0.05 : 0.01;
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const d = delta[event.key];
    if (!d) return;
    event.preventDefault();
    const p = quad[index]!;
    move(index, {
      x: Math.min(1, Math.max(0, p.x + d[0])),
      y: Math.min(1, Math.max(0, p.y + d[1])),
    });
  };

  const points = quad.map((p) => `${p.x},${p.y}`).join(" ");
  const usable = size ? isUsableQuad(quad, size.w, size.h) : false;
  const zoomed = view.scale > 1.001;

  return (
    <Sheet open={open} onClose={onClose} title={t("title")} closeLabel={tc("close")}>
      {open && (
        <div className="flex flex-col gap-5">
          <p className="text-body text-ink-2">{t("body")}</p>
          <div className="flex flex-col items-center gap-2">
            <div
              ref={frame}
              data-testid="framer"
              data-zoom={view.scale.toFixed(2)}
              className="relative inline-block max-w-full touch-none select-none overflow-hidden rounded-control"
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
            >
              {/* The photo and its frame zoom together; the corner handles stay finger-sized on top. */}
              <div
                className="relative origin-top-left"
                style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
              >
                {url && (
                  // eslint-disable-next-line @next/next/no-img-element -- a local preview of the photo being framed
                  <img
                    src={url}
                    alt={t("photoAlt")}
                    draggable={false}
                    onLoad={(e) =>
                      setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
                    }
                    className="block max-h-[52vh] w-auto max-w-full"
                  />
                )}
                <svg
                  viewBox="0 0 1 1"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 size-full"
                >
                  {/* A dark line under a light one: visible on any photo, light or dark. */}
                  <polygon
                    points={points}
                    fill="rgba(255,255,255,0.12)"
                    style={{ stroke: "rgba(0,0,0,0.65)", strokeWidth: 5 }}
                    vectorEffect="non-scaling-stroke"
                  />
                  <polygon
                    points={points}
                    fill="none"
                    style={{ stroke: "#fff", strokeWidth: 2.5 }}
                    vectorEffect="non-scaling-stroke"
                  />
                </svg>
              </div>
              {box &&
                quad.map((p, i) => {
                  const at = toBox(p, view, box.w, box.h);
                  return (
                    <button
                      key={CORNERS[i]}
                      type="button"
                      aria-label={t(`corner.${CORNERS[i]!}`)}
                      data-testid={`corner-${CORNERS[i]}`}
                      data-at={`${p.x.toFixed(4)},${p.y.toFixed(4)}`}
                      // Fingers and the mouse are handled by the photo (so a corner and a pinch never fight);
                      // the button is there for focus and the arrow keys.
                      className="pointer-events-none absolute grid size-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full focus-visible:outline-none [&:focus-visible>span]:ring-4"
                      style={{ left: at.x, top: at.y }}
                      onKeyDown={(e) => onKey(i, e)}
                    >
                      <span className="size-5 rounded-full border-2 border-white bg-accent shadow-raised ring-2 ring-accent-fg/40" />
                    </button>
                  );
                })}
            </div>
            <div className="flex items-center gap-2" role="group" aria-label={t("zoomLabel")}>
              <Button
                variant="secondary"
                size="sm"
                aria-label={t("zoomOut")}
                disabled={!zoomed}
                onClick={() => zoomBy(1 / 1.5)}
              >
                −
              </Button>
              <Button
                variant="secondary"
                size="sm"
                aria-label={t("zoomIn")}
                disabled={view.scale >= MAX_ZOOM}
                onClick={() => zoomBy(1.5)}
              >
                +
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={!zoomed}
                onClick={() => setView(WHOLE_PHOTO)}
              >
                {t("zoomReset")}
              </Button>
            </div>
            <p className="text-caption text-ink-2">{t("zoomHint")}</p>
          </div>
          {showError && !usable && (
            <p role="alert" className="text-small text-danger">
              {t("unusable")}
            </p>
          )}
          <div className="flex flex-col gap-2">
            <Button
              size="lg"
              block
              loading={busy}
              onClick={() => (usable ? onConfirm(quad) : setShowError(true))}
            >
              {t("use")}
            </Button>
            <Button variant="secondary" size="lg" block disabled={busy} onClick={onSkip}>
              {t("skip")}
            </Button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
