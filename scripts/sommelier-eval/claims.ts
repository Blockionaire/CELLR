/**
 * THE CHECK AS A MEASURING INSTRUMENT (P8 paid plan). The `check` part's own claim rules (`prepareAnswerCheck`) are
 * run over a model's words to COUNT what they would flag: an unknown ref, a wine presented as owned that the cellar
 * lacks, a wrong vintage or count, a price, a shop or stock claim, an action. They are applied to V1's text (prompt
 * v6, where nothing is checked) and to V1+'s text (prompt v7) before and after the check.
 *
 * THESE ARE HEURISTICS, NOT GROUND TRUTH. The rules prefer missing a doubtful claim over removing a good answer
 * (packages/domain/src/sommelier-check.ts lists what each rule cannot see), and they can flag a sentence that is
 * fine. A count here is "what the code flags", never "what is wrong": only a person reading the review sheet
 * (`reviewSheetCsv`) can say how many flags were right.
 */
import {
  normalizeText,
  prepareAnswerCheck,
  type CellarDigest,
  type CellarItem,
  type CheckCode,
  type SommelierBottle,
} from "@cellr/domain";

/** The codes counted as a factual or unproven claim (owned-buy is about buying advice, counted apart). */
export const FACT_CODES = [
  "unknown-ref",
  "not-in-cellar",
  "wrong-vintage",
  "wrong-count",
  "price",
  "availability",
  "action",
] as const satisfies readonly CheckCode[];

/**
 * The list the model was shown, read back from the prompt: each line starts with its ref, and a ref is the shortest
 * unique prefix of a vintage id without dashes (packages/domain/src/sommelier.ts `refsFor`).
 */
export function digestFromPrompt(user: string, items: readonly CellarItem[]): CellarDigest {
  const lines = [...user.matchAll(/^([0-9a-z]{6,36}) \| .*$/gm)];
  const refs = new Map<string, CellarItem>();
  for (const m of lines) {
    const ref = m[1]!;
    const item = items.find((i) => i.vintageId.replace(/-/g, "").startsWith(ref));
    if (item) refs.set(ref, item);
  }
  return { text: lines.map((m) => m[0]).join("\n"), refs, total: items.length };
}

/** The "Cellar facts" block of the prompt, when the question was about the cellar itself. */
export function factsFromPrompt(user: string): string | null {
  const at = user.indexOf("Cellar facts (");
  if (at < 0) return null;
  const end = user.indexOf("\n\n", at);
  return user.slice(at, end < 0 ? undefined : end);
}

export interface Instrument {
  digest: CellarDigest;
  items: readonly CellarItem[];
  facts: string | null;
  now: Date;
}

/** What the check's rules flag in a text (codes only), with the answer's cards as the wines it is about. */
export function flagged(
  text: string,
  bottles: readonly SommelierBottle[],
  on: Instrument,
): CheckCode[] {
  if (text.trim() === "") return [];
  const check = prepareAnswerCheck({
    digest: on.digest,
    items: on.items,
    budget: null,
    facts: on.facts,
    now: on.now,
  });
  return check({ text, bottles, buy: [] }).check.codes;
}

export const factCodes = (codes: readonly CheckCode[]) =>
  codes.filter((c): c is (typeof FACT_CODES)[number] =>
    (FACT_CODES as readonly string[]).includes(c),
  );

const nameOf = (i: CellarItem) =>
  `${i.producer} ${i.wineName}${i.year === null ? "" : ` ${i.year}`}`;

/** The model's text with every `[[ref]]` written as the wine's name (an unknown ref is left as it was). */
export function renderRefs(text: string, digest: CellarDigest): string {
  return text.replace(/\[\[\s*([^\]\s]{1,40})\s*\]\]/g, (whole, ref: string) => {
    const item = digest.refs.get(ref);
    return item ? nameOf(item) : whole;
  });
}

/** Whether the model wrote its cards as refs, as prompt v7 asks (null: no card, nothing to say). */
export function refsAsAsked(raw: string, cards: readonly string[], digest: CellarDigest) {
  if (cards.length === 0) return null;
  const refOf = new Map([...digest.refs].map(([ref, item]) => [item.vintageId, ref]));
  const used = new Set([...raw.matchAll(/\[\[\s*([^\]\s]{1,40})\s*\]\]/g)].map((m) => m[1]!));
  return cards.every((id) => used.has(refOf.get(id) ?? "\u0000"));
}

/** Sentences, as the check cuts them closely enough for a review sheet. */
export const sentencesOf = (text: string) =>
  text
    .split(/(?<=[.!?…])\s+(?=[A-Z0-9À-Ý"“(])/u)
    .map((s) => s.trim())
    .filter((s) => s !== "");

const norm = (s: string) => normalizeText(s).replace(/\s+/g, " ").trim();

/**
 * The sentences of the model's text (refs rendered) that the screen does not show. `replaced`: the check put the
 * app's own sentence in place of all of them.
 */
export function removedSentences(
  rendered: string,
  shown: string | null,
  outcome: "kept" | "trimmed" | "replaced" | null,
): Array<{ sentence: string; outcome: "removed" | "replaced" }> {
  const all = sentencesOf(rendered);
  if (outcome === "replaced") return all.map((sentence) => ({ sentence, outcome: "replaced" }));
  if (outcome !== "trimmed" || shown === null) return [];
  const kept = norm(shown);
  return all
    .filter((s) => !kept.includes(norm(s)))
    .map((sentence) => ({ sentence, outcome: "removed" }));
}

/**
 * The cellar wines a sentence names, by the wine's name, or by its producer when no other wine shares it (the eval
 * cellar's wines all have one invented producer), for the reviewer's context.
 */
export function winesIn(sentence: string, items: readonly CellarItem[]): string[] {
  const s = ` ${norm(sentence)} `;
  const shared = (p: string) => items.filter((i) => i.producer === p).length > 1;
  return items
    .filter(
      (i) =>
        s.includes(` ${norm(i.wineName)} `) ||
        (!shared(i.producer) && s.includes(` ${norm(i.producer)} `)),
    )
    .map(nameOf);
}
