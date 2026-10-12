import type { StorageKind, WineType } from "@cellr/domain";
import type { BottleShape } from "@/ui/bottle-glyph";

/** Which silhouette suits which wine. Real label photos replace these later. */
export const shapeFor = (type: WineType): BottleShape =>
  type === "sparkling"
    ? "champagne"
    : type === "red" || type === "fortified"
      ? "bordeaux"
      : "burgundy";

/** "FR" → "France", in the viewer's language. Falls back to the code if the runtime can't name it. */
export function countryName(code: string | null, locale: string): string | null {
  if (!code) return null;
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** "Bordeaux, France" — region first, country as context. */
export function placeLine(region: string | null, countryCode: string | null, locale: string) {
  return [region, countryName(countryCode, locale)].filter(Boolean).join(", ");
}

export const STORAGE_KIND_ORDER: readonly StorageKind[] = [
  "fridge",
  "rack",
  "cabinet",
  "shelving",
  "wall",
  "other",
];
