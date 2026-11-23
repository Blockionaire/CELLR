"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/ui/cn";
import { ADMIN_NAV, activeHref, type AdminNavItem } from "./nav-model";

export { activeHref } from "./nav-model";

/**
 * The admin sidebar (from 1024 px; phones and tablets get the header and tab bar of admin-shell.tsx): grouped links,
 * the current page marked (aria-current and a visible bar). Links only: it reads nothing but the URL, so it needs no
 * admin data (every admin page is still rendered and checked on the server).
 */
export type AdminNavGroup = {
  label: string | null;
  items: ReadonlyArray<AdminNavItem>;
};

export function AdminNav({ groups = ADMIN_NAV }: { groups?: ReadonlyArray<AdminNavGroup> }) {
  const current = activeHref(usePathname() ?? "/admin", groups);
  return (
    <nav aria-label="Admin" className="mt-8 flex flex-col gap-5 text-small">
      {groups.map((g) => (
        <div key={g.label ?? "main"} className="flex flex-col gap-1">
          {g.label && (
            <p className="px-3 pb-1 text-caption font-semibold uppercase tracking-[0.08em] text-ink-3">
              {g.label}
            </p>
          )}
          {g.items.map((n) => {
            const active = n.href === current;
            return (
              <Link
                key={n.href}
                href={n.href}
                prefetch={false}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative whitespace-nowrap rounded-[10px] px-3 py-2 font-medium transition-colors",
                  active
                    ? "bg-raised text-ink before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-full before:bg-accent-fg"
                    : "text-ink-2 hover:bg-raised/70 hover:text-ink",
                )}
              >
                {n.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
