import { normalizeText } from "./cellar";

/**
 * WHAT KIND OF QUESTION IS THIS, as far as words alone can tell. Some questions are recognised by how they are
 * asked ("at what temperature", "do I have enough bottles", "what should I cook with"); the rest (a dish to pair,
 * something to buy, a question about the cellar) is decided by the server from what the engines found.
 */
export const ASKED_FOR = ["serving", "keeping", "quantity", "wine-to-food", "compare"] as const;
export type AskedFor = (typeof ASKED_FOR)[number];

const PHRASES: ReadonlyArray<readonly [AskedFor, readonly string[]]> = [
  [
    "quantity",
    [
      "enough bottles",
      "enough wine",
      "how many bottles",
      "how much wine",
      "genoeg flessen",
      "genoeg wijn",
      "hoeveel flessen",
      "hoeveel wijn",
    ],
  ],
  [
    "serving",
    [
      "temperature",
      "how cold",
      "how warm",
      "how cool",
      "chill it",
      "chilled",
      "decant",
      "decanted",
      "decanting",
      "carafe",
      "which glass",
      "what glass",
      "how do i serve",
      "how should i serve",
      "how to serve",
      "let it breathe",
      "temperatuur",
      "hoe koud",
      "hoe warm",
      "koelen",
      "decanteren",
      "decanteer",
      "karaf",
      "welk glas",
      "wat voor glas",
      "hoe serveer",
      "hoe schenk",
      "chambreren",
      "laten ademen",
    ],
  ],
  [
    "keeping",
    [
      "how long can i keep",
      "how long will it keep",
      "how long can i store",
      "how long does it keep",
      "when should i drink",
      "when is it ready",
      "is it ready",
      "can i still keep",
      "hoe lang kan ik",
      "hoe lang kan hij",
      "nog bewaren",
      "bewaren",
      "wanneer drinken",
      "wanneer moet ik",
      "is hij op dronk",
      "op dronk",
    ],
  ],
  [
    "wine-to-food",
    [
      "what should i cook",
      "what can i cook",
      "what to cook",
      "what do i cook",
      "what should i eat",
      "what food goes",
      "what food should",
      "which dish",
      "what dish",
      "wat kook ik",
      "wat zal ik koken",
      "wat moet ik koken",
      "wat kan ik koken",
      "wat eet ik",
      "wat eten we",
      "welk gerecht",
      "welk eten",
      "wat past bij mijn",
    ],
  ],
];

/** The kind a question's wording points to, or null when the wording does not say. */
export function askedFor(question: string): AskedFor | null {
  const text = ` ${normalizeText(question)} `;
  for (const [kind, phrases] of PHRASES)
    if (phrases.some((p) => text.includes(` ${p} `))) return kind;
  return null;
}

/** "X or Y": a choice between two things. The server decides whether both are wines the person owns. */
export const offersChoice = (question: string): boolean =>
  / (or|of|versus|vs) /.test(` ${normalizeText(question)} `);

/** Words that show a question is about wine or a meal at all, when no dish and no wine was recognised. */
const TOPIC = [
  "wine",
  "wijn",
  "bottle",
  "fles",
  "flessen",
  "cellar",
  "kelder",
  "drink",
  "drinken",
  "pour",
  "schenk",
  "schenken",
  "open",
  "openen",
  "dinner",
  "diner",
  "eten",
  "eat",
  "pairing",
  "sommelier",
  "glass",
  "glas",
  "red",
  "white",
  "rood",
  "wit",
  "rose",
  "champagne",
  "bubbles",
  "bubbels",
];
export const aboutWine = (question: string): boolean => {
  const text = ` ${normalizeText(question)} `;
  return TOPIC.some((w) => text.includes(` ${w} `));
};
