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
  const services = servicesFor(ctx);
  // A failure to read the cellar is an error (with a way to try again), never an empty cellar: someone with 200
  // bottles must not be told their cellar starts here. Reminders are an extra and may quietly be missing.
  const [home, reminders] = await Promise.all([
    services.cellar.home(),
    services.insights.reminders().catch(() => ({ ready: false, items: [] })),
  ]);
  return <HomeScreen name={me.displayName} reminders={reminders.items} home={home} />;
}
