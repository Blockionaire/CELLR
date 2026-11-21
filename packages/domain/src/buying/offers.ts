import { normalizeText } from "../cellar";
import type { BuyChannel } from "./state";

/**
 * REAL BOTTLES IN REAL SHOPS, and what may be said about them. A retailer source (a provider) returns offers; this
 * file decides which of them may be shown and how much each one proves. Nothing here fetches anything, and nothing
 * here can produce an offer: an offer only ever comes from a provider, and one that fails a single check is not
 * shown at all. With no provider the sommelier gives a style and says that it could not check any shop.
 *
 * Four levels of claim, never mixed up:
 *   style               a kind of wine to look for (no provider needed)
 *   product             a named wine that exists (a catalogue says so); no price, no shop
 *   online-offer        a shop's own page listed this bottle at this price, seen recently
 *   local-availability  a named store confirmed it has the bottle, seen very recently
 */

/** An offer as a provider reports it. Untrusted until `checkOffer` has passed it. */
export interface RetailOffer {
  /** The provider's id for the offer. */
  id: string;
  producer: string;
  name: string;
  year: number | null;
  sizeMl: number;
  /** The price in minor units, taxes included, per bottle. */
  priceCents: number | null;
  currency: string;
  merchant: string;
  /** The page of this bottle at the merchant. */
  url: string;
  /** When the provider last saw this price and stock, ISO 8601. */
  observedAt: string;
  kind: "online" | "local";
  /** For a local offer: the store, and whether the store itself confirmed stock (not a chain-wide listing). */
  store?: { name: string; verified: boolean } | null;
  /** False when the merchant says it is sold out; null or absent when it does not say. */
  inStock?: boolean | null;
}

export interface OfferQuery {
  /** What is being looked for, as words that must all appear in the offer ("chablis", "rioja reserva"). */
  text: string;
  /** A vintage the person asked for; null when any will do. */
  year: number | null;
  /** The bottle size wanted; an ordinary bottle unless they said otherwise. */
  sizeMl: number;
  maxCents: number | null;
  currency: string;
  channel: BuyChannel | null;
}

export const OFFER_DEFECTS = [
  "identity-mismatch",
  "wrong-vintage",
  "wrong-size",
  "no-price",
  "wrong-currency",
  "over-budget",
  "no-merchant",
  "no-url",
  "insecure-url",
  "foreign-url",
  "stale",
  "out-of-stock",
  "unverified-store",
  "wrong-channel",
] as const;
export type OfferDefect = (typeof OFFER_DEFECTS)[number];

export interface OfferPolicy {
  /** How old an observation may be, in hours. Stock in a store changes faster than a web listing. */
  maxAgeHours: { online: number; local: number };
  /** Hosts the provider is allowed to link to (its merchants). Empty: none, so nothing is shown. */
  allowedHosts: readonly string[];
}
export const DEFAULT_OFFER_POLICY: OfferPolicy = {
  maxAgeHours: { online: 24, local: 6 },
  allowedHosts: [],
};

export const STANDARD_BOTTLE_ML = 750;
/** No bottle a sommelier is asked about costs more; a larger number is bad data. */
const MAX_OFFER_CENTS = 10_000_000;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;

/** Everything wrong with an offer for this query. Empty: it may be shown. */
export function checkOffer(
  offer: RetailOffer,
  query: OfferQuery,
  now: Date,
  policy: OfferPolicy = DEFAULT_OFFER_POLICY,
): OfferDefect[] {
  const defects: OfferDefect[] = [];
  const add = (d: OfferDefect) => void defects.push(d);

  // Every word asked for must be on the offer, and at least one of them in the wine's own name: a producer
  // called "Chablis Frères" selling a Mâcon is not a Chablis. A query for nothing matches nothing.
  const label = ` ${normalizeText(`${offer.producer} ${offer.name}`)} `;
  const name = ` ${normalizeText(offer.name)} `;
  const wanted = normalizeText(query.text).split(" ").filter(Boolean);
  if (
    wanted.length === 0 ||
    wanted.some((w) => !label.includes(` ${w} `)) ||
    !wanted.some((w) => name.includes(` ${w} `))
  )
    add("identity-mismatch");
  if (query.year !== null && offer.year !== query.year) add("wrong-vintage");
  if (offer.sizeMl !== query.sizeMl) add("wrong-size");

  if (
    offer.priceCents === null ||
    !Number.isInteger(offer.priceCents) ||
    offer.priceCents <= 0 ||
    offer.priceCents > MAX_OFFER_CENTS
  )
    add("no-price");
  else if (offer.currency !== query.currency) add("wrong-currency");
  else if (query.maxCents !== null && offer.priceCents > query.maxCents) add("over-budget");

  if (offer.merchant.trim() === "") add("no-merchant");

  let url: URL | null = null;
  try {
    url = offer.url.trim() === "" ? null : new URL(offer.url);
  } catch {
    url = null;
  }
  if (!url || url.hostname === "") add("no-url");
  else if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== ""
  )
    add("insecure-url");
  else {
    // Only the provider's own merchants, compared as hosts are: lower case, no trailing dot. No list: no host.
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    const allowed = policy.allowedHosts.map((h) => h.trim().toLowerCase().replace(/\.$/, ""));
    if (!allowed.some((h) => h !== "" && (host === h || host.endsWith(`.${h}`))))
      add("foreign-url");
  }

  // A timestamp with its zone, as ISO 8601 writes it: anything else could mean another moment.
  const seen = ISO_INSTANT.test(offer.observedAt) ? Date.parse(offer.observedAt) : Number.NaN;
  const ageHours = (now.getTime() - seen) / 3_600_000;
  // No timestamp, one from the future, or one that is too old: the price and the stock are not known now.
  if (!Number.isFinite(seen) || ageHours < -0.1 || ageHours > policy.maxAgeHours[offer.kind])
    add("stale");
  if (offer.inStock === false) add("out-of-stock");

  // "In a store nearby" is a claim about a shelf: the store itself must have confirmed it, and the stock.
  if (offer.kind === "local" && (offer.store?.verified !== true || offer.inStock !== true))
    add("unverified-store");
  if (query.channel === "online" && offer.kind !== "online") add("wrong-channel");
  if (query.channel === "pickup" && offer.kind !== "local") add("wrong-channel");
  return defects;
}

/** How much a checked offer proves. */
export const offerLevel = (offer: Pick<RetailOffer, "kind">) =>
  offer.kind === "local" ? ("local-availability" as const) : ("online-offer" as const);

export interface ShownOffer {
  offer: RetailOffer;
  level: "online-offer" | "local-availability";
}

/** The offers that may be shown for a query, cheapest first; and, for the record, why the others were not. */
export function selectOffers(
  offers: readonly RetailOffer[],
  query: OfferQuery,
  now: Date,
  policy: OfferPolicy = DEFAULT_OFFER_POLICY,
  limit = 3,
): { shown: ShownOffer[]; rejected: Array<{ id: string; defects: OfferDefect[] }> } {
  const shown: ShownOffer[] = [];
  const rejected: Array<{ id: string; defects: OfferDefect[] }> = [];
  for (const offer of offers) {
    const defects = checkOffer(offer, query, now, policy);
    if (defects.length > 0) rejected.push({ id: offer.id, defects });
    else shown.push({ offer, level: offerLevel(offer) });
  }
  shown.sort((a, b) => a.offer.priceCents! - b.offer.priceCents!);
  return { shown: shown.slice(0, limit), rejected };
}

/**
 * A retailer source. The app has none configured: a real one needs a commercial or licence agreement with the
 * merchant or data owner, which is the owner's decision. Until then the server's provider is absent, the sommelier
 * says it could not check shops, and no offer exists anywhere in an answer.
 */
export interface OfferProvider {
  id: string;
  /** Hosts this provider's offers may link to. */
  allowedHosts: readonly string[];
  search(query: OfferQuery): Promise<RetailOffer[]>;
}
