import "server-only";
import { RawSommelierSchema, type RawSommelier } from "@cellr/domain";
import { z } from "zod";
import { SOMMELIER_SCHEMA, SOMMELIER_SYSTEM } from "./sommelier";

/**
 * Prompt v7: v6 with the answer check (Sommelier V1+, part `check`). Used only where `check` is switched on; v6 stays
 * as it is for every other deployment. The difference is a short, enumerated list of edits to v6 (V7_EDITS), so what
 * changed is visible and tested, and everything else stays byte-identical:
 *
 *   1. In "answer", a cellar wine is written as its ref in double square brackets (`[[a1b2c3]]`), never by name: the
 *      app renders the ref from the cellar (checkAnswerClaims), so names and vintages of owned wines are the cellar's
 *      own. Wines not on the list may be named, compared and suggested, never as if the person has them. A number of
 *      bottles or a year for a cellar wine is only ever what its line says.
 *   2. Buying: an appellation or style with one well-known producer as an example and why it suits; no price, no shop,
 *      no availability, anywhere. The schema has no `price` in `buy`, so the model cannot state one there.
 *   3. "You can only read" names reserving and ordering too (the actions the check removes).
 */
export const SOMMELIER_VERSION_V7 = "sommelier_chat@v7";

/** One edit to the v6 system prompt: the exact v6 text and what v7 says instead. */
export interface PromptEdit {
  readonly v6: string;
  readonly v7: string;
}

export const V7_EDITS: readonly PromptEdit[] = [
  {
    // 1. Refs in the answer; non-owned wines may be talked about, never as owned.
    v6: "Never say a wine is in the cellar unless it is on the list, and never invent a wine, a vintage, a rating or a price for it.",
    v7: 'Never say a wine is in the cellar unless it is on the list, and never invent a wine, a vintage, a rating or a price for it.\n- In "answer", write every wine from the list as its ref in double square brackets, like [[a1b2c3]], never by its name: the app shows its producer, name and vintage there. Never state a number of bottles or a year for a wine from the list other than what its line says. You may name wines that are not on the list (to compare, or as something to buy), but never as if the person has them.',
  },
  {
    // 2. Buying without a price, a shop or availability.
    v6: 'give 1 to 3 suggestions in "buy": a concrete, widely available wine (an appellation or style, with one well-known producer as an example), why it suits, and a rough price per bottle in euros ("about €20"). Keep to the budget in the message when there is one.',
    v7: 'give 1 to 3 suggestions in "buy": an appellation or style, with one well-known producer as an example, and why it suits. Keep to the budget in the message when there is one, but never state a price, an amount of money, a shop, a stock or where a wine is available, in "buy" or in "answer": the app shows the budget.',
  },
  {
    // 3. The actions the check removes.
    v6: "never say you moved, added, removed or opened a bottle, or that you will.",
    v7: "never say you moved, added, removed, reserved, ordered or opened a bottle, or that you will.",
  },
];

/** v6 with each edit applied; an edit whose v6 text is not found exactly once is a build error, not a silent no-op. */
export function applyPromptEdits(base: string, edits: readonly PromptEdit[]): string {
  let out = base;
  for (const edit of edits) {
    const at = out.indexOf(edit.v6);
    if (at < 0 || out.indexOf(edit.v6, at + 1) >= 0)
      throw new Error(`Prompt edit does not match v6 exactly once: ${edit.v6.slice(0, 40)}`);
    out = out.slice(0, at) + edit.v7 + out.slice(at + edit.v6.length);
  }
  return out;
}

export const SOMMELIER_SYSTEM_V7 = applyPromptEdits(SOMMELIER_SYSTEM, V7_EDITS);

/** v6's schema with `buy` items of only `wine` and `why`: there is no place for a price. */
export const SOMMELIER_SCHEMA_V7 = {
  ...SOMMELIER_SCHEMA,
  properties: {
    ...SOMMELIER_SCHEMA.properties,
    buy: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["wine", "why"],
        properties: {
          wine: { type: "string" },
          why: { type: "string" },
        },
      },
    },
  },
} as const;

const RawSommelierV7Schema = RawSommelierSchema.extend({
  buy: z.array(z.object({ wine: z.string(), why: z.string() })).default([]),
});

/** The same shape v6 parses to, with `price: ""` on every buy entry (a price the model sent anyway is not read). */
export function parseSommelierV7(value: unknown): RawSommelier {
  const raw = RawSommelierV7Schema.parse(value);
  return { ...raw, buy: raw.buy.map((b) => ({ wine: b.wine, why: b.why, price: "" })) };
}
