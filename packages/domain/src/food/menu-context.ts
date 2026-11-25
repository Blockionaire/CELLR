import type { ChatMessage } from "../sommelier";
import type { FoodKnowledge } from "./compose";
import { FOOD } from "./knowledge";
import { parseMenu, type ParsedMenu } from "./parse";

/**
 * THE MENU A CONVERSATION IS ABOUT. A menu is said once ("oysters to start, then lamb, and a fondant"); the
 * questions after it ("and with the cheese?", "is the Barolo too heavy for the lamb?") are about that menu without
 * saying it again. The model only hears the last few turns of the chat, shortened, so the menu is found here and
 * restated to it in full (see the Menu block in server/ai/prompts/sommelier-menu.ts).
 *
 * Only the person's own messages are read: a menu is what the person said, never what the sommelier answered.
 * Known limits: it reaches as far back as the history the screen sends (its last ten turns, so about five earlier
 * questions); a menu said before that is gone. A later question about something else entirely still carries the
 * menu, as context only (the block says so), until a new menu replaces it.
 */

/**
 * The menu this question is about: the question itself when it is a menu (`parseMenu`), else — for a follow-up —
 * the most recent of the person's earlier messages that is one. `fromHistory` tells them apart.
 */
export function menuContext(
  messages: readonly ChatMessage[],
  /** The food knowledge (the app's own unless a test passes a small one). */
  k: FoodKnowledge = FOOD,
): { menu: ParsedMenu; fromHistory: boolean } | null {
  const last = messages.at(-1);
  if (!last || last.role !== "user") return null;
  const now = parseMenu(last.text, k);
  if (now) return { menu: now, fromHistory: false };
  for (let i = messages.length - 2; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== "user") continue;
    const earlier = parseMenu(m.text, k);
    if (earlier) return { menu: earlier, fromHistory: true };
  }
  return null;
}
