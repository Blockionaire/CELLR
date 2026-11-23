import { DISHES } from "./dishes";
import type { DishCard, Turn } from "./types";
import { CELLARS } from "./wines";

/**
 * MENU SCENARIOS (Sommelier V1+, part `menu`). Eighteen menus of two to five courses, in English and Dutch, asked
 * of the named cellars of wines.ts. Each course names the reference dish of dishes.ts it stands for, and the labels
 * are that card's: `good` wines a sommelier would pour with confidence, `ok` wines that will do, every other wine
 * of the cellar a poor choice. A course with no card (`dish: null`) is one the app cannot read; any honest answer
 * to it counts.
 *
 * The labels are AI-written, like those of the cards they come from (reviewed: false; RISK_REGISTER R-11), and
 * the dishes are the development set's, so this set is not blind: it measures whether a menu is read and planned
 * course by course, not how well a dish is paired. Not registered in sets.ts here (the lead does).
 *
 * `said` is the course as the app's menu reader returns it (scenarios-menu.test.ts proves they agree), so an
 * engine's answer can be matched to a course by its number. Two scenarios ask a follow-up about one course after
 * the menu was said (`followUp`): the menu must survive the conversation.
 */

export interface MenuScenarioCourse {
  /** The course as the menu reader returns it. */
  said: string;
  /** The reference dish of dishes.ts it stands for; null for a course that cannot be read. */
  dish: string | null;
}

export interface MenuScenario {
  id: string;
  lang: "en" | "nl";
  /** A named cellar of wines.ts. */
  cellar: string;
  /** The menu is the first turn; a follow-up asks about it afterwards. */
  turns: readonly Turn[];
  courses: readonly MenuScenarioCourse[];
  /** The last question is about this course (1-based) of the menu said earlier. */
  followUp?: { course: number };
  note?: string;
}

export const MENU_SCENARIOS: readonly MenuScenario[] = [
  {
    id: "mn-01",
    lang: "en",
    cellar: "all",
    turns: [
      {
        user: "Oysters to start, then roast lamb, and for dessert chocolate fondant. Which wine with each course?",
      },
    ],
    courses: [
      { said: "Oysters", dish: "raw-oysters" },
      { said: "roast lamb", dish: "roast-lamb" },
      { said: "chocolate fondant", dish: "dark-chocolate-fondant" },
    ],
  },
  {
    id: "mn-02",
    lang: "nl",
    cellar: "all",
    turns: [
      {
        user: "Vooraf oesters, daarna lamsbout en als toetje chocoladefondant. Welke wijn per gang?",
      },
    ],
    courses: [
      { said: "oesters", dish: "raw-oysters" },
      { said: "lamsbout", dish: "roast-lamb" },
      { said: "chocoladefondant", dish: "dark-chocolate-fondant" },
    ],
  },
  {
    id: "mn-03",
    lang: "en",
    cellar: "everyday",
    turns: [{ user: "Starter: goat cheese salad. Main: pork chops. Dessert: apple pie." }],
    courses: [
      { said: "goat cheese salad", dish: "goat-cheese-salad" },
      { said: "pork chops", dish: "pork-chops" },
      { said: "apple pie", dish: "appeltaart-slagroom" },
    ],
  },
  {
    id: "mn-04",
    lang: "nl",
    cellar: "all",
    turns: [
      {
        user: "Voorgerecht: carpaccio. Hoofdgerecht: zeebaars met citroenbotersaus. Nagerecht: tiramisu.",
      },
    ],
    courses: [
      { said: "carpaccio", dish: "beef-carpaccio" },
      { said: "zeebaars met citroenbotersaus", dish: "sea-bass-lemon-butter" },
      { said: "tiramisu", dish: "tiramisu" },
    ],
  },
  {
    id: "mn-05",
    lang: "en",
    cellar: "whites-and-bubbles",
    turns: [
      { user: "Three-course dinner: smoked salmon, sole meunière and lemon tart. Which wines?" },
    ],
    courses: [
      { said: "smoked salmon", dish: "smoked-salmon" },
      { said: "sole meunière", dish: "sole-meuniere" },
      { said: "lemon tart", dish: "lemon-tart" },
    ],
    note: "No sweet wine in this cellar: for the tart the honest answer is the closest (Champagne) or none.",
  },
  {
    id: "mn-06",
    lang: "en",
    cellar: "big-reds",
    turns: [
      {
        user: "To start beef carpaccio, then steak with béarnaise, then aged Gouda. One wine per course please.",
      },
    ],
    courses: [
      { said: "beef carpaccio", dish: "beef-carpaccio" },
      { said: "steak with béarnaise", dish: "steak-bearnaise" },
      { said: "aged Gouda", dish: "aged-gouda" },
    ],
  },
  {
    id: "mn-07",
    lang: "nl",
    cellar: "everyday",
    turns: [{ user: "We beginnen met bitterballen, dan mosselen met friet, daarna appeltaart." }],
    courses: [
      { said: "bitterballen", dish: "bitterballen" },
      { said: "mosselen met friet", dish: "mosselen-friet" },
      { said: "appeltaart", dish: "appeltaart-slagroom" },
    ],
  },
  {
    id: "mn-08",
    lang: "en",
    cellar: "all",
    turns: [
      {
        user: "Menu: scallops with cauliflower purée, then mushroom risotto, then duck breast with cherry sauce, and for dessert crème brûlée.",
      },
    ],
    courses: [
      { said: "scallops with cauliflower purée", dish: "scallops-cauliflower" },
      { said: "mushroom risotto", dish: "mushroom-risotto" },
      { said: "duck breast with cherry sauce", dish: "duck-cherry" },
      { said: "crème brûlée", dish: "creme-brulee" },
    ],
  },
  {
    id: "mn-09",
    lang: "nl",
    cellar: "all",
    turns: [
      {
        user: "Amuse: oesters. Voorgerecht: gerookte zalm. Tussengerecht: risotto met paddenstoelen. Hoofdgerecht: hertenbiefstuk met rodewijnsaus. Kaasplank: blauwe kaas.",
      },
    ],
    courses: [
      { said: "oesters", dish: "raw-oysters" },
      { said: "gerookte zalm", dish: "smoked-salmon" },
      { said: "risotto met paddenstoelen", dish: "mushroom-risotto" },
      { said: "hertenbiefstuk met rodewijnsaus", dish: "venison-red-wine-cabbage" },
      { said: "blauwe kaas", dish: "blue-cheese" },
    ],
  },
  {
    id: "mn-10",
    lang: "en",
    cellar: "one-red",
    turns: [{ user: "Oysters to start, then roast lamb." }],
    courses: [
      { said: "Oysters", dish: "raw-oysters" },
      { said: "roast lamb", dish: "roast-lamb" },
    ],
    note: "One Rioja in the cellar: it suits the lamb; for the oysters the honest answer is that nothing suits.",
  },
  {
    id: "mn-11",
    lang: "en",
    cellar: "light-whites",
    turns: [{ user: "Sushi to start, then grilled ribeye steak. Which wine with each course?" }],
    courses: [
      { said: "Sushi", dish: "sushi-sashimi" },
      { said: "grilled ribeye steak", dish: "grilled-ribeye-steak" },
    ],
    note: "Only light whites: the steak has nothing that suits, and a white must not be forced on it.",
  },
  {
    id: "mn-12",
    lang: "nl",
    cellar: "reds-only",
    turns: [
      {
        user: "Eerst gegrilde zeebrasem met venkel, daarna coq au vin, en als dessert tiramisu.",
      },
    ],
    courses: [
      { said: "gegrilde zeebrasem met venkel", dish: "sea-bream-fennel" },
      { said: "coq au vin", dish: "coq-au-vin" },
      { said: "tiramisu", dish: "tiramisu" },
    ],
  },
  {
    id: "mn-13",
    lang: "en",
    cellar: "all",
    turns: [
      {
        user: "Our menu:\n- pasta vongole\n- osso buco\n- cheese board with hard cheeses\nWhat should we pour with each?",
      },
    ],
    courses: [
      { said: "pasta vongole", dish: "pasta-vongole" },
      { said: "osso buco", dish: "osso-buco" },
      { said: "cheese board with hard cheeses", dish: "cheese-board-hard" },
    ],
  },
  {
    id: "mn-14",
    lang: "en",
    cellar: "all",
    turns: [
      { user: "Starter: ceviche. Main: Thai green curry. Dessert: cheesecake." },
      { user: "And which one would you pour with the curry?" },
    ],
    courses: [
      { said: "ceviche", dish: "ceviche" },
      { said: "Thai green curry", dish: "thai-green-curry" },
      { said: "cheesecake", dish: "cheesecake" },
    ],
    followUp: { course: 2 },
  },
  {
    id: "mn-15",
    lang: "nl",
    cellar: "all",
    turns: [
      { user: "Vooraf gebakken slibtong, daarna draadjesvlees, als toetje oude kaas." },
      { user: "Moet ik de rode wijn decanteren?" },
      { user: "En welke wijn past het best bij het hoofdgerecht?" },
    ],
    courses: [
      { said: "gebakken slibtong", dish: "gebakken-slibtong" },
      { said: "draadjesvlees", dish: "draadjesvlees" },
      { said: "oude kaas", dish: "aged-gouda" },
    ],
    followUp: { course: 2 },
  },
  {
    id: "mn-16",
    lang: "en",
    cellar: "sweet-only",
    turns: [{ user: "First a blue cheese, then crème brûlée. Which of my wines for each?" }],
    courses: [
      { said: "blue cheese", dish: "blue-cheese" },
      { said: "crème brûlée", dish: "creme-brulee" },
    ],
  },
  {
    id: "mn-17",
    lang: "nl",
    cellar: "whites-and-bubbles",
    turns: [{ user: "Vooraf kreeft met gesmolten boter, daarna kip met citroen en kruiden." }],
    courses: [
      { said: "kreeft met gesmolten boter", dish: "lobster-butter" },
      { said: "kip met citroen en kruiden", dish: "chicken-lemon-herbs" },
    ],
  },
  {
    id: "mn-18",
    lang: "en",
    cellar: "all",
    turns: [{ user: "Tomato salad to start, then qwertzu, then seafood paella." }],
    courses: [
      { said: "Tomato salad", dish: "tomato-salad" },
      { said: "qwertzu", dish: null },
      { said: "seafood paella", dish: "seafood-paella" },
    ],
    note: "The second course cannot be read: it must be said as it was, not dropped and not paired as if known.",
  },
];

const cards = new Map(DISHES.map((d) => [d.id, d]));
export const menuDishOf = (id: string): DishCard => {
  const card = cards.get(id);
  if (!card) throw new Error(`unknown reference dish: ${id}`);
  return card;
};

/** What is right for one course in a scenario's cellar: its best owned wines, and the poor ones. */
export interface CourseExpectation {
  /** "good": a good wine is in the cellar. "ok": only one that will do. "none": nothing suits. "any": unread. */
  level: "good" | "ok" | "none" | "any";
  /** The owned wines that are the right answer (the good ones, else the ones that will do). */
  right: string[];
  /** Owned wines that are a poor choice for it. */
  poor: string[];
}

export function menuExpectations(s: MenuScenario): CourseExpectation[] {
  const owned = CELLARS[s.cellar];
  if (!owned) throw new Error(`unknown cellar: ${s.cellar}`);
  return s.courses.map((c) => {
    if (c.dish === null) return { level: "any", right: [], poor: [] };
    const card = menuDishOf(c.dish);
    const good = owned.filter((k) => card.good.includes(k));
    const ok = owned.filter((k) => card.ok.includes(k));
    const poor = owned.filter((k) => !card.good.includes(k) && !card.ok.includes(k));
    if (good.length > 0) return { level: "good", right: good, poor };
    if (ok.length > 0) return { level: "ok", right: ok, poor };
    return { level: "none", right: [], poor };
  });
}
