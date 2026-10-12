import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ScanScreen } from "@/features/scan/scan-screen";
import { getPageMe } from "@/server/me";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("scan"))("title") };
}

export default async function ScanPage() {
  const me = await getPageMe();
  const currency = me?.households.find((h) => h.id === me.activeHouseholdId)?.currency ?? "EUR";
  return <ScanScreen currency={currency} />;
}
