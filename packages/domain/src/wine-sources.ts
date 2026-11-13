import type { DrinkSummary } from "./cellar";
import type { FactOrigin, SourceNotice } from "./provenance";

/**
 * "BRONNEN & BETROUWBAARHEID" OF ONE WINE PAGE (Wine Intelligence WI-05): what is shown about a wine, sorted by where
 * it really comes from. Built from what the page already knows; it decides nothing and fetches nothing.
 *
 * Four groups, in a fixed order, each left out when it has nothing to say:
 *  - identity: is this a wine of the CELLR catalogue (checked by CELLR with the pages listed), or the household's
 *    own entry? An external source is listed only when its record was verifiably linked to this catalogue wine AND
 *    that source is cleared and shown to people. A household's own wine never gets a source it did not come from.
 *  - characteristics: the filled-in facts (colour, country, region, appellation), with the same origin.
 *  - ai: what CELLR estimated (profile, drinking window, value). Always an estimate, with its date; never a fact.
 *  - yours: what the household recorded (bottles, prices, tastings, photos, own window, own value).
 *
 * "Verified" is only ever said of CELLR's own catalogue check. A public dataset listing a wine verifies nothing.
 */

/** A page CELLR's catalogue check of a wine rests on (`wine_sources`). */
export interface CatalogSourceRef {
  name: string;
  url: string | null;
  retrievedAt: string | null;
}

/** What the server adds to what the page already has (GET /api/v1/wines/:id/sources). */
export interface WineSourcesData {
  /** A wine of the shared CELLR catalogue (the server's word: the page cannot tell by itself). */
  catalog: boolean;
  catalogSources: CatalogSourceRef[];
  /** Verified links to records of sources that are cleared and shown to people. Usually empty. */
  external: SourceNotice[];
}

export interface WineSourcesInput {
  wine: {
    type: string | null;
    countryCode: string | null;
    region: string | null;
    appellation: string | null;
  };
  data: WineSourcesData;
  /** Where the page's drinking window comes from, and whether there is one. */
  drink: Pick<DrinkSummary, "source" | "from" | "until">;
  /** CELLR's profile of this vintage, when one was made. */
  insight: {
    generatedAt: string;
    researched: boolean;
    sources: ReadonlyArray<{ name: string; url: string }>;
  } | null;
  /** The latest looked-up value, when there is one. */
  valuation: { valuedAt: string; sources: ReadonlyArray<{ name: string; url: string }> } | null;
  ownValue: boolean;
  yours: { bottles: number; opened: number; tastings: number; prices: number; photos: number };
}

export const CHARACTERISTIC_FIELDS = ["type", "countryCode", "region", "appellation"] as const;
export type CharacteristicField = (typeof CHARACTERISTIC_FIELDS)[number];

export interface AiSourceLine {
  kind: "profile" | "window_profile" | "window_table" | "valuation";
  /** When it was made (ISO); null for the style table, which has no date. */
  at: string | null;
  /** Pages the estimate rests on, as reported by the search; empty when none. Links only: never embedded. */
  pages: Array<{ name: string; url: string }>;
  /** A profile made without research rests on general knowledge of the style only. */
  researched?: boolean;
}

export interface YourLine {
  kind: "bottles" | "opened" | "prices" | "tastings" | "photos" | "own_window" | "own_value";
  /** How many (bottles, tastings…); 1 for the own window and own value. */
  count: number;
}

export interface WineSourcesView {
  identity: {
    origin: Extract<FactOrigin, "cellr_catalog" | "user_provided">;
    catalogSources: CatalogSourceRef[];
    external: SourceNotice[];
  };
  characteristics: Array<{
    field: CharacteristicField;
    origin: Extract<FactOrigin, "cellr_catalog" | "user_provided">;
  }>;
  ai: AiSourceLine[];
  yours: YourLine[];
}

/** Only http(s) links are ever offered as links; anything else is shown as its name alone. */
export function safeHttpUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

const pagesOf = (pages: ReadonlyArray<{ name: string; url: string }>) =>
  pages.flatMap((p) => {
    const url = safeHttpUrl(p.url);
    return url ? [{ name: p.name.trim() || new URL(url).hostname, url }] : [];
  });

export function wineSourcesView(input: WineSourcesInput): WineSourcesView {
  const { wine, data } = input;
  // Whether this is a catalogue wine is the server's statement, never the page's guess.
  const catalog = data.catalog === true;
  const origin = catalog ? "cellr_catalog" : "user_provided";

  // A source is credited only where it applies: a catalogue wine, a record shown to people. Each record once.
  const external = catalog
    ? [
        ...new Map(
          data.external
            .filter((n) => n.scope === "public")
            .map((n) => [`${n.providerId}:${n.externalId}`, n] as const),
        ).values(),
      ]
    : [];
  const catalogSources = catalog
    ? data.catalogSources.map((s) => ({ ...s, url: safeHttpUrl(s.url) }))
    : [];

  const characteristics = CHARACTERISTIC_FIELDS.filter((f) => {
    const value = wine[f];
    return value !== null && value !== "";
  }).map((field) => ({ field, origin }) as const);

  const ai: AiSourceLine[] = [];
  if (input.insight)
    ai.push({
      kind: "profile",
      at: input.insight.generatedAt,
      pages: pagesOf(input.insight.sources),
      researched: input.insight.researched,
    });
  const hasWindow = input.drink.from !== null && input.drink.until !== null;
  if (hasWindow && input.drink.source === "ai")
    ai.push({ kind: "window_profile", at: input.insight?.generatedAt ?? null, pages: [] });
  if (hasWindow && input.drink.source === "estimate")
    ai.push({ kind: "window_table", at: null, pages: [] });
  if (input.valuation)
    ai.push({
      kind: "valuation",
      at: input.valuation.valuedAt,
      pages: pagesOf(input.valuation.sources),
    });

  const yours: YourLine[] = [];
  const add = (kind: YourLine["kind"], count: number) => {
    if (count > 0) yours.push({ kind, count });
  };
  add("bottles", input.yours.bottles);
  add("opened", input.yours.opened);
  add("prices", input.yours.prices);
  add("tastings", input.yours.tastings);
  add("photos", input.yours.photos);
  if (hasWindow && input.drink.source === "own") add("own_window", 1);
  if (input.ownValue) add("own_value", 1);

  return { identity: { origin, catalogSources, external }, characteristics, ai, yours };
}
