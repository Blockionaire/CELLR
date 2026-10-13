import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { InsightsScreen } from "@/features/stats/insights-screen";
import { getPageContext } from "@/server/context";
import { getPageMe } from "@/server/me";
import { servicesFor } from "@/server/services";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("insightsPage"))("title") };
}

export default async function InsightsPage() {
  const me = await getPageMe();
  if (!me) redirect("/sign-in");
  const ctx = await getPageContext();
  if (!ctx) return null;
  const stats = await servicesFor(ctx).stats.overview();
  return <InsightsScreen stats={stats} />;
}
