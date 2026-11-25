import "server-only";
import { wineLabel, type PairingVerdict, type SommelierBottle } from "@cellr/domain";
import en from "../../../../messages/en.json";
import nl from "../../../../messages/nl.json";

/**
 * SOMMELIER V1+ PART `check` (P3): the words an answer carries when the check took the model's own away. One plain
 * sentence made from what is certain, the first card V1 chose and its verdict, in the person's language, from the
 * same messages the screen uses.
 *
 * The screen words this sentence itself (features/sommelier/check-sentence.ts, with how many more cards follow).
 * It is put on the answer as well so that an answer is never without words: a screen from before this part (a tab
 * left open across a deployment, or the app after a rollback) draws `text` as it is and sends it back as the
 * conversation so far, and an empty one would fail the next question.
 */
export function cardOnlyWords(
  locale: string,
  bottles: readonly SommelierBottle[],
  verdict: PairingVerdict | null,
): string {
  const words = (locale === "nl" ? nl : en).sommelier.check;
  const first = bottles[0];
  if (!first) return verdict === "none" ? words.noneFits : words.nothing;
  const kind = verdict === "match" || verdict === "partial" ? verdict : "other";
  return words.cardOnly[kind].replace("{wine}", wineLabel(first));
}
