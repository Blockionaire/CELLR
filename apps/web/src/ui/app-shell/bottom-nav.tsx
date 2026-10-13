"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "../cn";
import { isActive, NAV_ITEMS } from "./nav-items";

/** Phone navigation. Scan is the one visually distinct action, raised above the bar. */
export function BottomNav({ className }: { className?: string }) {
  const t = useTranslations("nav");
  const pathname = usePathname();

  return (
    <nav
      aria-label={t("label")}
      className={cn(
        "fixed inset-x-0 bottom-0 z-30 border-t border-hairline bg-canvas/90 backdrop-blur-xl pb-safe lg:hidden",
        className,
      )}
    >
      <ul className="mx-auto grid h-[var(--nav-height)] max-w-md grid-cols-5">
        {NAV_ITEMS.map(({ key, href, Icon, primary }) => {
          const active = isActive(pathname, href);
          return (
            <li key={key} className="relative">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-full flex-col items-center justify-center gap-1 text-caption font-medium transition-colors duration-150",
                  active ? "text-ink" : "text-ink-3 hover:text-ink-2",
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
                  <>
                    <span
                      className={cn(
                        "absolute top-0 h-0.5 w-8 rounded-full bg-accent-fg transition-opacity duration-150",
                        active ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <Icon size={24} />
                  </>
                )}
                <span>{t(key)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
