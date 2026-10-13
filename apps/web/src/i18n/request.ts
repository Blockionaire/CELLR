import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { isLocale, LOCALE_COOKIE, pickLocale } from "./config";

// No locale in the URL: the person's choice lives in a cookie (synced from their profile), so routes stay
// identical for web, installed PWA and a future native app. Without a choice yet, the browser's language decides.
export default getRequestConfig(async () => {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : pickLocale((await headers()).get("accept-language"));
  return { locale, messages: (await import(`../../messages/${locale}.json`)).default };
});
