import type { Scenario } from "./types";

/**
 * THE SERVING AND GUESTS PROBE (P8). A small set (16 scenarios, English and Dutch, the eval's synthetic cellars) that
 * asks what the `annotate` and `quantities` parts act on: how to serve or keep a named wine, a follow-up "how cold?"
 * after a pairing, and pairings for a stated number of people. It exists so the stop rule on serving claims and the
 * reconciliation's removal rate are measured on real model output at all (the main sets hardly ask such questions).
 *
 * The dish labels behind the guests scenarios are the dish cards' (dishes.ts): WRITTEN BY AN AI, reviewed by nobody
 * (R-11). The serving scenarios have no label: they are measured by the stop rules and the reconciliation only.
 */
const serving = (
  id: string,
  lang: "en" | "nl",
  turns: string[],
  mods?: Scenario["mods"],
): Scenario => ({
  id,
  category: "experience",
  lang,
  cellar: "all",
  ...(mods ? { mods } : {}),
  turns: turns.map((user) => ({ user })),
  needs: ["pairing"],
  expect: {},
  note: "Serving probe: no label; measured by the stop rules and the serving reconciliation.",
});

const guests = (
  id: string,
  lang: "en" | "nl",
  cellar: string,
  user: string,
  dish: string,
): Scenario => ({
  id,
  category: "experience",
  lang,
  cellar,
  turns: [{ user }],
  dish,
  needs: ["pairing"],
  expect: { verdict: "auto" },
  note: "Guests probe: the dish card's labels are AI-written.",
});

export const PROBE_SCENARIOS: readonly Scenario[] = [
  serving("pr-01", "en", ["How should I serve the Barolo, and should I decant it?"], {
    profiles: ["barolo"],
  }),
  serving("pr-02", "nl", ["Hoe koud schenk ik de Chablis?"]),
  serving("pr-03", "en", ["At what temperature should I serve the Sauternes?"]),
  serving("pr-04", "nl", ["Moet ik de Pauillac decanteren, en hoe lang?"], {
    profiles: ["pauillac"],
  }),
  serving("pr-05", "en", ["How long can I keep the Chianti Classico?"]),
  serving("pr-06", "nl", ["Hoe lang kan ik de Rioja Reserva nog bewaren?"]),
  serving("pr-07", "en", [
    "Roast lamb tonight, which wine should I open?",
    "How should I serve it?",
  ]),
  serving("pr-08", "nl", ["Wat drinken we bij de mosselen?", "Hoe koud moet die?"]),
  serving("pr-09", "en", ["We have a cheese board: how warm should the Vintage Port be?"]),
  serving("pr-10", "nl", ["Op welke temperatuur schenk ik de Malbec?"]),
  guests(
    "pr-11",
    "en",
    "all",
    "We are 8 for roast lamb tonight. Which wine, and how many bottles?",
    "roast-lamb",
  ),
  guests(
    "pr-12",
    "nl",
    "all",
    "We zijn met z'n zessen en eten zeebaars met citroenbotersaus. Welke wijn?",
    "sea-bass-lemon-butter",
  ),
  guests(
    "pr-13",
    "en",
    "all",
    "Dinner for 12: mushroom risotto. What should I open?",
    "mushroom-risotto",
  ),
  guests("pr-14", "nl", "all", "Voor 4 personen oesters vooraf, welke wijn?", "raw-oysters"),
  guests("pr-15", "en", "everyday", "We are 10 for pork chops, which wine?", "pork-chops"),
  guests("pr-16", "nl", "reds-only", "Met z'n achten, coq au vin. Welke fles?", "coq-au-vin"),
];
