import type { AnalyticsEventName, TrackEvent } from "@cellr/domain";

type Props = NonNullable<TrackEvent["props"]>;

/** Honour the browser's do-not-track signals: no request is made at all. */
function trackingDisabled(): boolean {
  if (typeof navigator === "undefined") return true;
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return nav.doNotTrack === "1" || nav.globalPrivacyControl === true;
}

/**
 * Fire-and-forget product event. Never throws, never blocks, never shows an error:
 * analytics must not be able to hurt the experience it measures.
 */
export function track(name: AnalyticsEventName, props: Props = {}, householdId?: string): void {
  if (trackingDisabled()) return;
  try {
    void fetch("/api/v1/events", {
      method: "POST",
      credentials: "same-origin",
      keepalive: true, // survives a page navigation that happens right after the click
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, props, ...(householdId ? { householdId } : {}) }),
    }).catch(() => {});
  } catch {
    // swallow: see above
  }
}
