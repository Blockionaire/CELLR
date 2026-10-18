"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { motion } from "motion/react";
import { useState } from "react";
import { cn } from "../cn";
import { spring } from "../motion";
import { isActive, NAV_ITEMS } from "./nav-items";

/** Phone navigation. Scan is the one visually distinct action, raised above the bar. */
export function BottomNav({ className }: { className?: string }) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  // The tab you just tapped lights up at once, before the next page has arrived. It clears itself
  // when the path changes (the remembered tap only counts while we are still on the page it was made on).
  const [tapped, setTapped] = useState<{ href: string; from: string } | null>(null);
  const target = tapped && tapped.from === pathname ? tapped.href : null;

  return (
    <nav
      aria-label={t("label")}
      // its own layer in page changes: the bar stays put while the page under it cross-fades (globals.css)
      style={{ viewTransitionName: "app-nav" }}
      className={cn(
        "fixed inset-x-0 bottom-0 z-30 border-t border-hairline bg-canvas/90 backdrop-blur-xl pb-safe lg:hidden",
        className,
      )}
    >
      <ul className="mx-auto grid h-[var(--nav-height)] max-w-md grid-cols-5">
        {NAV_ITEMS.map(({ key, href, Icon, primary }) => {
          const active = isActive(target ?? pathname, href);
          return (
            <li key={key} className="relative">
              <Link
                href={href}
                prefetch
                onClick={() => setTapped({ href, from: pathname })}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-full flex-col items-center justify-center gap-1 text-caption transition-colors duration-150 active:opacity-70",
                  active ? "font-semibold text-ink" : "font-medium text-ink-3 hover:text-ink-2",
                )}
              >
                {primary ? (
                  // Same footprint as the other icons, so every label shares one baseline;
                  // the button itself is lifted out of the bar.
                  <span className="relative h-6 w-full">
                    <span className="absolute -top-7 left-1/2 grid size-14 -translate-x-1/2 place-items-center rounded-full bg-accent text-accent-ink shadow-raised ring-4 ring-canvas transition-transform duration-150 ease-cellr active:scale-95">
                      <Icon size={26} />
                    </span>
                  </span>
                ) : (
                  <span className="relative grid h-8 w-14 place-items-center">
                    {active && (
                      <motion.span
                        layoutId="nav-active"
                        transition={spring.snap}
                        className="absolute inset-0 rounded-full bg-accent/15"
                      />
                    )}
                    <Icon
                      size={24}
                      className={cn(
                        "relative transition-colors duration-150",
                        active && "text-accent-fg",
                      )}
                    />
                  </span>
                )}
                <span className="max-w-full whitespace-nowrap px-1 leading-none">{t(key)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
