import "server-only";
import type {
  InsightOutput,
  SaveTastePreferences,
  TastePreferences,
  WineType,
} from "@cellr/domain";

/** One of my tastings with its wine, as read for the taste profile. */
export interface TasteRow {
  wineId: string;
  vintageId: string;
  producer: string;
  wineName: string;
  year: number | null;
  type: WineType;
  region: string | null;
  appellation: string | null;
  score: number | null;
  /** From the curated catalogue (wine_grapes). */
  curatedGrapes: string[];
}

export interface TasteRepository {
  /** My own tastings in this household (all of them, paged on the server). Null before the tastings step. */
  listMyTastings(householdId: string, userId: string): Promise<TasteRow[] | null>;
  /** The household's AI profiles of these vintages. */
  listInsights(householdId: string, vintageIds: string[]): Promise<Map<string, InsightOutput>>;
  /** Of these vintages, the ones the household still has in the cellar or opened (their pages open). */
  listAvailableVintages(householdId: string, vintageIds: string[]): Promise<Set<string>>;
  /** Null before the taste-preferences step. */
  getPreferences(userId: string): Promise<TastePreferences | null>;
  /** False before the taste-preferences step. */
  savePreferences(userId: string, input: SaveTastePreferences): Promise<boolean>;
}
