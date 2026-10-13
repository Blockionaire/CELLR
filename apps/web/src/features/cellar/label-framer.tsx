"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { DEFAULT_QUAD, isUsableQuad, type Point, type Quad } from "@cellr/domain";
import { Button } from "@/ui/button";
import { Sheet } from "@/ui/sheet";

const CORNERS = ["tl", "tr", "br", "bl"] as const;

/**
 * "Show us where the label is": the photo with four corners to drag onto the label's own corners. What lies
 * between them is straightened and wrapped round the 3D bottle. Every corner can also be moved with the arrow
 * keys, and the whole photo is always an option.
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
  const [showError, setShowError] = useState(false);
  const frame = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const made = URL.createObjectURL(photo);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- an object URL must be made and revoked with the component
    setUrl(made);
    return () => URL.revokeObjectURL(made);
  }, [photo]);

  const move = (index: number, point: Point) =>
    setQuad((q) => q.map((p, i) => (i === index ? point : p)) as Quad);

  const fromPointer = (event: PointerEvent): Point | null => {
    const rect = frame.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    };
  };

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

  return (
    <Sheet open={open} onClose={onClose} title={t("title")} closeLabel={tc("close")}>
      {open && (
        <div className="flex flex-col gap-5">
          <p className="text-body text-ink-2">{t("body")}</p>
          <div className="flex justify-center">
            <div ref={frame} className="relative inline-block max-w-full touch-none select-none">
              {url && (
                // eslint-disable-next-line @next/next/no-img-element -- a local preview of the photo being framed
                <img
                  src={url}
                  alt={t("photoAlt")}
                  draggable={false}
                  onLoad={(e) =>
                    setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
                  }
                  className="block max-h-[52vh] w-auto max-w-full rounded-control"
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
              {quad.map((p, i) => (
                <button
                  key={CORNERS[i]}
                  type="button"
                  aria-label={t(`corner.${CORNERS[i]!}`)}
                  data-testid={`corner-${CORNERS[i]}`}
                  className="absolute grid size-11 -translate-x-1/2 -translate-y-1/2 touch-none place-items-center rounded-full focus-visible:outline-none"
                  style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
                  onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId);
                    setShowError(false);
                  }}
                  onPointerMove={(e) => {
                    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
                    const point = fromPointer(e);
                    if (point) move(i, point);
                  }}
                  onKeyDown={(e) => onKey(i, e)}
                >
                  <span className="size-5 rounded-full border-2 border-white bg-accent shadow-raised ring-2 ring-accent-fg/40" />
                </button>
              ))}
            </div>
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
