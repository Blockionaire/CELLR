import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { nextOnboardingStep } from "@cellr/domain";
import { OnboardingFlow } from "@/features/account/onboarding-flow";
import { getPageMe } from "@/server/me";

export const metadata: Metadata = { title: "Welcome" };

export default async function OnboardingPage() {
  const me = await getPageMe();
  if (!me) redirect("/sign-in");
  if (nextOnboardingStep(me) === "done") redirect("/");
  return <OnboardingFlow initialMe={me} />;
}
