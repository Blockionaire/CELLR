import { normalizeText } from "./cellar";
import { identityRelation, type IdentityRelation } from "./catalog-identity";
import type { CatalogSearchHit } from "./catalog-search";
import type { LabelFacts } from "./scan";

/**
 * A WINE NOBODY IN CELLR HAS ADDED YET (Sprint 004B). When a label is read and no CELLR wine fits (or several do),
 * an external source may know the wine. This ranks the source's records for what was read, so the review can offer
 * "this may be it" and pre-fill the new-wine form from a credited record.
 *
 * It never decides an identity. A record is never a CELLR wine: choosing one still creates the household's own wine,
 * which the person confirms. The resolver's candidates (CELLR wines, by `matchLabel`'s unchanged rules) always come
 * first and are never replaced by a record. Only records the server already offered to this person are ranked (the
 * people's search returns sources in the "public" scope only), so nothing here can widen what anyone sees.
 */

export const RECORD_SUGGESTIONS = {
  /** At most this many records are offered under the CELLR candidates. */
  most: 3,
} as const;

export const RECORD_REASONS = [
  /** Producer and name are equal to what was read (after case, accents and punctuation). Still only a suggestion. */
  "same_name",
  /** The same words apart from estate words, articles or order ("Château Margaux" / "Margaux"). */
  "name_variant",
  /** Alike letter for letter, not the same words: a misread or another wine. */
  "similar_name",
  /** A word makes it another bottling (Réserve, a second wine, a colour). Offered last. */
  "other_bottling",
  /** The name differs; only the producer and the search connect them. */
  "producer_only",
  /** The source lists the year read off the label. */
  "vintage_listed",
  /** The source lists vintages, but not the one read. Not a contradiction: its list may be incomplete. */
  "vintage_not_listed",
] as const;
export type RecordReason = (typeof RECORD_REASONS)[number];

export interface RecordSuggestion {
  hit: CatalogSearchHit;
  relation: IdentityRelation;
  reasons: RecordReason[];
  /** True / false when a year was read and the source lists vintages; null when either is missing. */
  vintageListed: boolean | null;
}

/** Best first. A contradiction (`different_producer`, `different_type`, `different_country`) is never offered. */
const ORDER: Partial<Record<IdentityRelation, number>> = {
  same: 0,
  variant: 1,
  uncertain: 2,
  different_wine: 3,
  different_cuvee: 4,
};

const REASON: Partial<Record<IdentityRelation, RecordReason>> = {
  same: "same_name",
  variant: "name_variant",
  uncertain: "similar_name",
  different_cuvee: "other_bottling",
  different_wine: "producer_only",
};

/**
 * The provider records among `hits` that may be the wine on this label, best first, at most `most`. A record whose
 * colour or country contradicts what was read is left out (a red label never suggests a white wine); a misread
 * producer is tolerated only as far as the search itself matched it. The search's order breaks ties.
 */
export function suggestRecordsForReading(
  facts: Pick<LabelFacts, "producer" | "name" | "type" | "countryCode" | "year">,
  hits: readonly CatalogSearchHit[],
  most: number = RECORD_SUGGESTIONS.most,
): RecordSuggestion[] {
  const producer = facts.producer ?? facts.name ?? "";
  if (normalizeText(producer) === "") return [];
  const out: Array<RecordSuggestion & { rank: number; at: number }> = [];
  hits.forEach((hit, at) => {
    if (hit.kind !== "record" || !hit.provider || !hit.recordId) return;
    if (facts.type && hit.type && facts.type !== hit.type) return;
    if (facts.countryCode && hit.countryCode && facts.countryCode !== hit.countryCode) return;
    // the label's producer (or its only big name) against the record. Without a wine name on the label the producer
    // must still be the record's: compared with the record's own name on both sides, so only the producer can differ
    // (review of Sprint 004B: "Castello Banfi" must never be offered another Castello's wine)
    const relation = facts.name
      ? identityRelation(
          { producer, name: facts.name, type: facts.type, countryCode: facts.countryCode },
          { producer: hit.producer, name: hit.name, type: hit.type, countryCode: hit.countryCode },
        ).relation
      : identityRelation({ producer, name: hit.name }, { producer: hit.producer, name: hit.name })
            .relation === "different_producer"
        ? "different_producer"
        : "different_wine";
    const rank = ORDER[relation];
    if (rank === undefined) return;
    const reasons: RecordReason[] = [REASON[relation]!];
    const listed = hit.vintages ?? [];
    const vintageListed =
      facts.year !== null && listed.length > 0 ? listed.includes(facts.year) : null;
    if (vintageListed === true) reasons.push("vintage_listed");
    if (vintageListed === false) reasons.push("vintage_not_listed");
    out.push({ hit, relation, reasons, vintageListed, rank, at });
  });
  return out
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        Number(b.vintageListed === true) - Number(a.vintageListed === true) ||
        a.at - b.at,
    )
    .slice(0, Math.max(0, most))
    .map(({ hit, relation, reasons, vintageListed }) => ({
      hit,
      relation,
      reasons,
      vintageListed,
    }));
}
