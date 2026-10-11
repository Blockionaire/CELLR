import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import { Providers } from "@/ui/providers";
import { readThemeCookie, THEME_COOKIE } from "@/ui/theme-cookie";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "CELLR", template: "%s · CELLR" },
  description: "Your personal intelligent wine cellar.",
  applicationName: "CELLR",
  // iOS home-screen app. 'default' keeps the status bar legible in both themes (verify on a device).
  appleWebApp: { capable: true, title: "CELLR", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover", // use the whole screen; the shell pads for the notch and home indicator
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#141211" },
    { media: "(prefers-color-scheme: light)", color: "#f6f2ea" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const theme = readThemeCookie((await cookies()).get(THEME_COOKIE)?.value);

  return (
    <html lang={locale} data-theme={theme}>
      <body>
        <NextIntlClientProvider>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
