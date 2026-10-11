"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { buttonStyles } from "../button";
import { cn } from "../cn";
import { Wordmark } from "../wordmark";
import { isActive, NAV_ITEMS } from "./nav-items";

/** Desktop navigation: a quiet left rail; the primary action becomes a real button. */
export function Rail({ className }: { className?: string }) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const scan = NAV_ITEMS.find((i) => i.primary);

  return (
    <nav
      aria-label={t("label")}
      className={cn(
        "fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-hairline px-4 py-8 lg:flex",
        className,
      )}
    >
      <Link href="/" className="mb-10 px-3" aria-label="CELLR">
        <Wordmark />
      </Link>
      {scan && (
        <Link
          href={scan.href}
          className={cn(buttonStyles({ variant: "primary", size: "md", block: true }), "mb-6")}
        >
          <scan.Icon size={20} />
          {t("scan")}
        </Link>
      )}
      <ul className="flex flex-col gap-1">
        {NAV_ITEMS.filter((i) => !i.primary).map(({ key, href, Icon }) => {
          const active = isActive(pathname, href);
          return (
            <li key={key}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-11 items-center gap-3 rounded-control px-3 text-body transition-colors duration-150",
                  active ? "bg-raised text-ink" : "text-ink-2 hover:bg-raised hover:text-ink",
                )}
              >
                <Icon size={22} />
                {t(key)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
