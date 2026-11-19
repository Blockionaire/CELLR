import { z } from "zod";
import { normalizeText, WINE_TYPES, type WineType } from "../cellar";

/**
 * WHAT A CONVERSATION WITH THE SOMMELIER HAS ESTABLISHED: what the person wants to do (open a bottle they own,
 * buy one, give one), for which dish, at what price, from where. It is filled in turn by turn, so a later answer
 * ("€25.") is read in the light of what was asked, a change ("make that €40", "no salmon after all, stew") replaces
 * what was said before and keeps the rest, and nothing is asked twice.
 *
 * The state travels with the conversation: the server returns it with every answer and the screen sends it back
 * with the next question. It is a hint, not a fact: it is validated here, it holds no wine, price or permission
 * the server would trust, and everything that matters (the cellar, a friend's consent) is read again each time.
 */

export const SOMMELIER_INTENTS = [
  /** Open something they own. */
  "open",
  "buy",
  "gift",
  /** Looking around, no decision to make. */
  "browse",
  /** Asked for either: open if something suits, else buy. */
  "either",
] as const;
export type SommelierIntent = (typeof SOMMELIER_INTENTS)[number];

export const BUY_CHANNELS = ["online", "pickup"] as const;
export type BuyChannel = (typeof BUY_CHANNELS)[number];

/** The questions the sommelier can ask back. At most one per answer, each at most once per conversation. */
export const ASK_CODES = [
  "dish",
  "budget",
  "channel",
  "location-consent",
  "recipient-taste",
  "occasion",
] as const;
export type AskCode = (typeof ASK_CODES)[number];

export const CONVERSATION_STATE_VERSION = 1;

export const ConversationStateSchema = z.object({
  v: z.literal(CONVERSATION_STATE_VERSION),
  intent: z.enum(SOMMELIER_INTENTS).nullable(),
  /** The dish in the person's own words, as the food engine found it in what they wrote. */
  dish: z.string().max(120).nullable(),
  budgetMaxEuros: z.number().min(1).max(100_000).nullable(),
  budgetMinEuros: z.number().min(1).max(100_000).nullable(),
  /** They said price does not matter: the budget is not asked for. */
  budgetOpen: z.boolean(),
  channel: z.enum(BUY_CHANNELS).nullable(),
  wineType: z.enum(WINE_TYPES).nullable(),
  /** For a gift: who it is for, as a role word ("father"), never a name. */
  recipient: z.string().max(40).nullable(),
  /** What the receiver likes, as wine keys the engine knows ("bordeaux"). */
  recipientLikes: z.array(z.string().max(40)).max(6),
  guests: z.number().int().min(1).max(500).nullable(),
  /** Whether they agreed to their location being used for shops nearby. Null: not asked or not answered. */
  locationConsent: z.boolean().nullable(),
  /** What has been asked so far, oldest first; the last one is what a bare answer replies to. */
  asked: z.array(z.enum(ASK_CODES)).max(12),
  /** Wines they turned down in this conversation (vintage ids): not offered again. */
  rejected: z.array(z.string().uuid()).max(30),
});
export type ConversationState = z.infer<typeof ConversationStateSchema>;

export const EMPTY_STATE: ConversationState = Object.freeze({
  v: CONVERSATION_STATE_VERSION,
  intent: null,
  dish: null,
  budgetMaxEuros: null,
  budgetMinEuros: null,
  budgetOpen: false,
  channel: null,
  wineType: null,
  recipient: null,
  recipientLikes: [],
  guests: null,
  locationConsent: null,
  asked: [],
  rejected: [],
}) as ConversationState;

/** A state a screen sent back: used when it is well-formed, else the conversation starts over. Never trusted. */
export function readState(value: unknown): ConversationState {
  const parsed = ConversationStateSchema.safeParse(value);
  return parsed.success ? parsed.data : EMPTY_STATE;
}

// ---- reading one turn ---------------------------------------------------------------------------

const has = (text: string, phrases: readonly string[]) =>
  phrases.some((p) => text.includes(` ${p} `));

const BUY = [
  "buy",
  "buying",
  "purchase",
  "order",
  "ordered",
  "pick up",
  "shop for",
  "get a bottle",
  "kopen",
  "koop",
  "koop ik",
  "aanschaffen",
  "bestellen",
  "bestel",
  "halen",
  "haal",
  "ophalen",
  "inslaan",
  "find me",
  "zoek een",
  "ik zoek",
  "where can i",
  "waar kan ik",
];
const NOT_BUY = [
  "don t want to buy",
  "do not want to buy",
  "not buy",
  "without buying",
  "niet kopen",
  "niets kopen",
  "niks kopen",
  "wil niet kopen",
  "hoef niets te kopen",
];
const OWN = [
  "from my cellar",
  "in my cellar",
  "my rack",
  "do i have",
  "should i open",
  "can i open",
  "what should i open",
  "uit mijn kelder",
  "in mijn kelder",
  "heb ik",
  "wat open ik",
  "openen",
  "opentrekken",
  "trek ik open",
];
const EITHER = [
  "or should i buy",
  "or do i need to buy",
  "or buy",
  "of moet ik iets kopen",
  "of moet ik kopen",
  "of kopen",
  "of iets kopen",
];
const GIFT = ["gift", "present", "cadeau", "kado", "cadeautje", "als cadeau", "to give"];
const BROWSE = [
  "just looking",
  "just browsing",
  "what s new",
  "inspire me",
  "inspiratie",
  "zomaar",
];

const ONLINE = [
  "online",
  "delivered",
  "delivery",
  "deliver",
  "webshop",
  "web shop",
  "laten bezorgen",
  "bezorgen",
  "bezorgd",
  "thuisbezorgd",
];
const PICKUP = [
  "collect",
  "pick up",
  "pick it up",
  "pickup",
  "in store",
  "in a store",
  "in a shop",
  "shop nearby",
  "nearby",
  "near me",
  "ophalen",
  "haal het op",
  "afhalen",
  "in de winkel",
  "in een winkel",
  "in de buurt",
  "dichtbij",
  "slijter",
  "supermarkt",
];

const TYPE_WORDS: ReadonlyArray<readonly [WineType, readonly string[]]> = [
  ["sparkling", ["sparkling", "bubbles", "bubbly", "fizz", "mousserend", "mousserende", "bubbels"]],
  ["rose", ["rose", "rosé"]],
  ["dessert", ["dessert wine", "sweet wine", "dessertwijn", "zoete wijn"]],
  ["fortified", ["fortified"]],
  ["orange", ["orange wine", "oranje wijn"]],
  ["white", ["white", "a white", "wit", "witte", "witte wijn"]],
  ["red", ["red", "a red", "rood", "rode", "rode wijn"]],
];

const NO_LIMIT = [
  "money is no object",
  "price is no object",
  "price doesn t matter",
  "price does not matter",
  "no budget",
  "any price",
  "geld speelt geen rol",
  "prijs maakt niet uit",
  "maakt niet uit wat het kost",
  "geen budget",
];
const YES = ["yes", "yeah", "sure", "ok", "okay", "fine", "ja", "prima", "goed", "is goed", "mag"];
const NO = ["no", "nope", "rather not", "nee", "liever niet", "niet doen"];
const ANOTHER = [
  "not that one",
  "another",
  "something else",
  "a different one",
  "other option",
  "niet die",
  "een andere",
  "iets anders",
  "andere optie",
];

const RECIPIENTS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["father", ["father", "dad", "vader", "pa", "papa"]],
  ["mother", ["mother", "mum", "mom", "moeder", "ma", "mama"]],
  [
    "partner",
    ["partner", "wife", "husband", "girlfriend", "boyfriend", "vrouw", "man", "vriendin", "vriend"],
  ],
  ["friend", ["friend", "a friend", "vrienden", "friends"]],
  ["colleague", ["colleague", "boss", "collega", "baas"]],
  ["host", ["host", "hostess", "gastheer", "gastvrouw"]],
  [
    "parent-in-law",
    ["father in law", "mother in law", "in laws", "schoonvader", "schoonmoeder", "schoonouders"],
  ],
];

/** "12,50", "12.50", "25" → euros. */
const amount = (raw: string) => Number(raw.replace(",", "."));
const MONEY = String.raw`(\d{1,5}(?:[.,]\d{1,2})?)`;
const EURO = String.raw`(?:€|eur|euro|euros|euro's)`;
const UPPER = String.raw`(?:under|below|up to|upto|max|maximum|at most|no more than|less than|within|hooguit|maximaal|max\.?|tot|onder de|onder|niet meer dan|ten hoogste|binnen)`;
const LOWER = String.raw`(?:at least|from|over|above|more than|minimum|min\.?|minstens|minimaal|vanaf|boven de|boven|meer dan)`;
const ABOUT = String.raw`(?:around|about|roughly|circa|ongeveer|rond de|rond|zo'n|plusminus)`;

export interface MoneyReading {
  max: number | null;
  min: number | null;
  open: boolean;
}

/**
 * The price a person named. "Under €15", "max 50", "tot 60 euro", "€ 12,50", "around €40" (read as a ceiling with
 * a little room), "between 20 and 30". A bare number is only money when the budget was just asked (`bare`).
 */
export function readMoney(text: string, bare = false): MoneyReading {
  const t = ` ${text.toLowerCase().replace(/\s+/g, " ")} `;
  const none: MoneyReading = { max: null, min: null, open: false };
  if (has(` ${normalizeText(text)} `, NO_LIMIT)) return { ...none, open: true };

  const between = new RegExp(
    String.raw`(?:between|tussen(?: de)?)\s*${EURO}?\s*${MONEY}\s*(?:and|en|-|–)\s*${EURO}?\s*${MONEY}`,
  ).exec(t);
  if (between) {
    const [a, b] = [amount(between[1]!), amount(between[2]!)];
    return { min: Math.min(a, b), max: Math.max(a, b), open: false };
  }
  const result: MoneyReading = { ...none };
  const lower = new RegExp(String.raw`${LOWER}\s*${EURO}?\s*${MONEY}\s*${EURO}?`).exec(t);
  const upper = new RegExp(String.raw`${UPPER}\s*${EURO}?\s*${MONEY}\s*${EURO}?`).exec(t);
  const about = new RegExp(String.raw`${ABOUT}\s*${EURO}?\s*${MONEY}\s*${EURO}?`).exec(t);
  if (upper) result.max = amount(upper[1]!);
  // "More than" directly before a ceiling word ("niet meer dan") was read as the ceiling above.
  if (
    lower &&
    !(upper && upper.index <= lower.index && lower.index < upper.index + upper[0].length)
  )
    result.min = amount(lower[1]!);
  if (about && result.max === null) result.max = Math.round(amount(about[1]!) * 1.15);
  if (result.max === null && result.min === null) {
    const marked =
      new RegExp(String.raw`${EURO}\s*${MONEY}`).exec(t) ??
      new RegExp(String.raw`${MONEY}\s*${EURO}(?![a-z])`).exec(t);
    if (marked) result.max = amount(marked[1]!);
    else if (bare) {
      const lone = new RegExp(String.raw`^\s*${MONEY}\s*[.!]?\s*$`).exec(t);
      if (lone) result.max = amount(lone[1]!);
    }
  }
  if (result.max !== null && result.max < 1) result.max = null;
  if (result.min !== null && (result.min < 1 || (result.max !== null && result.min > result.max)))
    result.min = null;
  return result;
}

export interface TurnInput {
  text: string;
  /** A budget chosen with a control on the screen, in whole euros. */
  budgetEuros?: number | null;
  /** What the food engine found in the text: the dish in the person's words, or null. */
  dish?: string | null;
  /** Wine keys the text names (regions, grapes, appellations), for a gift's "who loves Bordeaux". */
  wineKeys?: readonly string[];
  /** The wines offered in the previous answer (vintage ids), so "not that one" knows what was meant. */
  lastOffered?: readonly string[];
}

/** One turn folded into the state. Later statements replace earlier ones; what was not mentioned is kept. */
export function advance(previous: ConversationState, turn: TurnInput): ConversationState {
  const text = ` ${normalizeText(turn.text)} `;
  const lastAsked = previous.asked.at(-1) ?? null;
  const next: ConversationState = { ...previous };

  // --- intent ---
  const gift = has(text, GIFT);
  if (has(text, EITHER)) next.intent = "either";
  else if (has(text, NOT_BUY)) next.intent = "open";
  else if (gift) next.intent = "gift";
  else if (has(text, BUY)) next.intent = "buy";
  else if (has(text, OWN))
    next.intent =
      previous.intent === "buy" || previous.intent === "gift" ? previous.intent : "open";
  else if (has(text, BROWSE) && previous.intent === null) next.intent = "browse";

  // --- money ---
  const money = readMoney(turn.text, lastAsked === "budget");
  if (turn.budgetEuros != null && turn.budgetEuros >= 1) {
    next.budgetMaxEuros = turn.budgetEuros;
    next.budgetOpen = false;
  }
  if (money.open) {
    next.budgetOpen = true;
    next.budgetMaxEuros = null;
    next.budgetMinEuros = null;
  }
  if (money.max !== null) {
    next.budgetMaxEuros = money.max;
    next.budgetOpen = false;
    if (money.min === null && next.budgetMinEuros !== null && next.budgetMinEuros > money.max)
      next.budgetMinEuros = null;
  }
  if (money.min !== null) next.budgetMinEuros = money.min;
  // Naming a price is a wish to buy, unless they said otherwise.
  if ((money.max !== null || money.open) && (next.intent === null || next.intent === "either"))
    next.intent = "buy";

  // --- where from ---
  const online = has(text, ONLINE);
  const pickup = has(text, PICKUP);
  if (pickup && !online) next.channel = "pickup";
  else if (online && !pickup) next.channel = "online";
  else if (online && pickup)
    next.channel =
      text.lastIndexOf(" online ") > text.lastIndexOf(" ophalen ") ? "online" : "pickup";
  if (next.channel !== previous.channel && (next.intent === null || next.intent === "either"))
    next.intent = "buy";

  // --- what kind of wine ---
  for (const [type, words] of TYPE_WORDS)
    if (has(text, words.map(normalizeText))) {
      next.wineType = type;
      break;
    }

  // --- the dish ---
  if (turn.dish) next.dish = turn.dish.slice(0, 120);

  // --- a gift ---
  if (gift || next.intent === "gift") {
    for (const [role, words] of RECIPIENTS)
      if (has(text, words)) {
        next.recipient = role;
        break;
      }
    if (turn.wineKeys && turn.wineKeys.length > 0) next.recipientLikes = turn.wineKeys.slice(0, 6);
  }

  // --- guests ---
  const guests = /(\d{1,3})\s*(?:guests|people|persons|of us|gasten|personen|mensen|man)\b/.exec(
    turn.text.toLowerCase(),
  );
  if (guests) next.guests = Math.max(1, Math.min(500, Number(guests[1])));

  // --- yes or no to the location question ---
  if (lastAsked === "location-consent" && next.locationConsent === null) {
    if (has(text, NO)) next.locationConsent = false;
    else if (has(text, YES)) next.locationConsent = true;
  }

  // --- "not that one" ---
  if (has(text, ANOTHER) && turn.lastOffered && turn.lastOffered.length > 0)
    next.rejected = [...new Set([...previous.rejected, turn.lastOffered[0]!])].slice(-30);

  return next;
}

/**
 * The one question worth asking next, or null. Only what changes the answer is asked, never something already
 * said or already asked, and a question never holds back an answer that can be given without it.
 */
export function nextQuestion(
  state: ConversationState,
  situation: {
    /** Whether the food engine understood a dish in this conversation. */
    dishKnown: boolean;
    /** Whether something the person owns suits (so buying is not needed to answer). */
    ownedSuits: boolean;
    /** Whether the question was about wine or food at all. */
    onTopic: boolean;
  },
): AskCode | null {
  if (!situation.onTopic) return null;
  const asked = (code: AskCode) => state.asked.includes(code);
  const buying =
    state.intent === "buy" ||
    state.intent === "gift" ||
    (state.intent === "either" && !situation.ownedSuits);

  if (!situation.dishKnown && state.intent !== "gift" && state.intent !== "browse") {
    // Buying without a dish is fine when a kind of wine or a receiver's taste was named.
    const enough =
      buying &&
      (state.wineType !== null || state.recipientLikes.length > 0 || state.budgetMaxEuros !== null);
    if (!enough) return asked("dish") ? null : "dish";
  }
  if (!buying) return null;
  if (state.budgetMaxEuros === null && !state.budgetOpen) return asked("budget") ? null : "budget";
  if (state.intent === "gift" && state.recipientLikes.length === 0 && !asked("recipient-taste"))
    return "recipient-taste";
  if (state.intent !== "gift" && state.channel === null) return asked("channel") ? null : "channel";
  if (state.channel === "pickup" && state.locationConsent === null)
    return asked("location-consent") ? null : "location-consent";
  return null;
}

/** The state after the sommelier asked something: it is remembered, so it is not asked again. */
export function withAsked(state: ConversationState, code: AskCode | null): ConversationState {
  if (code === null || state.asked.at(-1) === code) return state;
  return { ...state, asked: [...state.asked.filter((c) => c !== code), code].slice(-12) };
}
