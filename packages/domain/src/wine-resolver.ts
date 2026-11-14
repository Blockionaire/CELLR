import { normalizeText, type WineSummary } from "./cellar";
import { identityRelation, type IdentityRelation } from "./catalog-identity";
import {
  isCatalogIdentity,
  matchLabel,
  type LabelFacts,
  type LabelMatch,
  type ScanOutcome,
} from "./scan";

/**
 * WHICH WINE IS THIS? (Wine Intelligence WI-03.) One answer for every place that has facts about a wine — a label
 * the vision model read, text the phone read, something a person typed — and needs to know which CELLR wine that
 * is, if any. It takes the facts and a BOUNDED set of candidates the server looked up (the household's own wines,
 * the catalogue wines of that producer, the best search hits), and says: exactly this one, one of these, or none.
 *
 * It decides nothing new. The decision is `matchLabel`'s, with its rules unchanged: a catalogue wine is "the one"
 * only on an exact identity (the producer, the name or a verified alias, no contradicting colour or country), the
 * household's own wine is never passed over, and a similar name is only ever offered. What this adds is the WHY for
 * each candidate, so a review screen can show what tells them apart instead of a bare guess — and two numbers that
 * are never mixed up: how sure the READING was (the facts' confidence) and how sure the MATCH is (`score`).
 *
 * It never changes a wine, never creates one, and never turns a candidate into an identity: a person confirms.
 */
export type ResolveStatus =
  /** Exactly one wine is this identity. Still shown to the person; never assumed. */
  | "exact_candidate"
  /** One or more wines it may be: the person chooses, or says "none of these". */
  | "ambiguous"
  /** Nothing among the candidates comes close: a new wine, typed or confirmed by the person. */
  | "not_found";

export const RESOLVE_REASONS = [
  /** The producer and the name (or a verified alias) are exactly this catalogue wine's. */
  "catalog_identity",
  /** It matched on a verified other name of the wine. */
  "alias",
  /** The household's own wine, by exactly this producer and name. */
  "own_identity",
  /** The household's own wine, close enough to be offered first. */
  "own_similar",
  /** The names are alike, not equal: a spelling, a longer form, or another wine. */
  "similar_name",
  /** Another bottling of that name: a reserve, a second wine, another colour. */
  "other_bottling",
  /** Only the producer fits: the label showed no wine name. */
  "producer_only",
  /** What was read contradicts this wine's colour. */
  "type_differs",
  /** What was read contradicts this wine's country. */
  "country_differs",
] as const;
export type ResolveReason = (typeof RESOLVE_REASONS)[number];

export interface ResolveCandidate extends LabelMatch {
  /** Whose wine it is: the household's own, or the shared catalogue's. */
  kind: "household" | "canonical";
  /** This candidate is exactly the identity that was read (never true for a merely similar name). */
  exact: boolean;
  /** Why it is offered, most telling first. */
  reasons: ResolveReason[];
}

export interface ResolveOutcome {
  status: ResolveStatus;
  /** Best first; empty for `not_found`. At most `MATCH.most`. */
  candidates: ResolveCandidate[];
  /** The vintage as it was read. A match never changes it, and never invents one. */
  year: number | null;
  nonVintage: boolean;
}

const REASON_OF: Partial<Record<IdentityRelation, ResolveReason>> = {
  different_cuvee: "other_bottling",
  different_type: "type_differs",
  different_country: "country_differs",
};

function explain(
  facts: LabelFacts,
  wine: WineSummary,
): { exact: boolean; reasons: ResolveReason[] } {
  const reasons: ResolveReason[] = [];
  const producer = facts.producer ?? "";
  const name = facts.name ?? "";
  const sameProducer = producer !== "" && normalizeText(producer) === normalizeText(wine.producer);
  const sameName = name !== "" && normalizeText(name) === normalizeText(wine.name);
  const viaAlias =
    name !== "" &&
    !sameName &&
    (wine.aliases ?? []).some((a) => normalizeText(a) === normalizeText(name));
  const exact = wine.catalog
    ? isCatalogIdentity(facts, wine)
    : sameProducer &&
      sameName &&
      !(facts.type && facts.type !== wine.type) &&
      !(facts.countryCode && wine.countryCode && facts.countryCode !== wine.countryCode);

  if (exact) reasons.push(wine.catalog ? "catalog_identity" : "own_identity");
  if (viaAlias) reasons.push("alias");
  if (facts.type && facts.type !== wine.type) reasons.push("type_differs");
  if (facts.countryCode && wine.countryCode && facts.countryCode !== wine.countryCode)
    reasons.push("country_differs");
  if (!exact) {
    if (name === "") reasons.push("producer_only");
    else {
      const relation = identityRelation(
        { producer: producer || wine.producer, name },
        { producer: wine.producer, name: wine.name },
      ).relation;
      const mapped = REASON_OF[relation];
      if (mapped && !reasons.includes(mapped)) reasons.push(mapped);
      else if (!mapped) reasons.push(!wine.catalog ? "own_similar" : "similar_name");
    }
  }
  return { exact, reasons };
}

/**
 * The scan's own three outcomes for a resolver status (the screens and the learning signals speak this language).
 */
export const scanOutcomeOf = (status: ResolveStatus): Exclude<ScanOutcome, "unread"> =>
  status === "exact_candidate" ? "found" : status === "ambiguous" ? "choose" : "new";

/**
 * Resolves the facts against the candidates. `candidates` may hold a wine more than once (it came from several
 * lookups): it is considered once. The order of `candidates` never changes the answer.
 */
export function resolveWine(facts: LabelFacts, candidates: readonly WineSummary[]): ResolveOutcome {
  const unique = [...new Map(candidates.map((w) => [w.id, w])).values()];
  const { outcome, matches } = matchLabel(facts, unique);
  const status: ResolveStatus =
    outcome === "found" ? "exact_candidate" : outcome === "choose" ? "ambiguous" : "not_found";
  return {
    status,
    candidates: matches.map((m) => ({
      ...m,
      kind: m.wine.catalog ? "canonical" : "household",
      ...explain(facts, m.wine),
    })),
    year: facts.year,
    nonVintage: facts.nonVintage,
  };
}

/**
 * The words to search the catalogue with for these facts: the producer and the name as read (or whichever there is).
 * Null when nothing was read that could name a wine.
 */
export function resolverQuery(facts: Pick<LabelFacts, "producer" | "name">): string | null {
  const text = [facts.producer, facts.name].filter(Boolean).join(" ").trim();
  return text === "" ? null : text.slice(0, 200);
}
