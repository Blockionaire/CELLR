"use client";

import { motion, useMotionValue, useTransform } from "motion/react";
import { useRef, type ReactNode } from "react";
import { HeartIcon } from "@/ui/icons";
import { useToggleFavorite } from "./hooks";

const THRESHOLD = 88;

/**
 * Swipe a row to the right to star it (or unstar it), like in a mail app. The heart button on the row stays
 * for anyone who does not swipe, so this is only a shortcut. The row springs back either way.
 */
export function SwipeFavorite({
  wineId,
  favorite,
  children,
}: {
  wineId: string;
  favorite: boolean;
  children: ReactNode;
}) {
  const { mutate } = useToggleFavorite();
  const x = useMotionValue(0);
  const hint = useTransform(x, [0, THRESHOLD], [0, 1]);
  const dragged = useRef(false);

  return (
    // A link would otherwise start the browser's own drag-and-drop of the link, which cancels the swipe.
    <div className="relative overflow-hidden" onDragStartCapture={(e) => e.preventDefault()}>
      <motion.span
        aria-hidden="true"
        style={{ opacity: hint }}
        className="absolute inset-y-0 left-0 grid w-24 place-items-center bg-accent/15 text-accent-fg"
      >
        <HeartIcon size={24} filled={!favorite} />
      </motion.span>
      <motion.div
        style={{ x }}
        drag="x"
        dragDirectionLock
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={{ left: 0, right: 0.5 }}
        dragSnapToOrigin
        onDragStart={() => (dragged.current = true)}
        onDragEnd={(_, info) => {
          if (info.offset.x >= THRESHOLD) mutate({ wineId, favorite: !favorite });
          // a swipe must not also count as a tap on the row's link
          setTimeout(() => (dragged.current = false), 0);
        }}
        onClickCapture={(e) => {
          if (dragged.current) e.preventDefault();
        }}
        className="relative bg-surface"
      >
        {children}
      </motion.div>
    </div>
  );
}
