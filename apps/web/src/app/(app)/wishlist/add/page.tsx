import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AddWishFlow } from "@/features/wishlist/add-wish-flow";
import { getPageMe } from "@/server/me";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("wishlist"))("add") };
}

export default async function AddWishPage() {
  const me = await getPageMe();
  const currency = me?.households.find((h) => h.id === me.activeHouseholdId)?.currency ?? "EUR";
  return <AddWishFlow currency={currency} />;
}
