/**
 * FEATURE SWITCHES (Wine Intelligence epic). A new entry experience ships OFF and is switched on per deployment, so
 * a release can be rolled back by configuration and every existing flow keeps working exactly as before until
 * someone decides otherwise. One server-side setting (`CELLR_FEATURES`, comma-separated names) decides; pages pass
 * the resulting booleans down to the screens that need them. Nothing here is a secret or an entitlement.
 */
export const FEATURES = [
  /** Database-backed wine autocomplete in "add a bottle" and in Koopcheck's manual path. */
  "wine_search",
  /** The scan matches a vision reading through the bounded catalogue resolver instead of the whole wine list. */
  "scan_resolver",
  /** Koopcheck reuses a valid shared wine profile for the wine in the shop (no model call). */
  "purchase_intel",
  /** "Bronnen & betrouwbaarheid" on the wine page and the Koopcheck result. */
  "sources_panel",
] as const;
export type Feature = (typeof FEATURES)[number];
export type FeatureFlags = Readonly<Record<Feature, boolean>>;

export const NO_FEATURES: FeatureFlags = Object.freeze(
  Object.fromEntries(FEATURES.map((f) => [f, false])) as Record<Feature, boolean>,
);

/**
 * The switches from the setting. Fails closed: unset or empty is all off, an unknown name switches nothing on (and
 * never switches anything else off), and `all` is every feature. Case and spaces are ignored.
 */
export function parseFeatures(raw: string | null | undefined): FeatureFlags {
  if (!raw || raw.trim() === "") return NO_FEATURES;
  const names = new Set(
    raw
      .slice(0, 400)
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
  const all = names.has("all");
  return Object.freeze(
    Object.fromEntries(FEATURES.map((f) => [f, all || names.has(f)])) as Record<Feature, boolean>,
  );
}
