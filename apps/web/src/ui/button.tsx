import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "./cn";

/** Class recipe, exported so links (`<Link className={buttonStyles(…)}>`) look identical to buttons. */
export const buttonStyles = cva(
  [
    "relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap font-medium",
    "transition-[transform,background-color,opacity] duration-150 ease-cellr",
    "active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45",
  ],
  {
    variants: {
      variant: {
        primary: "bg-accent text-accent-ink hover:brightness-110",
        secondary: "bg-raised text-ink hover:brightness-[1.04] dark:hover:brightness-110",
        ghost: "text-ink-2 hover:bg-raised hover:text-ink",
        danger: "text-danger hover:bg-raised",
      },
      size: {
        sm: "h-9 rounded-control px-3 text-small",
        md: "h-12 rounded-control px-5 text-body",
        lg: "h-14 rounded-card px-6 text-body",
      },
      block: { true: "w-full", false: "" },
    },
    defaultVariants: { variant: "primary", size: "md", block: false },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonStyles> {
  loading?: boolean | undefined;
}

export function Button({
  variant,
  size,
  block,
  loading,
  className,
  children,
  disabled,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        buttonStyles({ variant, size, block }),
        loading && "disabled:opacity-100",
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      <span className={cn("inline-flex items-center gap-2", loading && "invisible")}>
        {children}
      </span>
      {loading && (
        <span
          className="absolute inset-0 grid place-items-center"
          role="status"
          aria-label="Loading"
        >
          <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
        </span>
      )}
    </button>
  );
}
