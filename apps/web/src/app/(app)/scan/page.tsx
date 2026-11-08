import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { spotFromParams } from "@/features/cellar/add-spot";
import { ScanScreen } from "@/features/scan/scan-screen";
import { getPageContext } from "@/server/context";
import { getPageMe } from "@/server/me";
import { servicesFor } from "@/server/services";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("scan"))("title") };
}

type Props = { searchParams: Promise<{ place?: string; row?: string; col?: string }> };

export default async function ScanPage({ searchParams }: Props) {
  const params = await searchParams;
  const [me, ctx] = await Promise.all([getPageMe(), getPageContext()]);
  const currency = me?.households.find((h) => h.id === me.activeHouseholdId)?.currency ?? "EUR";
  // Scanning from "add a bottle here" in a rack: the first bottle scanned goes on that spot.
  const initialSpot =
    ctx && params.place
      ? spotFromParams(params, await servicesFor(ctx).cellar.storage())
      : undefined;
  return <ScanScreen currency={currency} initialSpot={initialSpot} />;
}
