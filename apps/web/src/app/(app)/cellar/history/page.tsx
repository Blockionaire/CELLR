import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { HistoryScreen } from "@/features/history/history-screen";
import { getPageContext } from "@/server/context";
import { servicesFor } from "@/server/services";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("history"))("title") };
}

export default async function HistoryPage() {
  const ctx = await getPageContext();
  if (!ctx) return null;
  return <HistoryScreen initial={await servicesFor(ctx).cellar.history()} />;
}
