import type { ImageRef } from "./image";
import { z } from "zod";
import { normalizeText, type CellarItem, type WineType } from "./cellar";
import type { DishId } from "./pairing";
import type { Reservation } from "./insights";
import type { Occasion } from "./tonight";
import type { RatingSummary } from "./tasting";

/**
 * THE SOMMELIER. A conversation about the cellar that is only ever as smart as the cellar is real: the model is
 * shown a compact list of the wines that exist, may only recommend wines from that list (every reference is
 * checked against it in code), and everything it says is shown as advice, not fact. When there is no AI, or it
 * is down, the same question is answered by the Tonight engine: ordinary arithmetic on the same cellar.
 */

// ---- The request ---------------------------------------------------------------------------------------------

const ChatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  text: z.string().trim().min(1).max(800),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

/** The recent conversation, oldest first, ending with what the person just asked. Nothing is stored on the server. */
/** If something has to be bought: how much it may cost, per bottle. */
export const BUDGETS = ["value", "mid", "premium", "splurge"] as const;
export type Budget = (typeof BUDGETS)[number];
/** The budget bands in euros, for the model and the screen (the upper bound of "splurge" is open). */
export const BUDGET_EUROS: Record<Budget, readonly [number, number | null]> = {
  value: [0, 15],
  mid: [15, 30],
  premium: [30, 60],
  splurge: [60, null],
};

export const AskSommelierSchema = z
  .object({
    messages: z.array(ChatMessageSchema).min(1).max(12),
    /** "tonight": pairing a dish or an evening, judged honestly, with what to buy when nothing fits. */
    mode: z.enum(["chat", "tonight"]).default("chat"),
    budget: z.enum(BUDGETS).nullable().default(null),
  })
  .refine((v) => v.messages.at(-1)?.role === "user", "Ask a question.");
/** What a caller sends; mode and budget may be left out (a plain chat, no budget). */
export type AskSommelier = z.input<typeof AskSommelierSchema>;

// ---- The answer ----------------------------------------------------------------------------------------------

/** A bottle from the cellar that an answer points at (tappable in the screen). */
export interface SommelierBottle {
  vintageId: string;
  producer: string;
  wineName: string;
  year: number | null;
  type: WineType;
  region: string | null;
  countryCode: string | null;
  count: number;
  places: string[];
  drinkPhase: CellarItem["drink"]["phase"];
  rating: RatingSummary | null;
  /** Some of these bottles are kept for an occasion. */
  reserved?: Reservation | null;
  /** The household's own label photo of the wine, to show it as itself. */
  image?: ImageRef | null;
}

/** A wine worth buying for the moment, when the cellar has nothing (good enough). Never one that is in it. */
export interface BuySuggestion {
  /** "Barolo, e.g. G.D. Vajra Albe" */
  wine: string;
  why: string;
  /** A rough price per bottle, as the model words it ("about €20–25"). */
  price: string;
}

/** How well the cellar answers the question: a real match, something that will do, or nothing. */
export type PairingVerdict = "match" | "partial" | "none";

export interface SommelierAnswer {
  source: "ai" | "basic";
  /** Only for a pairing question answered by the AI. */
  verdict?: PairingVerdict | null;
  /** Wines to buy instead (or as well), within the budget. */
  buy?: BuySuggestion[];
  /** The model's words (source "ai"); null for the plain answer, whose one sentence the screen words itself. */
  text: string | null;
  /** Which sentence the screen shows for a plain answer. */
  basic: "pairing" | "soon" | "favorites" | "nothing" | "facts" | null;
  /** For a plain answer to a question about the cellar ("facts"): the numbers it states, counted, never guessed. */
  facts?: { bottles: number; wines: number; free: number; matches: number | null } | null;
  /** Wines in the cellar the answer is about, best first; only ever real ones. */
  bottles: SommelierBottle[];
  /** Why the plain answer was given instead of an AI one. */
  reason: "ai-off" | "ai-down" | "limit" | null;
}

export const toSommelierBottle = (item: CellarItem): SommelierBottle => ({
  vintageId: item.vintageId,
  producer: item.producer,
  wineName: item.wineName,
  year: item.year,
  type: item.type,
  region: item.region,
  countryCode: item.countryCode,
  count: item.count,
  places: item.places,
  drinkPhase: item.drink.phase,
  rating: item.rating,
  reserved: item.reserved ?? null,
  image: item.image,
});

// ---- What the model is shown ---------------------------------------------------------------------------------

export const DIGEST_MAX = 120;

/** Short, stable names for the wines in a digest, so the model can point at one and we can check it did. */
function refsFor(items: readonly CellarItem[]): Map<string, CellarItem> {
  for (let length = 6; length <= 36; length += 2) {
    const refs = new Map<string, CellarItem>();
    for (const item of items) refs.set(item.vintageId.replace(/-/g, "").slice(0, length), item);
    if (refs.size === items.length) return refs;
  }
  return new Map(items.map((i) => [i.vintageId, i]));
}

const words = (text: string) =>
  normalizeText(text)
    .split(" ")
    .filter((w) => w.length >= 4);

/**
 * The wines to show the model for this question: all of them when the cellar is small, otherwise the ones
 * that look relevant (words of the question in the name, region or style), then what is urgent, loved or rated.
 */
export function shortlistForQuestion(
  items: readonly CellarItem[],
  question: string,
  max = DIGEST_MAX,
  /** Wines that must be on the list (the ones a question about the cellar is about). */
  keep: ReadonlySet<string> = new Set(),
): CellarItem[] {
  if (items.length <= max) return [...items];
  const wanted = new Set(words(question));
  const score = (i: CellarItem) => {
    const text = normalizeText(
      `${i.producer} ${i.wineName} ${i.region ?? ""} ${i.countryCode ?? ""} ${i.type} ${i.year ?? ""}`,
    );
    let s = keep.has(i.vintageId) ? 1000 : 0;
    for (const w of wanted) if (text.includes(w)) s += 4;
    if (i.favorite) s += 1;
    if (i.drink.phase === "ready" || i.drink.phase === "past") s += 2;
    if (i.rating) s += i.rating.average >= 8 ? 1 : 0;
    return s;
  };
  return items
    .map((item, order) => ({ item, order, s: score(item) }))
    .sort((a, b) => b.s - a.s || a.order - b.order)
    .slice(0, max)
    .map((x) => x.item);
}

export interface CellarDigest {
  /** One line per wine, each starting with the short name the model must use to point at it. */
  text: string;
  /** Short name → the wine it stands for. */
  refs: ReadonlyMap<string, CellarItem>;
  /** How many wines the cellar holds in all (the digest may hold fewer). */
  total: number;
}

const stars = (r: RatingSummary | null) =>
  r ? ` · rated ${(r.average / 2).toFixed(1)}★ (${r.count})` : "";

export function cellarDigest(
  items: readonly CellarItem[],
  question: string,
  keep?: ReadonlySet<string>,
): CellarDigest {
  const shown = shortlistForQuestion(items, question, DIGEST_MAX, keep);
  const refs = refsFor(shown);
  const lines = [...refs.entries()].map(([ref, i]) => {
    const where = [i.region, i.countryCode].filter(Boolean).join(", ");
    return (
      [
        `${ref} | ${i.producer} — ${i.wineName}`,
        `${i.year ?? "NV"}`,
        i.type,
        where || "place unknown",
        `×${i.count}`,
        `drink: ${i.drink.phase}`,
      ].join(" | ") +
      stars(i.rating) +
      (i.favorite ? " · favourite" : "") +
      (i.reserved
        ? ` · reserved: ${i.reserved.count} of ${i.count} kept for "${i.reserved.title.replace(/["\n]/g, " ")}"${i.reserved.on ? ` on ${i.reserved.on}` : ""}`
        : "")
    );
  });
  return { text: lines.join("\n"), refs, total: items.length };
}

// ---- What the model says -------------------------------------------------------------------------------------

export const RawSommelierSchema = z.object({
  answer: z.string(),
  bottle_refs: z.array(z.string()),
  verdict: z.enum(["match", "partial", "none", "not_pairing"]).default("not_pairing"),
  buy: z.array(z.object({ wine: z.string(), why: z.string(), price: z.string() })).default([]),
});
export type RawSommelier = z.input<typeof RawSommelierSchema>;

const MAX_ANSWER = 900;
const MAX_BOTTLES = 3;

/**
 * Keeps what can be trusted: the words, tidied and shortened, and only the references that name a wine that is
 * really in the digest. A wine the model made up simply has no card.
 */
export function checkSommelierAnswer(
  raw: RawSommelier,
  digest: CellarDigest,
): {
  text: string;
  bottles: SommelierBottle[];
  verdict: PairingVerdict | null;
  buy: BuySuggestion[];
} | null {
  const text = raw.answer
    // eslint-disable-next-line no-control-regex -- stripping control characters is the point
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]+/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_ANSWER)
    .trim();
  if (text === "") return null;
  const seen = new Set<string>();
  const bottles: SommelierBottle[] = [];
  for (const ref of raw.bottle_refs) {
    const item = digest.refs.get(ref.trim());
    if (!item || seen.has(item.vintageId)) continue;
    seen.add(item.vintageId);
    bottles.push(toSommelierBottle(item));
    if (bottles.length === MAX_BOTTLES) break;
  }
  const verdict = !raw.verdict || raw.verdict === "not_pairing" ? null : raw.verdict;
  const buy = (raw.buy ?? [])
    .map((b) => ({ wine: tidy(b.wine, 120), why: tidy(b.why, 240), price: tidy(b.price, 40) }))
    .filter((b) => b.wine !== "")
    .slice(0, MAX_BUY);
  // "Nothing fits" with a bottle to open contradicts itself: trust the bottles, call it partial.
  return {
    text,
    bottles,
    verdict: verdict === "none" && bottles.length > 0 ? "partial" : verdict,
    buy,
  };
}

const MAX_BUY = 3;

const tidy = (value: string, max: number) =>
  value
    // eslint-disable-next-line no-control-regex -- stripping control characters is the point
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();

// ---- Understanding a question without AI ---------------------------------------------------------------------

/** Everyday words (English and Dutch) for the dishes the pairing knows. First match wins, so specific ones come first. */
const DISH_WORDS: ReadonlyArray<readonly [DishId, readonly string[]]> = [
  ["steak", ["steak", "entrecote", "ribeye", "biefstuk", "rib eye", "sirloin", "tenderloin"]],
  ["burger", ["burger", "hamburger"]],
  ["barbecue", ["barbecue", "bbq", "barbeque"]],
  ["lamb", ["lamb"]],
  ["game", ["game", "venison", "hert", "everzwijn", "hare"]],
  ["curry", ["curry", "tikka", "masala"]],
  ["thai", ["thai", "pad thai", "satay", "saté"]],
  ["chinese", ["chinese", "dim sum", "stir fry", "stir-fry", "wok"]],
  ["spicy", ["spicy", "pittig", "hot sauce", "chili", "chilli"]],
  ["mushrooms", ["mushroom", "paddenstoel", "truffle", "truffel", "champignon"]],
  ["stew", ["stew", "casserole", "stoof", "braise", "beef", "rundvlees"]],
  ["festive-bird", ["turkey", "kalkoen", "christmas", "kerst"]],
  ["duck", ["duck", "eend"]],
  ["chicken", ["chicken", "kip", "poultry"]],
  ["pork-belly", ["pork belly", "spekkie"]],
  ["pork", ["pork", "varken", "ham"]],
  ["charcuterie", ["charcuterie", "salami", "cold cuts", "tapas"]],
  [
    "shellfish",
    [
      "oyster",
      "oesters",
      "shellfish",
      "lobster",
      "kreeft",
      "mussel",
      "mosselen",
      "prawn",
      "garnaal",
      "crab",
      "krab",
      "scallop",
    ],
  ],
  ["sushi", ["sushi", "sashimi"]],
  ["smoked-fish", ["smoked salmon", "gerookte zalm", "smoked fish"]],
  ["oily-fish", ["salmon", "zalm", "tuna", "tonijn", "mackerel", "makreel"]],
  ["fish-soup", ["fish soup", "bouillabaisse", "vissoep"]],
  [
    "white-fish",
    [
      "fish",
      "vis",
      "cod",
      "kabeljauw",
      "sole",
      "tong",
      "seabass",
      "zeebaars",
      "sea bass",
      "haddock",
    ],
  ],
  ["ragu", ["ragu", "ragù", "bolognese", "lasagna", "lasagne"]],
  ["pasta-cream", ["carbonara", "alfredo", "cream pasta", "pasta cream"]],
  ["pasta-tomato", ["pasta", "spaghetti", "penne", "tomato sauce", "tomatensaus"]],
  ["risotto", ["risotto"]],
  ["pizza", ["pizza"]],
  ["blue-cheese", ["blue cheese", "roquefort", "gorgonzola", "stilton", "blauwe kaas"]],
  ["goat-cheese", ["goat cheese", "goats cheese", "geitenkaas", "chevre"]],
  ["soft-cheese", ["brie", "camembert", "soft cheese", "zachte kaas"]],
  ["hard-cheese", ["cheese", "kaas", "cheddar", "parmesan", "gouda", "comte", "comté"]],
  ["chocolate", ["chocolate", "chocola", "brownie"]],
  ["fruit-tart", ["tart", "taart", "apple pie", "appeltaart", "fruit"]],
  ["ice-cream", ["ice cream", "ijs", "gelato"]],
  ["custard", ["custard", "creme brulee", "crème brûlée", "pudding", "vla", "tiramisu"]],
  ["quiche", ["quiche"]],
  ["veggie-burger", ["veggie burger", "vegetarian burger"]],
  ["roasted-veg", ["roasted veg", "vegetables", "groenten", "vegetarian", "vegetarisch", "vegan"]],
  ["pulses", ["lentil", "linzen", "chickpea", "kikkererwt", "beans", "bonen"]],
  ["salad", ["salad", "salade"]],
  ["soup", ["soup", "soep"]],
  ["eggs", ["egg", "eieren", "omelet", "omelette"]],
  ["fries", ["fries", "frites", "patat"]],
  ["nuts", ["nuts", "noten"]],
  ["aperitif", ["aperitif", "aperitief", "apero", "borrel", "snacks", "drinks before"]],
];

const OCCASION_WORDS: ReadonlyArray<readonly [Occasion, readonly string[]]> = [
  [
    "celebration",
    [
      "celebrat",
      "party",
      "anniversary",
      "birthday",
      "toast",
      "new year",
      "feest",
      "verjaardag",
      "jubileum",
      "nieuwjaar",
      "proost",
      "special occasion",
    ],
  ],
  [
    "guests",
    ["guests", "friends over", "dinner party", "visitors", "gasten", "vrienden", "company"],
  ],
  [
    "use-it-up",
    [
      "use up",
      "use it up",
      "past its best",
      "running out",
      "before it",
      "drink soon",
      "opdrinken",
      "nu op",
      "should drink",
      "peak",
      "at its best",
    ],
  ],
  ["weeknight", ["weeknight", "quick", "easy", "doordeweeks", "simple", "casual"]],
];

/** What a plain-words question seems to be about: a dish and/or an occasion. Either may be absent. */
export function detectIntent(question: string): { dish: DishId | null; occasion: Occasion } {
  const q = ` ${normalizeText(question)} `;
  const hit = (list: readonly string[]) => list.some((w) => q.includes(` ${normalizeText(w)}`));
  const dish = DISH_WORDS.find(([, list]) => hit(list))?.[0] ?? null;
  const occasion = OCCASION_WORDS.find(([, list]) => hit(list))?.[0] ?? "anything";
  return { dish, occasion };
}

/** For a plain answer with no dish in the question: what is most worth opening, in order of urgency, then the loved ones. */
export function worthOpening(
  items: readonly CellarItem[],
  count = MAX_BOTTLES,
): {
  kind: "soon" | "favorites" | "nothing";
  items: CellarItem[];
} {
  const soon = items
    .filter((i) => i.drink.phase === "ready" || i.drink.phase === "past")
    .sort((a, b) => a.drink.urgency - b.drink.urgency);
  if (soon.length > 0) return { kind: "soon", items: soon.slice(0, count) };
  const loved = items
    .filter((i) => i.favorite || (i.rating?.average ?? 0) >= 8)
    .sort(
      (a, b) =>
        Number(b.favorite) - Number(a.favorite) ||
        (b.rating?.average ?? 0) - (a.rating?.average ?? 0),
    );
  if (loved.length > 0) return { kind: "favorites", items: loved.slice(0, count) };
  return { kind: "nothing", items: items.slice(0, count) };
}
