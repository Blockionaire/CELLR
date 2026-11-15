import "server-only";
import type { BottleStatus, WineType } from "@cellr/domain";

export interface ExportBottleRow {
  producer: string;
  wine: string;
  year: number | null;
  type: WineType;
  country: string | null;
  region: string | null;
  appellation: string | null;
  status: BottleStatus;
  place: string | null;
  row: number | null;
  col: number | null;
  sizeMl: number;
  priceCents: number | null;
  currency: string | null;
  purchasedAt: string | null;
  purchasedFrom: string | null;
  notes: string | null;
  addedAt: string;
  openedAt: string | null;
  /** The bottle's index within its position: only read for export version 2 (it needs migration 0043). */
  index?: number;
}

export interface ExportTastingRow {
  producer: string;
  wine: string;
  year: number | null;
  score: number | null;
  descriptors: string[];
  note: string | null;
  tastedAt: string;
  by: string | null;
}

export interface ExportRepository {
  /** `withIndex`: read each bottle's index too (export version 2). Left out, the query is version 1's, unchanged. */
  bottles(householdId: string, options?: { withIndex?: boolean }): Promise<ExportBottleRow[]>;
  /** Empty until the ratings step has been run. */
  tastings(householdId: string): Promise<ExportTastingRow[]>;
}
