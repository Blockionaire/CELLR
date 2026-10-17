import type { ReactNode } from "react";
import { cn } from "./cn";

interface PageHeaderProps {
  title: ReactNode;
  eyebrow?: string;
  subtitle?: string;
  actions?: ReactNode;
  className?: string;
}

/** Editorial page title: a calm serif headline, generous space above. */
export function PageHeader({ title, eyebrow, subtitle, actions, className }: PageHeaderProps) {
  return (
    <header
      className={cn("flex items-end justify-between gap-4 pb-5 pt-8 lg:pb-6 lg:pt-14", className)}
    >
      <div className="min-w-0">
        {eyebrow && (
          <p className="mb-2 text-caption font-medium uppercase tracking-[0.14em] text-bronze">
            {eyebrow}
          </p>
        )}
        <h1 className="font-display text-[2.75rem] leading-[2.875rem] tracking-[-0.01em] text-balance lg:text-[3.25rem] lg:leading-[3.375rem]">
          {title}
        </h1>
        {subtitle && <p className="mt-2 max-w-prose text-body text-ink-2">{subtitle}</p>}
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </header>
  );
}
