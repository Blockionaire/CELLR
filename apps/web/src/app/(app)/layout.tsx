import { redirect } from "next/navigation";
import { nextOnboardingStep } from "@cellr/domain";
import { getPageMe } from "@/server/me";
import { AppShell } from "@/ui/app-shell/app-shell";

/** Second layer behind the proxy: signed in? has a household? Otherwise the right door. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await getPageMe();
  if (!me) redirect("/sign-in");
  if (nextOnboardingStep(me) !== "done") redirect("/onboarding");
  return <AppShell>{children}</AppShell>;
}
