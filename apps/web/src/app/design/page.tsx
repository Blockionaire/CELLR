import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { Gallery } from "@/features/design/gallery";
import { isDesignGalleryEnabled } from "@/server/env";
import { readThemeCookie, THEME_COOKIE } from "@/ui/theme-cookie";

export const metadata: Metadata = {
  title: "Design system",
  robots: { index: false, follow: false },
};

export default async function DesignPage() {
  if (!isDesignGalleryEnabled()) notFound();
  const theme = readThemeCookie((await cookies()).get(THEME_COOKIE)?.value) ?? "system";
  return <Gallery initialTheme={theme} />;
}
