import "server-only";
import en from "../../../../messages/en.json";
import nl from "../../../../messages/nl.json";

/**
 * SOMMELIER V1+ PART `annotate` (P4): the one sentence an answer carries when every sentence of the model's words
 * stated a serving temperature, a decanting time or drinking years that differ from the app's own facts for the
 * wine, and so nothing of them is left. The card shows the facts; the answer says where to look, in the person's
 * language, from the same messages the screen uses. An answer of the model is never without words.
 */
export function seeCardWords(locale: string): string {
  return (locale === "nl" ? nl : en).sommelier.annotate.seeCard;
}
