import { z } from "zod";
import { normalizeText, WINE_TYPES } from "./cellar";
import type { TasteSignals } from "./pairing-engine/taste";
import { WINE_FOCUS } from "./taste";

/**
 * THE SOCIAL SOMMELIER'S RULES. A person can name friends in a question ("@anna is coming, what do I open?").
 * A name in a question is only text: the server turns it into a person by looking it up among the asker's own
 * accepted friends, and reads what that friend allows at that moment. Nothing a screen sends (a user id, a
 * "resolved" list, an earlier answer) is believed.
 */

/** At most this many friends in one question: a table, not a crowd; it also bounds the lookups per question. */
export const MAX_MENTIONS = 5;

/** "@name", not part of an e-mail address, and not the first 20 characters of something longer. */
const MENTION = /(^|[^a-z0-9_.@])@([a-z0-9][a-z0-9_.]{2,19})(?![a-z0-9_])/gi;

/** The account names mentioned in a text, lower case, in order, each once. Never more than MAX_MENTIONS. */
export function findMentions(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(MENTION)) {
    // A name cannot end in a dot: "@anna." at the end of a sentence is "anna".
    const handle = match[2]!.toLowerCase().replace(/\.+$/, "");
    if (handle.length >= 3 && !handle.includes("..") && !found.includes(handle)) found.push(handle);
    if (found.length === MAX_MENTIONS) break;
  }
  return found;
}

/** The text with its mentions taken out, so a friend called "@pasta.lover" is not read as a dish. */
export const withoutMentions = (text: string): string =>
  text
    .replace(MENTION, (_all, before: string) => before)
    .replace(/\s{2,}/g, " ")
    .trim();

/**
 * What became of a mention. "unavailable" covers everyone who is not an accepted friend: a stranger, a pending
 * request, someone who was removed, a name that does not exist. They are told apart nowhere, so asking about a
 * name can never reveal whether an account exists or what it shares.
 */
export const MENTION_STATUSES = [
  /** A friend who allows their taste to be used in the asker's sommelier answers. */
  "included",
  /** A friend who does not allow it (or shares no taste at all, or has none to share). */
  "no-taste",
  "unavailable",
] as const;
export type MentionStatus = (typeof MENTION_STATUSES)[number];

/** A mentioned friend as the engine may know them: an alias, and closed taste signals. Never an id or a name. */
export interface SocialParticipant {
  /** "friend-1", "friend-2": how the engine and any log refer to them. */
  alias: string;
  status: MentionStatus;
  taste: TasteSignals | null;
}

/** What the answer may say about a mention; the screen shows the handle the asker typed themselves. */
export interface MentionOutcome {
  handle: string;
  status: MentionStatus;
}

export const aliasFor = (index: number) => `friend-${index + 1}`;

/** Whether the asker lets their own taste be used by their friends' sommelier. */
export const SaveSommelierSharingSchema = z.object({ tasteForFriends: z.boolean() });
export type SaveSommelierSharing = z.infer<typeof SaveSommelierSharingSchema>;
export interface SommelierSharingView {
  tasteForFriends: boolean;
}

const SCALES = ["body", "tannin", "sweetness", "acidity"] as const;

/** The scales of an object that are numbers from 1 to 5; everything else in it is ignored. */
function scalesOf(value: unknown): TasteSignals["said"] {
  if (typeof value !== "object" || value === null) return {};
  const out: TasteSignals["said"] = {};
  for (const key of SCALES) {
    const v = (value as Record<string, unknown>)[key];
    if (typeof v === "number" && Number.isFinite(v) && v >= 1 && v <= 5) out[key] = v;
  }
  return out;
}
const strings = (value: unknown, max: number): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string" && v.length <= max).slice(0, 8)
    : [];

/**
 * A friend's taste as the database returned it, made into the closed signals the engine orders by. Everything
 * is checked again here, whatever the database promised, and field by field: a colour must be a colour, a scale
 * a number from 1 to 5, and a region counts only when it is a wine key the engine knows (so no free text travels
 * on). Anything else is dropped, including every field this function does not name. Null when nothing usable is
 * left.
 */
export function friendTasteSignals(
  raw: unknown,
  knownKeys: ReadonlySet<string>,
): TasteSignals | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const t = raw as Record<string, unknown>;
  const focus = (WINE_FOCUS as readonly unknown[]).includes(t.focus)
    ? (t.focus as TasteSignals["focus"])
    : null;
  const styles = strings(t.styles, 20).filter((s): s is (typeof WINE_TYPES)[number] =>
    (WINE_TYPES as readonly string[]).includes(s),
  );
  const likes = [...new Set(strings(t.regions, 60).map(normalizeText))].filter((k) =>
    knownKeys.has(k),
  );
  const signals: TasteSignals = {
    focus,
    said: scalesOf(t.said),
    trends: scalesOf(t.trends),
    styles: [...new Set(styles)],
    likes,
  };
  const anything =
    signals.focus !== null ||
    signals.styles.length > 0 ||
    likes.length > 0 ||
    Object.keys(signals.said).length > 0 ||
    Object.keys(signals.trends).length > 0;
  return anything ? signals : null;
}
