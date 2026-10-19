import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { TonightScreen } from "@/features/tonight/tonight-screen";
import { getPageContext } from "@/server/context";
import { servicesFor } from "@/server/services";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("tonight"))("title") };
}

export default async function TonightPage({
  searchParams,
}: {
  searchParams: Promise<{ ask?: string | string[] }>;
}) {
  const { ask } = await searchParams;
  // Only a short, single question is taken from the address.
  const question = typeof ask === "string" ? ask.trim().slice(0, 200) || undefined : undefined;
  const ctx = await getPageContext();
  if (!ctx) return null; // the (app) layout has already redirected signed-out visitors
  const home = await servicesFor(ctx)
    .cellar.home()
    .catch(() => null);
  return <TonightScreen hasBottles={(home?.bottleCount ?? 0) > 0} ask={question} />;
}
