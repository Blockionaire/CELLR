/**
 * INTERVALS FOR RATES (P8): the exact (Clopper–Pearson) 95% interval of k events in n trials, and the rule that a
 * number with too few items behind it is not printed as one.
 */

function logGamma(x: number): number {
  // Lanczos approximation (g = 7, n = 9): accurate to about 15 digits for x > 0.
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  const z = x - 1;
  let a = c[0]!;
  const t = z + 7.5;
  for (let i = 1; i < 9; i++) a += c[i]! / (z + i);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

const logChoose = (n: number, k: number) => logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1);

/** P(X ≤ k) for X ~ Binomial(n, p). */
export function binomialCdf(k: number, n: number, p: number): number {
  if (k < 0) return 0;
  if (k >= n) return 1;
  if (p <= 0) return 1;
  if (p >= 1) return 0;
  let s = 0;
  for (let i = 0; i <= k; i++)
    s += Math.exp(logChoose(n, i) + i * Math.log(p) + (n - i) * Math.log(1 - p));
  return Math.min(1, s);
}

/** The p in [0, 1] at which an increasing f(p) reaches `target`, by bisection. */
function solveIncreasing(f: (p: number) => number, target: number): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** The exact (Clopper–Pearson) two-sided 95% interval of a rate, k events in n trials. */
export function clopperPearson(k: number, n: number, alpha = 0.05): { low: number; high: number } {
  if (n <= 0) return { low: 0, high: 1 };
  // Lower: P(X ≥ k | p) = α/2 (increasing in p). Upper: P(X ≤ k | p) = α/2, i.e. P(X > k | p) = 1 − α/2.
  const low = k === 0 ? 0 : solveIncreasing((p) => 1 - binomialCdf(k - 1, n, p), alpha / 2);
  const high = k === n ? 1 : solveIncreasing((p) => 1 - binomialCdf(k, n, p), 1 - alpha / 2);
  return { low, high };
}

/** Below these, a number is printed as "too few to conclude" (P8_MEASUREMENT_PLAN.md §9). */
export const TOO_FEW = { dishes: 10, rateTrials: 20 } as const;
export const TOO_FEW_WORDS = "too few to conclude";

const pct = (x: number) => `${(100 * x).toFixed(1)}%`;

/** A rate with its exact interval and n, or "too few to conclude". */
export function rateText(k: number, n: number): string {
  if (n < TOO_FEW.rateTrials) return `${TOO_FEW_WORDS} (${k} of ${n})`;
  const ci = clopperPearson(k, n);
  return `${k} of ${n} = ${pct(k / n)} [${pct(ci.low)}, ${pct(ci.high)}]`;
}
