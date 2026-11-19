import type { WineType } from "../../cellar";
import type { WineStructure, WineStyleRule } from "../wine";

/**
 * REGIONS: what a broad region (or a country read as a style) usually says about a wine of one colour. These are
 * the weakest rules: a grape or an appellation overrides any axis they state, so a region states only what holds
 * for most of its wines of that colour. Judgements on a coarse scale, not measurements.
 */

const rules: WineStyleRule[] = [];

function region(
  country: string,
  id: string,
  type: WineType | readonly WineType[],
  names: readonly string[],
  s: Partial<WineStructure>,
  keys: readonly string[],
) {
  for (const t of typeof type === "string" ? [type] : type)
    rules.push({ id, kind: "region", names, type: t, country, s, keys });
}

// ---- France ----
const LOIRE = ["loire", "val de loire", "loire valley"];
region("FR", "loire", "white", LOIRE, { body: 2.3, acidity: 4.3, intensity: 3, oak: 0.3, alcohol: 2 }, [
  "sauvignon blanc",
  "chenin blanc",
  "crisp white",
]);
region(
  "FR",
  "loire",
  "red",
  LOIRE,
  { body: 2.7, tannin: 2.6, acidity: 4, intensity: 3.2, oak: 0.5, alcohol: 2.1 },
  ["cabernet franc", "light red"],
);
// Loire rosé runs from dry Sancerre to the sweetish Rosé d'Anjou; a touch of sugar on average.
region("FR", "loire", "rose", LOIRE, { body: 1.8, tannin: 0.3, acidity: 3.9, sweetness: 1 }, ["dry rose"]);
region("FR", "loire", "sparkling", LOIRE, { body: 2, acidity: 4.5, sweetness: 0.8, intensity: 2.8 }, [
  "chenin blanc",
  "traditional method sparkling",
]);
const BURGUNDY = ["burgundy", "bourgogne"];
region(
  "FR",
  "burgundy",
  "red",
  BURGUNDY,
  { body: 3, tannin: 2.6, acidity: 3.9, intensity: 3.4, oak: 1.1, alcohol: 2.3 },
  ["pinot noir", "medium red"],
);
region("FR", "burgundy", "white", BURGUNDY, { body: 3, acidity: 3.9, intensity: 3, oak: 1, alcohol: 2.3 }, [
  "chardonnay",
]);
region(
  "FR",
  "bordeaux",
  "red",
  ["bordeaux", "bordelais"],
  { body: 3.9, tannin: 3.9, acidity: 3.6, intensity: 3.5, oak: 1.6, alcohol: 2.5 },
  ["cabernet sauvignon", "merlot", "full red"],
);
region("FR", "bordeaux", "white", ["bordeaux", "bordelais"], { body: 2.6, acidity: 3.9, intensity: 3.2, oak: 0.7 }, [
  "sauvignon blanc",
  "semillon",
]);
region(
  "FR",
  "bordeaux",
  "dessert",
  ["bordeaux", "bordelais"],
  { body: 4.3, acidity: 3.7, sweetness: 4.5, intensity: 4.3, oak: 1.2 },
  ["semillon", "sweet white"],
);
const RHONE = ["rhone", "rhone valley", "vallee du rhone"];
region(
  "FR",
  "rhone",
  "red",
  RHONE,
  { body: 4, tannin: 3.2, acidity: 3.1, intensity: 3.8, oak: 0.7, alcohol: 2.8 },
  ["grenache", "syrah", "full red"],
);
region("FR", "rhone", "white", RHONE, { body: 3.7, acidity: 2.8, intensity: 3.4, oak: 0.4, alcohol: 2.7 }, [
  "grenache blanc",
  "viognier",
  "rich white",
]);
region("FR", "rhone", "rose", RHONE, { body: 2.5, tannin: 0.8, acidity: 3.3, intensity: 2.6, alcohol: 2.5 }, [
  "grenache",
  "dry rose",
]);
const LANGUEDOC = ["languedoc", "languedoc roussillon", "roussillon", "pays d oc", "sud de france"];
region(
  "FR",
  "languedoc",
  "red",
  LANGUEDOC,
  { body: 3.9, tannin: 3.2, acidity: 3.1, intensity: 3.6, oak: 0.7, alcohol: 2.8 },
  ["grenache", "syrah", "carignan", "full red"],
);
region("FR", "languedoc", "white", LANGUEDOC, { body: 2.8, acidity: 3.3, intensity: 2.8, alcohol: 2.3 }, []);
region("FR", "languedoc", "rose", LANGUEDOC, { body: 2, tannin: 0.4, acidity: 3.5, intensity: 2.2 }, [
  "dry rose",
]);
region(
  "FR",
  "provence",
  "rose",
  ["provence"],
  { body: 1.7, tannin: 0.2, acidity: 3.8, sweetness: 0.3, intensity: 2, oak: 0, alcohol: 2 },
  ["grenache", "cinsault", "dry rose"],
);
region(
  "FR",
  "provence",
  "red",
  ["provence"],
  { body: 3.8, tannin: 3.5, acidity: 3.3, intensity: 3.5, alcohol: 2.6 },
  ["mourvedre", "grenache", "full red"],
);
// Alsace whites span grapes; the grape rule refines aroma and sweetness.
region(
  "FR",
  "alsace",
  "white",
  ["alsace", "elsass"],
  { body: 3, acidity: 3.6, sweetness: 1, intensity: 3.8, oak: 0.2, alcohol: 2.4 },
  ["riesling", "pinot gris", "gewurztraminer", "aromatic white"],
);
region(
  "FR",
  "beaujolais",
  "red",
  ["beaujolais"],
  { body: 2.3, tannin: 1.6, acidity: 3.8, intensity: 3, oak: 0.2, alcohol: 2 },
  ["gamay", "light red"],
);
region(
  "FR",
  "champagne",
  "sparkling",
  ["champagne"],
  { body: 2.5, acidity: 4.6, sweetness: 0.8, intensity: 3, oak: 0.2, alcohol: 2, fizz: true },
  ["chardonnay", "pinot noir", "traditional method sparkling"],
);
region("FR", "jura", "white", ["jura"], { body: 3.2, acidity: 4.1, intensity: 3.8, oak: 0.3, alcohol: 2.3 }, [
  "savagnin",
  "chardonnay",
]);
region("FR", "jura", "red", ["jura"], { body: 2.2, tannin: 1.8, acidity: 3.8, intensity: 3, oak: 0.4 }, [
  "light red",
]);
region(
  "FR",
  "savoie",
  "white",
  ["savoie", "savoy"],
  { body: 1.7, acidity: 4.2, intensity: 1.9, oak: 0, alcohol: 1.8 },
  ["crisp white"],
);
region(
  "FR",
  "south west france",
  "red",
  ["sud ouest", "south west france", "southwest france"],
  { body: 4, tannin: 4, acidity: 3.6, intensity: 3.6, oak: 1.2, alcohol: 2.6 },
  ["malbec", "tannat", "tannic red"],
);

// ---- Italy ----
region(
  "IT",
  "piedmont",
  "red",
  ["piedmont", "piemonte"],
  { body: 3.5, tannin: 3.6, acidity: 4.3, intensity: 3.8, oak: 0.8, alcohol: 2.6 },
  ["nebbiolo", "barbera", "medium red"],
);
region("IT", "piedmont", "white", ["piedmont", "piemonte"], { body: 2.3, acidity: 3.8, intensity: 2.5 }, [
  "cortese",
  "arneis",
]);
region(
  "IT",
  "tuscany",
  "red",
  ["tuscany", "toscana"],
  { body: 3.6, tannin: 3.6, acidity: 4.1, intensity: 3.5, oak: 1.2, alcohol: 2.6 },
  ["sangiovese", "medium red"],
);
region("IT", "tuscany", "white", ["tuscany", "toscana"], { body: 2.4, acidity: 3.6, intensity: 2.4 }, [
  "vermentino",
  "trebbiano",
]);
region(
  "IT",
  "veneto",
  "red",
  ["veneto"],
  { body: 2.9, tannin: 2.4, acidity: 3.8, intensity: 3, oak: 0.5, alcohol: 2.3 },
  ["corvina", "medium red"],
);
region("IT", "veneto", "white", ["veneto"], { body: 2.1, acidity: 3.6, intensity: 2.1, oak: 0, alcohol: 2 }, [
  "garganega",
  "pinot gris",
]);
region(
  "IT",
  "friuli",
  "white",
  ["friuli", "friuli venezia giulia"],
  { body: 2.8, acidity: 3.8, intensity: 3, oak: 0.3, alcohol: 2.3 },
  [],
);
// Friuli and the Slovenian border are where modern skin-contact white began.
region(
  "IT",
  "friuli",
  "orange",
  ["friuli", "friuli venezia giulia", "collio", "carso", "oslavia"],
  { body: 3.4, tannin: 2.6, acidity: 3.8, intensity: 4 },
  ["ribolla gialla", "orange"],
);
region(
  "IT",
  "sicily",
  "red",
  ["sicily", "sicilia"],
  { body: 3.9, tannin: 3, acidity: 3.4, intensity: 3.6, alcohol: 2.8 },
  ["nero d avola", "full red"],
);
region("IT", "sicily", "white", ["sicily", "sicilia"], { body: 2.7, acidity: 3.3, intensity: 2.7, alcohol: 2.3 }, []);
region(
  "IT",
  "puglia",
  "red",
  ["puglia", "apulia", "salento"],
  { body: 4.3, tannin: 3, acidity: 2.9, sweetness: 0.8, intensity: 4, oak: 0.8, alcohol: 3 },
  ["zinfandel", "negroamaro", "full red"],
);
region(
  "IT",
  "sardinia",
  "white",
  ["sardinia", "sardegna"],
  { body: 2.5, acidity: 3.4, intensity: 2.8, alcohol: 2.3 },
  ["vermentino"],
);
region(
  "IT",
  "sardinia",
  "red",
  ["sardinia", "sardegna"],
  { body: 3.9, tannin: 2.9, acidity: 3.2, intensity: 3.6, alcohol: 2.9 },
  ["grenache"],
);
region(
  "IT",
  "abruzzo",
  "red",
  ["abruzzo", "abruzzi"],
  { body: 3.7, tannin: 3.2, acidity: 3.4, intensity: 3.4, alcohol: 2.6 },
  ["montepulciano", "medium red"],
);
region(
  "IT",
  "campania",
  "red",
  ["campania", "irpinia"],
  { body: 4, tannin: 4.2, acidity: 4, intensity: 3.9, alcohol: 2.7 },
  ["aglianico", "tannic red"],
);

// ---- Spain ----
region(
  "ES",
  "rioja",
  "red",
  ["rioja", "la rioja", "rioja alavesa", "rioja oriental", "rioja baja"],
  { body: 3.5, tannin: 3.3, acidity: 3.6, intensity: 3.4, oak: 1.9, alcohol: 2.5 },
  ["tempranillo", "medium red"],
);
region("ES", "rioja", "white", ["rioja", "la rioja"], { body: 2.7, acidity: 3.5, intensity: 2.5, oak: 0.9 }, [
  "viura",
]);
region(
  "ES",
  "ribera del duero",
  "red",
  ["ribera del duero", "castilla y leon"],
  { body: 4.2, tannin: 4, acidity: 3.6, intensity: 4, oak: 2, alcohol: 2.8 },
  ["tempranillo", "full red"],
);
region(
  "ES",
  "priorat",
  "red",
  ["priorat", "priorato", "catalunya", "catalonia"],
  { body: 4.5, tannin: 3.9, acidity: 3.5, intensity: 4.3, oak: 1.6, alcohol: 3 },
  ["grenache", "carignan", "full red"],
);
region(
  "ES",
  "galicia",
  "white",
  ["galicia", "galicia spain"],
  { body: 2.2, acidity: 4.4, intensity: 3.2, oak: 0, alcohol: 2 },
  ["albarino", "godello", "crisp white"],
);
region(
  "ES",
  "navarra",
  "rose",
  ["navarra", "navarre"],
  { body: 2.4, tannin: 0.6, acidity: 3.5, intensity: 2.6 },
  ["grenache", "dry rose"],
);
region(
  "ES",
  "navarra",
  "red",
  ["navarra", "navarre"],
  { body: 3.6, tannin: 3.1, acidity: 3.4, intensity: 3.3, oak: 1.2, alcohol: 2.6 },
  ["tempranillo", "grenache"],
);
// Sherry country makes every style from bone dry to syrup; the sherry appellation rules decide.
region("ES", "jerez", "fortified", ["jerez", "andalucia", "andalusia", "sanlucar de barrameda"], { tannin: 0 }, [
  "palomino",
]);

// ---- Portugal ----
region(
  "PT",
  "douro",
  "red",
  ["douro", "douro valley"],
  { body: 4.2, tannin: 3.9, acidity: 3.6, intensity: 4, oak: 1.4, alcohol: 2.8 },
  ["touriga nacional", "full red"],
);
region(
  "PT",
  "douro",
  "fortified",
  ["douro", "douro valley"],
  { body: 4.5, tannin: 2.8, acidity: 3.2, sweetness: 4.2, intensity: 4.6, alcohol: 4 },
  ["touriga nacional", "port"],
);
region(
  "PT",
  "vinho verde",
  "white",
  ["minho", "vinho verde region"],
  { body: 1.4, acidity: 4.5, sweetness: 0.8, intensity: 2.3, oak: 0, alcohol: 1.2 },
  ["albarino", "crisp white"],
);
region(
  "PT",
  "alentejo",
  "red",
  ["alentejo", "alentejano"],
  { body: 4.1, tannin: 3.2, acidity: 3, intensity: 3.8, oak: 1.2, alcohol: 2.8 },
  ["full red"],
);
region(
  "PT",
  "madeira",
  "fortified",
  ["madeira island", "ilha da madeira"],
  { body: 3.5, tannin: 0, acidity: 4.7, intensity: 5, alcohol: 4 },
  ["sweet fortified"],
);

// ---- Germany ----
// German riesling regions: the Prädikat and "trocken" words on the label decide sweetness and win over these.
region(
  "DE",
  "mosel",
  "white",
  ["mosel", "mosel saar ruwer", "saar", "ruwer"],
  { body: 1.6, acidity: 4.7, sweetness: 1.8, intensity: 3.6, oak: 0, alcohol: 1.4 },
  ["riesling", "off-dry white"],
);
region(
  "DE",
  "rheingau",
  "white",
  ["rheingau"],
  { body: 2.4, acidity: 4.4, sweetness: 1.2, intensity: 3.6, oak: 0, alcohol: 1.8 },
  ["riesling"],
);
region(
  "DE",
  "pfalz",
  "white",
  ["pfalz", "palatinate"],
  { body: 2.8, acidity: 4, sweetness: 0.7, intensity: 3.5, oak: 0.2, alcohol: 2.2 },
  ["riesling"],
);
region(
  "DE",
  "nahe",
  "white",
  ["nahe"],
  { body: 2.2, acidity: 4.4, sweetness: 1.3, intensity: 3.6, oak: 0, alcohol: 1.7 },
  ["riesling"],
);
region(
  "DE",
  "rheinhessen",
  "white",
  ["rheinhessen"],
  { body: 2.6, acidity: 4, sweetness: 1, intensity: 3.2, oak: 0.1, alcohol: 2 },
  ["riesling", "silvaner"],
);
region(
  "DE",
  "germany",
  "white",
  ["germany", "deutschland"],
  { body: 2.1, acidity: 4.4, sweetness: 1.2, intensity: 3.4, oak: 0, alcohol: 1.7 },
  ["riesling"],
);
region(
  "DE",
  "baden",
  "red",
  ["baden", "ahr"],
  { body: 3, tannin: 2.3, acidity: 3.7, intensity: 3.2, oak: 1, alcohol: 2.4 },
  ["pinot noir", "medium red"],
);

// ---- Austria ----
region(
  "AT",
  "wachau",
  "white",
  ["wachau"],
  { body: 2.9, acidity: 4.1, sweetness: 0.3, intensity: 3.5, oak: 0.1, alcohol: 2.3 },
  ["gruner veltliner", "riesling"],
);
region(
  "AT",
  "kamptal",
  "white",
  ["kamptal", "kremstal", "traisental", "niederosterreich", "niederoesterreich", "lower austria"],
  { body: 2.7, acidity: 4.1, sweetness: 0.3, intensity: 3.3, oak: 0.2, alcohol: 2.2 },
  ["gruner veltliner", "riesling"],
);
region(
  "AT",
  "austria",
  "white",
  ["austria", "osterreich", "oesterreich"],
  { body: 2.5, acidity: 4, sweetness: 0.4, intensity: 3, oak: 0.1, alcohol: 2.1 },
  ["gruner veltliner", "crisp white"],
);
region(
  "AT",
  "burgenland",
  "red",
  ["burgenland", "mittelburgenland", "sudburgenland", "neusiedlersee", "carnuntum"],
  { body: 3.4, tannin: 3.1, acidity: 3.9, intensity: 3.5, oak: 1.1, alcohol: 2.4 },
  ["blaufrankisch", "zweigelt", "medium red"],
);
region(
  "AT",
  "burgenland",
  "dessert",
  ["burgenland", "neusiedlersee", "seewinkel"],
  { body: 4.2, acidity: 4, sweetness: 4.6, intensity: 4.5, oak: 0.5, alcohol: 1.8 },
  ["sweet white"],
);

// ---- Hungary ----
region(
  "HU",
  "tokaj",
  "white",
  ["tokaj", "tokaj hegyalja"],
  { body: 2.8, acidity: 4.5, sweetness: 0.6, intensity: 3.4, oak: 0.4, alcohol: 2.2 },
  ["furmint"],
);
region(
  "HU",
  "tokaj",
  "dessert",
  ["tokaj", "tokaj hegyalja"],
  { body: 4.3, acidity: 4.7, sweetness: 4.6, intensity: 4.8, oak: 0.8, alcohol: 1.8 },
  ["furmint", "sweet white"],
);

// ---- United States ----
region(
  "US",
  "napa",
  "red",
  ["napa", "napa county"],
  { body: 4.6, tannin: 4.1, acidity: 3, sweetness: 0.6, intensity: 4.5, oak: 2.3, alcohol: 3 },
  ["cabernet sauvignon", "full red"],
);
region(
  "US",
  "napa",
  "white",
  ["napa", "napa county"],
  { body: 3.8, acidity: 3.1, sweetness: 0.6, intensity: 3.6, oak: 1.9, alcohol: 2.8 },
  ["chardonnay", "oaked white"],
);
region(
  "US",
  "sonoma",
  "red",
  ["sonoma", "sonoma county"],
  { body: 3.8, tannin: 3, acidity: 3.4, intensity: 3.9, oak: 1.7, alcohol: 2.8 },
  ["pinot noir", "zinfandel", "cabernet sauvignon"],
);
region(
  "US",
  "sonoma",
  "white",
  ["sonoma", "sonoma county"],
  { body: 3.5, acidity: 3.4, intensity: 3.4, oak: 1.6, alcohol: 2.7 },
  ["chardonnay"],
);
region(
  "US",
  "california",
  "red",
  ["california", "central coast", "north coast"],
  { body: 4.2, tannin: 3.4, acidity: 3, sweetness: 0.8, intensity: 4, oak: 1.9, alcohol: 3 },
  ["cabernet sauvignon", "zinfandel", "full red"],
);
region(
  "US",
  "california",
  "white",
  ["california", "central coast", "north coast"],
  { body: 3.6, acidity: 3.1, sweetness: 0.8, intensity: 3.3, oak: 1.6, alcohol: 2.7 },
  ["chardonnay"],
);
region(
  "US",
  "oregon",
  "red",
  ["oregon"],
  { body: 2.8, tannin: 2.3, acidity: 3.9, intensity: 3.4, oak: 1.1, alcohol: 2.3 },
  ["pinot noir", "light red"],
);
region("US", "oregon", "white", ["oregon"], { body: 2.9, acidity: 3.9, intensity: 3, oak: 0.8, alcohol: 2.3 }, [
  "chardonnay",
  "pinot gris",
]);
region(
  "US",
  "washington",
  "red",
  ["washington", "washington state"],
  { body: 4.1, tannin: 3.8, acidity: 3.5, intensity: 3.9, oak: 1.8, alcohol: 2.9 },
  ["cabernet sauvignon", "merlot", "syrah", "full red"],
);

// ---- South America ----
region(
  "AR",
  "mendoza",
  "red",
  ["mendoza", "cuyo"],
  { body: 4.3, tannin: 3.8, acidity: 3.2, intensity: 4.1, oak: 1.6, alcohol: 3 },
  ["malbec", "full red"],
);
region(
  "AR",
  "argentina",
  "red",
  ["argentina"],
  { body: 4.2, tannin: 3.7, acidity: 3.2, intensity: 4, oak: 1.5, alcohol: 2.9 },
  ["malbec", "full red"],
);
region(
  "CL",
  "chile",
  "red",
  ["chile", "valle central", "central valley chile", "maipo", "colchagua", "rapel"],
  { body: 4, tannin: 3.5, acidity: 3.4, intensity: 3.9, oak: 1.5, alcohol: 2.8 },
  ["cabernet sauvignon", "carmenere", "full red"],
);
region(
  "CL",
  "chile",
  "white",
  ["chile", "valle central", "central valley chile"],
  { body: 2.5, acidity: 3.9, intensity: 3.5, oak: 0.4, alcohol: 2.2 },
  ["sauvignon blanc", "chardonnay"],
);

// ---- Australia and New Zealand ----
region(
  "AU",
  "barossa",
  "red",
  ["barossa", "barossa zone"],
  { body: 4.8, tannin: 3.6, acidity: 2.9, sweetness: 0.8, intensity: 4.7, oak: 2, alcohol: 3 },
  ["syrah", "full red"],
);
region(
  "AU",
  "mclaren vale",
  "red",
  ["mclaren vale", "fleurieu"],
  { body: 4.5, tannin: 3.5, acidity: 3, sweetness: 0.6, intensity: 4.4, oak: 1.7, alcohol: 3 },
  ["syrah", "grenache", "full red"],
);
region(
  "AU",
  "margaret river",
  "red",
  ["margaret river", "western australia"],
  { body: 4, tannin: 3.9, acidity: 3.6, intensity: 4, oak: 1.8, alcohol: 2.7 },
  ["cabernet sauvignon", "full red"],
);
region(
  "AU",
  "margaret river",
  "white",
  ["margaret river", "western australia"],
  { body: 3.3, acidity: 3.8, intensity: 3.5, oak: 1.3, alcohol: 2.5 },
  ["chardonnay", "semillon"],
);
region(
  "AU",
  "hunter",
  "white",
  ["hunter valley", "new south wales"],
  { body: 1.8, acidity: 4.3, intensity: 2.5, oak: 0.2, alcohol: 1.4 },
  ["semillon", "crisp white"],
);
region(
  "AU",
  "hunter",
  "red",
  ["hunter valley"],
  { body: 3, tannin: 2.6, acidity: 3.5, intensity: 3.4, oak: 1, alcohol: 2.4 },
  ["syrah", "medium red"],
);
region(
  "AU",
  "australia",
  "red",
  ["australia", "south australia", "south eastern australia"],
  { body: 4.3, tannin: 3.3, acidity: 3, sweetness: 0.8, intensity: 4.2, oak: 1.7, alcohol: 2.9 },
  ["syrah", "full red"],
);
region(
  "AU",
  "australia",
  "white",
  ["australia", "south australia", "south eastern australia"],
  { body: 3.2, acidity: 3.6, sweetness: 0.6, intensity: 3.3, oak: 1.1, alcohol: 2.4 },
  ["chardonnay"],
);
region(
  "NZ",
  "marlborough",
  "white",
  ["marlborough"],
  { body: 2.2, acidity: 4.4, sweetness: 0.6, intensity: 4.4, oak: 0.2, alcohol: 2.2 },
  ["sauvignon blanc", "aromatic white"],
);
region(
  "NZ",
  "marlborough",
  "red",
  ["marlborough"],
  { body: 2.8, tannin: 2.2, acidity: 3.9, intensity: 3.5, oak: 1, alcohol: 2.3 },
  ["pinot noir", "light red"],
);
region(
  "NZ",
  "central otago",
  "red",
  ["central otago", "otago"],
  { body: 3.3, tannin: 2.5, acidity: 3.8, intensity: 4, oak: 1.2, alcohol: 2.6 },
  ["pinot noir", "medium red"],
);
region(
  "NZ",
  "new zealand",
  "white",
  ["new zealand", "aotearoa"],
  { body: 2.4, acidity: 4.3, sweetness: 0.6, intensity: 4, oak: 0.3, alcohol: 2.2 },
  ["sauvignon blanc", "crisp white"],
);
region(
  "NZ",
  "new zealand",
  "red",
  ["new zealand", "aotearoa"],
  { body: 3, tannin: 2.4, acidity: 3.8, intensity: 3.6, oak: 1.1, alcohol: 2.4 },
  ["pinot noir"],
);
region(
  "NZ",
  "hawkes bay",
  "red",
  ["hawke s bay", "hawkes bay"],
  { body: 3.8, tannin: 3.4, acidity: 3.6, intensity: 3.8, oak: 1.5, alcohol: 2.5 },
  ["merlot", "syrah", "medium red"],
);

// ---- South Africa ----
region(
  "ZA",
  "stellenbosch",
  "red",
  ["stellenbosch"],
  { body: 4.2, tannin: 3.9, acidity: 3.4, intensity: 4, oak: 1.8, alcohol: 2.8 },
  ["cabernet sauvignon", "full red"],
);
region(
  "ZA",
  "south africa",
  "red",
  ["south africa", "western cape", "coastal region", "paarl", "franschhoek"],
  { body: 4, tannin: 3.4, acidity: 3.3, intensity: 3.9, oak: 1.5, alcohol: 2.8 },
  ["pinotage", "syrah", "full red"],
);
region(
  "ZA",
  "south africa",
  "white",
  ["south africa", "western cape", "coastal region", "paarl", "franschhoek", "stellenbosch"],
  { body: 2.9, acidity: 3.8, intensity: 3.3, oak: 0.6, alcohol: 2.4 },
  ["chenin blanc"],
);

// ---- Eastern Mediterranean ----
region(
  "GR",
  "greece",
  "white",
  ["greece", "hellas", "aegean"],
  { body: 2.6, acidity: 4.1, intensity: 3.1, oak: 0.2, alcohol: 2.3 },
  ["assyrtiko", "crisp white"],
);
region(
  "GR",
  "greece",
  "red",
  ["greece", "hellas", "macedonia greece"],
  { body: 3.5, tannin: 3.7, acidity: 3.9, intensity: 3.7, oak: 1.1, alcohol: 2.5 },
  ["xinomavro", "agiorgitiko"],
);
region(
  "LB",
  "lebanon",
  "red",
  ["lebanon", "liban", "bekaa"],
  { body: 4, tannin: 3.4, acidity: 3.3, intensity: 4, oak: 1.3, alcohol: 2.8 },
  ["cabernet sauvignon", "cinsault", "full red"],
);
// Georgian amber wine from clay qvevri: firm skin tannin.
region(
  "GE",
  "georgia",
  "orange",
  ["georgia", "kakheti", "sakartvelo"],
  { body: 3.5, tannin: 3.2, acidity: 3.8, intensity: 4.2 },
  ["rkatsiteli", "orange"],
);

// ---- England ----
region(
  "GB",
  "england",
  "sparkling",
  ["england", "english", "sussex", "hampshire", "kent"],
  { body: 2, acidity: 4.8, sweetness: 0.8, intensity: 2.8, oak: 0.1, alcohol: 2, fizz: true },
  ["chardonnay", "traditional method sparkling"],
);

export const REGION_RULES: readonly WineStyleRule[] = rules;
