/**
 * THE WINE STYLE KNOWLEDGE of the pairing engine: what a region, a grape or an appellation usually says about a
 * wine's structure, and the names a dish's list of classics may call it by.
 *
 * Written for CELLR from general wine knowledge: the typical style of a place or a grape, not any one bottle. Not
 * copied from any book, database or website. Not yet reviewed by a wine professional. Every value is a judgement
 * on a coarse scale (see WineStructure), meant to rank and pair, not to describe a measured wine.
 */
import { STYLE_KEYS } from "../styles";
import { WINE_TYPES } from "../../cellar";
import type { WineKnowledge } from "../wine";
import { APPELLATION_RULES } from "./appellations";
import { GRAPE_RULES } from "./grapes";
import { REGION_RULES } from "./regions";

export { APPELLATION_RULES, GRAPE_RULES, REGION_RULES };

export const WINE_KNOWLEDGE: WineKnowledge = {
  rules: [...REGION_RULES, ...GRAPE_RULES, ...APPELLATION_RULES],
};

export const WINE_KNOWLEDGE_VERSION = "2026.11.1";

export const WINE_PROVENANCE = { source: "cellr", reviewed: false } as const;

export { STYLE_KEYS };
export type StyleKey = (typeof STYLE_KEYS)[number];

/** Every word a wine can answer to in a dish's list of classics: rule ids, rule keys, colours and style keys. */
export const ALL_WINE_KEYS: ReadonlySet<string> = new Set<string>([
  ...WINE_TYPES,
  ...STYLE_KEYS,
  ...WINE_KNOWLEDGE.rules.flatMap((r) => [r.id, ...r.keys]),
]);
