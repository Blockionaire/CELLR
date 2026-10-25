import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { TasteScreen } from "@/features/taste/taste-screen";
import { getPageContext } from "@/server/context";
import { servicesFor } from "@/server/services";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("taste"))("title") };
}

/** My taste profile: worked out on the server from my own tastings and my own answers. */
export default async function TasteProfilePage() {
  const ctx = await getPageContext();
  if (!ctx) redirect("/sign-in");
  return <TasteScreen initial={await servicesFor(ctx).taste.profile()} />;
}
