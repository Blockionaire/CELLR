import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PurchaseCheckScreen } from "@/features/purchase-check/purchase-check-screen";
import { getFeatures } from "@/server/env";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("purchaseCheck"))("title") };
}

/** Koopcheck: is the bottle in the shop worth buying, given your cellar and your taste? */
export default function PurchaseCheckPage() {
  const features = getFeatures();
  return (
    <PurchaseCheckScreen
      catalogSearch={features.wine_search}
      sourcesPanel={features.sources_panel}
    />
  );
}
