import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AdminNav } from "@/features/admin/admin-nav";
import { ADMIN_ICONS, ADMIN_MANIFEST_PATH } from "@/features/admin/admin-manifest";
import { AdminMobileChrome } from "@/features/admin/admin-shell";
import { SignOutButton } from "@/features/admin/sign-out-button";
import { getAdminSession } from "@/server/admin/service";
import { Logo } from "@/ui/logo";
import { SPLASH_SCREENS } from "../splash-screens";

/**
 * The internal admin dashboard, outside the app's own shell and navigation: a sidebar from 1024 px, a header and a
 * tab bar on phones and tablets (Mobile Admin Portal 2.0). Only a verified session on CELLR_ADMIN_USER_IDS gets past
 * this layout, and every page checks again on its own (a layout is not re-run on every navigation). Anyone else
 * sees the ordinary "not found" page: the navigation is never rendered for them.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

/**
 * CELLR Admin installs as its own home-screen app (features/admin/admin-manifest.ts): these pages link the admin's
 * manifest instead of the CELLR app's, and give iOS the admin's name and icon. Everything else in the head is the
 * root layout's.
 */
export const metadata: Metadata = {
  title: "Admin",
  manifest: ADMIN_MANIFEST_PATH,
  applicationName: "CELLR Admin",
  appleWebApp: {
    capable: true,
    title: "CELLR Admin",
    statusBarStyle: "default",
    startupImage: SPLASH_SCREENS,
  },
  icons: {
    icon: [{ url: ADMIN_ICONS.favicon, sizes: "32x32", type: "image/png" }],
    apple: ADMIN_ICONS.apple,
  },
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false },
  },
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!(await getAdminSession())) notFound();
  return (
    <div className="min-h-dvh bg-canvas text-ink lg:flex">
      <a
        href="#admin-main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-surface focus:px-4 focus:py-2 focus:text-small focus:text-ink focus:shadow-raised"
      >
        Skip to content
      </a>
      <aside className="hidden bg-surface px-4 lg:sticky lg:top-0 lg:block lg:h-dvh lg:w-60 lg:shrink-0 lg:overflow-y-auto lg:border-r lg:border-hairline lg:py-6">
        <div className="flex items-center gap-2">
          <Logo className="h-6 w-auto" />
          <span className="rounded-full bg-raised px-2 py-0.5 text-caption font-medium text-ink-2">
            Admin
          </span>
        </div>
        <AdminNav />
        <p className="mt-8 px-3 text-caption text-ink-3">
          Read-only, except catalogue review, the bottle library, the Wine Master Database and
          external sources (every change there is audited). Costs are estimates, not invoices.
        </p>
        <SignOutButton className="mt-4" />
      </aside>
      <Suspense fallback={null}>
        <AdminMobileChrome />
      </Suspense>
      <main
        id="admin-main"
        className="mx-auto w-full min-w-0 max-w-7xl px-4 pb-[calc(var(--nav-height)+env(safe-area-inset-bottom)+2rem)] pt-5 break-words sm:px-6 lg:px-8 lg:py-8"
      >
        {children}
      </main>
    </div>
  );
}
