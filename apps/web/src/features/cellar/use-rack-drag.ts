"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { PlacedBottle } from "@cellr/domain";

/** How long a bottle is pressed before it lifts out of its spot. */
export const LONG_PRESS_MS = 350;
/** A finger that travels further than this before the bottle lifts is scrolling the page: no drag. */
const SLOP_PX = 8;
/** Near the top or the bottom (above the tab bar) of the screen, the page scrolls along with the bottle. */
const EDGE_TOP_PX = 72;
const EDGE_BOTTOM_PX = 128;
const MAX_SCROLL_PX = 14;
/** The lifted bottle hangs this far above the finger, so the finger never hides it (see DragGhost). */
export const GHOST_LIFT_PX = 52;

/** A spot under the finger: which place and spot (from `data-slot`), and the bottle standing there, if any. */
export interface DropTarget {
  slotKey: string;
  row: number;
  col: number;
  bottleId: string | null;
}

interface Session {
  pointerId: number;
  bottle: PlacedBottle;
  el: HTMLElement;
  x0: number;
  y0: number;
  x: number;
  y: number;
  active: boolean;
  timer: number;
  frame: number;
  overKey: string | null;
  over: DropTarget | null;
}

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Press and hold a bottle in the racks to lift it, drag it over any spot of any open place, let go to put it there.
 * Built on pointer events, not the browser's drag and drop (which phones do not offer for this):
 * - before the bottle lifts, a finger that moves is a scroll and nothing happens; a quick tap stays a tap;
 * - once lifted, the page no longer scrolls under the finger (except near the top and bottom edges, where it scrolls
 *   on purpose), the bottle follows the finger as a light "ghost" moved directly (no re-render per movement), and the
 *   spot under it is looked up only when it changes;
 * - letting go over a spot hands it to `onDrop`; anywhere else, on its own spot, a second finger, a cancelled touch or
 *   Escape put it back without writing anything.
 */
export function useRackDrag(options: {
  disabled: boolean;
  onDrop: (bottle: PlacedBottle, target: DropTarget) => void;
}) {
  const [drag, setDrag] = useState<{ bottle: PlacedBottle; over: DropTarget | null } | null>(null);
  const ghost = useRef<HTMLDivElement | null>(null);
  const session = useRef<Session | null>(null);
  const quietUntil = useRef(0);
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });

  const [api] = useState(() => {
    const placeGhost = (x: number, y: number) => {
      if (ghost.current) ghost.current.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    };

    const hitTest = (s: Session) => {
      // through anything floating over the racks (the Undo toast of the last move, the tab bar's shadow)
      const el = document
        .elementsFromPoint(s.x, s.y)
        .find((e): e is HTMLElement => e instanceof HTMLElement && e.dataset.slot !== undefined);
      let over: DropTarget | null = null;
      if (el?.dataset.slot) {
        const [slotKey = "", row = "0", col = "0"] = el.dataset.slot.split("|");
        const bottleId = el.dataset.bottleId ?? null;
        if (bottleId !== s.bottle.bottleId)
          over = { slotKey, row: Number(row), col: Number(col), bottleId };
      }
      const key = over ? `${over.slotKey}|${over.row}|${over.col}` : null;
      if (key === s.overKey) return;
      s.overKey = key;
      s.over = over;
      setDrag({ bottle: s.bottle, over });
    };

    const tick = () => {
      const s = session.current;
      if (!s?.active) return;
      const bottom = window.innerHeight - EDGE_BOTTOM_PX;
      let dy = 0;
      if (s.y < EDGE_TOP_PX) dy = -Math.ceil(((EDGE_TOP_PX - s.y) / EDGE_TOP_PX) * MAX_SCROLL_PX);
      else if (s.y > bottom)
        dy = Math.ceil(Math.min(1, (s.y - bottom) / EDGE_BOTTOM_PX) * MAX_SCROLL_PX);
      if (dy !== 0) {
        window.scrollBy(0, dy);
        hitTest(s);
      }
      s.frame = requestAnimationFrame(tick);
    };

    const stop = () => {
      const s = session.current;
      if (!s) return null;
      window.clearTimeout(s.timer);
      cancelAnimationFrame(s.frame);
      session.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("pointerdown", onOtherDown, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("touchmove", onTouchMove);
      document.documentElement.classList.remove("rack-dragging");
      return s;
    };

    /** The bottle goes back to its spot: the ghost glides there, then disappears. Nothing is written. */
    const settleBack = (s: Session) => {
      const g = ghost.current;
      if (!g || reducedMotion()) return setDrag(null);
      const r = s.el.getBoundingClientRect();
      g.style.transition = "transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 180ms ease";
      g.style.opacity = "0";
      // the ghost hangs above the finger (see DragGhost): aim its bottle at the spot's centre
      placeGhost(r.left + r.width / 2, r.top + r.height / 2 + GHOST_LIFT_PX);
      window.setTimeout(() => setDrag(null), 190);
    };

    const cancel = () => {
      const s = stop();
      if (s?.active) settleBack(s);
    };

    const activate = () => {
      const s = session.current;
      if (!s) return;
      s.active = true;
      document.documentElement.classList.add("rack-dragging");
      navigator.vibrate?.(8);
      setDrag({ bottle: s.bottle, over: null });
      s.frame = requestAnimationFrame(tick);
    };

    function onMove(e: PointerEvent) {
      const s = session.current;
      if (!s || e.pointerId !== s.pointerId) return;
      s.x = e.clientX;
      s.y = e.clientY;
      if (!s.active) {
        if (Math.hypot(s.x - s.x0, s.y - s.y0) > SLOP_PX) cancel(); // scrolling, not pressing
        return;
      }
      placeGhost(s.x, s.y);
      hitTest(s);
    }

    function onUp(e: PointerEvent) {
      const s = session.current;
      if (!s || e.pointerId !== s.pointerId) return;
      if (!s.active) return void stop(); // a tap: the click that follows opens the bottle as before
      quietUntil.current = performance.now() + 350; // the click this release makes is not a tap
      stop();
      const over = s.over;
      if (!over) return settleBack(s);
      setDrag(null);
      latest.current.onDrop(s.bottle, over);
    }

    function onCancel(e: PointerEvent) {
      if (session.current && e.pointerId === session.current.pointerId) cancel();
    }

    /** A second finger: not a drag any more. */
    function onOtherDown(e: PointerEvent) {
      if (session.current && e.pointerId !== session.current.pointerId) cancel();
    }

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") cancel();
    }

    function onContextMenu(e: Event) {
      e.preventDefault();
    }

    /** Once the bottle is lifted, the finger moves the bottle, not the page. */
    function onTouchMove(e: TouchEvent) {
      if (session.current?.active && e.cancelable) e.preventDefault();
    }

    return {
      begin(e: ReactPointerEvent<HTMLElement>, bottle: PlacedBottle) {
        if (latest.current.disabled || session.current || !e.isPrimary) return;
        if (e.pointerType === "mouse" && e.button !== 0) return;
        session.current = {
          pointerId: e.pointerId,
          bottle,
          el: e.currentTarget,
          x0: e.clientX,
          y0: e.clientY,
          x: e.clientX,
          y: e.clientY,
          active: false,
          timer: window.setTimeout(activate, LONG_PRESS_MS),
          frame: 0,
          overKey: null,
          over: null,
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onCancel);
        window.addEventListener("pointerdown", onOtherDown, true);
        window.addEventListener("keydown", onKey);
        window.addEventListener("contextmenu", onContextMenu);
        window.addEventListener("touchmove", onTouchMove, { passive: false });
      },
      /** The ghost element: placed under the finger as soon as it appears. */
      ghostRef(el: HTMLDivElement | null) {
        ghost.current = el;
        const s = session.current;
        if (el && s) placeGhost(s.x, s.y);
      },
      /** True for the click that ends a drag (it must not open the bottle). */
      consumeClick() {
        return performance.now() < quietUntil.current;
      },
      stop,
    };
  });

  useEffect(() => () => void api.stop(), [api]);

  return { drag, begin: api.begin, ghostRef: api.ghostRef, consumeClick: api.consumeClick };
}
