import { normalizeText } from "./cellar";
import { reusableInsight, type InsightOutput } from "./insights";
import type { FactOrigin } from "./provenance";
import type { PurchaseWine } from "./purchase-check";

/**
 * WHAT CELLR ALREADY KNOWS ABOUT A WINE, AND AT WHICH LEVEL (Wine Intelligence WI-04, ADR-003).
 *
 * A researched profile belongs to ONE vintage. Part of it is about the wine whatever the year (which grapes it is
 * made of, how it is built); part is about that year only (when to drink it, what it costs, how the season was).
 * Reusing the first across vintages saves research and helps a buying decision; reusing the second would be wrong
 * in a way nobody could see. So the two are different TYPES here:
 *
 *   - `VintageKnowledge`: a profile of exactly this vintage. May carry a drinking window.
 *   - `StableWineFacts`: the few structured facts that hold across vintages. It has NO field for a drinking window,
 *     a value, an alcohol level or any free text, so those cannot cross a vintage even by mistake.
 *
 * Both come only from profiles that meet the shared-profile bar again when read (`reusableInsight`: researched, on
 * pages about this exact wine, high confidence, current version, nothing contradicting the catalogue). Both remain
 * CELLR's AI estimates: reusing an estimate never turns it into a verified fact.
 */

/** A shared profile of one vintage of a catalogue wine, as stored (checked here before anything is used). */
export interface StoredProfile {
  /** The vintage's year; null = the non-vintage wine. */
  year: number | null;
  output: unknown;
  generatedAt: string;
}

export interface VintageKnowledge {
  year: number | null;
  output: InsightOutput;
  generatedAt: string;
}

/** The structure scales of a profile (1–5), each null when not known. */
export type WineStructure = NonNullable<InsightOutput["structure"]>;

export interface StableWineFacts {
  /** The grape varieties (never percentages), when every profile used names the same ones. */
  grapes: string[];
  /** Body, tannin, sweetness, acidity as typically found: a scale is kept only where the vintages agree. */
  structure: WineStructure | null;
  /** The vintages whose profiles these rest on (null = the non-vintage wine), newest first. */
  fromYears: Array<number | null>;
}

/** Every key a `StableWineFacts` may have. Pinned by a test: adding a vintage-specific field here is a decision. */
export const STABLE_FACT_KEYS = ["grapes", "structure", "fromYears"] as const;

/** The parts of a profile that belong to its vintage alone and are never carried to another year. */
export const VINTAGE_ONLY_FIELDS = [
  "drinkWindow",
  "value",
  "abvPercent",
  "decantMinutes",
  "aging",
  "summary",
  "tasting",
  "style",
  "flavors",
  "sources",
] as const satisfies ReadonlyArray<keyof InsightOutput>;

const grapeKey = (grapes: readonly string[]) =>
  [...new Set(grapes.map((g) => normalizeText(g)).filter(Boolean))].sort().join("|");

/** The valid profiles among the stored ones (each checked against its own vintage), newest vintage first. */
function validProfiles(
  profiles: readonly StoredProfile[],
  wine: { countryCode: string | null },
): VintageKnowledge[] {
  const out: VintageKnowledge[] = [];
  for (const p of profiles) {
    const output = reusableInsight(p.output, { year: p.year, countryCode: wine.countryCode });
    if (output) out.push({ year: p.year, output, generatedAt: p.generatedAt });
  }
  return out.sort((a, b) => (b.year ?? -1) - (a.year ?? -1));
}

/**
 * The profile of exactly this vintage, when there is a valid one. `year` null with `nonVintage` true is the
 * non-vintage wine; a vintage that is not known has no vintage-level knowledge at all.
 */
export function vintageKnowledge(
  profiles: readonly StoredProfile[],
  wine: { year: number | null; nonVintage: boolean; countryCode: string | null },
): VintageKnowledge | null {
  if (wine.year === null && !wine.nonVintage) return null;
  return validProfiles(profiles, wine).find((p) => p.year === wine.year) ?? null;
}

/**
 * What holds for the wine whatever the vintage, from every valid profile of it. Conservative on purpose:
 * grapes only when all of them name the same varieties; a structure scale only when the vintages lie within one
 * step of each other. Nothing else is ever returned (see the type).
 */
export function stableWineFacts(
  profiles: readonly StoredProfile[],
  wine: { countryCode: string | null },
): StableWineFacts | null {
  const valid = validProfiles(profiles, wine);
  if (valid.length === 0) return null;
  const keys = new Set(valid.map((p) => grapeKey(p.output.grapes)));
  const grapes = keys.size === 1 && !keys.has("") ? [...valid[0]!.output.grapes] : [];

  const scales = ["body", "tannin", "sweetness", "acidity"] as const;
  const structure = {} as WineStructure;
  let anyScale = false;
  for (const scale of scales) {
    const values = valid.map((p) => p.output.structure?.[scale] ?? null);
    const known = values.filter((v): v is number => v !== null);
    const agreed =
      known.length === values.length &&
      known.length > 0 &&
      Math.max(...known) - Math.min(...known) <= 1;
    structure[scale] = agreed ? Math.round(known.reduce((a, b) => a + b, 0) / known.length) : null;
    if (agreed) anyScale = true;
  }
  if (grapes.length === 0 && !anyScale) return null;
  return { grapes, structure: anyScale ? structure : null, fromYears: valid.map((p) => p.year) };
}

// ---- What a Koopcheck may add to the wine the person confirmed ------------------------------------------------

/** A fact CELLR added to the comparison because the person left it open. What they typed is never replaced. */
export interface AddedFact {
  field: "type" | "countryCode" | "region" | "appellation" | "grapes";
  value: string;
  /** Where it comes from: the curated catalogue (verified), or CELLR's own AI estimate. Never a provider here. */
  origin: Extract<FactOrigin, "cellr_catalog" | "ai_estimate">;
  /** A fact about the wine whatever the year, or about this vintage only. */
  level: "wine" | "vintage";
  /** For an estimate taken from other vintages' profiles: which ones (null = the non-vintage wine). */
  fromYears?: Array<number | null>;
}

export const PURCHASE_KNOWLEDGE_STATUSES = [
  /** A valid profile of exactly this vintage exists and was reused (no research call). */
  "vintage_profile",
  /** No profile of this vintage; stable facts of the wine were taken from other vintages' profiles. */
  "stable_facts",
  /** Only what the curated catalogue records about the wine. */
  "catalog_only",
] as const;
export type PurchaseKnowledgeStatus = (typeof PURCHASE_KNOWLEDGE_STATUSES)[number];

/** What CELLR knew about the wine in the shop beyond what the person confirmed, and where each part came from. */
export interface PurchaseKnowledge {
  status: PurchaseKnowledgeStatus;
  /** The catalogue wine the confirmed facts exactly are. */
  catalogWineId: string;
  /** What was added to the comparison (each with its origin); empty when the person had filled everything in. */
  added: AddedFact[];
  /**
   * The reused profile of exactly this vintage, for the person to read: an AI estimate, with its date. Null when
   * there is none. Only this, never a profile of another year, may show a drinking window.
   */
  profile: {
    year: number | null;
    summary: string;
    style: string;
    drinkWindow: { from: number; until: number } | null;
    structure: WineStructure | null;
    generatedAt: string;
    sources: number;
  } | null;
}

/** What the curated catalogue records about a wine (verified by the owner with a public source). */
export interface CatalogWineFacts {
  id: string;
  type: PurchaseWine["type"];
  countryCode: string | null;
  region: string | null;
  appellation: string | null;
  /** Curated grapes; empty when the catalogue lists none. */
  grapes: string[];
}

/**
 * The wine as it is compared: what the person confirmed, with only its OPEN fields filled — first from the
 * catalogue (verified), then, for grapes, from a valid profile of this vintage, then from the wine's stable facts.
 * Returns the wine to compare and the record of what was added. Pure.
 */
export function enrichPurchaseWine(
  confirmed: PurchaseWine,
  catalog: CatalogWineFacts,
  profiles: readonly StoredProfile[],
  countries: readonly string[],
): { wine: PurchaseWine; knowledge: PurchaseKnowledge } {
  const added: AddedFact[] = [];
  const wine: PurchaseWine = { ...confirmed, grapes: [...confirmed.grapes] };
  const fromCatalog = (field: AddedFact["field"], value: string) =>
    added.push({ field, value, origin: "cellr_catalog", level: "wine" });

  if (wine.type === null && catalog.type) {
    wine.type = catalog.type;
    fromCatalog("type", catalog.type);
  }
  if (wine.countryCode === null && catalog.countryCode && countries.includes(catalog.countryCode)) {
    wine.countryCode = catalog.countryCode as PurchaseWine["countryCode"];
    fromCatalog("countryCode", catalog.countryCode);
  }
  if (wine.region === null && catalog.region) {
    wine.region = catalog.region;
    fromCatalog("region", catalog.region);
  }
  if (wine.appellation === null && catalog.appellation) {
    wine.appellation = catalog.appellation;
    fromCatalog("appellation", catalog.appellation);
  }

  const exact = vintageKnowledge(profiles, {
    year: confirmed.year,
    nonVintage: confirmed.nonVintage,
    countryCode: catalog.countryCode,
  });
  const stable = exact ? null : stableWineFacts(profiles, { countryCode: catalog.countryCode });

  if (wine.grapes.length === 0) {
    if (catalog.grapes.length > 0) {
      wine.grapes = catalog.grapes.slice(0, 6);
      fromCatalog("grapes", wine.grapes.join(", "));
    } else if (exact && exact.output.grapes.length > 0) {
      wine.grapes = exact.output.grapes.slice(0, 6);
      added.push({
        field: "grapes",
        value: wine.grapes.join(", "),
        origin: "ai_estimate",
        level: "vintage",
      });
    } else if (stable && stable.grapes.length > 0) {
      wine.grapes = stable.grapes.slice(0, 6);
      added.push({
        field: "grapes",
        value: wine.grapes.join(", "),
        origin: "ai_estimate",
        level: "wine",
        fromYears: stable.fromYears,
      });
    }
  }

  return {
    wine,
    knowledge: {
      status: exact ? "vintage_profile" : stable ? "stable_facts" : "catalog_only",
      catalogWineId: catalog.id,
      added,
      profile: exact
        ? {
            year: exact.year,
            summary: exact.output.summary,
            style: exact.output.style,
            // a window belongs to this vintage only, and a non-vintage wine keeps none
            drinkWindow: exact.output.drinkWindow,
            structure: exact.output.structure,
            generatedAt: exact.generatedAt,
            sources: exact.output.sources.length,
          }
        : null,
    },
  };
}
