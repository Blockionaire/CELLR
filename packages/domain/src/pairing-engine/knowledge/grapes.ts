import type { WineType } from "../../cellar";
import type { WineStructure, WineStyleRule } from "../wine";

/**
 * GRAPES: what a grape usually gives in one colour, wherever it grows. A grape overrides its region and is
 * overridden by its appellation. Synonyms are listed in `names`; the longest name mentioned wins, so
 * "cabernet franc" is never read as "cabernet". Judgements on a coarse scale, not measurements.
 */

const rules: WineStyleRule[] = [];

function grape(
  id: string,
  type: WineType,
  names: readonly string[],
  s: Partial<WineStructure>,
  keys: readonly string[],
) {
  rules.push({ id, kind: "grape", names, type, s, keys });
}

// ---- Red ----
grape(
  "cabernet sauvignon",
  "red",
  ["cabernet sauvignon", "cabernet", "cab sauv"],
  { body: 4.3, tannin: 4.3, acidity: 3.6, intensity: 4, oak: 1.8, alcohol: 2.7 },
  ["full red", "tannic red"],
);
grape(
  "merlot",
  "red",
  ["merlot"],
  { body: 3.8, tannin: 3, acidity: 3.2, intensity: 3.5, oak: 1.3, alcohol: 2.6 },
  ["medium red"],
);
grape(
  "cabernet franc",
  "red",
  ["cabernet franc", "breton"],
  { body: 3, tannin: 3, acidity: 3.9, intensity: 3.5, oak: 0.8, alcohol: 2.2 },
  ["medium red"],
);
grape(
  "pinot noir",
  "red",
  ["pinot noir", "spatburgunder", "spaetburgunder", "pinot nero", "blauburgunder"],
  { body: 2.8, tannin: 2.3, acidity: 3.9, intensity: 3.3, oak: 1, alcohol: 2.3 },
  ["light red"],
);
grape(
  "syrah",
  "red",
  ["syrah", "shiraz"],
  { body: 4.2, tannin: 3.6, acidity: 3.3, intensity: 4.3, oak: 1.3, alcohol: 2.8 },
  ["full red"],
);
grape(
  "grenache",
  "red",
  ["grenache", "garnacha", "garnacha tinta", "garnatxa", "cannonau", "grenache noir"],
  { body: 4, tannin: 2.5, acidity: 2.8, intensity: 3.8, oak: 0.5, alcohol: 3 },
  ["full red"],
);
grape(
  "mourvedre",
  "red",
  ["mourvedre", "monastrell", "mataro"],
  { body: 4.3, tannin: 4, acidity: 3.2, intensity: 4, oak: 0.8, alcohol: 2.9 },
  ["full red", "tannic red"],
);
grape(
  "tempranillo",
  "red",
  [
    "tempranillo",
    "tinta de toro",
    "tinto fino",
    "tinta del pais",
    "tinta roriz",
    "aragonez",
    "cencibel",
    "ull de llebre",
  ],
  { body: 3.7, tannin: 3.5, acidity: 3.5, intensity: 3.5, oak: 1.8, alcohol: 2.6 },
  ["medium red"],
);
// "Brunello" is Montalcino's name for sangiovese; the two Montepulciano wines below are sangiovese too, and are
// listed here so they are not read as the montepulciano grape.
grape(
  "sangiovese",
  "red",
  [
    "sangiovese",
    "sangioveto",
    "brunello",
    "prugnolo gentile",
    "morellino",
    "vino nobile di montepulciano",
    "rosso di montepulciano",
  ],
  { body: 3.4, tannin: 3.7, acidity: 4.2, intensity: 3.5, oak: 1, alcohol: 2.6 },
  ["medium red"],
);
grape(
  "nebbiolo",
  "red",
  ["nebbiolo", "spanna", "chiavennasca"],
  { body: 3.8, tannin: 4.7, acidity: 4.4, intensity: 4.3, oak: 1, alcohol: 2.8 },
  ["tannic red"],
);
grape(
  "barbera",
  "red",
  ["barbera"],
  { body: 3.2, tannin: 2, acidity: 4.4, intensity: 3.5, oak: 0.8, alcohol: 2.6 },
  ["medium red"],
);
grape(
  "dolcetto",
  "red",
  ["dolcetto"],
  { body: 3, tannin: 3, acidity: 3.1, intensity: 3, oak: 0, alcohol: 2.3 },
  ["medium red"],
);
grape(
  "gamay",
  "red",
  ["gamay", "gamay noir"],
  { body: 2.2, tannin: 1.5, acidity: 3.9, intensity: 3, oak: 0.2, alcohol: 2 },
  ["light red"],
);
grape(
  "malbec",
  "red",
  ["malbec", "cot"],
  { body: 4.2, tannin: 3.8, acidity: 3.3, intensity: 4, oak: 1.5, alcohol: 2.8 },
  ["full red"],
);
grape(
  "zinfandel",
  "red",
  ["zinfandel", "primitivo", "tribidrag", "crljenak kastelanski"],
  { body: 4.4, tannin: 3, acidity: 3, sweetness: 0.8, intensity: 4.3, oak: 1.3, alcohol: 3 },
  ["full red"],
);
grape(
  "carmenere",
  "red",
  ["carmenere"],
  { body: 3.8, tannin: 3.2, acidity: 3.2, intensity: 3.8, oak: 1.3, alcohol: 2.7 },
  ["full red"],
);
grape(
  "pinotage",
  "red",
  ["pinotage"],
  { body: 4, tannin: 3.4, acidity: 3.3, intensity: 4, oak: 1.3, alcohol: 2.8 },
  ["full red"],
);
grape(
  "corvina",
  "red",
  ["corvina", "corvina veronese", "corvinone"],
  { body: 2.7, tannin: 2.2, acidity: 3.9, intensity: 3, oak: 0.3, alcohol: 2.1 },
  ["light red"],
);
grape(
  "montepulciano",
  "red",
  ["montepulciano"],
  { body: 3.7, tannin: 3.3, acidity: 3.4, intensity: 3.5, oak: 0.7, alcohol: 2.6 },
  ["medium red"],
);
grape(
  "nero d avola",
  "red",
  ["nero d avola", "calabrese"],
  { body: 3.8, tannin: 3, acidity: 3.3, intensity: 3.7, oak: 0.8, alcohol: 2.7 },
  ["full red"],
);
grape(
  "aglianico",
  "red",
  ["aglianico"],
  { body: 4.2, tannin: 4.5, acidity: 4.2, intensity: 4, oak: 1.2, alcohol: 2.8 },
  ["tannic red"],
);
grape(
  "negroamaro",
  "red",
  ["negroamaro", "negro amaro"],
  { body: 4, tannin: 3, acidity: 3, intensity: 3.8, oak: 0.8, alcohol: 2.8 },
  ["full red"],
);
grape(
  "touriga nacional",
  "red",
  ["touriga nacional", "touriga"],
  { body: 4.3, tannin: 4, acidity: 3.6, intensity: 4.5, oak: 1.3, alcohol: 2.8 },
  ["full red", "tannic red"],
);
grape(
  "blaufrankisch",
  "red",
  ["blaufrankisch", "blaufraenkisch", "lemberger", "kekfrankos", "frankovka"],
  { body: 3.2, tannin: 3.2, acidity: 4.1, intensity: 3.5, oak: 0.9, alcohol: 2.3 },
  ["medium red"],
);
grape(
  "zweigelt",
  "red",
  ["zweigelt", "blauer zweigelt", "rotburger"],
  { body: 2.8, tannin: 2.3, acidity: 3.7, intensity: 3.1, oak: 0.5, alcohol: 2.2 },
  ["light red"],
);
grape(
  "st laurent",
  "red",
  ["st laurent", "sankt laurent", "svatovavrinecke"],
  { body: 3, tannin: 2.5, acidity: 3.7, intensity: 3.3, oak: 0.8, alcohol: 2.3 },
  ["medium red"],
);
grape(
  "carignan",
  "red",
  ["carignan", "carignane", "carignano", "mazuelo", "samso"],
  { body: 3.8, tannin: 3.5, acidity: 3.6, intensity: 3.6, oak: 0.6, alcohol: 2.7 },
  ["full red"],
);
grape(
  "cinsault",
  "red",
  ["cinsault", "cinsaut"],
  { body: 2.5, tannin: 2, acidity: 3.3, intensity: 3, oak: 0.3, alcohol: 2.3 },
  ["light red"],
);
grape(
  "mencia",
  "red",
  ["mencia"],
  { body: 3, tannin: 2.8, acidity: 3.8, intensity: 3.6, oak: 0.8, alcohol: 2.4 },
  ["medium red"],
);
grape(
  "petit verdot",
  "red",
  ["petit verdot"],
  { body: 4.5, tannin: 4.5, acidity: 3.6, intensity: 4.3, oak: 1.7, alcohol: 2.8 },
  ["full red", "tannic red"],
);
grape(
  "petite sirah",
  "red",
  ["petite sirah", "petite syrah", "durif"],
  { body: 4.6, tannin: 4.6, acidity: 3.2, intensity: 4.4, oak: 1.6, alcohol: 3 },
  ["full red", "tannic red"],
);
grape(
  "tannat",
  "red",
  ["tannat"],
  { body: 4.6, tannin: 5, acidity: 3.8, intensity: 4, oak: 1.4, alcohol: 2.8 },
  ["tannic red"],
);
grape(
  "xinomavro",
  "red",
  ["xinomavro"],
  { body: 3.3, tannin: 4.5, acidity: 4.4, intensity: 4, oak: 1, alcohol: 2.4 },
  ["tannic red"],
);
grape(
  "agiorgitiko",
  "red",
  ["agiorgitiko", "aghiorghitiko"],
  { body: 3.8, tannin: 3.3, acidity: 3.3, intensity: 3.8, oak: 1.1, alcohol: 2.6 },
  ["medium red"],
);
grape(
  "lagrein",
  "red",
  ["lagrein"],
  { body: 3.8, tannin: 3.3, acidity: 3.5, intensity: 3.7, oak: 0.8, alcohol: 2.5 },
  ["medium red"],
);
grape(
  "nerello mascalese",
  "red",
  ["nerello mascalese", "nerello"],
  { body: 2.9, tannin: 3.5, acidity: 4.2, intensity: 3.5, oak: 0.6, alcohol: 2.4 },
  ["medium red"],
);
grape(
  "sagrantino",
  "red",
  ["sagrantino"],
  { body: 4.5, tannin: 5, acidity: 3.8, intensity: 4.2, oak: 1.4, alcohol: 2.9 },
  ["tannic red"],
);
grape(
  "baga",
  "red",
  ["baga"],
  { body: 3.4, tannin: 4.3, acidity: 4.3, intensity: 3.6, oak: 0.8, alcohol: 2.3 },
  ["tannic red"],
);

// ---- White ----
// Chardonnay is whatever the winemaker makes it; a middle between Chablis and Napa.
grape(
  "chardonnay",
  "white",
  ["chardonnay", "morillon"],
  { body: 3.3, acidity: 3.6, intensity: 3, oak: 1.3, alcohol: 2.4 },
  ["rich white"],
);
grape(
  "sauvignon blanc",
  "white",
  ["sauvignon blanc", "sauvignon", "fume blanc", "muskat sylvaner"],
  { body: 2.2, acidity: 4.3, intensity: 4, oak: 0.3, alcohol: 2.1 },
  ["crisp white", "aromatic white"],
);
grape(
  "riesling",
  "white",
  ["riesling", "rheinriesling", "johannisberg riesling", "weisser riesling"],
  { body: 2, acidity: 4.6, sweetness: 1, intensity: 4, oak: 0, alcohol: 1.8 },
  ["aromatic white", "crisp white"],
);
grape(
  "chenin blanc",
  "white",
  ["chenin blanc", "chenin", "steen", "pineau de la loire"],
  { body: 2.8, acidity: 4.4, sweetness: 1, intensity: 3.5, oak: 0.4, alcohol: 2.2 },
  ["crisp white"],
);
// One grape, two styles, and the spelling on the label says which. "Pinot gris" (Alsace, Baden, Oregon, New
// Zealand) is full, soft and often a little off-dry; "pinot grigio" is light, dry and neutral.
grape(
  "pinot gris",
  "white",
  ["pinot gris", "grauburgunder", "grauer burgunder", "rulandske sede", "szurkebarat"],
  { body: 3.4, acidity: 3, sweetness: 1.3, intensity: 3.4, oak: 0.2, alcohol: 2.5 },
  ["aromatic white", "rich white"],
);
grape(
  "pinot grigio",
  "white",
  ["pinot grigio"],
  { body: 2.2, acidity: 3.5, sweetness: 0.4, intensity: 2.2, oak: 0, alcohol: 2 },
  ["pinot gris", "crisp white"],
);
grape(
  "gewurztraminer",
  "white",
  ["gewurztraminer", "gewuerztraminer", "traminer", "traminer aromatico", "tramini"],
  { body: 3.8, acidity: 2.3, sweetness: 1.5, intensity: 5, oak: 0, alcohol: 2.6 },
  ["aromatic white"],
);
grape(
  "viognier",
  "white",
  ["viognier"],
  { body: 3.8, acidity: 2.3, sweetness: 0.5, intensity: 4.5, oak: 0.6, alcohol: 2.8 },
  ["aromatic white", "rich white"],
);
grape(
  "gruner veltliner",
  "white",
  ["gruner veltliner", "gruener veltliner", "veltliner", "gruner", "gruener"],
  { body: 2.6, acidity: 4, intensity: 3.3, oak: 0.2, alcohol: 2.2 },
  ["crisp white"],
);
grape(
  "albarino",
  "white",
  ["albarino", "alvarinho"],
  { body: 2.2, acidity: 4.4, intensity: 3.5, oak: 0, alcohol: 2 },
  ["crisp white"],
);
grape(
  "melon de bourgogne",
  "white",
  ["melon de bourgogne", "melon", "muscadet"],
  { body: 1.4, acidity: 4.6, intensity: 1.8, oak: 0, alcohol: 1.6 },
  ["crisp white"],
);
grape(
  "semillon",
  "white",
  ["semillon"],
  { body: 3.2, acidity: 3.2, intensity: 2.8, oak: 0.8, alcohol: 2.2 },
  ["rich white"],
);
grape(
  "marsanne",
  "white",
  ["marsanne"],
  { body: 4, acidity: 2.5, intensity: 3, oak: 0.6, alcohol: 2.7 },
  ["rich white"],
);
grape(
  "roussanne",
  "white",
  ["roussanne"],
  { body: 3.8, acidity: 2.8, intensity: 3.5, oak: 0.7, alcohol: 2.7 },
  ["rich white"],
);
grape(
  "verdejo",
  "white",
  ["verdejo"],
  { body: 2.3, acidity: 4, intensity: 3.5, oak: 0.2, alcohol: 2.2 },
  ["crisp white", "aromatic white"],
);
grape(
  "godello",
  "white",
  ["godello", "gouveio"],
  { body: 3, acidity: 3.7, intensity: 3, oak: 0.6, alcohol: 2.3 },
  ["rich white"],
);
grape(
  "viura",
  "white",
  ["viura", "macabeo", "macabeu"],
  { body: 2.5, acidity: 3.4, intensity: 2, oak: 0.5, alcohol: 2.1 },
  ["crisp white"],
);
grape(
  "assyrtiko",
  "white",
  ["assyrtiko", "asyrtiko"],
  { body: 2.8, acidity: 4.8, intensity: 3.3, oak: 0.2, alcohol: 2.6 },
  ["crisp white"],
);
grape(
  "furmint",
  "white",
  ["furmint", "sipon"],
  { body: 2.8, acidity: 4.6, intensity: 3.3, oak: 0.4, alcohol: 2.3 },
  ["crisp white"],
);
grape(
  "torrontes",
  "white",
  ["torrontes"],
  { body: 2.6, acidity: 3.3, intensity: 4.8, oak: 0, alcohol: 2.6 },
  ["aromatic white"],
);
// Dry muscat (Alsace, Austria, Spain) is the table wine; the sweet ones are dessert or fortified.
grape(
  "muscat",
  "white",
  [
    "muscat",
    "moscato",
    "moscatel",
    "muskateller",
    "gelber muskateller",
    "muscat blanc a petits grains",
  ],
  { body: 2.4, acidity: 3, sweetness: 1, intensity: 5, oak: 0, alcohol: 2 },
  ["aromatic white"],
);
grape(
  "vermentino",
  "white",
  ["vermentino", "rolle", "pigato", "favorita"],
  { body: 2.6, acidity: 3.6, intensity: 3, oak: 0, alcohol: 2.2 },
  ["crisp white"],
);
grape(
  "garganega",
  "white",
  ["garganega"],
  { body: 2.4, acidity: 3.6, intensity: 2.4, oak: 0.1, alcohol: 2 },
  ["crisp white"],
);
grape(
  "trebbiano",
  "white",
  ["trebbiano", "ugni blanc", "turbiana", "trebbiano di lugana"],
  { body: 2.2, acidity: 3.7, intensity: 2, oak: 0, alcohol: 2 },
  ["crisp white"],
);
grape(
  "cortese",
  "white",
  ["cortese"],
  { body: 2, acidity: 4, intensity: 2.2, oak: 0, alcohol: 2 },
  ["crisp white"],
);
grape(
  "arneis",
  "white",
  ["arneis"],
  { body: 2.7, acidity: 3.2, intensity: 3, oak: 0, alcohol: 2.2 },
  ["aromatic white"],
);
grape(
  "fiano",
  "white",
  ["fiano"],
  { body: 3.2, acidity: 3.7, intensity: 3.5, oak: 0.3, alcohol: 2.4 },
  ["rich white"],
);
grape(
  "greco",
  "white",
  ["greco", "greco bianco"],
  { body: 2.9, acidity: 4, intensity: 3.2, alcohol: 2.4 },
  ["crisp white"],
);
grape(
  "pinot blanc",
  "white",
  ["pinot blanc", "pinot bianco", "weissburgunder", "weisser burgunder", "klevner"],
  { body: 2.6, acidity: 3.4, intensity: 2.3, oak: 0.2, alcohol: 2.2 },
  ["crisp white"],
);
grape(
  "silvaner",
  "white",
  ["silvaner", "sylvaner", "gruner silvaner"],
  { body: 2.4, acidity: 3.7, intensity: 2, oak: 0, alcohol: 2.1 },
  ["crisp white"],
);
grape(
  "aligote",
  "white",
  ["aligote"],
  { body: 2, acidity: 4.4, intensity: 2, oak: 0, alcohol: 1.9 },
  ["crisp white"],
);
grape(
  "picpoul",
  "white",
  ["picpoul", "piquepoul"],
  { body: 2, acidity: 4.3, intensity: 2.3, oak: 0, alcohol: 2 },
  ["crisp white"],
);
grape(
  "savagnin",
  "white",
  ["savagnin"],
  { body: 3.3, acidity: 4, intensity: 4, oak: 0.3, alcohol: 2.5 },
  ["rich white"],
);
grape(
  "ribolla gialla",
  "white",
  ["ribolla gialla", "ribolla", "rebula"],
  { body: 2.4, acidity: 3.9, intensity: 2.5, oak: 0.2, alcohol: 2.1 },
  ["crisp white"],
);
grape(
  "grenache blanc",
  "white",
  ["grenache blanc", "garnacha blanca", "garnatxa blanca"],
  { body: 3.5, acidity: 2.8, intensity: 2.8, oak: 0.5, alcohol: 2.8 },
  ["rich white"],
);
grape(
  "malvasia",
  "white",
  ["malvasia", "malvasia bianca", "malvazija"],
  { body: 3, acidity: 3, intensity: 4, oak: 0.2, alcohol: 2.3 },
  ["aromatic white"],
);
grape(
  "chasselas",
  "white",
  ["chasselas", "fendant", "gutedel"],
  { body: 1.8, acidity: 3.2, intensity: 1.8, oak: 0, alcohol: 1.9 },
  ["crisp white"],
);

// ---- Rosé ----
grape(
  "grenache",
  "rose",
  ["grenache", "garnacha", "garnatxa", "cannonau"],
  { body: 2.2, tannin: 0.4, acidity: 3.4, intensity: 2.5, alcohol: 2.4 },
  ["dry rose"],
);

// ---- Orange (skin-contact white) ----
grape(
  "ribolla gialla",
  "orange",
  ["ribolla gialla", "ribolla", "rebula"],
  { body: 3.3, tannin: 2.5, acidity: 3.8, intensity: 3.8, alcohol: 2.3 },
  ["orange"],
);
grape(
  "rkatsiteli",
  "orange",
  ["rkatsiteli"],
  { body: 3.4, tannin: 3, acidity: 4, intensity: 4, alcohol: 2.3 },
  ["orange"],
);
grape(
  "pinot gris",
  "orange",
  ["pinot gris", "pinot grigio", "ramato"],
  { body: 2.8, tannin: 1.2, acidity: 3.4, intensity: 3, alcohol: 2.2 },
  ["orange"],
);

// ---- Sparkling, sweet and fortified ----
grape(
  "glera",
  "sparkling",
  ["glera"],
  { body: 1.8, acidity: 3.6, sweetness: 1.3, intensity: 2.7, alcohol: 1.8 },
  ["tank method sparkling"],
);
grape(
  "muscat",
  "sparkling",
  ["muscat", "moscato", "moscatel"],
  { body: 1.8, acidity: 3, sweetness: 3.5, intensity: 4.6, alcohol: 1 },
  ["tank method sparkling"],
);
grape(
  "muscat",
  "dessert",
  ["muscat", "moscato", "moscatel", "muskateller"],
  { body: 3.8, acidity: 3, sweetness: 4.3, intensity: 5, oak: 0, alcohol: 2.2 },
  ["sweet white"],
);
grape(
  "riesling",
  "dessert",
  ["riesling"],
  { body: 3.5, acidity: 4.8, sweetness: 4.5, intensity: 4.6, oak: 0, alcohol: 1.4 },
  ["sweet white"],
);
grape(
  "chenin blanc",
  "dessert",
  ["chenin blanc", "chenin"],
  { body: 3.8, acidity: 4.5, sweetness: 4.3, intensity: 4.3, oak: 0.3, alcohol: 2 },
  ["sweet white"],
);
grape(
  "semillon",
  "dessert",
  ["semillon"],
  { body: 4.5, acidity: 3.6, sweetness: 4.7, intensity: 4.4, oak: 1.4, alcohol: 2.6 },
  ["sweet white"],
);
grape(
  "palomino",
  "fortified",
  ["palomino", "palomino fino"],
  { body: 2.4, tannin: 0, acidity: 3.2, sweetness: 0, intensity: 3.8, oak: 0.2, alcohol: 4 },
  ["dry sherry"],
);
grape(
  "pedro ximenez",
  "fortified",
  ["pedro ximenez"],
  { body: 5, tannin: 0, acidity: 2.3, sweetness: 5, intensity: 5, oak: 0.5, alcohol: 4 },
  ["sweet sherry"],
);

export const GRAPE_RULES: readonly WineStyleRule[] = rules;
