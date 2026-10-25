import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { RatingsScreen } from "@/features/ratings/ratings-screen";
import { getPageContext } from "@/server/context";
import { servicesFor } from "@/server/services";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("ratings"))("title") };
}

/** My tasting journal: only the signed-in person's own tastings, in their active household. */
export default async function RatingsPage() {
  const ctx = await getPageContext();
  if (!ctx) redirect("/sign-in");
  const journal = await servicesFor(ctx).cellar.journal();
  return <RatingsScreen initial={journal} />;
}
