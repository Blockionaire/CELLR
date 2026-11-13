import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AdminNav, type AdminNavGroup } from "@/features/admin/admin-nav";
import { getAdminSession } from "@/server/admin/service";
import { Logo } from "@/ui/logo";

/**
 * The internal admin dashboard: read-only, desktop-first, outside the app's own shell and navigation. Only a
 * verified session on CELLR_ADMIN_USER_IDS gets past this layout, and every page checks again on its own (a
 * layout is not re-run on every navigation). Anyone else sees the ordinary "not found" page.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export const metadata: Metadata = {
  title: "Admin",
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false },
  },
};

const NAV: AdminNavGroup[] = [
  { label: null, items: [{ href: "/admin", label: "Overview" }] },
  {
    label: "Wine management",
    items: [
      { href: "/admin/wines", label: "Wine Master Database" },
      { href: "/admin/bottle-photos", label: "Bottle photos" },
      { href: "/admin/catalog", label: "Wine catalogue" },
      { href: "/admin/catalog/corrections", label: "Corrections" },
      { href: "/admin/sources", label: "External sources" },
    ],
  },
  {
    label: "Insights",
    items: [
      { href: "/admin/users", label: "Users" },
      { href: "/admin/product", label: "Product analytics" },
      { href: "/admin/ai", label: "AI & costs" },
      { href: "/admin/feedback", label: "Beta feedback" },
    ],
  },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!(await getAdminSession())) notFound();
  return (
    <div className="min-h-dvh bg-canvas text-ink md:flex">
      <a
        href="#admin-main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-surface focus:px-4 focus:py-2 focus:text-small focus:text-ink focus:shadow-raised"
      >
        Skip to content
      </a>
      <aside className="border-b border-hairline bg-surface px-4 py-3 md:sticky md:top-0 md:h-dvh md:w-60 md:shrink-0 md:overflow-y-auto md:border-b-0 md:border-r md:py-6">
        <div className="flex items-center gap-2">
          <Logo className="h-6 w-auto" />
          <span className="rounded-full bg-raised px-2 py-0.5 text-caption font-medium text-ink-2">
            Admin
          </span>
        </div>
        <AdminNav groups={NAV} />
        <p className="mt-8 hidden px-3 text-caption text-ink-3 md:block">
          Read-only, except catalogue review, the bottle library, the Wine Master Database and
          external sources (every change there is audited). Costs are estimates, not invoices.
        </p>
      </aside>
      <main id="admin-main" className="mx-auto w-full min-w-0 max-w-7xl px-4 py-6 md:px-8 md:py-8">
        {children}
      </main>
    </div>
  );
}
