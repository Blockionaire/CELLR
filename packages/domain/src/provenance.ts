/**
 * WHERE A FACT COMES FROM (Sprint 004A): the model behind a wine page's "Bronnen & betrouwbaarheid" section.
 *
 * Four origins, never mixed up:
 * - cellr_catalog: CELLR's curated catalogue (canonical wines, verified by the owner with a public source);
 * - external_catalog: a licensed external provider's record (credited, with its licence and CELLR's modifications);
 * - ai_estimate: CELLR's own AI estimate (drinking windows, profiles, valuations): an estimate, never a fact;
 * - user_provided: what the household entered or confirmed (typed, read off their label and confirmed).
 * External licensed data stays distinguishable from CELLR's own and from household data; an attribution never says
 * or suggests that a provider endorses, sponsors or partners with CELLR (CC BY 4.0, section 2(a)(6)).
 */

export const FACT_ORIGINS = [
  "cellr_catalog",
  "external_catalog",
  "ai_estimate",
  "user_provided",
] as const;
export type FactOrigin = (typeof FACT_ORIGINS)[number];

/** The database's `provenance_source` (migration 0001) → the origin shown to people. */
export function originOf(
  source:
    "verified" | "licensed_import" | "label_ocr" | "user_entered" | "ai_estimate" | "heuristic",
): FactOrigin {
  switch (source) {
    case "verified":
      return "cellr_catalog";
    case "licensed_import":
      return "external_catalog";
    case "ai_estimate":
    case "heuristic":
      return "ai_estimate";
    case "label_ocr":
    case "user_entered":
      return "user_provided";
  }
}

/** One external source as a wine page credits it (from `catalog_record_provenance`). */
export interface SourceNotice {
  providerId: string;
  providerName: string;
  license: string;
  licenseUrl: string | null;
  /** The credit the licence requires, verbatim from the provider row. */
  attribution: string | null;
  /** Whether CELLR changed the provider's record, and how (shown when it did). */
  modified: boolean;
  modificationNotice: string | null;
  modifications: string[];
  /** The provider's full legal notice exists (shown behind "more"). */
  legalNotice: string | null;
  externalId: string;
  sourceUrl: string | null;
  retrievedAt: string | null;
  datasetVersion: string | null;
  /** Only "public" providers ever reach a wine page (pilot data is never shown to people). */
  scope: "public";
}

export interface ProvenancedFact {
  /** e.g. "producer", "region", "grapes", "drinkWindow", "price" */
  field: string;
  origin: FactOrigin;
  /** For external_catalog: which source. */
  source?: SourceNotice;
}

export type Locale = "nl" | "en";

const LABELS: Record<Locale, Record<FactOrigin, string>> = {
  nl: {
    cellr_catalog: "CELLR-catalogus (gecontroleerd)",
    external_catalog: "Externe wijndatabase",
    ai_estimate: "Schatting door CELLR (AI)",
    user_provided: "Door jullie ingevoerd",
  },
  en: {
    cellr_catalog: "CELLR catalogue (verified)",
    external_catalog: "External wine database",
    ai_estimate: "CELLR estimate (AI)",
    user_provided: "Entered by your household",
  },
};
export const originLabel = (origin: FactOrigin, locale: Locale): string => LABELS[locale][origin];

const NO_ENDORSEMENT: Record<Locale, (name: string) => string> = {
  nl: (name) => `${name} is niet verbonden aan CELLR en onderschrijft CELLR niet.`,
  en: (name) => `${name} is not affiliated with and does not endorse CELLR.`,
};
export const noEndorsement = (name: string, locale: Locale): string => NO_ENDORSEMENT[locale](name);

/**
 * The compact credit line under the external facts: the source, its licence, and — when CELLR changed the record —
 * that it did. Deliberately plain ("Bron:" / "Source:"): never "in partnership with", "powered by" or "official".
 */
export function attributionLine(n: SourceNotice, locale: Locale): string {
  const credit = n.attribution ?? n.providerName;
  const parts =
    locale === "nl"
      ? [`Bron: ${credit}`, `licentie ${n.license}`]
      : [`Source: ${credit}`, `licence ${n.license}`];
  if (n.modified) parts.push(locale === "nl" ? "bewerkt door CELLR" : "modified by CELLR");
  return parts.join(" · ");
}

/** The facts of one wine page grouped by origin, in the order the section shows them; empty groups are left out. */
export function groupByOrigin(
  facts: readonly ProvenancedFact[],
): Array<{ origin: FactOrigin; facts: ProvenancedFact[] }> {
  return FACT_ORIGINS.map((origin) => ({
    origin,
    facts: facts.filter((f) => f.origin === origin),
  })).filter((g) => g.facts.length > 0);
}

/** Each external source once (by provider and record), for the credits and the "full legal notices" sheet. */
export function sourcesOf(facts: readonly ProvenancedFact[]): SourceNotice[] {
  const seen = new Map<string, SourceNotice>();
  for (const f of facts)
    if (f.origin === "external_catalog" && f.source)
      seen.set(`${f.source.providerId}:${f.source.externalId}`, f.source);
  return [...seen.values()];
}
