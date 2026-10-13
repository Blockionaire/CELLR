/**
 * HOW GOOD A WINE IS OVER ITS LIFE, as a gentle curve for a chart: it climbs while the wine is young, opens up,
 * holds at its best, eases off while it is "ready", and fades once it is past. It is drawn from the same
 * window as every other estimate (the first and last good year); the heights are only for the picture.
 */

/** Quality from 0 to 1 in calendar year `t` (fractions allowed) for a window that opens in `from` and closes in `until`. */
export function drinkQuality(t: number, from: number, until: number): number {
  const span = Math.max(1, until - from);
  const p = (t - from) / span;
  if (p <= -1) return 0.15;
  if (p < 0) return 0.15 + 0.4 * (p + 1); // young: climbing towards the window
  if (p < 0.25) return 0.55 + 0.35 * (p / 0.25); // opening up
  if (p < 0.7) return 1 - 0.1 * ((p - 0.475) / 0.225) ** 2; // at its best
  if (p <= 1) return 0.9 - 0.3 * ((p - 0.7) / 0.3); // ready: drink soon
  return 0.6 - 0.35 * Math.min(1, (p - 1) / 0.8); // past
}

/** The calendar years a chart should cover: from the harvest (or a little before the window) to a while after it. */
export function chartYears(
  year: number | null,
  from: number,
  until: number,
): { start: number; end: number } {
  const span = Math.max(1, until - from);
  const start = Math.min(year ?? from - 2, from - 1);
  return { start, end: Math.ceil(until + Math.max(2, 0.8 * span)) };
}

/** Where the stretches of the window fall, in calendar years. */
export function windowStretches(from: number, until: number) {
  const span = Math.max(1, until - from);
  return {
    opening: [from, from + 0.25 * span] as const,
    best: [from + 0.25 * span, from + 0.7 * span] as const,
    ready: [from + 0.7 * span, until] as const,
  };
}

/** A calendar year with a fraction, from an ISO date or timestamp (for placing "opened on" on the chart). */
export function yearFraction(iso: string): number {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  const end = Date.UTC(d.getUTCFullYear() + 1, 0, 1);
  return d.getUTCFullYear() + (d.getTime() - start) / (end - start);
}
