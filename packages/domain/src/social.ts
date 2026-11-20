import { z } from "zod";
import { normalizeText, WINE_TYPES, type WineType } from "./cellar";
import type { TasteSignals } from "./pairing-engine/taste";
import { WINE_FOCUS } from "./taste";

/**
 * THE SOCIAL SOMMELIER'S RULES. A person can name friends in a question ("@anna is coming, what do I open?").
 * A name in a question is only text: the server turns it into a person by looking it up among the asker's own
 * accepted friends, and reads what that friend allows at that moment. Nothing a screen sends (a user id, a
 * "resolved" list, an earlier answer) is believed.
 */

/** The little words that tie a name to a sentence. */
const TIE = "(?:for|with|and|to|voor|met|en|bij|aan|van)";

/** At most this many friends in one question: a table, not a crowd; it also bounds the lookups per question. */
export const MAX_MENTIONS = 5;

/** "@name", not part of an e-mail address, and not the first 20 characters of something longer. */
const MENTION = /(^|[^a-z0-9_.@])@([a-z0-9][a-z0-9_.]{2,19})(?![a-z0-9_]|\.[a-z0-9_])/gi;

/** Full-width "＠" is "@"; invisible characters inside a name are not part of it. */
const tidy = (text: string) =>
  text.normalize("NFKC").replace(/[\u200b-\u200d\u2060\ufeff\u00ad]/g, "");

/** The account names mentioned in a text, lower case, in order, each once. Never more than MAX_MENTIONS. */
export function findMentions(text: string): string[] {
  const found: string[] = [];
  for (const match of tidy(text).matchAll(MENTION)) {
    // A name cannot end in a dot: "@anna." at the end of a sentence is "anna".
    const handle = match[2]!.toLowerCase().replace(/\.+$/, "");
    if (handle.length >= 3 && !handle.includes("..") && !found.includes(handle)) found.push(handle);
    if (found.length === MAX_MENTIONS) break;
  }
  return found;
}

/** The text with its mentions taken out, so a friend called "@pasta.lover" is not read as a dish. */
export const withoutMentions = (text: string): string =>
  tidy(text)
    .replace(MENTION, (_all, before: string) => before)
    .replace(/\s{2,}/g, " ")
    .trim();

/**
 * A text with everything that looks like a name taken out, whether or not it is a valid account name ("@@anna",
 * "x.@anna", "@аnna" in another alphabet). For text that is about to leave the server for a model: stricter than
 * `withoutMentions`, which only removes what would be looked up.
 */
export const withoutAnyMention = (text: string): string =>
  tidy(text)
    // With the little word that tied the name to the sentence ("for @anna", "met @bram"), so that what is left
    // still reads as the question it was.
    // Also what is glued to the front of the "@" ("anna@", an e-mail address), and a name after "@ " with a
    // space: neither is a mention anyone looks up, and both may be someone's name.
    .replace(
      new RegExp(
        String.raw`(?:\b${TIE}\s+)?(?:[^\s,;:!?()]+@[^\s,;:!?()]*|@\s?[^\s,;:!?()]*)`,
        "gi",
      ),
      " ",
    )
    .replace(/\s{2,}/g, " ")
    .trim();
/** Whether a text holds anything that looks like a name. */
export const hasAnyMention = (text: string): boolean => tidy(text).includes("@");

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

/**
 * What the asker lets their friends' sommelier use: their taste, and (apart from it) the wines in their cellar.
 * Each is its own consent, off until turned on; a request changes the ones it names.
 */
export const SaveSommelierSharingSchema = z
  .object({ tasteForFriends: z.boolean().optional(), cellarForFriends: z.boolean().optional() })
  .refine((s) => s.tasteForFriends !== undefined || s.cellarForFriends !== undefined, {
    message: "name at least one setting",
  });
export type SaveSommelierSharing = z.infer<typeof SaveSommelierSharingSchema>;
export interface SommelierSharingView {
  tasteForFriends: boolean;
  /** Null: this deployment's database does not know the setting yet (the 0050 step is not taken). */
  cellarForFriends: boolean | null;
}

// ---- A friend's cellar, for the asker's sommelier (migration 0050) --------------------------------------------

/**
 * What the database said about a friend's cellar. "unavailable": not an accepted friend, whatever the reason.
 * "not-shared": a friend who does not show their cellar to the asker, or does not allow a sommelier to use it
 * (which of the two is never told). "included": the wines in it now, never where they lie or how many.
 */
export const FRIEND_CELLAR_STATUSES = ["included", "not-shared", "unavailable"] as const;
export type FriendCellarStatus = (typeof FRIEND_CELLAR_STATUSES)[number];

export interface FriendWine {
  producer: string;
  name: string;
  year: number | null;
  type: WineType;
  region: string | null;
  appellation: string | null;
  countryCode: string | null;
}
export interface FriendCellar {
  status: FriendCellarStatus;
  wines: FriendWine[];
}
export const NO_FRIEND_CELLAR: FriendCellar = { status: "unavailable", wines: [] };
export const MAX_FRIEND_WINES = 300;

const text = (value: unknown, max: number): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim().slice(0, max) : null;

/**
 * A friend's cellar as the engines may use it: read field by field from what the database returned, so nothing
 * that is not a wine's name, vintage, kind and origin can ride along (no place, no count, no id).
 */
export function readFriendCellar(value: unknown): FriendCellar {
  if (typeof value !== "object" || value === null) return NO_FRIEND_CELLAR;
  const row = value as Record<string, unknown>;
  const status = (FRIEND_CELLAR_STATUSES as readonly unknown[]).includes(row.status)
    ? (row.status as FriendCellarStatus)
    : "unavailable";
  if (status !== "included" || !Array.isArray(row.wines)) return { status, wines: [] };
  const wines: FriendWine[] = [];
  for (const w of row.wines.slice(0, MAX_FRIEND_WINES)) {
    if (typeof w !== "object" || w === null) continue;
    const r = w as Record<string, unknown>;
    const name = text(r.wine, 160);
    const producer = text(r.producer, 160);
    if (!name || !producer || !(WINE_TYPES as readonly unknown[]).includes(r.type)) continue;
    wines.push({
      producer,
      name,
      year:
        typeof r.year === "number" && Number.isInteger(r.year) && r.year >= 1900 && r.year <= 2200
          ? r.year
          : null,
      type: r.type as WineType,
      region: text(r.region, 120),
      appellation: text(r.appellation, 160),
      countryCode:
        typeof r.countryCode === "string" && /^[A-Z]{2}$/.test(r.countryCode)
          ? r.countryCode
          : null,
    });
  }
  return { status, wines };
}

/** "What does he own…", "from her cellar", "is bringing a bottle": the question is about the friend's wines. */
export const asksFriendCellar = (question: string): boolean =>
  /\b(?:what (?:does|do) (?:he|she|they) (?:own|have)|(?:his|her|their) (?:cellar|bottles|wines|collection)|(?:is|are) bringing (?:a|the|some) (?:bottle|bottles|wine)|wat heeft (?:hij|zij|ze)|wat hebben (?:zij|ze)|(?:zijn|haar|hun) (?:kelder|wijnkelder|flessen|wijnen|collectie)|neemt (?:een|de) (?:fles|flessen|wijn) mee|brengt (?:een|de) (?:fles|flessen|wijn) mee)\b/i.test(
    tidy(question),
  );

/**
 * "…that he does not already own", "die hij nog niet heeft": what THEY have is to be left out. About someone else
 * only: "I do not have any Champagne" says nothing about a friend's cellar, and must not have it read.
 */
export const asksNotAlreadyOwned = (question: string): boolean =>
  /\b(?:(?:does not|doesn t|doesn't|has not|hasn t|hasn't) (?:already |yet |got )?(?:own|have|got)|(?:they|who) (?:don t|don't|do not) (?:already |yet )?(?:own|have)|not already (?:in (?:his|her|their)|owned)|nog niet (?:zelf )?(?:heeft|bezit)|niet al (?:heeft|bezit)|(?:zij|ze) (?:nog niet|niet al) hebben|(?:nog niet|niet al) in (?:zijn|haar|hun))\b/i.test(
    tidy(question),
  );

/**
 * "And with the oysters?", "what about the fish?", "does she have something lighter?": a follow-up that leans on
 * the question before it, or speaks of the friend. "What goes with oysters tonight?" stands on its own.
 */
export const leansOnBefore = (question: string): boolean => {
  const text = tidy(question).trim();
  return (
    /^(?:and|or|but|what about|how about|en|of|maar|wat dacht je van|hoe zit het met)\b/i.test(
      text,
    ) || /\b(?:he|she|they|him|them|his|hers|her|their|theirs|hij|zij|hem|haar|hun)\b/i.test(text)
  );
};

/** "…and what do I have myself?", "uit mijn eigen kelder": a follow-up that turns back to the asker's own wines. */
export const asksOwnCellar = (question: string): boolean =>
  /\b(?:my (?:own )?(?:cellar|bottles|wines|collection)|(?:do|can|could|should) i (?:have|own|open)|i (?:have|own)|myself|of mine|mijn (?:eigen )?(?:kelder|wijnkelder|flessen|wijnen|collectie)|heb ik|ik (?:zelf )?heb|zelf)\b/i.test(
    tidy(question),
  );

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
