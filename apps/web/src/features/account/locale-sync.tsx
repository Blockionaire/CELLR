"use client";

import { useLocale } from "next-intl";
import { useEffect } from "react";
import { isLocale } from "@/i18n/config";
import { rememberLocale } from "@/i18n/client";

/**
 * The profile is the truth for a signed-in person: on a device that shows another language (a new phone,
 * a cleared cookie), switch to the profile's once. Guarded so a browser that refuses cookies can't loop.
 */
export function LocaleSync({ profileLocale }: { profileLocale: string }) {
  const active = useLocale();
  useEffect(() => {
    if (!isLocale(profileLocale) || profileLocale === active) return;
    try {
      if (sessionStorage.getItem("cellr-locale-sync") === profileLocale) return;
      sessionStorage.setItem("cellr-locale-sync", profileLocale);
    } catch {
      return;
    }
    rememberLocale(profileLocale);
    window.location.reload();
  }, [profileLocale, active]);
  return null;
}
