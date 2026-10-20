import {
  normalizeText,
  type CellarItem,
  type RackView,
  type StorageUnitView,
  type WineType,
} from "./cellar";

/**
 * Questions about the cellar itself ("how many bottles", "where is my Musar", "how much room is left") are
 * answered from facts counted here, from the database, never by the model: it only words them. Wine advice
 * does not need any of this, so it is only worked out (and shown to the model) for a question that asks.
 */

const ASKS_ABOUT_CELLAR = new RegExp(
  [
    // Dutch
    "\\bhoeveel\\b",
    "\\bwaar (ligt|liggen|staat|staan|zit|zitten)\\b",
    "\\bop welke plek",
    "\\bwelke plek",
    "\\bplek(ken)? (vrij|over)\\b",
    "\\bvrij(e)? plek",
    "\\bruimte\\b",
    "\\bheb ik (nog )?(een|geen|wel|ook)?\\b",
    "\\bwelke .{0,30}\\bheb ik\\b",
    // English
    "\\bhow (many|much)\\b",
    "\\bwhere (is|are)\\b",
    "\\bwhich (spot|place|shelf|position)s?\\b",
    "\\b(free|empty) (spot|place|slot|space)s?\\b",
    "\\b(room|space) (left|in)\\b",
    "\\bdo i (still )?have\\b",
    "\\bwhich .{0,30}\\bdo i have\\b",
  ].join("|"),
  "i",
);

export function isCellarQuestion(question: string): boolean {
  return ASKS_ABOUT_CELLAR.test(question);
}

/**
 * What a question about the cellar wants to know, so a plain answer answers that and nothing more:
 * where bottles are ("Waar ligt…", "Where is…"), how many there are ("Hoeveel…", "How many…"), or which wines
 * there are ("Welke…", "Heb ik nog een…", "Do I have…").
 */
export type CellarQuestionKind = "location" | "quantity" | "selection";

const ASKS_WHERE =
  /\b(waar|where|plek|plekken|plaats|plank|positie|spot|spots|shelf|position|located|location)\b/i;
const ASKS_HOW_MANY = /\b(hoeveel|aantal|how many|how much|number of)\b/i;

export function cellarQuestionKind(question: string): CellarQuestionKind {
  if (ASKS_WHERE.test(question)) return "location";
  if (ASKS_HOW_MANY.test(question)) return "quantity";
  return "selection";
}

const TYPE_WORDS: Array<[RegExp, WineType]> = [
  [/\b(wit|witte|white|whites)\b/i, "white"],
  [/\b(rood|rode|red|reds)\b/i, "red"],
  [/\b(rose|rosé|roses|rosés)\b/i, "rose"],
  [/\b(mousserend|mousserende|bubbels|sparkling|bubbles)\b/i, "sparkling"],
  [/\b(dessert|zoet|zoete|sweet)\b/i, "dessert"],
  [/\b(versterkt|versterkte|fortified|port|porto|sherry)\b/i, "fortified"],
];

/** Words that say what is asked, not which wine: they never pick a wine out. */
const QUESTION_WORDS = new Set(
  normalizeText(
    // Dutch
    "hoeveel verschillende flessen fles wijnen wijn heb hebben hebt ik jij wij nog mijn mijne onze waar ligt " +
      "liggen staat staan zit zitten welke welk plek plekken plaats plaatsen vrij vrije ruimte opslagruimte " +
      "over in de het een uit van voor bij op wat met kast rek kelder wijnkelder wijnklimaatkast klimaatkast " +
      "koelkast wijnkast jaargang jaar beschikbaar totaal stuks meer minder alle allemaal geen wel ook nog er " +
      "daar hier zijn is die dat deze dit graag even nou eigenlijk precies " +
      // English
      "how many much bottles bottle wines wine different do does have has got still my our where is are " +
      "which spot spots place places free empty space storage room left available total the a an of from " +
      "in on at what any some all there here that this these those cellar fridge rack vintage year please " +
      "exactly kept stored",
  ).split(" "),
);

/** The kind of wine a word says ("witte" → white), or null. */
const typeOf = (word: string): WineType | null =>
  TYPE_WORDS.find(([pattern]) => pattern.test(word))?.[1] ?? null;

export interface CellarMatch {
  item: CellarItem;
  /** Where each bottle is: "Wine fridge, shelf 2, position 3"; bottles without a place are counted apart. */
  spots: Array<{ place: string; row: number; col: number }>;
  unplaced: number;
}

export interface CellarFacts {
  bottles: number;
  /** Different wines (a wine with two vintages is one wine). */
  wines: number;
  vintages: number;
  unplaced: number;
  byType: Array<{ type: WineType; bottles: number; wines: number }>;
  places: Array<Pick<StorageUnitView, "label" | "kind" | "capacity" | "used" | "free">>;
  free: number;
  /**
   * What the question named (words, a year, a kind of wine), or null when it named no wine. `unknown` are the
   * words that look like a wine's name but fit nothing in this cellar: then nothing matches ("not found"),
   * rather than the rest of the question picking out other wines.
   */
  asked: { words: string[]; unknown: string[]; year: number | null; type: WineType | null } | null;
  /** The wines that fit what was named, all of them (so an ambiguous question is answered with the choice). */
  matches: CellarMatch[];
  /** What the question wants to know about them. */
  kind: CellarQuestionKind;
}

/**
 * Every wine in the cellar that fits the words, year and kind of wine in the question. A word that names a
 * producer, wine or region in the cellar narrows it down (every such word must fit, so "Château Musar" is not
 * every château). A word that could be a wine's name but fits nothing (a wine that isn't there, a typo) is never
 * dropped: then nothing matches, so a question about a missing 2019 wine is not answered with other 2019s.
 * Words of the question itself, kinds of wine and the names of the household's places are not wine names.
 */
export function matchCellarItems(
  items: readonly CellarItem[],
  question: string,
  placeLabels: readonly string[] = [],
): { asked: CellarFacts["asked"]; matches: CellarItem[] } {
  const year = /\b(1[89]\d\d|20\d\d)\b/.exec(question);
  const type = TYPE_WORDS.find(([pattern]) => pattern.test(question))?.[1] ?? null;
  const text = (i: CellarItem) =>
    ` ${normalizeText(`${i.producer} ${i.wineName} ${i.region ?? ""}`)} `;
  const places = ` ${placeLabels.map((l) => normalizeText(l)).join(" ")} `;
  const candidates = [
    ...new Set(
      normalizeText(question)
        .split(" ")
        .filter(
          (w) =>
            w.length >= 3 &&
            !QUESTION_WORDS.has(w) &&
            !/^\d+$/.test(w) &&
            typeOf(w) === null &&
            !places.includes(` ${w} `),
        ),
    ),
  ];
  const known = (w: string) => items.some((i) => text(i).includes(` ${w}`));
  const words = candidates.filter(known);
  const unknown = candidates.filter((w) => !known(w));
  if (candidates.length === 0 && !year && !type) return { asked: null, matches: [] };
  const asked = { words, unknown, year: year ? Number(year[1]) : null, type };
  if (unknown.length > 0) return { asked, matches: [] };
  const matches = items.filter(
    (i) =>
      (!year || i.year === Number(year[1])) &&
      (!type || i.type === type) &&
      words.every((w) => text(i).includes(` ${w}`)),
  );
  return { asked, matches };
}

/** The cellar in numbers and places, counted from what the database says now. */
export function cellarFacts(
  items: readonly CellarItem[],
  storage: readonly StorageUnitView[],
  racks: RackView,
  question: string,
): CellarFacts {
  const byType = new Map<WineType, { bottles: number; wines: Set<string> }>();
  for (const i of items) {
    const t = byType.get(i.type) ?? { bottles: 0, wines: new Set<string>() };
    t.bottles += i.count;
    t.wines.add(i.wineId);
    byType.set(i.type, t);
  }
  const { asked, matches } = matchCellarItems(
    items,
    question,
    storage.map((u) => u.label),
  );
  const spotsOf = new Map<string, CellarMatch["spots"]>();
  const wanted = new Set(matches.map((m) => m.vintageId));
  for (const unit of racks.units)
    for (const b of unit.bottles)
      if (wanted.has(b.vintageId) && b.row !== null && b.col !== null)
        spotsOf.set(b.vintageId, [
          ...(spotsOf.get(b.vintageId) ?? []),
          { place: unit.label, row: b.row, col: b.col },
        ]);
  const unplacedOf = new Map<string, number>();
  for (const b of racks.unplaced)
    unplacedOf.set(b.vintageId, (unplacedOf.get(b.vintageId) ?? 0) + 1);
  return {
    bottles: items.reduce((s, i) => s + i.count, 0),
    wines: new Set(items.map((i) => i.wineId)).size,
    vintages: items.length,
    unplaced: racks.unplaced.length,
    byType: [...byType.entries()].map(([type, t]) => ({
      type,
      bottles: t.bottles,
      wines: t.wines.size,
    })),
    places: storage.map(({ label, kind, capacity, used, free }) => ({
      label,
      kind,
      capacity,
      used,
      free,
    })),
    free: storage.reduce((s, u) => s + u.free, 0),
    asked,
    kind: cellarQuestionKind(question),
    matches: matches.map((item) => ({
      item,
      spots: (spotsOf.get(item.vintageId) ?? []).sort(
        (a, b) => a.place.localeCompare(b.place) || a.row - b.row || a.col - b.col,
      ),
      unplaced: unplacedOf.get(item.vintageId) ?? 0,
    })),
  };
}

/** At most this many wines are listed with their spots; the rest are counted. */
export const FACTS_MAX_MATCHES = 12;

/** The facts as the model is shown them. `refOf` names a wine the way the cellar list does. */
export function cellarFactsText(facts: CellarFacts, refOf: (vintageId: string) => string | null) {
  const types = facts.byType
    .map((t) => `${t.type} ${t.bottles} bottles (${t.wines} wines)`)
    .join(", ");
  const places = facts.places
    .map(
      (p) =>
        `"${p.label.replace(/["\n]/g, " ")}" (${p.kind}): ${p.capacity} spots, ${p.used} taken, ${p.free} free`,
    )
    .join("; ");
  const lines = [
    "Cellar facts (counted from the database just now; these are the only numbers and places to state):",
    `- In the cellar: ${facts.bottles} bottles of ${facts.wines} different wines (${facts.vintages} wine-and-vintage combinations); ${facts.unplaced} bottles have no place yet.`,
    `- By kind: ${types || "none"}.`,
    `- Places: ${places || "none"}. Free spots in all: ${facts.free}.`,
  ];
  if (facts.asked) {
    const named = [
      ...facts.asked.words,
      ...facts.asked.unknown,
      facts.asked.year ? String(facts.asked.year) : null,
      facts.asked.type,
    ]
      .filter(Boolean)
      .join(" ");
    const bottles = facts.matches.reduce((s, m) => s + m.item.count, 0);
    lines.push(
      facts.matches.length === 0
        ? `- Wines matching "${named}": none in the cellar.`
        : `- Wines matching "${named}": ${facts.matches.length} (${bottles} bottles)${facts.matches.length > FACTS_MAX_MATCHES ? `, the first ${FACTS_MAX_MATCHES} listed` : ""}:`,
    );
    for (const m of facts.matches.slice(0, FACTS_MAX_MATCHES)) {
      const ref = refOf(m.item.vintageId);
      const where = [
        ...m.spots.map((s) => `${s.place} shelf ${s.row} position ${s.col}`),
        ...(m.unplaced > 0 ? [`${m.unplaced} without a place`] : []),
      ].join("; ");
      lines.push(
        `  - ${ref ?? "(not in the list)"} | ${m.item.producer} — ${m.item.wineName} | ${m.item.year ?? "NV"} | ${m.item.type} | ×${m.item.count} | ${where || "no place recorded"}`,
      );
    }
  }
  return lines.join("\n");
}
