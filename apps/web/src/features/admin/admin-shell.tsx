"use client";

import {
  BarChart3,
  Check,
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  Menu,
  Network,
  Wine,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import { cn } from "@/ui/cn";
import { Logo } from "@/ui/logo";
import { Sheet } from "@/ui/sheet";
import { SignOutButton } from "./sign-out-button";
import { ADMIN_NAV, TAB_LABEL, pageInfo, type AdminNavGroup, type AdminTab } from "./nav-model";

/**
 * The admin portal on phones and tablets (below 1024 px; the sidebar of admin-nav.tsx takes over above):
 *   - a header with the page's title, "back" to the list on a detail page, and a menu with the whole structure;
 *   - a tab bar with the four areas, in thumb reach above the home indicator. An area with several pages opens a
 *     sheet of them; Overview opens directly.
 * Both are links only (they read the URL, never admin data), every target is at least 44 × 44 px, and both pad for
 * the notch and the home indicator (env(safe-area-inset-*), with viewport-fit=cover from the root layout).
 */
const TAB_ICON: Readonly<Record<AdminTab, LucideIcon>> = {
  overview: LayoutDashboard,
  wine: Wine,
  insights: BarChart3,
  system: Network,
};

type Open = { kind: "menu" } | { kind: "group"; tab: AdminTab } | null;

export function AdminMobileChrome() {
  const pathname = usePathname() ?? "/admin";
  const params = useSearchParams();
  const info = pageInfo(pathname, params?.get("back") ?? null);
  const [open, setOpen] = useState<Open>(null);
  // a page change (a link in a sheet, the browser's back button) closes whatever sheet was open
  const [seen, setSeen] = useState(pathname);
  if (seen !== pathname) {
    setSeen(pathname);
    setOpen(null);
  }
  const group = open?.kind === "group" ? ADMIN_NAV.find((g) => g.tab === open.tab) : undefined;

  return (
    <>
      <header
        className="sticky top-0 z-30 border-b border-hairline bg-canvas/90 pt-safe backdrop-blur-xl lg:hidden"
        data-testid="admin-mobile-header"
      >
        <div className="flex h-14 items-center gap-1 px-1.5 [@media(max-height:500px)]:h-12">
          {info.back ? (
            <Link
              href={info.back.href}
              prefetch={false}
              className="grid size-11 shrink-0 place-items-center rounded-full text-ink hover:bg-raised"
              aria-label={`Back to ${info.back.label}`}
              data-testid="admin-back"
            >
              <ChevronLeft size={24} aria-hidden="true" />
            </Link>
          ) : (
            <Link
              href="/admin"
              prefetch={false}
              aria-label="CELLR Admin overview"
              className="grid h-11 shrink-0 place-items-center rounded-full px-2.5 hover:bg-raised"
            >
              <Logo className="h-5 w-auto" />
            </Link>
          )}
          <div className="min-w-0 flex-1 px-1">
            <p className="truncate text-[0.6875rem] font-semibold uppercase leading-tight tracking-[0.08em] text-ink-3">
              {info.back ? info.back.label : (info.group ?? "Admin")}
            </p>
            <p
              className="truncate text-body font-semibold leading-tight text-ink"
              data-testid="admin-page-title"
            >
              {info.title}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen({ kind: "menu" })}
            className="grid size-11 shrink-0 place-items-center rounded-full text-ink hover:bg-raised"
            aria-label="All admin pages"
            aria-haspopup="dialog"
            data-testid="admin-menu-button"
          >
            <Menu size={22} aria-hidden="true" />
          </button>
        </div>
      </header>

      <nav
        aria-label="Admin areas"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-hairline bg-canvas/90 pb-safe backdrop-blur-xl lg:hidden"
        data-testid="admin-tab-bar"
      >
        {/* a phone on its side (little height): a lower bar, icons only (the names stay for screen readers) */}
        <ul className="mx-auto grid h-[var(--nav-height)] max-w-xl grid-cols-4 [@media(max-height:500px)]:h-12">
          {ADMIN_NAV.map((g) => {
            const Icon = TAB_ICON[g.tab];
            const active = info.tab === g.tab;
            const single = g.items.length === 1;
            const inner = (
              <>
                <span className="relative grid h-8 w-14 place-items-center">
                  {active && <span className="absolute inset-0 rounded-full bg-accent/15" />}
                  <Icon
                    size={22}
                    aria-hidden="true"
                    className={cn("relative", active && "text-accent-fg")}
                  />
                </span>
                <span className="leading-none [@media(max-height:500px)]:sr-only">
                  {TAB_LABEL[g.tab]}
                </span>
              </>
            );
            const cls = cn(
              "flex h-full w-full flex-col items-center justify-center gap-1 text-caption transition-colors active:opacity-70",
              active ? "font-semibold text-ink" : "font-medium text-ink-2 hover:text-ink",
            );
            return (
              <li key={g.tab}>
                {single ? (
                  <Link
                    href={g.items[0]!.href}
                    prefetch={false}
                    aria-current={info.current === g.items[0]!.href ? "page" : undefined}
                    className={cls}
                    data-tab={g.tab}
                  >
                    {inner}
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={() => setOpen({ kind: "group", tab: g.tab })}
                    aria-haspopup="dialog"
                    aria-label={`${TAB_LABEL[g.tab]}: ${g.items.length} pages${active ? ", current area" : ""}`}
                    className={cls}
                    data-tab={g.tab}
                    data-active={active || undefined}
                  >
                    {inner}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </nav>

      <Sheet
        open={open !== null}
        onClose={() => setOpen(null)}
        title={group ? (group.label ?? TAB_LABEL[group.tab]) : "Admin"}
        description={group ? undefined : "Every page of the admin portal"}
        closeLabel="Close"
      >
        <div data-testid="admin-nav-sheet">
          {group ? (
            <PageList group={group} current={info.current} />
          ) : (
            <>
              {ADMIN_NAV.map((g) => (
                <div key={g.tab} className="mb-4">
                  {g.label && (
                    <p className="mb-1 px-1 text-caption font-semibold uppercase tracking-[0.08em] text-ink-3">
                      {g.label}
                    </p>
                  )}
                  <PageList group={g} current={info.current} />
                </div>
              ))}
              <Link
                href="/"
                prefetch={false}
                className="mb-2 flex min-h-12 items-center justify-between rounded-[14px] px-3 text-small font-medium text-ink-2 ring-1 ring-hairline hover:bg-raised"
              >
                Open the CELLR app
                <ChevronRight size={18} aria-hidden="true" />
              </Link>
              <SignOutButton className="mb-2" />
            </>
          )}
        </div>
      </Sheet>
    </>
  );
}

function PageList({ group, current }: { group: AdminNavGroup; current: string | null }) {
  return (
    <ul className="overflow-hidden rounded-[14px] bg-raised/60 ring-1 ring-hairline">
      {group.items.map((i) => {
        const here = i.href === current;
        return (
          <li key={i.href} className="border-b border-hairline last:border-0">
            <Link
              href={i.href}
              prefetch={false}
              aria-current={here ? "page" : undefined}
              className={cn(
                "flex min-h-12 items-center justify-between gap-3 px-3 text-body transition-colors hover:bg-raised",
                here ? "font-semibold text-ink" : "text-ink",
              )}
            >
              <span className="min-w-0 truncate">{i.label}</span>
              {here ? (
                <Check size={18} aria-hidden="true" className="shrink-0 text-accent-fg" />
              ) : (
                <ChevronRight size={18} aria-hidden="true" className="shrink-0 text-ink-3" />
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
