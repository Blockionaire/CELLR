"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";
import { cn } from "./cn";
import { CloseIcon } from "./icons";

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string | undefined;
  children: ReactNode;
  closeLabel?: string;
}

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Bottom sheet on phones, centred dialog on larger screens.
 * Built on the native <dialog>: focus trap, Escape, inert background and top-layer stacking come from
 * the browser, and nothing is injected into <head> (which our strict nonce-based CSP would block).
 * Drag the handle down to dismiss.
 */
export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  closeLabel = "Close",
}: SheetProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();
  const [closing, setClosing] = useState(false);
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ startY: number; startT: number } | null>(null);

  // Open / close the native dialog in step with the `open` prop.
  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) {
      setClosing(false);
      setDragY(0);
      el.showModal();
    } else if (!open && el.open) {
      el.close();
    }
  }, [open]);

  // Lock page scroll while open (a class, not injected CSS).
  useEffect(() => {
    if (!open) return;
    document.documentElement.classList.add("overflow-hidden");
    return () => document.documentElement.classList.remove("overflow-hidden");
  }, [open]);

  const requestClose = useCallback(() => {
    if (closing) return;
    setClosing(true);
    window.setTimeout(onClose, prefersReducedMotion() ? 0 : 160);
  }, [closing, onClose]);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    drag.current = { startY: e.clientY, startT: e.timeStamp };
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current) setDragY(Math.max(0, e.clientY - drag.current.startY));
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    setDragging(false);
    if (!d) return;
    const distance = e.clientY - d.startY;
    const velocity = distance / Math.max(1, e.timeStamp - d.startT);
    if (distance > 120 || velocity > 0.6) requestClose();
    else setDragY(0);
  };

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      // Escape / native close → keep React state in sync (cancel fires first; we animate out ourselves).
      onCancel={(e) => {
        e.preventDefault();
        requestClose();
      }}
      onClose={() => {
        if (open) onClose();
      }}
      onClick={(e) => {
        if (e.target === dialog.current) requestClose();
      }}
      data-closing={closing || undefined}
      className={cn(
        "m-0 mt-auto w-full max-w-none overflow-visible border-0 bg-transparent p-0 text-ink",
        "md:m-auto md:max-w-md",
        "backdrop:bg-black/55",
      )}
    >
      <div
        style={{
          transform: dragY ? `translateY(${dragY}px)` : undefined,
          transition: dragging ? "none" : undefined,
        }}
        className={cn(
          "sheet-panel flex max-h-[88dvh] flex-col rounded-t-sheet bg-surface shadow-raised md:rounded-sheet",
          "pb-[max(1.25rem,env(safe-area-inset-bottom))]",
        )}
      >
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="flex shrink-0 cursor-grab touch-none flex-col items-center pt-3 md:hidden"
          aria-hidden="true"
        >
          <span
            className="h-1 w-10 rounded-full bg-hairline"
            style={{ backgroundColor: "color-mix(in srgb, var(--ink) 22%, transparent)" }}
          />
        </div>
        <div className="flex items-start justify-between gap-4 px-5 pb-2 pt-4 md:pt-6">
          <div>
            <h2 id={titleId} className="font-display text-headline">
              {title}
            </h2>
            {description && (
              <p id={descId} className="mt-1 text-small text-ink-2">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={requestClose}
            aria-label={closeLabel}
            className="-mr-2 grid size-10 shrink-0 place-items-center rounded-control text-ink-2 hover:bg-raised hover:text-ink"
          >
            <CloseIcon size={20} />
          </button>
        </div>
        <div className="overflow-y-auto px-5 pb-2">{children}</div>
      </div>
    </dialog>
  );
}
