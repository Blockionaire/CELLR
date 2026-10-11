import type { HTMLAttributes } from "react";
import { cn } from "./cn";

/** Loading placeholder. Shape it like the content it stands in for. */
export function Skeleton({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse rounded-control bg-raised", className)}
      {...rest}
    />
  );
}
