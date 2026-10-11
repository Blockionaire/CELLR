import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ProfileView } from "@/features/account/profile-view";
import { getPageMe } from "@/server/me";
import { PageHeader } from "@/ui/page-header";
import { readThemeCookie, THEME_COOKIE } from "@/ui/theme-cookie";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("profile"))("title") };
}

export default async function ProfilePage() {
  const me = await getPageMe();
  if (!me) redirect("/sign-in");
  const t = await getTranslations("profile");
  const theme = readThemeCookie((await cookies()).get(THEME_COOKIE)?.value) ?? "system";

  return (
    <>
      <PageHeader title={t("title")} />
      <ProfileView initialMe={me} initialTheme={theme} />
    </>
  );
}
