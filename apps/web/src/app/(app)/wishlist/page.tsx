import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { WishlistScreen } from "@/features/wishlist/wishlist-screen";
import { getPageContext } from "@/server/context";
import { servicesFor } from "@/server/services";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("wishlist"))("title") };
}

export default async function WishlistPage() {
  const ctx = await getPageContext();
  if (!ctx) return null; // the (app) layout has already redirected signed-out visitors
  return <WishlistScreen initial={await servicesFor(ctx).wishlist.list()} />;
}
