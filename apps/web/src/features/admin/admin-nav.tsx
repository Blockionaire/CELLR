"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/ui/cn";

/**
 * The admin sidebar: grouped links, the current page marked (aria-current and a visible bar). Links only: it reads
 * nothing but the URL, so it needs no admin data (every admin page is still rendered and checked on the server).
 */
export type AdminNavGroup = {
  label: string | null;
  items: ReadonlyArray<{ href: string; label: string }>;
};

/** The current page's own link: the longest one that the path starts with. */
export function activeHref(pathname: string, groups: ReadonlyArray<AdminNavGroup>) {
  const hrefs = groups.flatMap((g) => g.items.map((i) => i.href));
  return (
    hrefs
      .filter((h) => pathname === h || (h !== "/admin" && pathname.startsWith(`${h}/`)))
      .sort((a, b) => b.length - a.length)[0] ?? null
  );
}

export function AdminNav({ groups }: { groups: ReadonlyArray<AdminNavGroup> }) {
  const current = activeHref(usePathname() ?? "/admin", groups);
  return (
    <nav
      aria-label="Admin"
      className="mt-3 flex gap-1 overflow-x-auto text-small md:mt-8 md:flex-col md:gap-5 md:overflow-visible"
    >
      {groups.map((g) => (
        <div key={g.label ?? "main"} className="flex gap-1 md:flex-col">
          {g.label && (
            <p className="hidden px-3 pb-1 text-caption font-semibold uppercase tracking-[0.08em] text-ink-3 md:block">
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
