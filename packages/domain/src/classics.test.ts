import { describe, expect, it } from "vitest";
import type { WineType } from "./cellar";
import { FOOD } from "./food/knowledge";
import { parseFood } from "./food/parse";
import { assessPairing } from "./pairing-engine/assess";
import { WINE_KNOWLEDGE } from "./pairing-engine/knowledge";
import { readWine } from "./pairing-engine/wine";

/**
 * THE TEXTBOOK, ON THE REAL KNOWLEDGE. The rule tests state dishes and wines by hand; these read the dish as a
 * person types it and the wine as a cellar records it, through the app's own knowledge, and hold the answer to
 * what any sommelier would say. A pairing every book calls a classic must be offered; one every book warns
 * against must never be. They exist because an independent review found classics the engine called poor while
 * the hand-made tests passed (a real Chablis is 0.2 heavier than the test's).
 */
type Bottle = [
  type: WineType,
  name: string,
  appellation: string | null,
  region: string | null,
  country: string,
];

const B: Record<string, Bottle> = {
  chablis: ["white", "Chablis", "Chablis", "Burgundy", "FR"],
  sancerre: ["white", "Sancerre", "Sancerre", "Loire", "FR"],
  muscadet: ["white", "Muscadet Sèvre et Maine sur lie", "Muscadet Sèvre et Maine", "Loire", "FR"],
  champagne: ["sparkling", "Champagne Brut", "Champagne", "Champagne", "FR"],
  meursault: ["white", "Meursault", "Meursault", "Burgundy", "FR"],
  kabinett: ["white", "Riesling Kabinett", "Mosel", "Mosel", "DE"],
  gewurz: ["white", "Gewurztraminer", "Alsace", "Alsace", "FR"],
  albarino: ["white", "Albariño", "Rías Baixas", "Galicia", "ES"],
  fino: ["fortified", "Fino", "Jerez", "Andalucía", "ES"],
  gevrey: ["red", "Gevrey-Chambertin", "Gevrey-Chambertin", "Burgundy", "FR"],
  willamette: ["red", "Pinot Noir", "Willamette Valley", "Oregon", "US"],
  morgon: ["red", "Morgon", "Morgon", "Beaujolais", "FR"],
  chianti: ["red", "Chianti Classico", "Chianti Classico", "Tuscany", "IT"],
  barolo: ["red", "Barolo", "Barolo", "Piedmont", "IT"],
  pauillac: ["red", "Pauillac", "Pauillac", "Bordeaux", "FR"],
  napa: ["red", "Cabernet Sauvignon", "Napa Valley", "California", "US"],
  malbec: ["red", "Malbec", "Mendoza", "Mendoza", "AR"],
  rioja: ["red", "Rioja Reserva", "Rioja", "Rioja", "ES"],
  crozes: ["red", "Crozes-Hermitage", "Crozes-Hermitage", "Rhône", "FR"],
  amarone: ["red", "Amarone della Valpolicella", "Amarone della Valpolicella", "Veneto", "IT"],
  sauternes: ["dessert", "Sauternes", "Sauternes", "Bordeaux", "FR"],
  tokaji: ["dessert", "Tokaji Aszú 5 Puttonyos", "Tokaji", "Tokaj", "HU"],
  moscato: ["sparkling", "Moscato d'Asti", "Moscato d'Asti", "Piedmont", "IT"],
  vintagePort: ["fortified", "Vintage Port", "Porto", "Douro", "PT"],
  tawny: ["fortified", "10 Year Old Tawny Port", "Porto", "Douro", "PT"],
};

function judge(dish: string, bottle: keyof typeof B) {
  const food = parseFood(dish, FOOD);
  expect(food.main, `"${dish}" was not read`).not.toBeNull();
  const [type, name, appellation, region, countryCode] = B[bottle]!;
  const reading = readWine({ type, name, appellation, region, countryCode }, WINE_KNOWLEDGE);
  return assessPairing(food, { ...reading, type });
}

/** Offered: the engine calls it good or acceptable. */
const CLASSICS: Array<[dish: string, bottle: keyof typeof B]> = [
  ["oysters", "chablis"],
  ["raw oysters", "chablis"],
  ["oysters", "muscadet"],
  ["oysters", "champagne"],
  ["oysters", "sancerre"],
  ["oesters", "muscadet"],
  ["moules marinières", "muscadet"],
  ["goat cheese salad", "sancerre"],
  ["geitenkaas", "sancerre"],
  ["sole meunière", "chablis"],
  ["sea bass with lemon butter", "chablis"],
  ["zeebaars met citroenboter", "sancerre"],
  ["lobster with butter", "meursault"],
  ["roast chicken", "meursault"],
  ["roast chicken", "gevrey"],
  ["roast duck", "gevrey"],
  ["duck breast", "gevrey"],
  ["grilled salmon", "willamette"],
  ["coq au vin", "gevrey"],
  ["boeuf bourguignon", "gevrey"],
  ["charcuterie", "morgon"],
  ["pizza margherita", "chianti"],
  ["spaghetti bolognese", "chianti"],
  ["truffle risotto", "barolo"],
  ["grilled ribeye steak", "napa"],
  ["grilled ribeye steak", "malbec"],
  ["gegrilde entrecote", "pauillac"],
  ["roast lamb", "pauillac"],
  ["lamsbout", "rioja"],
  ["rack of lamb", "rioja"],
  ["thai green curry", "kabinett"],
  ["thaise groene curry", "gewurz"],
  ["munster", "gewurz"],
  ["jamón ibérico", "fino"],
  ["foie gras", "sauternes"],
  ["foie gras terrine", "sauternes"],
  ["foie gras terrine", "tokaji"],
  ["roquefort", "sauternes"],
  ["stilton", "vintagePort"],
  ["blue cheese", "tawny"],
  ["chocolate fondant", "vintagePort"],
  ["tarte tatin", "sauternes"],
  ["fruit tart", "moscato"],
  ["fried chicken", "champagne"],
  ["fish and chips", "champagne"],
  ["seafood paella", "albarino"],
];

/** Never offered: the engine calls it poor (a clash), not merely neutral. */
const CLASHES: Array<[dish: string, bottle: keyof typeof B]> = [
  ["oysters", "pauillac"],
  ["oysters", "vintagePort"],
  ["sole meunière", "amarone"],
  ["sushi", "napa"],
  ["sea bass with lemon butter", "barolo"],
  ["thai green curry", "barolo"],
  ["vindaloo", "napa"],
  ["chocolate fondant", "barolo"],
  ["chocolate fondant", "chablis"],
  ["lemon tart", "champagne"],
  ["crème brûlée", "pauillac"],
  ["grilled ribeye steak", "moscato"],
  ["grilled ribeye steak", "sauternes"],
  ["roast chicken", "vintagePort"],
  ["ceviche", "amarone"],
];

describe("the textbook, on the real knowledge", () => {
  it.each(CLASSICS)("%s + %s is offered", (dish, bottle) => {
    const a = judge(dish, bottle);
    expect(["good", "acceptable"], `${a.level} ${a.score} +${a.pros} -${a.cons}`).toContain(
      a.level,
    );
  });
  it.each(CLASHES)("%s + %s is never offered", (dish, bottle) => {
    const a = judge(dish, bottle);
    expect(a.level, `${a.score} +${a.pros} -${a.cons}`).toBe("poor");
  });
});
