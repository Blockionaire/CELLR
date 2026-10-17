import type { ReactNode } from "react";
import { BottleGlyph, type BottleShape } from "./bottle-glyph";
import { cn } from "./cn";
import { STAGE } from "@/features/cellar/wine-card";

interface EmptyStateProps {
  title: string;
  body?: string;
  action?: ReactNode;
  className?: string;
  /** The little rack above the text; hide it for compact, in-list empty states. */
  illustration?: boolean;
}

const ROW: ReadonlyArray<{ shape: BottleShape; tint: "red" | "white" | "rose"; delay: number }> = [
  { shape: "bordeaux", tint: "red", delay: 0 },
  { shape: "burgundy", tint: "white", delay: 90 },
  { shape: "bordeaux", tint: "rose", delay: 180 },
];

/** An invitation, never "No records." Every list and screen needs one before it counts as done. */
export function EmptyState({
  title,
  body,
  action,
  className,
  illustration = true,
}: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center px-6 py-12 text-center", className)}>
      {illustration && (
        <div className="mb-8 flex items-end gap-3" aria-hidden="true">
          {ROW.map((b, i) => (
            <div
              key={i}
              className={cn(
                "relative grid size-20 place-items-end justify-items-center overflow-hidden rounded-[22px] pb-2",
                STAGE[b.tint],
                i === 1 && "mb-3",
              )}
            >
              <span className="absolute -bottom-6 left-1/2 size-16 -translate-x-1/2 rounded-full bg-surface/45" />
              <BottleGlyph
                shape={b.shape}
                tint={b.tint}
                className="relative w-8 animate-[rise_600ms_var(--ease-out)_both] opacity-90"
                style={{ animationDelay: `${b.delay}ms` }}
              />
            </div>
          ))}
        </div>
      )}
      <h2 className="font-display text-headline">{title}</h2>
      {body && <p className="mt-2 max-w-xs text-body text-ink-2">{body}</p>}
      {action && <div className="mt-8">{action}</div>}
    </div>
  );
}
