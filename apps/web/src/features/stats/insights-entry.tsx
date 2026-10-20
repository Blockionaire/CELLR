import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { cn } from "@/ui/cn";
import { ChevronRightIcon } from "@/ui/icons";

/**
 * The way into Insights from where people already are: the collection in one line, and "View insights". The card
 * (Cellar) sits on a surface; the subtle row (Home) is just a line under the Tonight hero. Both are one link.
 */
export function InsightsEntry({
  summary,
  subtle = false,
  testId,
  className,
}: {
  summary: ReactNode;
  subtle?: boolean;
  testId?: string;
  className?: string;
}) {
  const t = useTranslations("insightsEntry");
  return (
    <Link
      href="/insights"
      data-testid="insights-entry"
      className={cn(
        "group flex items-center gap-3 transition-[transform,background-color] duration-200 ease-spring active:scale-[0.99]",
        subtle
          ? "min-h-11 rounded-control px-1 py-2 hover:bg-raised"
          : "rounded-card bg-surface px-4 py-3 shadow-raised ring-1 ring-hairline hover:bg-raised",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="grid size-9 shrink-0 place-items-center rounded-full bg-raised text-bronze ring-1 ring-hairline"
      >
        <svg
          width={18}
          height={18}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.9}
          strokeLinecap="round"
        >
          <path d="M5 20V12M12 20V5M19 20v-5" />
        </svg>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-caption font-medium uppercase tracking-[0.14em] text-bronze">
          {t("title")}
        </span>
        <span data-testid={testId} className="block truncate text-small text-ink-2 tnum">
          {summary}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-0.5 text-small font-medium text-accent-fg">
        {t("cta")}
        <ChevronRightIcon
          size={16}
          className="transition-transform duration-200 ease-spring group-hover:translate-x-0.5"
        />
      </span>
    </Link>
  );
}
