import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
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

const NAV = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/product", label: "Product analytics" },
  { href: "/admin/ai", label: "AI & costs" },
  { href: "/admin/feedback", label: "Beta feedback" },
  { href: "/admin/catalog", label: "Wine catalogue" },
  { href: "/admin/bottle-photos", label: "Bottle photos" },
  { href: "/admin/wines", label: "Wine visuals" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!(await getAdminSession())) notFound();
  return (
    <div className="min-h-dvh bg-canvas text-ink md:flex">
      <aside className="border-b border-hairline bg-surface px-4 py-3 md:sticky md:top-0 md:h-dvh md:w-56 md:shrink-0 md:border-b-0 md:border-r md:py-6">
        <div className="flex items-center gap-2">
          <Logo className="h-6 w-auto" />
          <span className="rounded-full bg-raised px-2 py-0.5 text-caption text-ink-2">Admin</span>
        </div>
        <nav
          aria-label="Admin"
          className="mt-3 flex gap-1 overflow-x-auto text-small md:mt-8 md:flex-col"
        >
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              prefetch={false}
              className="whitespace-nowrap rounded-[10px] px-3 py-2 text-ink-2 hover:bg-raised hover:text-ink"
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <p className="mt-8 hidden text-caption text-ink-3 md:block">
          Read-only, except catalogue review and the bottle library. Costs are estimates, not
          invoices.
        </p>
      </aside>
      <main className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-8">{children}</main>
    </div>
  );
}
