"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { buttonStyles } from "../button";
import { cn } from "../cn";
import { Logo } from "../logo";
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
        "fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-hairline bg-canvas/60 px-4 py-8 backdrop-blur-xl lg:flex",
        className,
      )}
    >
      <Link href="/" className="mb-8 rounded-full px-3" aria-label="CELLR">
        <Logo className="h-20" />
      </Link>
      {scan && (
        <Link
          href={scan.href}
          className={cn(buttonStyles({ variant: "primary", size: "md", block: true }), "mb-7")}
        >
          <scan.Icon size={20} />
          {t("scan")}
        </Link>
      )}
      <ul className="flex flex-col gap-1.5">
        {NAV_ITEMS.filter((i) => !i.primary).map(({ key, href, Icon }) => {
          const active = isActive(pathname, href);
          return (
            <li key={key}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-11 items-center gap-3 rounded-full px-4 text-body transition-colors duration-150",
                  active
                    ? "bg-raised font-medium text-ink"
                    : "text-ink-2 hover:bg-raised/60 hover:text-ink",
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
