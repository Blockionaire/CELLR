import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SommelierScreen } from "@/features/sommelier/sommelier-screen";
import { getPageContext } from "@/server/context";
import { getFeatures } from "@/server/env";
import { servicesFor } from "@/server/services";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("sommelier"))("title") };
}

export default async function SommelierPage() {
  const ctx = await getPageContext();
  if (!ctx) return null; // the (app) layout has already redirected signed-out visitors
  const services = servicesFor(ctx);
  // The kept conversation comes along, so it is on screen at once; if it cannot be read here, the screen asks.
  const [home, conversation] = await Promise.all([
    services.cellar.home().catch(() => null),
    services.sommelierChat.current().catch(() => undefined),
  ]);
  return (
    <SommelierScreen
      hasBottles={(home?.bottleCount ?? 0) > 0}
      conversation={conversation}
      social={getFeatures().sommelier_social}
      learning={getFeatures().sommelier_learning}
    />
  );
}
