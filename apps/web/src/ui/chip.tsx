import type { ButtonHTMLAttributes } from "react";
import { cn } from "./cn";

interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
}

/** Toggle chip for filters and quick descriptors. */
export function Chip({ selected = false, className, type = "button", ...rest }: ChipProps) {
  return (
    <button
      type={type}
      aria-pressed={selected}
      className={cn(
        "h-9 shrink-0 rounded-full border px-4 text-small font-medium transition-colors duration-150 ease-cellr active:scale-[0.97]",
        selected
          ? "border-transparent bg-accent text-accent-ink"
          : "border-hairline bg-surface text-ink-2 hover:text-ink",
        className,
      )}
      {...rest}
    />
  );
}
