import type { WineType } from "../../cellar";
import type { WineStructure, WineStyleRule } from "../wine";

/**
 * APPELLATIONS and other legally defined label words: the strongest rules. An appellation overrides its region
 * and grape on every axis it states, so a rule states what the appellation really decides and leaves out what
 * depends on the grape when the appellation allows several (Alsace, Alto Adige). Label words that decide
 * sweetness or ageing (Kabinett, Smaragd, Fino, Tawny, Gran Reserva, Blanc de Blancs) are rules of this kind too:
 * when they are in the wine's name they apply on top of its recorded appellation.
 *
 * Where a name covers very different styles, the rule describes the style most often bought, and says so.
 * Judgements on a coarse scale, not measurements.
 */

const rules: WineStyleRule[] = [];

type Types = WineType | readonly WineType[];
type S = Partial<WineStructure>;

/** Rules of one country. A place that makes several colours gets one call per colour. */
const at =
  (country: string | undefined) =>
  (id: string, type: Types, names: readonly string[], s: S, keys: readonly string[]) => {
    for (const t of typeof type === "string" ? [type] : type)
      rules.push({ id, kind: "appellation", names, type: t, ...(country ? { country } : {}), s, keys });
  };

const fr = at("FR");
const it = at("IT");
const es = at("ES");
const pt = at("PT");
const de = at("DE");
const at_ = at("AT");
const hu = at("HU");
const us = at("US");
const ar = at("AR");
const cl = at("CL");
const au = at("AU");
const nz = at("NZ");
const za = at("ZA");
const gr = at("GR");
const lb = at("LB");
const ch = at("CH");
const ca = at("CA");
/** Label words used in several countries. */
const any = at(undefined);

// =============================================================================================== FRANCE

// ---- Chablis and the Mâconnais ----
// Chablis is chardonnay grown cool and mostly kept out of new oak: lean, mineral, high acid.
fr("chablis", "white", ["chablis"], { body: 2.2, acidity: 4.5, intensity: 2.8, oak: 0.3, alcohol: 2.1 }, [
  "chardonnay",
  "burgundy",
  "crisp white",
]);
fr("petit chablis", "white", ["petit chablis"], { body: 1.8, acidity: 4.6, intensity: 2.3, oak: 0, alcohol: 1.8 }, [
  "chardonnay",
  "burgundy",
  "crisp white",
]);
fr(
  "chablis premier cru",
  "white",
  ["chablis premier cru", "chablis 1er cru", "chablis 1er"],
  { body: 2.7, acidity: 4.5, intensity: 3.3, oak: 0.5, alcohol: 2.2 },
  ["chardonnay", "burgundy", "chablis", "crisp white"],
);
fr(
  "chablis grand cru",
  "white",
  ["chablis grand cru", "les clos", "vaudesir", "valmur", "les preuses", "grenouilles", "bougros", "blanchot"],
  { body: 3.2, acidity: 4.4, intensity: 3.8, oak: 0.9, alcohol: 2.3 },
  ["chardonnay", "burgundy", "chablis", "crisp white"],
);
fr(
  "macon",
  "white",
  ["macon", "macon villages", "macon blanc"],
  { body: 2.6, acidity: 3.6, intensity: 2.6, oak: 0.3, alcohol: 2.2 },
  ["chardonnay", "burgundy", "crisp white"],
);
fr(
  "saint veran",
  "white",
  ["saint veran", "st veran", "vire clesse"],
  { body: 2.9, acidity: 3.7, intensity: 2.9, oak: 0.6, alcohol: 2.3 },
  ["chardonnay", "burgundy"],
);
fr(
  "pouilly fuisse",
  "white",
  ["pouilly fuisse", "pouilly loche", "pouilly vinzelles"],
  { body: 3.4, acidity: 3.6, intensity: 3.3, oak: 1.3, alcohol: 2.4 },
  ["chardonnay", "burgundy", "rich white"],
);

// ---- Bourgogne and the Côte Chalonnaise ----
fr(
  "bourgogne",
  "white",
  ["bourgogne", "bourgogne blanc", "bourgogne chardonnay", "bourgogne cote d or", "coteaux bourguignons"],
  { body: 2.7, acidity: 3.9, intensity: 2.7, oak: 0.7, alcohol: 2.2 },
  ["chardonnay", "burgundy"],
);
fr(
  "bourgogne",
  "red",
  [
    "bourgogne",
    "bourgogne rouge",
    "bourgogne pinot noir",
    "bourgogne cote d or",
    "coteaux bourguignons",
    "bourgogne passetoutgrain",
    "bourgogne passetoutgrains",
  ],
  { body: 2.6, tannin: 2.2, acidity: 3.9, intensity: 2.9, oak: 0.6, alcohol: 2.1 },
  ["pinot noir", "burgundy", "light red"],
);
fr(
  "bourgogne aligote",
  "white",
  ["bourgogne aligote", "bouzeron"],
  { body: 1.8, acidity: 4.6, intensity: 2, oak: 0, alcohol: 1.9 },
  ["aligote", "burgundy", "crisp white"],
);
fr(
  "hautes cotes",
  "red",
  [
    "hautes cotes de nuits",
    "hautes cotes de beaune",
    "bourgogne hautes cotes de nuits",
    "bourgogne hautes cotes de beaune",
  ],
  { body: 2.6, tannin: 2.4, acidity: 4, intensity: 3, oak: 0.6, alcohol: 2.1 },
  ["pinot noir", "burgundy", "light red"],
);
fr(
  "mercurey",
  "red",
  ["mercurey", "rully", "cote chalonnaise", "bourgogne cote chalonnaise"],
  { body: 2.9, tannin: 2.7, acidity: 3.8, intensity: 3.2, oak: 0.9, alcohol: 2.2 },
  ["pinot noir", "burgundy", "medium red"],
);
fr(
  "mercurey",
  "white",
  ["mercurey", "rully", "montagny", "cote chalonnaise"],
  { body: 2.7, acidity: 3.9, intensity: 2.8, oak: 0.7, alcohol: 2.2 },
  ["chardonnay", "burgundy"],
);
fr("givry", "red", ["givry"], { body: 2.8, tannin: 2.5, acidity: 3.9, intensity: 3.1, oak: 0.8, alcohol: 2.2 }, [
  "pinot noir",
  "burgundy",
  "light red",
]);

// ---- Côte de Beaune ----
fr(
  "meursault",
  "white",
  ["meursault"],
  { body: 3.8, acidity: 3.4, intensity: 3.8, oak: 1.8, alcohol: 2.4 },
  ["chardonnay", "burgundy", "rich white", "oaked white"],
);
fr(
  "puligny montrachet",
  "white",
  ["puligny montrachet"],
  { body: 3.4, acidity: 3.9, intensity: 3.8, oak: 1.6, alcohol: 2.3 },
  ["chardonnay", "burgundy", "oaked white"],
);
fr(
  "chassagne montrachet",
  "white",
  ["chassagne montrachet"],
  { body: 3.6, acidity: 3.7, intensity: 3.8, oak: 1.6, alcohol: 2.4 },
  ["chardonnay", "burgundy", "rich white", "oaked white"],
);
fr(
  "chassagne montrachet",
  "red",
  ["chassagne montrachet"],
  { body: 3.2, tannin: 3, acidity: 3.8, intensity: 3.4, oak: 1.1, alcohol: 2.3 },
  ["pinot noir", "burgundy", "medium red"],
);
fr(
  "montrachet grand cru",
  "white",
  [
    "montrachet",
    "le montrachet",
    "batard montrachet",
    "chevalier montrachet",
    "bienvenues batard montrachet",
    "criots batard montrachet",
    "corton charlemagne",
    "charlemagne",
  ],
  { body: 4.2, acidity: 3.9, intensity: 4.6, oak: 2, alcohol: 2.5 },
  ["chardonnay", "burgundy", "rich white", "oaked white"],
);
fr(
  "cote de beaune white villages",
  "white",
  ["saint aubin", "st aubin", "saint romain", "auxey duresses", "pernand vergelesses", "ladoix", "monthelie"],
  { body: 2.9, acidity: 4, intensity: 3, oak: 1, alcohol: 2.2 },
  ["chardonnay", "burgundy"],
);
fr(
  "beaune",
  "red",
  ["beaune", "cote de beaune", "cote de beaune villages"],
  { body: 3, tannin: 2.7, acidity: 3.9, intensity: 3.5, oak: 1.2, alcohol: 2.3 },
  ["pinot noir", "burgundy", "medium red"],
);
fr(
  "cote de beaune red villages",
  "red",
  [
    "savigny les beaune",
    "chorey les beaune",
    "ladoix",
    "pernand vergelesses",
    "monthelie",
    "auxey duresses",
    "santenay",
    "maranges",
    "saint romain",
  ],
  { body: 2.8, tannin: 2.6, acidity: 3.9, intensity: 3.2, oak: 0.9, alcohol: 2.2 },
  ["pinot noir", "burgundy", "light red"],
);
fr("pommard", "red", ["pommard"], { body: 3.6, tannin: 3.5, acidity: 3.8, intensity: 3.8, oak: 1.4, alcohol: 2.4 }, [
  "pinot noir",
  "burgundy",
  "medium red",
]);
fr("volnay", "red", ["volnay"], { body: 2.9, tannin: 2.4, acidity: 4, intensity: 3.7, oak: 1.2, alcohol: 2.3 }, [
  "pinot noir",
  "burgundy",
  "light red",
]);
fr(
  "corton",
  "red",
  ["corton", "aloxe corton"],
  { body: 3.6, tannin: 3.4, acidity: 3.9, intensity: 4, oak: 1.5, alcohol: 2.4 },
  ["pinot noir", "burgundy", "medium red"],
);

// ---- Côte de Nuits ----
fr(
  "gevrey chambertin",
  "red",
  ["gevrey chambertin"],
  { body: 3.5, tannin: 3.2, acidity: 3.9, intensity: 4, oak: 1.4, alcohol: 2.4 },
  ["pinot noir", "burgundy", "medium red"],
);
fr(
  "morey saint denis",
  "red",
  ["morey saint denis", "morey st denis"],
  { body: 3.4, tannin: 3.1, acidity: 3.9, intensity: 3.9, oak: 1.3, alcohol: 2.4 },
  ["pinot noir", "burgundy", "medium red"],
);
fr(
  "chambolle musigny",
  "red",
  ["chambolle musigny"],
  { body: 3, tannin: 2.6, acidity: 4, intensity: 3.9, oak: 1.3, alcohol: 2.3 },
  ["pinot noir", "burgundy", "light red"],
);
fr(
  "vosne romanee",
  "red",
  ["vosne romanee", "flagey echezeaux"],
  { body: 3.4, tannin: 3, acidity: 3.9, intensity: 4.2, oak: 1.6, alcohol: 2.4 },
  ["pinot noir", "burgundy", "medium red"],
);
fr(
  "nuits saint georges",
  "red",
  ["nuits saint georges", "nuits st georges"],
  { body: 3.6, tannin: 3.4, acidity: 3.9, intensity: 3.9, oak: 1.4, alcohol: 2.4 },
  ["pinot noir", "burgundy", "medium red"],
);
fr(
  "cote de nuits villages",
  "red",
  ["cote de nuits villages", "marsannay", "fixin"],
  { body: 2.9, tannin: 2.7, acidity: 3.9, intensity: 3.2, oak: 0.9, alcohol: 2.2 },
  ["pinot noir", "burgundy", "light red"],
);
fr(
  "cote de nuits grand cru",
  "red",
  [
    "chambertin",
    "chambertin clos de beze",
    "charmes chambertin",
    "mazis chambertin",
    "latricieres chambertin",
    "griotte chambertin",
    "chapelle chambertin",
    "ruchottes chambertin",
    "mazoyeres chambertin",
    "clos de la roche",
    "clos saint denis",
    "clos de tart",
    "clos des lambrays",
    "bonnes mares",
    "musigny",
    "clos de vougeot",
    "clos vougeot",
    "echezeaux",
    "grands echezeaux",
    "richebourg",
    "romanee saint vivant",
    "la tache",
    "romanee conti",
    "la grande rue",
  ],
  { body: 3.9, tannin: 3.4, acidity: 4, intensity: 4.6, oak: 1.8, alcohol: 2.4 },
  ["pinot noir", "burgundy", "medium red"],
);

// ---- Beaujolais ----
fr(
  "beaujolais",
  "red",
  ["beaujolais", "beaujolais superieur"],
  { body: 2.1, tannin: 1.4, acidity: 3.8, intensity: 2.9, oak: 0, alcohol: 1.9 },
  ["gamay", "beaujolais", "light red"],
);
fr(
  "beaujolais nouveau",
  "red",
  ["beaujolais nouveau", "beaujolais primeur"],
  { body: 1.7, tannin: 1, acidity: 3.8, intensity: 2.8, oak: 0, alcohol: 1.8 },
  ["gamay", "beaujolais", "light red"],
);
fr(
  "beaujolais villages",
  "red",
  ["beaujolais villages"],
  { body: 2.4, tannin: 1.6, acidity: 3.7, intensity: 3.1, oak: 0, alcohol: 2 },
  ["gamay", "beaujolais", "light red"],
);
const CRU = (body: number, tannin: number, intensity: number, oak = 0.2): S => ({
  body,
  tannin,
  acidity: 3.7,
  intensity,
  oak,
  alcohol: 2.1,
});
fr("morgon", "red", ["morgon"], CRU(3, 2.2, 3.5, 0.3), ["gamay", "beaujolais", "light red"]);
fr("moulin a vent", "red", ["moulin a vent"], CRU(3.2, 2.5, 3.6, 0.6), ["gamay", "beaujolais", "medium red"]);
fr("fleurie", "red", ["fleurie"], CRU(2.4, 1.6, 3.4), ["gamay", "beaujolais", "light red"]);
fr("brouilly", "red", ["brouilly"], CRU(2.4, 1.6, 3.2), ["gamay", "beaujolais", "light red"]);
fr("cote de brouilly", "red", ["cote de brouilly"], CRU(2.7, 1.9, 3.4), ["gamay", "beaujolais", "light red"]);
fr("chiroubles", "red", ["chiroubles"], CRU(2.1, 1.3, 3.2), ["gamay", "beaujolais", "light red"]);
fr("saint amour", "red", ["saint amour", "st amour"], CRU(2.4, 1.6, 3.3), ["gamay", "beaujolais", "light red"]);
fr("julienas", "red", ["julienas"], CRU(2.7, 2, 3.4), ["gamay", "beaujolais", "light red"]);
fr("chenas", "red", ["chenas"], CRU(3, 2.3, 3.4, 0.4), ["gamay", "beaujolais", "medium red"]);
fr("regnie", "red", ["regnie"], CRU(2.4, 1.6, 3.2), ["gamay", "beaujolais", "light red"]);

// ---- Loire ----
fr(
  "muscadet",
  "white",
  ["muscadet", "muscadet sur lie", "muscadet coteaux de la loire", "muscadet cotes de grandlieu"],
  { body: 1.3, acidity: 4.7, sweetness: 0.2, intensity: 1.8, oak: 0, alcohol: 1.6 },
  ["melon de bourgogne", "loire", "crisp white"],
);
fr(
  "muscadet sevre et maine",
  "white",
  ["muscadet sevre et maine", "muscadet sevre maine", "sevre et maine"],
  { body: 1.5, acidity: 4.7, sweetness: 0.2, intensity: 2.1, oak: 0, alcohol: 1.7 },
  ["melon de bourgogne", "loire", "muscadet", "crisp white"],
);
fr(
  "sancerre",
  "white",
  ["sancerre"],
  { body: 2.3, acidity: 4.4, intensity: 3.6, oak: 0.2, alcohol: 2.2 },
  ["sauvignon blanc", "loire", "crisp white"],
);
fr(
  "sancerre",
  "red",
  ["sancerre"],
  { body: 2.3, tannin: 1.8, acidity: 4, intensity: 3, oak: 0.6, alcohol: 2.1 },
  ["pinot noir", "loire", "light red"],
);
fr(
  "sancerre",
  "rose",
  ["sancerre"],
  { body: 1.8, tannin: 0.3, acidity: 4.1, sweetness: 0.3, intensity: 2.4, oak: 0, alcohol: 2 },
  ["pinot noir", "loire", "dry rose"],
);
fr(
  "pouilly fume",
  "white",
  ["pouilly fume", "blanc fume de pouilly"],
  { body: 2.5, acidity: 4.3, intensity: 3.7, oak: 0.2, alcohol: 2.2 },
  ["sauvignon blanc", "loire", "crisp white"],
);
fr(
  "central loire sauvignon",
  "white",
  ["menetou salon", "quincy", "reuilly", "coteaux du giennois"],
  { body: 2.2, acidity: 4.3, intensity: 3.4, oak: 0.1, alcohol: 2.1 },
  ["sauvignon blanc", "loire", "crisp white"],
);
fr(
  "touraine",
  "white",
  ["touraine", "touraine sauvignon", "touraine chenonceaux", "cheverny"],
  { body: 2.1, acidity: 4.2, intensity: 3.5, oak: 0, alcohol: 2 },
  ["sauvignon blanc", "loire", "crisp white"],
);
// Vouvray runs from bone dry to luscious; with no word on the label, a middle: dry to off-dry.
fr(
  "vouvray",
  "white",
  ["vouvray", "montlouis", "montlouis sur loire"],
  { body: 2.8, acidity: 4.4, sweetness: 1.3, intensity: 3.5, oak: 0.3, alcohol: 2.1 },
  ["chenin blanc", "loire", "off-dry white"],
);
fr(
  "vouvray sec",
  "white",
  ["vouvray sec", "montlouis sec"],
  { body: 2.7, acidity: 4.5, sweetness: 0.5, intensity: 3.4, oak: 0.3, alcohol: 2.2 },
  ["chenin blanc", "loire", "vouvray", "crisp white"],
);
fr(
  "vouvray demi sec",
  "white",
  ["vouvray demi sec", "vouvray tendre", "montlouis demi sec"],
  { body: 3, acidity: 4.4, sweetness: 2.5, intensity: 3.6, oak: 0.2, alcohol: 2 },
  ["chenin blanc", "loire", "vouvray", "off-dry white"],
);
fr(
  "vouvray moelleux",
  ["white", "dessert"],
  ["vouvray moelleux", "montlouis moelleux"],
  { body: 3.8, acidity: 4.5, sweetness: 4, intensity: 4.2, oak: 0.2, alcohol: 2 },
  ["chenin blanc", "loire", "vouvray", "sweet white"],
);
fr(
  "vouvray",
  "sparkling",
  ["vouvray", "vouvray brut", "vouvray petillant", "montlouis"],
  { body: 2.2, acidity: 4.5, sweetness: 0.8, intensity: 3, alcohol: 2, fizz: true },
  ["chenin blanc", "loire", "traditional method sparkling"],
);
fr(
  "savennieres",
  "white",
  ["savennieres", "savennieres roche aux moines", "coulee de serrant"],
  { body: 3.3, acidity: 4.6, sweetness: 0.3, intensity: 3.8, oak: 0.4, alcohol: 2.4 },
  ["chenin blanc", "loire", "rich white"],
);
fr(
  "anjou",
  "white",
  ["anjou", "anjou blanc", "saumur", "saumur blanc"],
  { body: 2.7, acidity: 4.3, sweetness: 0.6, intensity: 3.2, oak: 0.4, alcohol: 2.2 },
  ["chenin blanc", "loire", "crisp white"],
);
fr(
  "anjou",
  "red",
  ["anjou", "anjou rouge", "anjou villages", "saumur", "saumur rouge"],
  { body: 2.7, tannin: 2.5, acidity: 3.9, intensity: 3.2, oak: 0.4, alcohol: 2.1 },
  ["cabernet franc", "loire", "light red"],
);
fr(
  "rose d anjou",
  "rose",
  ["rose d anjou", "anjou", "cabernet d anjou", "rose de loire"],
  { body: 1.8, tannin: 0.3, acidity: 3.5, sweetness: 2, intensity: 2.4, oak: 0, alcohol: 1.6 },
  ["cabernet franc", "loire"],
);
fr(
  "saumur champigny",
  "red",
  ["saumur champigny"],
  { body: 2.8, tannin: 2.6, acidity: 4, intensity: 3.4, oak: 0.4, alcohol: 2.2 },
  ["cabernet franc", "loire", "light red"],
);
fr(
  "chinon",
  "red",
  ["chinon"],
  { body: 2.9, tannin: 2.8, acidity: 4, intensity: 3.4, oak: 0.5, alcohol: 2.2 },
  ["cabernet franc", "loire", "medium red"],
);
fr(
  "bourgueil",
  "red",
  ["bourgueil", "saint nicolas de bourgueil", "st nicolas de bourgueil"],
  { body: 3, tannin: 3, acidity: 4, intensity: 3.4, oak: 0.4, alcohol: 2.2 },
  ["cabernet franc", "loire", "medium red"],
);
fr(
  "coteaux du layon",
  ["white", "dessert"],
  ["coteaux du layon", "quarts de chaume", "bonnezeaux", "coteaux de l aubance"],
  { body: 3.9, acidity: 4.4, sweetness: 4.3, intensity: 4.3, oak: 0.2, alcohol: 2 },
  ["chenin blanc", "loire", "sweet white"],
);
fr(
  "cremant de loire",
  "sparkling",
  ["cremant de loire", "saumur brut", "saumur mousseux"],
  { body: 2.1, acidity: 4.5, sweetness: 0.8, intensity: 2.8, oak: 0, alcohol: 2, fizz: true },
  ["chenin blanc", "loire", "traditional method sparkling"],
);

// ---- Alsace ----
// Alsace allows many grapes, so these rules leave aroma, acidity and sweetness to the grape and the region.
fr("alsace", "white", ["alsace", "vin d alsace"], { oak: 0.1, alcohol: 2.4 }, ["alsace", "aromatic white"]);
fr("alsace grand cru", "white", ["alsace grand cru"], { oak: 0.1, alcohol: 2.6 }, ["alsace", "aromatic white"]);
fr(
  "vendanges tardives",
  ["white", "dessert"],
  ["vendanges tardives", "vendange tardive"],
  { body: 4, acidity: 3.5, sweetness: 3.5, intensity: 4.8, oak: 0, alcohol: 2.5 },
  ["alsace", "gewurztraminer", "sweet white"],
);
fr(
  "selection de grains nobles",
  ["white", "dessert"],
  ["selection de grains nobles", "sgn"],
  { body: 4.5, acidity: 3.8, sweetness: 4.8, intensity: 5, oak: 0, alcohol: 2.2 },
  ["alsace", "gewurztraminer", "sweet white"],
);
fr(
  "cremant d alsace",
  "sparkling",
  ["cremant d alsace"],
  { body: 2, acidity: 4.3, sweetness: 0.7, intensity: 2.7, oak: 0, alcohol: 2, fizz: true },
  ["pinot blanc", "alsace", "traditional method sparkling"],
);

// ---- Champagne and other French sparkling ----
fr(
  "champagne",
  "sparkling",
  ["champagne"],
  { body: 2.6, acidity: 4.6, sweetness: 0.8, intensity: 3.2, oak: 0.2, alcohol: 2, fizz: true },
  ["chardonnay", "pinot noir", "champagne", "traditional method sparkling"],
);
fr(
  "cremant de bourgogne",
  "sparkling",
  ["cremant de bourgogne"],
  { body: 2.1, acidity: 4.4, sweetness: 0.7, intensity: 2.6, oak: 0, alcohol: 2, fizz: true },
  ["chardonnay", "pinot noir", "burgundy", "traditional method sparkling"],
);
fr(
  "cremant",
  "sparkling",
  ["cremant", "cremant de limoux", "blanquette de limoux", "cremant du jura", "cremant de bordeaux"],
  { body: 2.1, acidity: 4.3, sweetness: 0.8, intensity: 2.6, oak: 0, alcohol: 2, fizz: true },
  ["chardonnay", "traditional method sparkling"],
);

// ---- Bordeaux ----
fr(
  "bordeaux",
  "red",
  ["bordeaux", "bordeaux rouge"],
  { body: 3.4, tannin: 3.3, acidity: 3.5, intensity: 3, oak: 0.8, alcohol: 2.4 },
  ["merlot", "cabernet sauvignon", "bordeaux", "medium red"],
);
fr(
  "bordeaux superieur",
  "red",
  ["bordeaux superieur"],
  { body: 3.6, tannin: 3.5, acidity: 3.5, intensity: 3.3, oak: 1.2, alcohol: 2.5 },
  ["merlot", "cabernet sauvignon", "bordeaux", "medium red"],
);
fr(
  "bordeaux",
  "white",
  ["bordeaux", "bordeaux blanc", "bordeaux sauvignon"],
  { body: 2.3, acidity: 4, intensity: 3.3, oak: 0.3, alcohol: 2.1 },
  ["sauvignon blanc", "semillon", "bordeaux", "crisp white"],
);
fr(
  "bordeaux",
  "rose",
  ["bordeaux", "bordeaux rose", "bordeaux clairet", "clairet"],
  { body: 2.3, tannin: 0.8, acidity: 3.5, intensity: 2.6, oak: 0, alcohol: 2.1 },
  ["merlot", "bordeaux", "dry rose"],
);
fr(
  "entre deux mers",
  "white",
  ["entre deux mers"],
  { body: 2, acidity: 4.1, intensity: 3, oak: 0, alcohol: 2 },
  ["sauvignon blanc", "semillon", "bordeaux", "crisp white"],
);
fr(
  "graves",
  "red",
  ["graves"],
  { body: 3.6, tannin: 3.5, acidity: 3.6, intensity: 3.5, oak: 1.5, alcohol: 2.4 },
  ["cabernet sauvignon", "merlot", "bordeaux", "medium red"],
);
fr(
  "graves",
  "white",
  ["graves"],
  { body: 3, acidity: 3.7, intensity: 3.3, oak: 1.2, alcohol: 2.3 },
  ["sauvignon blanc", "semillon", "bordeaux", "oaked white"],
);
fr(
  "pessac leognan",
  "red",
  ["pessac leognan"],
  { body: 3.9, tannin: 3.9, acidity: 3.7, intensity: 4, oak: 2, alcohol: 2.5 },
  ["cabernet sauvignon", "merlot", "bordeaux", "full red"],
);
fr(
  "pessac leognan",
  "white",
  ["pessac leognan"],
  { body: 3.4, acidity: 3.8, intensity: 3.8, oak: 2, alcohol: 2.4 },
  ["sauvignon blanc", "semillon", "bordeaux", "oaked white", "rich white"],
);
fr(
  "medoc",
  "red",
  ["medoc"],
  { body: 3.6, tannin: 3.8, acidity: 3.6, intensity: 3.3, oak: 1.5, alcohol: 2.4 },
  ["cabernet sauvignon", "merlot", "bordeaux", "full red"],
);
fr(
  "haut medoc",
  "red",
  ["haut medoc"],
  { body: 3.8, tannin: 4, acidity: 3.6, intensity: 3.6, oak: 1.8, alcohol: 2.5 },
  ["cabernet sauvignon", "merlot", "bordeaux", "full red", "tannic red"],
);
fr(
  "listrac moulis",
  "red",
  ["listrac medoc", "listrac", "moulis", "moulis en medoc"],
  { body: 3.8, tannin: 4.1, acidity: 3.6, intensity: 3.5, oak: 1.6, alcohol: 2.5 },
  ["cabernet sauvignon", "merlot", "bordeaux", "full red", "tannic red"],
);
fr(
  "pauillac",
  "red",
  ["pauillac"],
  { body: 4.4, tannin: 4.6, acidity: 3.8, intensity: 4.3, oak: 2.3, alcohol: 2.6 },
  ["cabernet sauvignon", "bordeaux", "full red", "tannic red"],
);
fr(
  "saint julien",
  "red",
  ["saint julien", "st julien"],
  { body: 4.1, tannin: 4.3, acidity: 3.7, intensity: 4, oak: 2.2, alcohol: 2.6 },
  ["cabernet sauvignon", "bordeaux", "full red", "tannic red"],
);
fr(
  "margaux",
  "red",
  ["margaux"],
  { body: 3.8, tannin: 4, acidity: 3.7, intensity: 4, oak: 2.1, alcohol: 2.5 },
  ["cabernet sauvignon", "bordeaux", "full red"],
);
fr(
  "saint estephe",
  "red",
  ["saint estephe", "st estephe"],
  { body: 4.2, tannin: 4.5, acidity: 3.8, intensity: 3.8, oak: 2, alcohol: 2.6 },
  ["cabernet sauvignon", "merlot", "bordeaux", "full red", "tannic red"],
);
fr(
  "saint emilion",
  "red",
  ["saint emilion", "st emilion", "saint emilion grand cru", "st emilion grand cru"],
  { body: 4, tannin: 3.6, acidity: 3.4, intensity: 3.8, oak: 2, alcohol: 2.7 },
  ["merlot", "cabernet franc", "bordeaux", "full red"],
);
fr(
  "saint emilion satellites",
  "red",
  [
    "lussac saint emilion",
    "montagne saint emilion",
    "puisseguin saint emilion",
    "saint georges saint emilion",
    "lussac st emilion",
    "montagne st emilion",
    "puisseguin st emilion",
  ],
  { body: 3.7, tannin: 3.4, acidity: 3.4, intensity: 3.4, oak: 1.4, alcohol: 2.6 },
  ["merlot", "bordeaux", "medium red"],
);
fr(
  "pomerol",
  "red",
  ["pomerol"],
  { body: 4.3, tannin: 3.6, acidity: 3.4, intensity: 4.2, oak: 2.2, alcohol: 2.7 },
  ["merlot", "bordeaux", "full red"],
);
fr(
  "lalande de pomerol",
  "red",
  ["lalande de pomerol"],
  { body: 3.9, tannin: 3.4, acidity: 3.4, intensity: 3.7, oak: 1.6, alcohol: 2.6 },
  ["merlot", "bordeaux", "full red"],
);
fr(
  "fronsac",
  "red",
  ["fronsac", "canon fronsac"],
  { body: 3.8, tannin: 3.8, acidity: 3.4, intensity: 3.5, oak: 1.3, alcohol: 2.6 },
  ["merlot", "bordeaux", "full red"],
);
fr(
  "cotes de bordeaux",
  "red",
  [
    "cotes de bordeaux",
    "cotes de bourg",
    "blaye",
    "blaye cotes de bordeaux",
    "castillon cotes de bordeaux",
    "cotes de castillon",
    "francs cotes de bordeaux",
    "cadillac cotes de bordeaux",
    "premieres cotes de blaye",
  ],
  { body: 3.6, tannin: 3.4, acidity: 3.4, intensity: 3.3, oak: 1, alcohol: 2.5 },
  ["merlot", "bordeaux", "medium red"],
);
fr(
  "sauternes",
  ["dessert", "white"],
  ["sauternes"],
  { body: 4.6, acidity: 3.7, sweetness: 4.8, intensity: 4.6, oak: 1.5, alcohol: 2.6 },
  ["semillon", "sauvignon blanc", "bordeaux", "sweet white"],
);
fr(
  "barsac",
  ["dessert", "white"],
  ["barsac"],
  { body: 4.3, acidity: 3.9, sweetness: 4.6, intensity: 4.4, oak: 1.4, alcohol: 2.6 },
  ["semillon", "bordeaux", "sweet white"],
);
fr(
  "bordeaux sweet",
  ["dessert", "white"],
  ["loupiac", "cadillac", "sainte croix du mont", "cerons"],
  { body: 3.9, acidity: 3.6, sweetness: 4, intensity: 3.8, oak: 0.8, alcohol: 2.4 },
  ["semillon", "bordeaux", "sweet white"],
);

// ---- South West ----
fr(
  "monbazillac",
  ["dessert", "white"],
  ["monbazillac", "saussignac"],
  { body: 4, acidity: 3.5, sweetness: 4.3, intensity: 4, oak: 0.6, alcohol: 2.4 },
  ["semillon", "south west france", "sweet white"],
);
fr(
  "bergerac",
  "red",
  ["bergerac", "cotes de bergerac", "pecharmant"],
  { body: 3.4, tannin: 3.3, acidity: 3.4, intensity: 3.2, oak: 0.9, alcohol: 2.4 },
  ["merlot", "south west france", "medium red"],
);
fr(
  "cahors",
  "red",
  ["cahors"],
  { body: 4.2, tannin: 4.3, acidity: 3.6, intensity: 3.8, oak: 1.2, alcohol: 2.6 },
  ["malbec", "south west france", "tannic red"],
);
fr(
  "madiran",
  "red",
  ["madiran"],
  { body: 4.6, tannin: 4.9, acidity: 3.8, intensity: 4, oak: 1.5, alcohol: 2.8 },
  ["tannat", "south west france", "tannic red"],
);
// Plain Jurançon is legally the sweet (moelleux) wine; the dry one says "sec".
fr(
  "jurancon",
  ["white", "dessert"],
  ["jurancon", "jurancon moelleux", "pacherenc du vic bilh"],
  { body: 3.8, acidity: 4.4, sweetness: 3.8, intensity: 4.4, oak: 0.5, alcohol: 2.3 },
  ["south west france", "sweet white"],
);
fr(
  "jurancon sec",
  "white",
  ["jurancon sec"],
  { body: 2.8, acidity: 4.5, sweetness: 0.3, intensity: 3.8, oak: 0.3, alcohol: 2.3 },
  ["south west france", "crisp white"],
);
fr(
  "cotes de gascogne",
  "white",
  ["cotes de gascogne", "gascogne"],
  { body: 2, acidity: 4, sweetness: 0.8, intensity: 3.3, oak: 0, alcohol: 1.8 },
  ["sauvignon blanc", "south west france", "crisp white"],
);

// ---- Rhône ----
fr(
  "cotes du rhone",
  "red",
  ["cotes du rhone"],
  { body: 3.5, tannin: 2.8, acidity: 3, intensity: 3.3, oak: 0.4, alcohol: 2.7 },
  ["grenache", "syrah", "rhone", "medium red"],
);
fr(
  "cotes du rhone",
  "white",
  ["cotes du rhone"],
  { body: 3.2, acidity: 3, intensity: 3, oak: 0.2, alcohol: 2.5 },
  ["grenache blanc", "viognier", "rhone", "rich white"],
);
fr(
  "cotes du rhone",
  "rose",
  ["cotes du rhone"],
  { body: 2.4, tannin: 0.7, acidity: 3.4, intensity: 2.6, oak: 0, alcohol: 2.4 },
  ["grenache", "rhone", "dry rose"],
);
fr(
  "cotes du rhone villages",
  "red",
  ["cotes du rhone villages", "plan de dieu", "sablet", "seguret", "visan", "signargues"],
  { body: 3.8, tannin: 3.1, acidity: 3, intensity: 3.6, oak: 0.5, alcohol: 2.8 },
  ["grenache", "syrah", "rhone", "full red"],
);
fr(
  "southern rhone crus",
  "red",
  ["rasteau", "cairanne", "vinsobres", "beaumes de venise", "lirac"],
  { body: 4, tannin: 3.3, acidity: 3, intensity: 3.8, oak: 0.6, alcohol: 2.9 },
  ["grenache", "syrah", "rhone", "full red"],
);
fr(
  "chateauneuf du pape",
  "red",
  ["chateauneuf du pape", "chateauneuf"],
  { body: 4.6, tannin: 3.4, acidity: 2.9, intensity: 4.4, oak: 0.9, alcohol: 3 },
  ["grenache", "syrah", "mourvedre", "rhone", "full red"],
);
fr(
  "chateauneuf du pape",
  "white",
  ["chateauneuf du pape", "chateauneuf"],
  { body: 4, acidity: 2.7, intensity: 3.7, oak: 0.8, alcohol: 2.8 },
  ["grenache blanc", "roussanne", "rhone", "rich white"],
);
fr(
  "gigondas",
  "red",
  ["gigondas"],
  { body: 4.4, tannin: 3.8, acidity: 3, intensity: 4.2, oak: 0.8, alcohol: 3 },
  ["grenache", "syrah", "rhone", "full red"],
);
fr(
  "vacqueyras",
  "red",
  ["vacqueyras"],
  { body: 4.2, tannin: 3.5, acidity: 3, intensity: 4, oak: 0.7, alcohol: 3 },
  ["grenache", "syrah", "rhone", "full red"],
);
fr(
  "rhone outskirts",
  "red",
  ["costieres de nimes", "ventoux", "luberon", "grignan les adhemar"],
  { body: 3.4, tannin: 2.7, acidity: 3.2, intensity: 3.2, oak: 0.4, alcohol: 2.6 },
  ["grenache", "syrah", "rhone", "medium red"],
);
fr(
  "tavel",
  "rose",
  ["tavel"],
  { body: 3, tannin: 1, acidity: 3.2, sweetness: 0.3, intensity: 3.3, oak: 0, alcohol: 2.7 },
  ["grenache", "rhone", "dry rose"],
);
fr(
  "cote rotie",
  "red",
  ["cote rotie"],
  { body: 3.8, tannin: 3.6, acidity: 3.7, intensity: 4.6, oak: 1.5, alcohol: 2.6 },
  ["syrah", "rhone", "full red"],
);
fr(
  "hermitage",
  "red",
  ["hermitage"],
  { body: 4.6, tannin: 4.5, acidity: 3.6, intensity: 4.6, oak: 1.5, alcohol: 2.7 },
  ["syrah", "rhone", "full red", "tannic red"],
);
fr(
  "hermitage",
  "white",
  ["hermitage"],
  { body: 4.3, acidity: 2.8, intensity: 3.8, oak: 1, alcohol: 2.8 },
  ["marsanne", "roussanne", "rhone", "rich white"],
);
fr(
  "crozes hermitage",
  "red",
  ["crozes hermitage"],
  { body: 3.5, tannin: 3, acidity: 3.6, intensity: 3.8, oak: 0.8, alcohol: 2.5 },
  ["syrah", "rhone", "medium red"],
);
fr(
  "crozes hermitage",
  "white",
  ["crozes hermitage"],
  { body: 3.3, acidity: 3, intensity: 3.2, oak: 0.6, alcohol: 2.5 },
  ["marsanne", "roussanne", "rhone", "rich white"],
);
fr(
  "saint joseph",
  "red",
  ["saint joseph", "st joseph"],
  { body: 3.4, tannin: 3, acidity: 3.6, intensity: 3.8, oak: 0.8, alcohol: 2.5 },
  ["syrah", "rhone", "medium red"],
);
fr(
  "cornas",
  "red",
  ["cornas"],
  { body: 4.4, tannin: 4.4, acidity: 3.6, intensity: 4.4, oak: 1.2, alcohol: 2.7 },
  ["syrah", "rhone", "full red", "tannic red"],
);
fr(
  "condrieu",
  "white",
  ["condrieu", "chateau grillet"],
  { body: 4, acidity: 2.2, sweetness: 0.6, intensity: 4.7, oak: 0.7, alcohol: 2.9 },
  ["viognier", "rhone", "aromatic white", "rich white"],
);

// ---- Vins doux naturels (sweet, fortified during fermentation; cellars file them as either) ----
fr(
  "banyuls",
  ["fortified", "dessert"],
  ["banyuls", "banyuls grand cru"],
  { body: 4.3, tannin: 2.6, acidity: 3, sweetness: 4, intensity: 4.5, oak: 0.8, alcohol: 4 },
  ["grenache", "languedoc", "sweet red", "sweet fortified"],
);
fr(
  "maury",
  ["fortified", "dessert"],
  ["maury"],
  { body: 4.4, tannin: 2.8, acidity: 3, sweetness: 4, intensity: 4.5, oak: 0.7, alcohol: 4 },
  ["grenache", "languedoc", "sweet red", "sweet fortified"],
);
fr(
  "rivesaltes",
  ["fortified", "dessert"],
  ["rivesaltes", "rivesaltes ambre", "rivesaltes tuile", "rivesaltes grenat"],
  { body: 4.2, tannin: 1.2, acidity: 3, sweetness: 4.1, intensity: 4.5, oak: 0.8, alcohol: 4 },
  ["grenache", "languedoc", "sweet fortified"],
);
fr(
  "vin doux naturel muscat",
  ["fortified", "dessert"],
  [
    "muscat de rivesaltes",
    "muscat de beaumes de venise",
    "muscat de frontignan",
    "muscat de mireval",
    "muscat de lunel",
    "muscat de saint jean de minervois",
  ],
  { body: 3.8, tannin: 0, acidity: 2.8, sweetness: 4.3, intensity: 5, oak: 0, alcohol: 3.5 },
  ["muscat", "sweet white", "sweet fortified"],
);

// ---- Provence ----
fr(
  "cotes de provence",
  "rose",
  [
    "cotes de provence",
    "cotes de provence sainte victoire",
    "coteaux d aix en provence",
    "coteaux varois",
    "coteaux varois en provence",
  ],
  { body: 1.7, tannin: 0.2, acidity: 3.8, sweetness: 0.3, intensity: 2.1, oak: 0, alcohol: 2 },
  ["grenache", "cinsault", "provence", "dry rose"],
);
fr(
  "bandol",
  "red",
  ["bandol"],
  { body: 4.3, tannin: 4.3, acidity: 3.4, intensity: 4, oak: 1, alcohol: 2.7 },
  ["mourvedre", "provence", "full red", "tannic red"],
);
fr(
  "bandol",
  "rose",
  ["bandol"],
  { body: 2.5, tannin: 0.5, acidity: 3.6, sweetness: 0.2, intensity: 2.8, oak: 0, alcohol: 2.4 },
  ["mourvedre", "provence", "dry rose"],
);

// ---- Languedoc and Roussillon ----
fr(
  "minervois",
  "red",
  ["minervois", "minervois la liviniere"],
  { body: 3.9, tannin: 3.3, acidity: 3.1, intensity: 3.8, oak: 0.8, alcohol: 2.8 },
  ["syrah", "grenache", "carignan", "languedoc", "full red"],
);
fr(
  "corbieres",
  "red",
  ["corbieres", "corbieres boutenac", "fitou"],
  { body: 3.9, tannin: 3.4, acidity: 3.1, intensity: 3.7, oak: 0.7, alcohol: 2.8 },
  ["carignan", "grenache", "syrah", "languedoc", "full red"],
);
fr(
  "pic saint loup",
  "red",
  ["pic saint loup", "pic st loup"],
  { body: 3.8, tannin: 3.3, acidity: 3.4, intensity: 3.9, oak: 0.8, alcohol: 2.7 },
  ["syrah", "grenache", "languedoc", "full red"],
);
fr(
  "faugeres",
  "red",
  ["faugeres", "saint chinian", "st chinian"],
  { body: 3.9, tannin: 3.3, acidity: 3.2, intensity: 3.8, oak: 0.7, alcohol: 2.8 },
  ["syrah", "grenache", "carignan", "languedoc", "full red"],
);
fr(
  "terrasses du larzac",
  "red",
  ["terrasses du larzac"],
  { body: 4, tannin: 3.4, acidity: 3.5, intensity: 4, oak: 0.8, alcohol: 2.8 },
  ["syrah", "grenache", "languedoc", "full red"],
);
fr(
  "languedoc",
  "red",
  ["languedoc", "coteaux du languedoc", "la clape"],
  { body: 3.8, tannin: 3.1, acidity: 3.1, intensity: 3.5, oak: 0.6, alcohol: 2.8 },
  ["grenache", "syrah", "languedoc", "full red"],
);
fr(
  "roussillon",
  "red",
  ["cotes du roussillon", "cotes du roussillon villages", "collioure"],
  { body: 4.2, tannin: 3.4, acidity: 3, intensity: 4, oak: 0.8, alcohol: 3 },
  ["grenache", "syrah", "carignan", "languedoc", "full red"],
);
fr(
  "picpoul de pinet",
  "white",
  ["picpoul de pinet"],
  { body: 2, acidity: 4.3, intensity: 2.4, oak: 0, alcohol: 2 },
  ["picpoul", "languedoc", "crisp white"],
);

// ---- Jura and Savoie ----
fr(
  "jura",
  "white",
  ["arbois", "cotes du jura", "l etoile"],
  { body: 3.2, acidity: 4.1, intensity: 3.6, oak: 0.4, alcohol: 2.3 },
  ["chardonnay", "savagnin", "jura"],
);
fr(
  "jura",
  "red",
  ["arbois", "cotes du jura"],
  { body: 2.2, tannin: 1.8, acidity: 3.8, intensity: 3, oak: 0.4, alcohol: 2.1 },
  ["pinot noir", "jura", "light red"],
);
fr(
  "vin jaune",
  "white",
  ["vin jaune", "chateau chalon"],
  { body: 3.8, acidity: 4.3, sweetness: 0, intensity: 5, oak: 0, alcohol: 2.7 },
  ["savagnin", "jura", "rich white"],
);
fr(
  "vin de savoie",
  "white",
  ["vin de savoie", "apremont", "chignin", "abymes", "jacquere", "crepy"],
  { body: 1.6, acidity: 4.2, intensity: 1.8, oak: 0, alcohol: 1.7 },
  ["savoie", "crisp white"],
);

// =============================================================================================== ITALY

// ---- Piedmont ----
it(
  "barolo",
  "red",
  ["barolo"],
  { body: 4.2, tannin: 4.8, acidity: 4.4, intensity: 4.6, oak: 1.3, alcohol: 2.8 },
  ["nebbiolo", "piedmont", "tannic red", "full red"],
);
it(
  "barbaresco",
  "red",
  ["barbaresco"],
  { body: 3.9, tannin: 4.5, acidity: 4.3, intensity: 4.4, oak: 1.2, alcohol: 2.7 },
  ["nebbiolo", "piedmont", "tannic red"],
);
it(
  "langhe nebbiolo",
  "red",
  ["langhe nebbiolo", "nebbiolo d alba", "nebbiolo langhe"],
  { body: 3.3, tannin: 3.8, acidity: 4.2, intensity: 3.8, oak: 0.6, alcohol: 2.5 },
  ["nebbiolo", "piedmont", "medium red"],
);
it(
  "roero",
  "red",
  ["roero", "roero rosso"],
  { body: 3.4, tannin: 3.8, acidity: 4.2, intensity: 3.8, oak: 0.8, alcohol: 2.6 },
  ["nebbiolo", "piedmont", "medium red"],
);
it(
  "alto piemonte",
  "red",
  ["gattinara", "ghemme", "lessona", "bramaterra", "carema"],
  { body: 3.4, tannin: 4, acidity: 4.4, intensity: 3.9, oak: 0.9, alcohol: 2.5 },
  ["nebbiolo", "piedmont", "tannic red"],
);
it(
  "valtellina",
  "red",
  ["valtellina", "valtellina superiore", "sassella", "grumello", "sforzato", "sfursat"],
  { body: 3, tannin: 3.6, acidity: 4.3, intensity: 3.6, oak: 0.7, alcohol: 2.3 },
  ["nebbiolo", "medium red"],
);
it(
  "barbera d asti",
  "red",
  ["barbera d asti", "barbera d asti superiore", "nizza", "barbera del monferrato"],
  { body: 3.3, tannin: 2, acidity: 4.4, intensity: 3.6, oak: 0.8, alcohol: 2.7 },
  ["barbera", "piedmont", "medium red"],
);
it(
  "barbera d alba",
  "red",
  ["barbera d alba", "barbera d alba superiore"],
  { body: 3.4, tannin: 2.2, acidity: 4.3, intensity: 3.6, oak: 0.9, alcohol: 2.7 },
  ["barbera", "piedmont", "medium red"],
);
it(
  "dolcetto",
  "red",
  ["dolcetto d alba", "dolcetto di dogliani", "dogliani", "dolcetto d ovada", "dolcetto di diano d alba"],
  { body: 3, tannin: 3, acidity: 3.1, intensity: 3.2, oak: 0, alcohol: 2.3 },
  ["dolcetto", "piedmont", "medium red"],
);
it(
  "roero arneis",
  "white",
  ["roero arneis", "langhe arneis"],
  { body: 2.6, acidity: 3.3, intensity: 3, oak: 0, alcohol: 2.2 },
  ["arneis", "piedmont", "aromatic white"],
);
it(
  "gavi",
  "white",
  ["gavi", "gavi di gavi", "cortese di gavi"],
  { body: 2, acidity: 4.1, intensity: 2.3, oak: 0, alcohol: 2 },
  ["cortese", "piedmont", "crisp white"],
);
it(
  "asti",
  "sparkling",
  ["asti", "asti spumante"],
  { body: 2, acidity: 3, sweetness: 3.8, intensity: 4.5, oak: 0, alcohol: 1.2, fizz: true },
  ["muscat", "piedmont", "tank method sparkling"],
);
// Moscato d'Asti is barely sparkling, about 5.5% alcohol and sweet; cellars file it under all three colours.
it(
  "moscato d asti",
  ["sparkling", "white", "dessert"],
  ["moscato d asti"],
  { body: 1.6, acidity: 3, sweetness: 3.5, intensity: 4.5, oak: 0, alcohol: 1, fizz: true },
  ["muscat", "piedmont", "tank method sparkling"],
);
it(
  "brachetto d acqui",
  ["sparkling", "red"],
  ["brachetto d acqui", "brachetto"],
  { body: 1.8, tannin: 0.8, acidity: 3.2, sweetness: 3.5, intensity: 4.2, oak: 0, alcohol: 1, fizz: true },
  ["piedmont", "sweet red", "tank method sparkling"],
);

// ---- Tuscany and central Italy ----
it(
  "chianti",
  "red",
  ["chianti", "chianti superiore", "chianti rufina", "chianti colli senesi", "chianti colli fiorentini"],
  { body: 3, tannin: 3.4, acidity: 4.2, intensity: 3.2, oak: 0.6, alcohol: 2.3 },
  ["sangiovese", "tuscany", "medium red"],
);
it(
  "chianti classico",
  "red",
  ["chianti classico", "chianti classico riserva", "chianti classico gran selezione"],
  { body: 3.5, tannin: 3.7, acidity: 4.2, intensity: 3.6, oak: 1.2, alcohol: 2.5 },
  ["sangiovese", "tuscany", "medium red"],
);
it(
  "brunello di montalcino",
  "red",
  ["brunello di montalcino", "brunello"],
  { body: 4, tannin: 4.3, acidity: 4.2, intensity: 4.3, oak: 1.6, alcohol: 2.8 },
  ["sangiovese", "tuscany", "full red", "tannic red"],
);
it(
  "rosso di montalcino",
  "red",
  ["rosso di montalcino"],
  { body: 3.3, tannin: 3.4, acidity: 4.1, intensity: 3.4, oak: 0.8, alcohol: 2.5 },
  ["sangiovese", "tuscany", "medium red"],
);
it(
  "vino nobile di montepulciano",
  "red",
  ["vino nobile di montepulciano", "nobile di montepulciano"],
  { body: 3.6, tannin: 3.8, acidity: 4.1, intensity: 3.6, oak: 1.4, alcohol: 2.6 },
  ["sangiovese", "tuscany", "medium red"],
);
it(
  "rosso di montepulciano",
  "red",
  ["rosso di montepulciano"],
  { body: 3, tannin: 3.1, acidity: 4, intensity: 3, oak: 0.5, alcohol: 2.4 },
  ["sangiovese", "tuscany", "medium red"],
);
it(
  "morellino di scansano",
  "red",
  ["morellino di scansano", "montecucco"],
  { body: 3.3, tannin: 3, acidity: 3.8, intensity: 3.3, oak: 0.6, alcohol: 2.6 },
  ["sangiovese", "tuscany", "medium red"],
);
it(
  "bolgheri",
  "red",
  ["bolgheri", "bolgheri rosso", "bolgheri superiore", "bolgheri sassicaia"],
  { body: 4.2, tannin: 4, acidity: 3.6, intensity: 4.1, oak: 2, alcohol: 2.8 },
  ["cabernet sauvignon", "merlot", "tuscany", "full red"],
);
it(
  "vernaccia di san gimignano",
  "white",
  ["vernaccia di san gimignano", "vernaccia"],
  { body: 2.4, acidity: 3.8, intensity: 2.4, oak: 0.1, alcohol: 2.1 },
  ["tuscany", "crisp white"],
);
it(
  "vin santo",
  "dessert",
  ["vin santo", "vin santo del chianti", "vin santo del chianti classico"],
  { body: 4.2, acidity: 3.5, sweetness: 4, intensity: 4.6, oak: 1, alcohol: 2.6 },
  ["trebbiano", "malvasia", "tuscany", "sweet white"],
);
it(
  "sagrantino di montefalco",
  "red",
  ["sagrantino di montefalco", "montefalco sagrantino"],
  { body: 4.5, tannin: 5, acidity: 3.8, intensity: 4.2, oak: 1.4, alcohol: 2.9 },
  ["sagrantino", "tannic red"],
);
it(
  "verdicchio",
  "white",
  ["verdicchio", "verdicchio dei castelli di jesi", "verdicchio di matelica"],
  { body: 2.6, acidity: 4.1, intensity: 2.8, oak: 0.1, alcohol: 2.2 },
  ["crisp white"],
);
it(
  "montepulciano d abruzzo",
  "red",
  ["montepulciano d abruzzo", "montepulciano d abruzzo colline teramane"],
  { body: 3.7, tannin: 3.2, acidity: 3.3, intensity: 3.5, oak: 0.6, alcohol: 2.6 },
  ["montepulciano", "abruzzo", "medium red"],
);
it(
  "cerasuolo d abruzzo",
  "rose",
  ["cerasuolo d abruzzo", "montepulciano d abruzzo cerasuolo"],
  { body: 2.6, tannin: 0.8, acidity: 3.6, intensity: 3, oak: 0, alcohol: 2.2 },
  ["montepulciano", "abruzzo", "dry rose"],
);
it(
  "trebbiano d abruzzo",
  "white",
  ["trebbiano d abruzzo"],
  { body: 2.3, acidity: 3.6, intensity: 2.2, oak: 0.1, alcohol: 2.1 },
  ["trebbiano", "abruzzo", "crisp white"],
);
// Most Lambrusco sold abroad is secco or semisecco and frizzante; cellars file it as red or sparkling.
it(
  "lambrusco",
  ["red", "sparkling"],
  ["lambrusco", "lambrusco grasparossa", "lambrusco grasparossa di castelvetro", "lambrusco salamino"],
  { body: 2.6, tannin: 1.9, acidity: 4, sweetness: 1.2, intensity: 3.5, oak: 0, alcohol: 1.6, fizz: true },
  ["tank method sparkling"],
);
it(
  "lambrusco di sorbara",
  ["red", "sparkling"],
  ["lambrusco di sorbara"],
  { body: 1.8, tannin: 1, acidity: 4.5, sweetness: 0.6, intensity: 3, oak: 0, alcohol: 1.5, fizz: true },
  ["lambrusco", "tank method sparkling"],
);

// ---- Veneto ----
it(
  "valpolicella",
  "red",
  ["valpolicella", "valpolicella classico", "valpolicella superiore", "valpolicella classico superiore"],
  { body: 2.5, tannin: 2, acidity: 3.9, intensity: 2.9, oak: 0.3, alcohol: 2.1 },
  ["corvina", "veneto", "light red"],
);
it(
  "valpolicella ripasso",
  "red",
  [
    "valpolicella ripasso",
    "ripasso",
    "ripasso della valpolicella",
    "valpolicella classico superiore ripasso",
    "valpolicella superiore ripasso",
  ],
  { body: 3.8, tannin: 3, acidity: 3.7, sweetness: 0.7, intensity: 3.8, oak: 1, alcohol: 2.7 },
  ["corvina", "veneto", "valpolicella", "full red"],
);
// Amarone: dried grapes, about 15–16% alcohol, a little residual sugar.
it(
  "amarone",
  "red",
  ["amarone", "amarone della valpolicella", "amarone della valpolicella classico"],
  { body: 5, tannin: 3.6, acidity: 3.5, sweetness: 1.3, intensity: 5, oak: 1.5, alcohol: 3 },
  ["corvina", "veneto", "valpolicella", "full red"],
);
it(
  "recioto della valpolicella",
  ["dessert", "red"],
  ["recioto della valpolicella", "recioto"],
  { body: 4.8, tannin: 3, acidity: 3.5, sweetness: 4.2, intensity: 5, oak: 1, alcohol: 2.8 },
  ["corvina", "veneto", "sweet red"],
);
it(
  "bardolino",
  "red",
  ["bardolino", "bardolino classico"],
  { body: 2.1, tannin: 1.4, acidity: 3.8, intensity: 2.6, oak: 0, alcohol: 2 },
  ["corvina", "veneto", "light red"],
);
it(
  "bardolino chiaretto",
  "rose",
  ["bardolino chiaretto", "chiaretto", "chiaretto di bardolino"],
  { body: 1.8, tannin: 0.3, acidity: 3.8, intensity: 2.3, oak: 0, alcohol: 2 },
  ["corvina", "veneto", "dry rose"],
);
it(
  "soave",
  "white",
  ["soave", "soave classico", "soave superiore"],
  { body: 2.3, acidity: 3.7, intensity: 2.4, oak: 0.1, alcohol: 2 },
  ["garganega", "veneto", "crisp white"],
);
it(
  "lugana",
  "white",
  ["lugana"],
  { body: 2.8, acidity: 3.8, intensity: 2.9, oak: 0.1, alcohol: 2.3 },
  ["trebbiano", "veneto", "crisp white"],
);
it(
  "pinot grigio delle venezie",
  "white",
  ["pinot grigio delle venezie", "delle venezie", "venezie", "pinot grigio ramato"],
  { body: 1.8, acidity: 3.3, sweetness: 0.4, intensity: 1.6, oak: 0, alcohol: 2 },
  ["pinot gris", "veneto", "crisp white"],
);
it(
  "prosecco",
  "sparkling",
  [
    "prosecco",
    "prosecco superiore",
    "conegliano valdobbiadene",
    "conegliano valdobbiadene prosecco",
    "valdobbiadene",
    "asolo prosecco",
  ],
  { body: 1.8, acidity: 3.6, sweetness: 1.3, intensity: 2.7, oak: 0, alcohol: 1.8, fizz: true },
  ["glera", "veneto", "tank method sparkling"],
);

// ---- Northern Italy ----
// Alto Adige makes everything from gewürztraminer to pinot bianco; the grape decides the aroma.
it(
  "alto adige",
  "white",
  ["alto adige", "sudtirol", "suedtirol", "sudtirol alto adige", "alto adige sudtirol"],
  { oak: 0.2, alcohol: 2.2 },
  ["crisp white"],
);
it(
  "alto adige",
  "red",
  ["alto adige", "sudtirol", "suedtirol", "sudtirol alto adige", "alto adige sudtirol"],
  { acidity: 3.8, oak: 0.6, alcohol: 2.2 },
  ["medium red"],
);
it(
  "friuli whites",
  "white",
  ["collio", "collio goriziano", "friuli colli orientali", "colli orientali del friuli", "friuli isonzo"],
  { body: 3, acidity: 3.7, intensity: 3.3, oak: 0.4, alcohol: 2.3 },
  ["friuli", "crisp white"],
);
it(
  "franciacorta",
  "sparkling",
  ["franciacorta", "franciacorta saten"],
  { body: 2.5, acidity: 4.2, sweetness: 0.7, intensity: 3, oak: 0.2, alcohol: 2, fizz: true },
  ["chardonnay", "traditional method sparkling"],
);
it(
  "trento doc",
  "sparkling",
  ["trento doc", "trentodoc"],
  { body: 2.3, acidity: 4.4, sweetness: 0.7, intensity: 2.9, oak: 0.1, alcohol: 2, fizz: true },
  ["chardonnay", "traditional method sparkling"],
);

// ---- Southern Italy and the islands ----
it(
  "etna",
  "red",
  ["etna rosso", "etna"],
  { body: 2.9, tannin: 3.4, acidity: 4.2, intensity: 3.5, oak: 0.6, alcohol: 2.4 },
  ["nerello mascalese", "sicily", "medium red"],
);
it(
  "etna",
  "white",
  ["etna bianco", "etna"],
  { body: 2.6, acidity: 4.3, intensity: 3, oak: 0.2, alcohol: 2.2 },
  ["sicily", "crisp white"],
);
it(
  "cerasuolo di vittoria",
  "red",
  ["cerasuolo di vittoria"],
  { body: 2.9, tannin: 2.5, acidity: 3.6, intensity: 3.3, oak: 0.3, alcohol: 2.4 },
  ["nero d avola", "sicily", "light red"],
);
it(
  "taurasi",
  "red",
  ["taurasi"],
  { body: 4.3, tannin: 4.7, acidity: 4.3, intensity: 4.3, oak: 1.5, alcohol: 2.8 },
  ["aglianico", "campania", "tannic red"],
);
it(
  "aglianico del vulture",
  "red",
  ["aglianico del vulture"],
  { body: 4.1, tannin: 4.4, acidity: 4.1, intensity: 4, oak: 1.3, alcohol: 2.7 },
  ["aglianico", "tannic red"],
);
it(
  "fiano di avellino",
  "white",
  ["fiano di avellino"],
  { body: 3, acidity: 3.8, intensity: 3.4, oak: 0.2, alcohol: 2.3 },
  ["fiano", "campania", "rich white"],
);
it(
  "greco di tufo",
  "white",
  ["greco di tufo"],
  { body: 2.9, acidity: 4, intensity: 3.2, oak: 0.1, alcohol: 2.3 },
  ["greco", "campania", "crisp white"],
);
it(
  "primitivo di manduria",
  "red",
  ["primitivo di manduria"],
  { body: 4.6, tannin: 3, acidity: 2.8, sweetness: 1, intensity: 4.6, oak: 1, alcohol: 3 },
  ["zinfandel", "puglia", "full red"],
);
it(
  "salice salentino",
  "red",
  ["salice salentino", "salento rosso"],
  { body: 4, tannin: 3, acidity: 3, sweetness: 0.6, intensity: 3.8, oak: 0.6, alcohol: 2.8 },
  ["negroamaro", "puglia", "full red"],
);
it(
  "vermentino di sardegna",
  "white",
  ["vermentino di sardegna", "vermentino di gallura"],
  { body: 2.5, acidity: 3.6, intensity: 2.9, oak: 0, alcohol: 2.2 },
  ["vermentino", "sardinia", "crisp white"],
);
it(
  "cannonau di sardegna",
  "red",
  ["cannonau di sardegna"],
  { body: 4, tannin: 2.8, acidity: 3, intensity: 3.8, oak: 0.6, alcohol: 3 },
  ["grenache", "sardinia", "full red"],
);
it(
  "passito di pantelleria",
  "dessert",
  ["passito di pantelleria", "moscato di pantelleria"],
  { body: 4.5, acidity: 3.2, sweetness: 4.7, intensity: 5, oak: 0, alcohol: 2.8 },
  ["muscat", "sicily", "sweet white"],
);
it(
  "marsala",
  "fortified",
  ["marsala", "marsala superiore", "marsala vergine"],
  { body: 3.8, tannin: 0, acidity: 3.3, sweetness: 3, intensity: 4.6, oak: 1, alcohol: 4 },
  ["sicily", "sweet fortified"],
);

// =============================================================================================== SPAIN

es(
  "rioja",
  "red",
  ["rioja", "rioja alta", "rioja alavesa", "rioja oriental"],
  { body: 3.4, tannin: 3.2, acidity: 3.6, intensity: 3.3, oak: 1.8, alcohol: 2.5 },
  ["tempranillo", "rioja", "medium red"],
);
es(
  "rioja crianza",
  "red",
  ["rioja crianza"],
  { body: 3.3, tannin: 3.1, acidity: 3.6, intensity: 3.2, oak: 1.8, alcohol: 2.5 },
  ["tempranillo", "rioja", "medium red"],
);
es(
  "rioja reserva",
  "red",
  ["rioja reserva"],
  { body: 3.6, tannin: 3.2, acidity: 3.5, intensity: 3.6, oak: 2.3, alcohol: 2.5 },
  ["tempranillo", "rioja", "medium red"],
);
es(
  "rioja gran reserva",
  "red",
  ["rioja gran reserva"],
  { body: 3.5, tannin: 3, acidity: 3.6, intensity: 3.8, oak: 2.5, alcohol: 2.5 },
  ["tempranillo", "rioja", "medium red"],
);
// Spanish ageing words say how long the wine spent in oak, not where it grew, so they state oak only.
es("crianza", "red", ["crianza"], { oak: 1.8 }, ["tempranillo", "medium red"]);
es("gran reserva", "red", ["gran reserva"], { oak: 2.5 }, ["tempranillo"]);
// White Rioja is now mostly fresh and unoaked; the old oxidative reservas are a minority.
es(
  "rioja",
  "white",
  ["rioja", "rioja blanco"],
  { body: 2.8, acidity: 3.5, intensity: 2.6, oak: 0.9, alcohol: 2.3 },
  ["viura", "rioja", "crisp white"],
);
es(
  "rioja",
  "rose",
  ["rioja", "rioja rosado"],
  { body: 2.2, tannin: 0.5, acidity: 3.6, intensity: 2.5, oak: 0, alcohol: 2.2 },
  ["tempranillo", "grenache", "rioja", "dry rose"],
);
es(
  "ribera del duero",
  "red",
  ["ribera del duero"],
  { body: 4.2, tannin: 4.1, acidity: 3.6, intensity: 4, oak: 2.1, alcohol: 2.8 },
  ["tempranillo", "ribera del duero", "full red", "tannic red"],
);
es(
  "toro",
  "red",
  ["toro"],
  { body: 4.6, tannin: 4.4, acidity: 3.2, intensity: 4.4, oak: 1.8, alcohol: 3 },
  ["tempranillo", "full red", "tannic red"],
);
es(
  "priorat",
  "red",
  ["priorat", "priorato"],
  { body: 4.7, tannin: 4.2, acidity: 3.6, intensity: 4.6, oak: 1.8, alcohol: 3 },
  ["grenache", "carignan", "priorat", "full red"],
);
es(
  "montsant",
  "red",
  ["montsant"],
  { body: 4.2, tannin: 3.4, acidity: 3.3, intensity: 4, oak: 1.2, alcohol: 2.9 },
  ["grenache", "carignan", "priorat", "full red"],
);
es(
  "garnacha aragon",
  "red",
  ["campo de borja", "calatayud", "carinena"],
  { body: 4, tannin: 2.8, acidity: 3, intensity: 3.8, oak: 0.8, alcohol: 3 },
  ["grenache", "full red"],
);
es(
  "jumilla",
  "red",
  ["jumilla", "yecla", "alicante"],
  { body: 4.4, tannin: 3.8, acidity: 2.9, intensity: 4.2, oak: 1, alcohol: 3 },
  ["mourvedre", "full red"],
);
es(
  "bierzo",
  "red",
  ["bierzo"],
  { body: 3.1, tannin: 2.9, acidity: 3.8, intensity: 3.6, oak: 1, alcohol: 2.4 },
  ["mencia", "medium red"],
);
es(
  "rias baixas",
  "white",
  ["rias baixas", "val do salnes"],
  { body: 2.2, acidity: 4.4, intensity: 3.4, oak: 0, alcohol: 2 },
  ["albarino", "galicia", "crisp white"],
);
es(
  "valdeorras",
  "white",
  ["valdeorras", "ribeira sacra"],
  { body: 3, acidity: 3.8, intensity: 3.1, oak: 0.5, alcohol: 2.3 },
  ["godello", "galicia"],
);
es(
  "rueda",
  "white",
  ["rueda", "rueda verdejo"],
  { body: 2.3, acidity: 4, intensity: 3.4, oak: 0.2, alcohol: 2.2 },
  ["verdejo", "crisp white"],
);
es(
  "txakoli",
  "white",
  ["txakoli", "txakolina", "chacoli", "getariako txakolina"],
  { body: 1.3, acidity: 4.7, sweetness: 0.3, intensity: 2, oak: 0, alcohol: 1.4 },
  ["crisp white"],
);
es(
  "cava",
  "sparkling",
  ["cava", "corpinnat", "cava de paraje calificado"],
  { body: 2, acidity: 4.2, sweetness: 0.8, intensity: 2.4, oak: 0, alcohol: 2, fizz: true },
  ["viura", "traditional method sparkling"],
);

// ---- Sherry ----
// A bottle labelled only "sherry" is most often a medium blend; the style words below decide when present.
es(
  "sherry",
  "fortified",
  ["sherry", "jerez", "xeres", "jerez xeres sherry", "montilla moriles"],
  { body: 3.2, tannin: 0, acidity: 3.1, sweetness: 1.8, intensity: 4.3, oak: 0.3, alcohol: 4 },
  ["palomino", "jerez"],
);
es(
  "fino",
  "fortified",
  ["fino", "fino sherry", "fino en rama"],
  { body: 2, tannin: 0, acidity: 3.3, sweetness: 0, intensity: 3.6, oak: 0, alcohol: 4 },
  ["palomino", "jerez", "dry sherry"],
);
es(
  "manzanilla",
  "fortified",
  ["manzanilla", "manzanilla en rama", "manzanilla sanlucar de barrameda"],
  { body: 1.8, tannin: 0, acidity: 3.4, sweetness: 0, intensity: 3.5, oak: 0, alcohol: 4 },
  ["palomino", "jerez", "dry sherry"],
);
es(
  "manzanilla pasada",
  "fortified",
  ["manzanilla pasada"],
  { body: 2.4, tannin: 0, acidity: 3.3, sweetness: 0, intensity: 4.2, oak: 0.2, alcohol: 4 },
  ["palomino", "jerez", "dry sherry"],
);
es(
  "amontillado",
  "fortified",
  ["amontillado"],
  { body: 3, tannin: 0, acidity: 3.3, sweetness: 0.3, intensity: 4.6, oak: 0.5, alcohol: 4 },
  ["palomino", "jerez", "dry sherry"],
);
es(
  "palo cortado",
  "fortified",
  ["palo cortado"],
  { body: 3.5, tannin: 0, acidity: 3.3, sweetness: 0.3, intensity: 4.8, oak: 0.6, alcohol: 4 },
  ["palomino", "jerez", "dry sherry"],
);
es(
  "oloroso",
  "fortified",
  ["oloroso", "oloroso seco"],
  { body: 4, tannin: 0, acidity: 3.1, sweetness: 0.3, intensity: 5, oak: 0.8, alcohol: 4 },
  ["palomino", "jerez", "dry sherry"],
);
es(
  "medium sherry",
  "fortified",
  ["medium sherry", "medium dry sherry", "amontillado medium", "oloroso dulce"],
  { body: 3.4, tannin: 0, acidity: 3, sweetness: 2.6, intensity: 4.5, oak: 0.5, alcohol: 4 },
  ["palomino", "jerez", "sweet sherry"],
);
es(
  "cream sherry",
  "fortified",
  ["cream sherry", "cream", "pale cream"],
  { body: 4.2, tannin: 0, acidity: 2.8, sweetness: 4, intensity: 4.6, oak: 0.6, alcohol: 4 },
  ["palomino", "jerez", "sweet sherry"],
);
es(
  "pedro ximenez",
  ["fortified", "dessert"],
  ["pedro ximenez", "px"],
  { body: 5, tannin: 0, acidity: 2.3, sweetness: 5, intensity: 5, oak: 0.5, alcohol: 4 },
  ["pedro ximenez", "jerez", "sweet sherry", "sweet fortified"],
);

// =============================================================================================== PORTUGAL

pt(
  "douro",
  "red",
  ["douro", "douro doc"],
  { body: 4.2, tannin: 3.9, acidity: 3.6, intensity: 4, oak: 1.4, alcohol: 2.8 },
  ["touriga nacional", "douro", "full red"],
);
pt(
  "dao",
  "red",
  ["dao"],
  { body: 3.5, tannin: 3.6, acidity: 3.9, intensity: 3.6, oak: 1, alcohol: 2.5 },
  ["touriga nacional", "medium red"],
);
pt(
  "bairrada",
  "red",
  ["bairrada"],
  { body: 3.6, tannin: 4.3, acidity: 4.2, intensity: 3.6, oak: 0.8, alcohol: 2.4 },
  ["baga", "tannic red"],
);
pt(
  "alentejo",
  "red",
  ["alentejo", "alentejano"],
  { body: 4.1, tannin: 3.2, acidity: 3, intensity: 3.8, oak: 1.3, alcohol: 2.8 },
  ["alentejo", "full red"],
);
pt(
  "vinho verde",
  "white",
  ["vinho verde"],
  { body: 1.3, acidity: 4.5, sweetness: 0.8, intensity: 2.3, oak: 0, alcohol: 1.2 },
  ["vinho verde", "crisp white"],
);
pt(
  "vinho verde alvarinho",
  "white",
  ["vinho verde alvarinho", "alvarinho vinho verde", "moncao e melgaco", "moncao melgaco"],
  { body: 2.3, acidity: 4.4, sweetness: 0.3, intensity: 3.4, oak: 0, alcohol: 2.2 },
  ["albarino", "vinho verde", "crisp white"],
);
pt(
  "vinho verde",
  "rose",
  ["vinho verde"],
  { body: 1.4, tannin: 0.2, acidity: 4.3, sweetness: 1, intensity: 2.3, oak: 0, alcohol: 1.3 },
  ["vinho verde", "dry rose"],
);

// ---- Port ----
// Port with no style word is read as a ruby, the most bought.
pt(
  "port",
  "fortified",
  ["port", "porto", "port wine", "oporto"],
  { body: 4.5, tannin: 2.8, acidity: 3.1, sweetness: 4.2, intensity: 4.6, oak: 0.5, alcohol: 4 },
  ["touriga nacional", "douro", "port"],
);
pt(
  "ruby port",
  "fortified",
  ["ruby", "ruby port", "reserve port", "reserve ruby", "fine ruby"],
  { body: 4.4, tannin: 2.8, acidity: 3.1, sweetness: 4.2, intensity: 4.5, oak: 0.3, alcohol: 4 },
  ["touriga nacional", "douro", "port"],
);
pt(
  "late bottled vintage",
  "fortified",
  ["lbv", "late bottled vintage", "late bottled"],
  { body: 4.6, tannin: 3.2, acidity: 3.2, sweetness: 4.2, intensity: 4.7, oak: 0.6, alcohol: 4 },
  ["touriga nacional", "douro", "port"],
);
pt(
  "vintage port",
  "fortified",
  ["vintage port", "vintage porto", "porto vintage", "single quinta vintage", "quinta vintage port"],
  { body: 5, tannin: 4, acidity: 3.3, sweetness: 4.3, intensity: 5, oak: 0.3, alcohol: 4 },
  ["touriga nacional", "douro", "port"],
);
pt(
  "tawny port",
  "fortified",
  ["tawny", "tawny port", "porto tawny", "tawny porto"],
  { body: 3.8, tannin: 1.2, acidity: 3.3, sweetness: 4, intensity: 4.4, oak: 1.2, alcohol: 4 },
  ["douro", "port", "tawny port"],
);
pt(
  "aged tawny 10",
  "fortified",
  [
    "10 year old tawny",
    "10 years old tawny",
    "10 year tawny",
    "tawny 10 year",
    "tawny 10 years",
    "tawny 10 years old",
    "tawny 10 year old",
  ],
  { body: 3.8, tannin: 1, acidity: 3.5, sweetness: 4, intensity: 4.7, oak: 1.5, alcohol: 4 },
  ["douro", "port", "tawny port"],
);
pt(
  "aged tawny 20",
  "fortified",
  [
    "20 year old tawny",
    "20 years old tawny",
    "20 year tawny",
    "tawny 20 year",
    "tawny 20 years",
    "tawny 20 years old",
    "tawny 20 year old",
    "30 year old tawny",
    "40 year old tawny",
    "tawny 30 years",
    "tawny 40 years",
    "colheita port",
    "porto colheita",
    "colheita tawny",
  ],
  { body: 3.7, tannin: 0.8, acidity: 3.6, sweetness: 4, intensity: 5, oak: 1.7, alcohol: 4 },
  ["douro", "port", "tawny port"],
);
// White port runs from dry to lágrima; most sold is the sweetish kind mixed with tonic.
pt(
  "white port",
  "fortified",
  ["white port", "porto branco", "white porto", "porto blanco", "porto white"],
  { body: 3.5, tannin: 0, acidity: 3, sweetness: 3, intensity: 3.8, oak: 0.3, alcohol: 4 },
  ["douro", "port", "sweet fortified"],
);

// ---- Madeira and Setúbal ----
// Madeira with no grape on the label is read as a medium-rich blend.
pt(
  "madeira",
  "fortified",
  ["madeira", "madeira wine"],
  { body: 3.6, tannin: 0, acidity: 4.7, sweetness: 3, intensity: 5, oak: 1, alcohol: 4 },
  ["madeira", "sweet fortified"],
);
pt(
  "sercial",
  "fortified",
  ["sercial"],
  { body: 2.8, tannin: 0, acidity: 4.9, sweetness: 1.2, intensity: 4.6, oak: 0.8, alcohol: 4 },
  ["madeira"],
);
pt(
  "verdelho madeira",
  "fortified",
  ["verdelho", "verdelho madeira"],
  { body: 3.2, tannin: 0, acidity: 4.8, sweetness: 2.3, intensity: 4.8, oak: 0.9, alcohol: 4 },
  ["madeira"],
);
pt(
  "bual",
  "fortified",
  ["bual", "boal"],
  { body: 3.8, tannin: 0, acidity: 4.6, sweetness: 3.6, intensity: 5, oak: 1, alcohol: 4 },
  ["madeira", "sweet fortified"],
);
pt(
  "malmsey",
  "fortified",
  ["malmsey", "malvasia madeira"],
  { body: 4.3, tannin: 0, acidity: 4.5, sweetness: 4.5, intensity: 5, oak: 1, alcohol: 4 },
  ["madeira", "sweet fortified"],
);
pt(
  "moscatel de setubal",
  ["fortified", "dessert"],
  ["moscatel de setubal", "setubal"],
  { body: 4.3, tannin: 0, acidity: 3, sweetness: 4.6, intensity: 5, oak: 0.8, alcohol: 4 },
  ["muscat", "sweet fortified"],
);

// =============================================================================================== GERMANY

de(
  "mosel",
  "white",
  ["mosel", "mosel saar ruwer", "saar", "ruwer"],
  { body: 1.6, acidity: 4.7, sweetness: 1.8, intensity: 3.6, oak: 0, alcohol: 1.4 },
  ["riesling", "mosel", "off-dry white"],
);
de(
  "rheingau",
  "white",
  ["rheingau"],
  { body: 2.4, acidity: 4.4, sweetness: 1.2, intensity: 3.6, oak: 0, alcohol: 1.8 },
  ["riesling", "rheingau", "aromatic white"],
);
de(
  "pfalz",
  "white",
  ["pfalz"],
  { body: 2.8, acidity: 4, sweetness: 0.7, intensity: 3.5, oak: 0.2, alcohol: 2.2 },
  ["riesling", "pfalz", "aromatic white"],
);
de(
  "nahe",
  "white",
  ["nahe"],
  { body: 2.2, acidity: 4.4, sweetness: 1.3, intensity: 3.6, oak: 0, alcohol: 1.7 },
  ["riesling", "nahe", "aromatic white"],
);
de(
  "rheinhessen",
  "white",
  ["rheinhessen"],
  { body: 2.6, acidity: 4, sweetness: 1, intensity: 3.2, oak: 0.1, alcohol: 2 },
  ["riesling", "silvaner", "rheinhessen"],
);
de(
  "franken",
  "white",
  ["franken", "frankenwein"],
  { body: 2.6, acidity: 3.8, sweetness: 0.3, intensity: 2.6, oak: 0, alcohol: 2.2 },
  ["silvaner", "germany", "crisp white"],
);

// ---- German label words ----
// The Prädikat says how ripe the grapes were; without "trocken" a Kabinett or Spätlese is off-dry to sweet and
// low in alcohol. Most are riesling, so these also state its acidity.
de(
  "kabinett",
  "white",
  ["kabinett"],
  { body: 1.6, acidity: 4.6, sweetness: 2.5, intensity: 3.6, oak: 0, alcohol: 1 },
  ["riesling", "germany", "off-dry white"],
);
de(
  "spatlese",
  "white",
  ["spatlese", "spaetlese"],
  { body: 2.3, acidity: 4.5, sweetness: 3, intensity: 4, oak: 0, alcohol: 1.2 },
  ["riesling", "germany", "off-dry white"],
);
de(
  "auslese",
  ["white", "dessert"],
  ["auslese"],
  { body: 3, acidity: 4.4, sweetness: 3.8, intensity: 4.5, oak: 0, alcohol: 1.4 },
  ["riesling", "germany", "sweet white"],
);
any(
  "beerenauslese",
  ["white", "dessert"],
  ["beerenauslese"],
  { body: 4.2, acidity: 4.6, sweetness: 4.7, intensity: 4.8, oak: 0, alcohol: 1.3 },
  ["riesling", "sweet white"],
);
any(
  "trockenbeerenauslese",
  ["white", "dessert"],
  ["trockenbeerenauslese", "tba"],
  { body: 5, acidity: 4.7, sweetness: 5, intensity: 5, oak: 0, alcohol: 1 },
  ["riesling", "sweet white"],
);
any(
  "eiswein",
  ["white", "dessert"],
  ["eiswein", "icewine", "ice wine"],
  { body: 4, acidity: 4.9, sweetness: 4.8, intensity: 4.8, oak: 0, alcohol: 1.3 },
  ["riesling", "sweet white"],
);
// "Trocken" overrides the Prädikat ("Spätlese trocken" is dry), so it lists those pairs as longer names.
de(
  "trocken",
  "white",
  ["trocken", "kabinett trocken", "spatlese trocken", "spaetlese trocken", "auslese trocken"],
  { body: 2.4, sweetness: 0.4, alcohol: 2.2 },
  ["riesling", "germany", "crisp white"],
);
de(
  "grosses gewachs",
  "white",
  ["grosses gewachs", "grosses gewaechs", "gg", "erstes gewachs"],
  { body: 3.4, sweetness: 0.3, intensity: 4.2, alcohol: 2.6 },
  ["riesling", "germany", "rich white"],
);
de(
  "feinherb",
  "white",
  [
    "feinherb",
    "halbtrocken",
    "kabinett feinherb",
    "kabinett halbtrocken",
    "spatlese feinherb",
    "spatlese halbtrocken",
  ],
  { body: 2, sweetness: 1.8, alcohol: 1.7 },
  ["riesling", "germany", "off-dry white"],
);
any(
  "sekt",
  "sparkling",
  ["sekt", "winzersekt", "deutscher sekt", "sekt b a"],
  { body: 2, acidity: 4.4, sweetness: 1, intensity: 2.9, oak: 0, alcohol: 2, fizz: true },
  ["riesling", "traditional method sparkling"],
);

// =============================================================================================== AUSTRIA

at_(
  "wachau",
  "white",
  ["wachau"],
  { body: 2.9, acidity: 4.1, sweetness: 0.3, intensity: 3.5, oak: 0.1, alcohol: 2.3 },
  ["gruner veltliner", "riesling", "wachau", "crisp white"],
);
// The Wachau's own ripeness ladder, from light to rich; all dry.
at_(
  "steinfeder",
  "white",
  ["steinfeder"],
  { body: 1.5, acidity: 4.1, sweetness: 0.2, intensity: 2.6, oak: 0, alcohol: 1.2 },
  ["gruner veltliner", "wachau", "crisp white"],
);
at_(
  "federspiel",
  "white",
  ["federspiel"],
  { body: 2.4, acidity: 4.1, sweetness: 0.2, intensity: 3.2, oak: 0, alcohol: 2 },
  ["gruner veltliner", "riesling", "wachau", "crisp white"],
);
at_(
  "smaragd",
  "white",
  ["smaragd"],
  { body: 3.7, acidity: 3.9, sweetness: 0.4, intensity: 4.2, oak: 0.1, alcohol: 2.8 },
  ["gruner veltliner", "riesling", "wachau", "rich white"],
);
at_(
  "kamptal",
  "white",
  ["kamptal", "kremstal", "traisental", "wagram"],
  { body: 2.8, acidity: 4.1, sweetness: 0.3, intensity: 3.4, oak: 0.2, alcohol: 2.3 },
  ["gruner veltliner", "riesling", "kamptal", "crisp white"],
);
at_(
  "weinviertel",
  "white",
  ["weinviertel", "weinviertel dac"],
  { body: 2.2, acidity: 4, sweetness: 0.2, intensity: 3.2, oak: 0, alcohol: 2 },
  ["gruner veltliner", "austria", "crisp white"],
);
at_(
  "mittelburgenland",
  "red",
  ["mittelburgenland", "leithaberg", "eisenberg"],
  { body: 3.4, tannin: 3.3, acidity: 4, intensity: 3.6, oak: 1.1, alcohol: 2.4 },
  ["blaufrankisch", "burgenland", "medium red"],
);
at_(
  "ruster ausbruch",
  ["dessert", "white"],
  ["ruster ausbruch", "ausbruch"],
  { body: 4.3, acidity: 4.3, sweetness: 4.6, intensity: 4.6, oak: 0.6, alcohol: 1.8 },
  ["furmint", "burgenland", "sweet white"],
);

// =============================================================================================== HUNGARY

hu(
  "tokaji aszu",
  ["dessert", "white"],
  ["tokaji aszu", "aszu", "puttonyos", "6 puttonyos", "5 puttonyos"],
  { body: 4.3, acidity: 4.8, sweetness: 4.7, intensity: 4.9, oak: 0.8, alcohol: 1.8 },
  ["furmint", "tokaj", "sweet white"],
);
hu(
  "tokaji eszencia",
  "dessert",
  ["eszencia", "tokaji eszencia", "essencia"],
  { body: 5, acidity: 5, sweetness: 5, intensity: 5, oak: 0, alcohol: 1 },
  ["furmint", "tokaj", "sweet white"],
);
hu(
  "tokaji",
  "white",
  ["tokaji", "tokaji furmint", "tokaji dry", "tokaji szaraz"],
  { body: 2.8, acidity: 4.6, sweetness: 0.5, intensity: 3.4, oak: 0.4, alcohol: 2.3 },
  ["furmint", "tokaj", "crisp white"],
);
hu(
  "egri bikaver",
  "red",
  ["egri bikaver", "bikaver", "bull s blood", "bulls blood"],
  { body: 3.3, tannin: 3, acidity: 3.8, intensity: 3.4, oak: 0.9, alcohol: 2.4 },
  ["blaufrankisch", "medium red"],
);

// =============================================================================================== UNITED STATES

const NAPA = [
  "napa valley",
  "oakville",
  "rutherford",
  "stags leap district",
  "stag s leap district",
  "howell mountain",
  "spring mountain",
  "spring mountain district",
  "mount veeder",
  "st helena",
  "saint helena",
  "calistoga",
  "atlas peak",
  "coombsville",
];
us(
  "napa valley",
  "red",
  NAPA,
  { body: 4.6, tannin: 4.2, acidity: 3, sweetness: 0.6, intensity: 4.6, oak: 2.3, alcohol: 3 },
  ["cabernet sauvignon", "napa", "full red", "tannic red"],
);
us(
  "napa valley",
  "white",
  NAPA,
  { body: 3.9, acidity: 3.1, sweetness: 0.6, intensity: 3.7, oak: 2, alcohol: 2.8 },
  ["chardonnay", "napa", "oaked white", "rich white"],
);
us(
  "carneros",
  "red",
  ["carneros", "los carneros"],
  { body: 3, tannin: 2.3, acidity: 3.7, intensity: 3.6, oak: 1.3, alcohol: 2.6 },
  ["pinot noir", "napa", "medium red"],
);
us(
  "sonoma coast",
  "red",
  ["sonoma coast", "fort ross seaview", "west sonoma coast", "petaluma gap"],
  { body: 3, tannin: 2.3, acidity: 3.8, intensity: 3.8, oak: 1.3, alcohol: 2.6 },
  ["pinot noir", "sonoma", "medium red"],
);
us(
  "sonoma coast",
  "white",
  ["sonoma coast", "fort ross seaview", "west sonoma coast"],
  { body: 3.4, acidity: 3.7, intensity: 3.4, oak: 1.4, alcohol: 2.6 },
  ["chardonnay", "sonoma"],
);
us(
  "russian river valley",
  "red",
  ["russian river valley", "russian river", "green valley of russian river valley"],
  { body: 3.3, tannin: 2.3, acidity: 3.4, intensity: 4, oak: 1.5, alcohol: 2.8 },
  ["pinot noir", "sonoma", "medium red"],
);
us(
  "russian river valley",
  "white",
  ["russian river valley", "russian river"],
  { body: 3.8, acidity: 3.3, intensity: 3.8, oak: 2, alcohol: 2.7 },
  ["chardonnay", "sonoma", "oaked white", "rich white"],
);
us(
  "alexander valley",
  "red",
  ["alexander valley", "knights valley"],
  { body: 4.3, tannin: 3.9, acidity: 3.1, intensity: 4.2, oak: 2, alcohol: 2.9 },
  ["cabernet sauvignon", "sonoma", "full red"],
);
us(
  "dry creek valley",
  "red",
  ["dry creek valley", "dry creek"],
  { body: 4.3, tannin: 3.2, acidity: 3.1, sweetness: 0.7, intensity: 4.3, oak: 1.5, alcohol: 3 },
  ["zinfandel", "sonoma", "full red"],
);
us(
  "paso robles",
  "red",
  ["paso robles", "adelaida district", "willow creek district"],
  { body: 4.5, tannin: 3.5, acidity: 2.8, sweetness: 0.8, intensity: 4.4, oak: 1.8, alcohol: 3 },
  ["syrah", "zinfandel", "california", "full red"],
);
us(
  "lodi",
  "red",
  ["lodi"],
  { body: 4.5, tannin: 3, acidity: 2.8, sweetness: 1, intensity: 4.3, oak: 1.5, alcohol: 3 },
  ["zinfandel", "california", "full red"],
);
us(
  "santa barbara",
  "red",
  ["santa rita hills", "sta rita hills", "santa barbara county", "santa maria valley", "santa lucia highlands"],
  { body: 3.1, tannin: 2.3, acidity: 3.8, intensity: 3.9, oak: 1.3, alcohol: 2.7 },
  ["pinot noir", "california", "medium red"],
);
us(
  "willamette valley",
  "red",
  [
    "willamette valley",
    "willamette",
    "dundee hills",
    "eola amity hills",
    "yamhill carlton",
    "ribbon ridge",
    "chehalem mountains",
  ],
  { body: 2.8, tannin: 2.2, acidity: 3.9, intensity: 3.5, oak: 1.1, alcohol: 2.3 },
  ["pinot noir", "oregon", "light red"],
);
us(
  "willamette valley",
  "white",
  ["willamette valley", "willamette", "dundee hills", "eola amity hills"],
  { body: 3, acidity: 3.9, intensity: 3.1, oak: 0.9, alcohol: 2.3 },
  ["chardonnay", "pinot gris", "oregon"],
);
us(
  "columbia valley",
  "red",
  ["columbia valley", "walla walla", "walla walla valley", "red mountain", "yakima valley", "horse heaven hills"],
  { body: 4.2, tannin: 3.9, acidity: 3.5, intensity: 4, oak: 1.9, alcohol: 2.9 },
  ["cabernet sauvignon", "merlot", "syrah", "washington", "full red"],
);
us(
  "finger lakes",
  "white",
  ["finger lakes", "seneca lake", "keuka lake"],
  { body: 2, acidity: 4.5, sweetness: 1.2, intensity: 3.6, oak: 0, alcohol: 1.8 },
  ["riesling", "aromatic white"],
);

// =============================================================================================== SOUTH AMERICA

ar(
  "mendoza",
  "red",
  ["mendoza", "lujan de cuyo", "maipu", "agrelo", "perdriel"],
  { body: 4.3, tannin: 3.9, acidity: 3.2, intensity: 4.2, oak: 1.7, alcohol: 3 },
  ["malbec", "mendoza", "full red"],
);
ar(
  "uco valley",
  "red",
  ["uco valley", "valle de uco", "tupungato", "tunuyan", "gualtallary", "paraje altamira", "altamira", "vista flores"],
  { body: 4.1, tannin: 3.8, acidity: 3.6, intensity: 4.2, oak: 1.6, alcohol: 2.8 },
  ["malbec", "mendoza", "full red"],
);
ar(
  "salta",
  "white",
  ["salta", "cafayate", "valles calchaquies", "calchaqui"],
  { body: 2.7, acidity: 3.2, intensity: 4.7, oak: 0, alcohol: 2.6 },
  ["torrontes", "argentina", "aromatic white"],
);
ar(
  "salta",
  "red",
  ["salta", "cafayate", "valles calchaquies", "calchaqui"],
  { body: 4.5, tannin: 4.2, acidity: 3.3, intensity: 4.4, oak: 1.6, alcohol: 3 },
  ["malbec", "argentina", "full red", "tannic red"],
);
ar(
  "patagonia",
  "red",
  ["patagonia", "rio negro", "neuquen"],
  { body: 3, tannin: 2.6, acidity: 3.6, intensity: 3.5, oak: 1.1, alcohol: 2.5 },
  ["pinot noir", "malbec", "argentina", "medium red"],
);
cl(
  "maipo",
  "red",
  ["maipo", "maipo valley", "valle del maipo", "puente alto", "alto maipo"],
  { body: 4.2, tannin: 3.8, acidity: 3.4, intensity: 4, oak: 1.8, alcohol: 2.8 },
  ["cabernet sauvignon", "chile", "full red"],
);
cl(
  "colchagua",
  "red",
  ["colchagua", "colchagua valley", "valle de colchagua", "apalta", "rapel", "rapel valley", "cachapoal"],
  { body: 4.4, tannin: 3.6, acidity: 3.2, intensity: 4.2, oak: 1.8, alcohol: 3 },
  ["carmenere", "cabernet sauvignon", "syrah", "chile", "full red"],
);
cl(
  "casablanca",
  "white",
  ["casablanca", "casablanca valley", "valle de casablanca", "san antonio", "leyda", "leyda valley", "limari"],
  { body: 2.4, acidity: 4.2, intensity: 3.8, oak: 0.3, alcohol: 2.2 },
  ["sauvignon blanc", "chardonnay", "chile", "crisp white"],
);
cl(
  "casablanca",
  "red",
  ["casablanca", "casablanca valley", "valle de casablanca", "san antonio", "leyda", "leyda valley"],
  { body: 2.8, tannin: 2.3, acidity: 3.8, intensity: 3.5, oak: 1, alcohol: 2.4 },
  ["pinot noir", "chile", "light red"],
);

// =============================================================================================== AUSTRALIA

au(
  "barossa valley",
  "red",
  ["barossa valley", "barossa"],
  { body: 4.8, tannin: 3.6, acidity: 2.9, sweetness: 0.8, intensity: 4.8, oak: 2, alcohol: 3 },
  ["syrah", "barossa", "full red"],
);
au(
  "eden valley",
  "white",
  ["eden valley", "high eden"],
  { body: 2, acidity: 4.6, sweetness: 0.3, intensity: 4, oak: 0, alcohol: 2 },
  ["riesling", "australia", "crisp white", "aromatic white"],
);
au(
  "clare valley",
  "white",
  ["clare valley", "polish hill", "watervale"],
  { body: 1.9, acidity: 4.8, sweetness: 0.2, intensity: 4, oak: 0, alcohol: 2 },
  ["riesling", "australia", "crisp white", "aromatic white"],
);
au(
  "mclaren vale",
  "red",
  ["mclaren vale"],
  { body: 4.5, tannin: 3.5, acidity: 3, sweetness: 0.6, intensity: 4.5, oak: 1.8, alcohol: 3 },
  ["syrah", "grenache", "mclaren vale", "full red"],
);
au(
  "coonawarra",
  "red",
  ["coonawarra", "limestone coast", "wrattonbully"],
  { body: 4, tannin: 4, acidity: 3.6, intensity: 4, oak: 1.8, alcohol: 2.7 },
  ["cabernet sauvignon", "australia", "full red", "tannic red"],
);
au(
  "margaret river",
  "red",
  ["margaret river"],
  { body: 4, tannin: 3.9, acidity: 3.6, intensity: 4, oak: 1.8, alcohol: 2.7 },
  ["cabernet sauvignon", "margaret river", "full red"],
);
au(
  "margaret river",
  "white",
  ["margaret river"],
  { body: 3.4, acidity: 3.8, intensity: 3.6, oak: 1.4, alcohol: 2.5 },
  ["chardonnay", "semillon", "sauvignon blanc", "margaret river"],
);
// Young Hunter semillon is picked early: about 11% alcohol, very lean; it turns toasty with age.
au(
  "hunter valley",
  "white",
  ["hunter valley", "lower hunter"],
  { body: 1.6, acidity: 4.5, intensity: 2.4, oak: 0, alcohol: 1.2 },
  ["semillon", "hunter", "crisp white"],
);
au(
  "hunter valley",
  "red",
  ["hunter valley", "lower hunter"],
  { body: 3, tannin: 2.6, acidity: 3.6, intensity: 3.4, oak: 1, alcohol: 2.4 },
  ["syrah", "hunter", "medium red"],
);
au(
  "yarra valley",
  "red",
  ["yarra valley", "mornington peninsula", "geelong"],
  { body: 2.8, tannin: 2.3, acidity: 3.8, intensity: 3.5, oak: 1.1, alcohol: 2.4 },
  ["pinot noir", "australia", "light red"],
);
au(
  "yarra valley",
  "white",
  ["yarra valley", "mornington peninsula", "geelong"],
  { body: 3, acidity: 3.9, intensity: 3.2, oak: 1.2, alcohol: 2.4 },
  ["chardonnay", "australia"],
);
au(
  "adelaide hills",
  "white",
  ["adelaide hills"],
  { body: 2.6, acidity: 4, intensity: 3.6, oak: 0.6, alcohol: 2.3 },
  ["sauvignon blanc", "chardonnay", "australia", "crisp white"],
);
au(
  "heathcote",
  "red",
  ["heathcote", "grampians"],
  { body: 4.3, tannin: 3.6, acidity: 3.3, intensity: 4.3, oak: 1.6, alcohol: 2.9 },
  ["syrah", "australia", "full red"],
);
au(
  "rutherglen muscat",
  ["fortified", "dessert"],
  ["rutherglen muscat", "rutherglen", "rutherglen topaque", "topaque"],
  { body: 5, tannin: 0, acidity: 2.5, sweetness: 5, intensity: 5, oak: 1, alcohol: 4 },
  ["muscat", "australia", "sweet fortified"],
);

// =============================================================================================== NEW ZEALAND

// Marlborough means sauvignon blanc to nearly every buyer; its chardonnay and pinot gris are a minority.
nz(
  "marlborough",
  "white",
  ["marlborough", "awatere", "wairau", "wairau valley", "awatere valley"],
  { body: 2.2, acidity: 4.4, sweetness: 0.6, intensity: 4.4, oak: 0.2, alcohol: 2.2 },
  ["sauvignon blanc", "marlborough", "aromatic white", "crisp white"],
);
nz(
  "marlborough",
  "red",
  ["marlborough", "awatere", "wairau", "southern valleys"],
  { body: 2.8, tannin: 2.2, acidity: 3.9, intensity: 3.5, oak: 1, alcohol: 2.3 },
  ["pinot noir", "marlborough", "light red"],
);
nz(
  "central otago",
  "red",
  ["central otago", "bannockburn", "gibbston", "bendigo", "cromwell"],
  { body: 3.3, tannin: 2.5, acidity: 3.8, intensity: 4, oak: 1.2, alcohol: 2.6 },
  ["pinot noir", "central otago", "medium red"],
);
nz(
  "martinborough",
  "red",
  ["martinborough", "wairarapa"],
  { body: 3.2, tannin: 2.6, acidity: 3.8, intensity: 3.9, oak: 1.2, alcohol: 2.5 },
  ["pinot noir", "new zealand", "medium red"],
);
nz(
  "hawkes bay",
  "red",
  ["hawke s bay", "hawkes bay", "gimblett gravels", "bridge pa"],
  { body: 3.8, tannin: 3.4, acidity: 3.6, intensity: 3.8, oak: 1.5, alcohol: 2.5 },
  ["merlot", "syrah", "hawkes bay", "medium red"],
);
nz(
  "hawkes bay",
  "white",
  ["hawke s bay", "hawkes bay", "gimblett gravels"],
  { body: 3.3, acidity: 3.7, intensity: 3.3, oak: 1.3, alcohol: 2.4 },
  ["chardonnay", "hawkes bay"],
);

// =============================================================================================== SOUTH AFRICA

za(
  "stellenbosch",
  "red",
  ["stellenbosch", "simonsberg stellenbosch", "helderberg"],
  { body: 4.2, tannin: 3.9, acidity: 3.4, intensity: 4, oak: 1.8, alcohol: 2.8 },
  ["cabernet sauvignon", "stellenbosch", "full red"],
);
za(
  "stellenbosch",
  "white",
  ["stellenbosch"],
  { body: 3, acidity: 3.9, intensity: 3.4, oak: 0.8, alcohol: 2.5 },
  ["chenin blanc", "south africa"],
);
za(
  "swartland",
  "red",
  ["swartland", "paardeberg"],
  { body: 3.8, tannin: 3.2, acidity: 3.5, intensity: 4, oak: 0.8, alcohol: 2.7 },
  ["syrah", "grenache", "south africa", "full red"],
);
za(
  "swartland",
  "white",
  ["swartland", "paardeberg"],
  { body: 3.4, acidity: 3.9, intensity: 3.6, oak: 0.5, alcohol: 2.5 },
  ["chenin blanc", "south africa", "rich white"],
);
za(
  "constantia",
  "white",
  ["constantia", "cape point", "elgin"],
  { body: 2.6, acidity: 4.2, intensity: 3.8, oak: 0.4, alcohol: 2.3 },
  ["sauvignon blanc", "south africa", "crisp white"],
);
za(
  "vin de constance",
  "dessert",
  ["vin de constance", "constantia"],
  { body: 4.4, acidity: 4, sweetness: 4.6, intensity: 5, oak: 1, alcohol: 2.4 },
  ["muscat", "south africa", "sweet white"],
);
za(
  "hemel en aarde",
  "red",
  ["hemel en aarde", "walker bay", "hemel en aarde ridge", "upper hemel en aarde valley"],
  { body: 2.9, tannin: 2.4, acidity: 3.9, intensity: 3.6, oak: 1.1, alcohol: 2.4 },
  ["pinot noir", "south africa", "light red"],
);
za(
  "cap classique",
  "sparkling",
  ["methode cap classique", "cap classique", "mcc"],
  { body: 2.2, acidity: 4.3, sweetness: 0.8, intensity: 2.8, oak: 0.1, alcohol: 2, fizz: true },
  ["chardonnay", "south africa", "traditional method sparkling"],
);

// =============================================================================================== GREECE, LEBANON, SWITZERLAND, CANADA

gr(
  "santorini",
  "white",
  ["santorini", "santorini assyrtiko"],
  { body: 2.9, acidity: 4.8, intensity: 3.6, oak: 0.2, alcohol: 2.6 },
  ["assyrtiko", "greece", "crisp white"],
);
gr(
  "santorini vinsanto",
  "dessert",
  ["vinsanto", "santorini vinsanto"],
  { body: 4.5, acidity: 4.4, sweetness: 4.5, intensity: 5, oak: 0.8, alcohol: 2.4 },
  ["assyrtiko", "greece", "sweet white"],
);
gr(
  "naoussa",
  "red",
  ["naoussa", "amyndeo", "amyndeon"],
  { body: 3.3, tannin: 4.4, acidity: 4.4, intensity: 4, oak: 1, alcohol: 2.4 },
  ["xinomavro", "greece", "tannic red"],
);
gr(
  "nemea",
  "red",
  ["nemea"],
  { body: 3.7, tannin: 3.3, acidity: 3.3, intensity: 3.8, oak: 1.2, alcohol: 2.6 },
  ["agiorgitiko", "greece", "medium red"],
);
gr(
  "samos",
  "dessert",
  ["samos", "muscat of samos", "samos vin doux"],
  { body: 4.2, acidity: 3, sweetness: 4.5, intensity: 5, oak: 0, alcohol: 2.8 },
  ["muscat", "greece", "sweet white"],
);
// Bekaa reds in the Musar mould: cinsault and cabernet, volatile and spicy, made to age.
lb(
  "bekaa valley",
  "red",
  ["bekaa valley", "chateau musar", "musar"],
  { body: 3.6, tannin: 3.2, acidity: 3.8, intensity: 4.5, oak: 1.2, alcohol: 2.6 },
  ["cabernet sauvignon", "cinsault", "lebanon", "medium red"],
);
ch(
  "fendant",
  "white",
  ["fendant", "dezaley", "lavaux", "epesses"],
  { body: 1.8, acidity: 3.2, intensity: 1.9, oak: 0, alcohol: 1.9 },
  ["chasselas", "crisp white"],
);
ca(
  "canadian icewine",
  "dessert",
  ["niagara peninsula", "okanagan valley", "vqa icewine"],
  { body: 4.2, acidity: 4.3, sweetness: 4.9, intensity: 4.8, oak: 0, alcohol: 1.5 },
  ["riesling", "sweet white"],
);

// =============================================================================================== ANY COUNTRY

// Sparkling label words that decide sweetness or style, wherever the wine was made.
any(
  "blanc de blancs",
  "sparkling",
  ["blanc de blancs", "blanc de blanc"],
  { body: 2.1, acidity: 4.8, intensity: 3.1 },
  ["chardonnay", "traditional method sparkling"],
);
any(
  "blanc de noirs",
  "sparkling",
  ["blanc de noirs", "blanc de noir"],
  { body: 3, acidity: 4.3, intensity: 3.4 },
  ["pinot noir", "traditional method sparkling"],
);
any(
  "brut nature",
  "sparkling",
  ["brut nature", "zero dosage", "dosage zero", "pas dose", "non dose", "brut zero", "extra brut"],
  { sweetness: 0.2 },
  ["traditional method sparkling"],
);
any("demi sec", "sparkling", ["demi sec", "doux", "dolce"], { sweetness: 3 }, ["traditional method sparkling"]);
any("extra dry", "sparkling", ["extra dry", "extra sec", "extra seco"], { sweetness: 1.6 }, [
  "tank method sparkling",
]);
// Words that mark a skin-contact white, whatever the grape.
any(
  "orange wine",
  "orange",
  ["orange wine", "skin contact", "amber wine", "qvevri", "kvevri", "ramato"],
  { tannin: 2.6, intensity: 3.8 },
  ["orange"],
);

export const APPELLATION_RULES: readonly WineStyleRule[] = rules;
