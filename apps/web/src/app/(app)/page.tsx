import { redirect } from "next/navigation";
import { HomeScreen } from "@/features/home/home-screen";
import { getPageContext } from "@/server/context";
import { getPageMe } from "@/server/me";
import { servicesFor } from "@/server/services";

export default async function HomePage() {
  const me = await getPageMe();
  if (!me) redirect("/sign-in");
  const ctx = await getPageContext();
  if (!ctx) return null;
  // A person who has not made or joined a household yet has no cellar to summarise.
  const services = servicesFor(ctx);
  const [home, reminders] = await Promise.all([
    services.cellar.home().catch(() => null),
    services.insights.reminders().catch(() => ({ ready: false, items: [] })),
  ]);
  return (
    <HomeScreen
      name={me.displayName}
      reminders={reminders.items}
      home={
        home ?? {
          generatedAt: new Date(0).toISOString(),
          bottleCount: 0,
          wineCount: 0,
          valueCents: null,
          pricedCount: 0,
          currency: null,
          capacity: 0,
          used: 0,
          unplaced: 0,
          recentlyAdded: [],
          drinkSoon: [],
          atPeak: [],
          recentlyOpened: [],
        }
      }
    />
  );
}
