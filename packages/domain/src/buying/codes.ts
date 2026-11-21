/**
 * Codes the buying advice uses, apart from the catalogue and the engine, so a screen can name them without
 * carrying either.
 */

/** How much is claimed about a suggestion. Without a retailer source the engine can only ever say "style". */
export const OFFER_LEVELS = ["style", "product", "online-offer", "local-availability"] as const;
export type OfferLevel = (typeof OFFER_LEVELS)[number];

export const STYLE_REASONS = [
  /** It suits the dish (the assessment says how). */
  "suits-dish",
  /** The receiver, or the person, likes wines like this. */
  "liked",
  /** A bottle people recognise as a present. */
  "gift-worthy",
  /** Goes with many things: good to have in the house. */
  "versatile",
  /** Something the cellar has none of. */
  "fills-gap",
] as const;
export type StyleReason = (typeof STYLE_REASONS)[number];
