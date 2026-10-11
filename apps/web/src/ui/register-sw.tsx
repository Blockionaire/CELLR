"use client";

import { useEffect } from "react";
import { isDevelopment } from "@/lib/public-env";

/** Registers the service worker in production only (in development it would serve stale code). */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (isDevelopment() || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {
      // Offline support is an enhancement; a failed registration must never bother anyone.
    });
  }, []);
  return null;
}
