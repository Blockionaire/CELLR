import type { StorageKind, WineType } from "@cellr/domain";
import type { BottleShape, WineTint } from "@/ui/bottle-glyph";

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

const HOUSE_PREFIX =
  /^(ch[âa]teau|domaine|dom\.?|maison|bodegas?|weingut|tenuta|cantina|castello|clos|quinta|herdade|cave|the)\s+/i;

/** The short producer mark typeset on a bottle without a label photo: "Château Léoville-Barton" → "LÉOVILLE". */
export function labelMark(producer: string, wine: string): string {
  const base = (producer || wine).trim().replace(HOUSE_PREFIX, "");
  return (base.split(/[\s,–-]+/)[0] ?? "").toUpperCase().slice(0, 12);
}

/** The stage behind a bottle: a pastel field on paper, a soft glow on noir. */
export const STAGE: Record<WineTint, string> = {
  red: "bg-stage-red",
  white: "bg-stage-white",
  rose: "bg-stage-rose",
  sparkling: "bg-stage-sparkling",
  orange: "bg-stage-orange",
  dessert: "bg-stage-dessert",
  fortified: "bg-stage-fortified",
};
