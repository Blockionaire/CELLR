import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AddBottleFlow } from "@/features/cellar/add-bottle-flow";
import { getPageMe } from "@/server/me";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("addBottle"))("eyebrow") };
}

export default async function AddBottlePage() {
  const me = await getPageMe();
  const currency = me?.households.find((h) => h.id === me.activeHouseholdId)?.currency ?? "EUR";
  return <AddBottleFlow currency={currency} />;
}
