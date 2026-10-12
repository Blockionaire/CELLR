import { LOCALE_COOKIE, type Locale } from "./config";

/** Remembers the language in the browser for a year (the server reads it on every page). */
export function rememberLocale(locale: Locale): void {
  try {
    document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; samesite=lax`;
  } catch {
    // cookies blocked: the language simply stays as it is
  }
}
