import { normalizeText, type CellarItem } from "./cellar";

/**
 * How a cellar wine is written in an answer: its own producer, name and vintage ("Château Musar Rouge 2018"). The
 * producer is not repeated when the name starts with it ("Château Margaux 2010"); an NV wine has no year. Its own
 * tiny module so the screen's wording (check-sentence.ts) does not need the answer check's tables.
 */
export function wineLabel(item: Pick<CellarItem, "producer" | "wineName" | "year">): string {
  const producer = normalizeText(item.producer);
  const name = normalizeText(item.wineName);
  const both =
    producer !== "" && (name === producer || name.startsWith(`${producer} `))
      ? item.wineName
      : `${item.producer} ${item.wineName}`;
  return item.year === null ? both.trim() : `${both.trim()} ${item.year}`;
}
