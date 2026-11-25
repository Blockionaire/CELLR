"use client";

import { useTranslations } from "next-intl";
import type { QuantityAdvice } from "@cellr/domain";
import { quantityLines } from "./annotation-lines";

/**
 * Bottles for the guests, counted by the app: the need in one line (worded as the estimate it is), then each wine
 * against what is free to open. Reserved bottles are not counted as free. A small, quiet box under the cards.
 */
export function QuantityView({
  quantity,
  nameOf,
}: {
  quantity: QuantityAdvice;
  /** The wine's name as its card shows it; null for a wine that has no card (its line is left out). */
  nameOf: (vintageId: string) => string | null;
}) {
  const t = useTranslations("sommelier");
  const [head, ...wines] = quantityLines(quantity, nameOf, t);
  return (
    <section
      className="min-w-0 rounded-card bg-raised px-4 py-3 text-small text-ink-2 break-words"
      data-testid="quantity"
      data-mode={quantity.mode}
    >
      <p className="text-ink">{head}</p>
      {wines.length > 0 && (
        <ul className="mt-1 flex flex-col gap-0.5">
          {wines.map((line, n) => (
            <li key={n} className="tnum">
              {line}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
