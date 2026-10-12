import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { CellarScreen } from "@/features/cellar/cellar-screen";
import { CELLAR_VIEW_COOKIE, parseViewMode } from "@/features/cellar/view-mode";
import { getPageContext } from "@/server/context";
import { servicesFor } from "@/server/services";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("cellar"))("title") };
}

export default async function CellarPage() {
  const ctx = await getPageContext();
  if (!ctx) return null; // the (app) layout has already redirected signed-out visitors
  const [initial, store] = await Promise.all([servicesFor(ctx).cellar.inventory(), cookies()]);
  const view = parseViewMode(store.get(CELLAR_VIEW_COOKIE)?.value);
  return <CellarScreen initial={initial} initialView={view} />;
}
