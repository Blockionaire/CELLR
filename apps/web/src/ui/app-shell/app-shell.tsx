import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { BottomNav } from "./bottom-nav";
import { Rail } from "./rail";

/**
 * The frame around every signed-in screen: bottom bar on phones, left rail on desktop.
 * Content gets a calm column; wide screens use the extra space for two-pane layouts, not stretched cards.
 */
export async function AppShell({ children }: { children: ReactNode }) {
  const t = await getTranslations("common");
  return (
    <div className="min-h-dvh lg:pl-60">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-control focus:bg-surface focus:px-4 focus:py-2 focus:text-ink focus:shadow-raised"
      >
        {t("skipToContent")}
      </a>
      <Rail />
      <main
        id="main"
        className="mx-auto w-full max-w-[1200px] px-5 pt-safe pb-[calc(var(--nav-height)+env(safe-area-inset-bottom)+32px)] md:px-8 lg:pb-16"
      >
        {children}
      </main>
      <BottomNav />
    </div>
  );
}
