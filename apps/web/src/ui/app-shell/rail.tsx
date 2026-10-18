"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { motion } from "motion/react";
import { useState } from "react";
import { buttonStyles } from "../button";
import { cn } from "../cn";
import { spring } from "../motion";
import { Logo } from "../logo";
import { isActive, NAV_ITEMS } from "./nav-items";

/** Desktop navigation: a quiet left rail; the primary action becomes a real button. */
export function Rail({ className }: { className?: string }) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const scan = NAV_ITEMS.find((i) => i.primary);
  // the tapped item lights up at once (see BottomNav)
  const [tapped, setTapped] = useState<{ href: string; from: string } | null>(null);
  const current = tapped && tapped.from === pathname ? tapped.href : pathname;

  return (
    <nav
      aria-label={t("label")}
      style={{ viewTransitionName: "app-nav" }}
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
          const active = isActive(current, href);
          return (
            <li key={key}>
              <Link
                href={href}
                prefetch
                onClick={() => setTapped({ href, from: pathname })}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-11 items-center gap-3 rounded-full px-4 text-body transition-colors duration-150",
                  active ? "font-medium text-ink" : "text-ink-2 hover:bg-raised/60 hover:text-ink",
                )}
              >
                {active && (
                  <motion.span
                    layoutId="rail-active"
                    transition={spring.snap}
                    className="absolute inset-0 rounded-full bg-accent/15"
                  />
                )}
                <Icon size={22} className={cn("relative", active && "text-accent-fg")} />
                <span className="relative">{t(key)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
