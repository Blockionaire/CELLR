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
  /** Sommelier 3.0: the food and pairing engines answer pairing questions (a plan, three honest outcomes). */
  "sommelier_engine",
  /** Sommelier 3.0: buying advice as wine styles, with the conversation that leads to it. Needs the engine. */
  "sommelier_buying",
  /** Sommelier 3.0: friends named in a question, with their consent. Needs the engine. */
  "sommelier_social",
  /** Sommelier 3.0: menus, wine-to-food, comparing, serving, quantities. Needs the engine. */
  "sommelier_experiences",
  /** Sommelier 3.0: a person can say what came of a bottle (opened, with the dish, how it went). Needs the engine. */
  "sommelier_learning",
] as const;
export type Feature = (typeof FEATURES)[number];
export type FeatureFlags = Readonly<Record<Feature, boolean>>;

/**
 * Switches that `all` does not turn on: each must be named. A deployment that was set to `all` for an earlier
 * epic must not start a later one by accident; these go live only when someone writes their name.
 */
export const NAMED_ONLY: ReadonlySet<Feature> = new Set<Feature>([
  "sommelier_engine",
  "sommelier_buying",
  "sommelier_social",
  "sommelier_experiences",
  "sommelier_learning",
]);
/** Switches that do nothing without another one. */
const REQUIRES: Partial<Record<Feature, Feature>> = {
  sommelier_buying: "sommelier_engine",
  sommelier_social: "sommelier_engine",
  sommelier_experiences: "sommelier_engine",
  sommelier_learning: "sommelier_engine",
};

export const NO_FEATURES: FeatureFlags = Object.freeze(
  Object.fromEntries(FEATURES.map((f) => [f, false])) as Record<Feature, boolean>,
);

/**
 * The switches from the setting. Fails closed: unset or empty is all off, an unknown name switches nothing on (and
 * never switches anything else off), and `all` is every feature except the ones that must be named (`NAMED_ONLY`).
 * A switch that needs another one stays off without it. Case and spaces are ignored.
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
  const on = (f: Feature) => names.has(f) || (all && !NAMED_ONLY.has(f));
  return Object.freeze(
    Object.fromEntries(
      FEATURES.map((f) => [f, on(f) && (REQUIRES[f] === undefined || on(REQUIRES[f]))]),
    ) as Record<Feature, boolean>,
  );
}
