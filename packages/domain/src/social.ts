import type { TasteSignals } from "./pairing-engine/taste";

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
