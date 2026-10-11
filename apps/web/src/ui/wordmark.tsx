import { cn } from "./cn";

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("font-display text-title uppercase tracking-[0.28em]", className)}>
      Cellr
    </span>
  );
}
