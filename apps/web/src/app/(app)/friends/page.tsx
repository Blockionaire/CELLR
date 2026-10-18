import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { FriendsScreen } from "@/features/friends/friends-screen";
import { getPageContext } from "@/server/context";
import { servicesFor } from "@/server/services";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("friends"))("title") };
}

export default async function FriendsPage() {
  const ctx = await getPageContext();
  if (!ctx) return null; // the (app) layout has already redirected signed-out visitors
  const { friends } = servicesFor(ctx);
  const overview = await friends.overview();
  const sharing = overview.ready ? await friends.sharing().catch(() => null) : null;
  return <FriendsScreen initial={overview} initialSharing={sharing} />;
}
