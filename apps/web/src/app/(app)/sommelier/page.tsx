import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SommelierScreen } from "@/features/sommelier/sommelier-screen";
import { getPageContext } from "@/server/context";
import { servicesFor } from "@/server/services";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("sommelier"))("title") };
}

export default async function SommelierPage() {
  const ctx = await getPageContext();
  if (!ctx) return null; // the (app) layout has already redirected signed-out visitors
  const home = await servicesFor(ctx)
    .cellar.home()
    .catch(() => null);
  return <SommelierScreen hasBottles={(home?.bottleCount ?? 0) > 0} />;
}
