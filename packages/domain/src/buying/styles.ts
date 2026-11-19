import type { WineType } from "../cellar";
import type { WineInput } from "../pairing-engine/wine";

/**
 * WHAT TO LOOK FOR IN A SHOP. When the sommelier advises buying, and no retailer source has confirmed a real
 * bottle, the advice is a style: "a Muscadet", "a Rioja Reserva". This is the catalogue of styles it can name.
 *
 * `fromEuros` is the engine's estimate of where sound bottles of the style start in an ordinary European shop.
 * It is general market knowledge on a coarse scale, written for CELLR and not taken from any retailer; it is used
 * to keep advice inside a budget and is shown, if at all, as "usually from about". It is never an offer, a price
 * of a product or a promise that a shop has it.
 */
export interface BuyStyle {
  /** A stable id; also how the benchmark and the analytics name the style (never a product). */
  id: string;
  label: { en: string; nl: string };
  /** The style as a wine the engine can read (appellation, region, country): its structure comes from there. */
  wine: WineInput;
  fromEuros: number;
  /** Found in most supermarkets and wine shops, so a safe thing to send someone out for. */
  common: boolean;
  /** A bottle people recognise as a present. */
  gift: boolean;
}

const style = (
  id: string,
  en: string,
  nl: string,
  type: WineType,
  name: string,
  appellation: string | null,
  region: string | null,
  countryCode: string,
  fromEuros: number,
  flags: "" | "c" | "g" | "cg" = "",
): BuyStyle => ({
  id,
  label: { en, nl },
  wine: { type, name, appellation, region, countryCode },
  fromEuros,
  common: flags.includes("c"),
  gift: flags.includes("g"),
});

// prettier-ignore
export const BUY_STYLES: readonly BuyStyle[] = [
  // Crisp and light whites
  style("muscadet", "Muscadet (Loire)", "Muscadet (Loire)", "white", "Muscadet Sèvre et Maine sur lie", "Muscadet Sèvre et Maine", "Loire", "FR", 9, "c"),
  style("picpoul", "Picpoul de Pinet", "Picpoul de Pinet", "white", "Picpoul de Pinet", "Picpoul de Pinet", "Languedoc", "FR", 9, "c"),
  style("vinho-verde", "Vinho Verde", "Vinho Verde", "white", "Vinho Verde", "Vinho Verde", "Minho", "PT", 8, "c"),
  style("albarino", "Albariño (Rías Baixas)", "Albariño (Rías Baixas)", "white", "Albariño", "Rías Baixas", "Galicia", "ES", 13, "c"),
  style("gruner", "Grüner Veltliner (Austria)", "Grüner Veltliner (Oostenrijk)", "white", "Grüner Veltliner", "Kamptal", "Niederösterreich", "AT", 11, "c"),
  style("verdejo", "Verdejo (Rueda)", "Verdejo (Rueda)", "white", "Verdejo", "Rueda", "Castilla y León", "ES", 8, "c"),
  style("pinot-grigio", "Pinot Grigio (northern Italy)", "Pinot Grigio (Noord-Italië)", "white", "Pinot Grigio", "Alto Adige", "Alto Adige", "IT", 10, "c"),
  style("soave", "Soave Classico", "Soave Classico", "white", "Soave Classico", "Soave", "Veneto", "IT", 10, "c"),
  style("vermentino", "Vermentino", "Vermentino", "white", "Vermentino di Sardegna", "Vermentino di Sardegna", "Sardinia", "IT", 11),
  style("sancerre", "Sancerre", "Sancerre", "white", "Sancerre", "Sancerre", "Loire", "FR", 20, "cg"),
  style("sauvignon-nz", "Sauvignon Blanc (Marlborough)", "Sauvignon Blanc (Marlborough)", "white", "Sauvignon Blanc", "Marlborough", "Marlborough", "NZ", 11, "c"),
  style("chablis", "Chablis", "Chablis", "white", "Chablis", "Chablis", "Burgundy", "FR", 19, "cg"),
  style("riesling-dry", "Dry Riesling (Germany)", "Droge Riesling (Duitsland)", "white", "Riesling trocken", "Pfalz", "Pfalz", "DE", 12, "c"),
  // Off-dry and aromatic whites
  style("riesling-kabinett", "Riesling Kabinett (Mosel)", "Riesling Kabinett (Moezel)", "white", "Riesling Kabinett", "Mosel", "Mosel", "DE", 13),
  style("gewurztraminer", "Gewurztraminer (Alsace)", "Gewurztraminer (Elzas)", "white", "Gewurztraminer", "Alsace", "Alsace", "FR", 14, "c"),
  style("pinot-gris", "Pinot Gris (Alsace)", "Pinot Gris (Elzas)", "white", "Pinot Gris", "Alsace", "Alsace", "FR", 14, "c"),
  style("vouvray", "Chenin Blanc (Vouvray)", "Chenin Blanc (Vouvray)", "white", "Vouvray", "Vouvray", "Loire", "FR", 13),
  // Fuller whites
  style("macon", "White Burgundy (Mâcon, Saint-Véran)", "Witte Bourgogne (Mâcon, Saint-Véran)", "white", "Mâcon-Villages", "Mâcon-Villages", "Burgundy", "FR", 13, "c"),
  style("meursault", "Meursault", "Meursault", "white", "Meursault", "Meursault", "Burgundy", "FR", 45, "g"),
  style("condrieu", "Condrieu (Viognier)", "Condrieu (Viognier)", "white", "Condrieu", "Condrieu", "Rhône", "FR", 40, "g"),
  style("chardonnay-oaked", "Oaked Chardonnay (California)", "Houtgerijpte Chardonnay (Californië)", "white", "Chardonnay", "Sonoma Coast", "California", "US", 15, "c"),
  // Sparkling
  style("cava", "Cava", "Cava", "sparkling", "Cava Brut", "Cava", "Penedès", "ES", 9, "c"),
  style("cremant", "Crémant", "Crémant", "sparkling", "Crémant de Bourgogne Brut", "Crémant de Bourgogne", "Burgundy", "FR", 13, "c"),
  style("prosecco", "Prosecco", "Prosecco", "sparkling", "Prosecco Superiore", "Prosecco", "Veneto", "IT", 10, "c"),
  style("champagne", "Champagne", "Champagne", "sparkling", "Champagne Brut", "Champagne", "Champagne", "FR", 32, "cg"),
  style("moscato", "Moscato d'Asti", "Moscato d'Asti", "sparkling", "Moscato d'Asti", "Moscato d'Asti", "Piedmont", "IT", 9, "c"),
  // Rosé and orange
  style("provence-rose", "Provence rosé", "Provence rosé", "rose", "Côtes de Provence Rosé", "Côtes de Provence", "Provence", "FR", 12, "c"),
  style("tavel", "Tavel rosé", "Tavel rosé", "rose", "Tavel", "Tavel", "Rhône", "FR", 14),
  style("orange", "Orange wine (skin-contact white)", "Oranje wijn", "orange", "Orange wine", null, null, "IT", 16),
  // Light reds
  style("beaujolais", "Beaujolais cru (Morgon, Fleurie)", "Beaujolais cru (Morgon, Fleurie)", "red", "Morgon", "Morgon", "Beaujolais", "FR", 13, "c"),
  style("bourgogne-pinot", "Red Burgundy (Pinot Noir)", "Rode Bourgogne (Pinot Noir)", "red", "Bourgogne Pinot Noir", "Bourgogne", "Burgundy", "FR", 18, "cg"),
  style("spatburgunder", "Spätburgunder (German Pinot Noir)", "Spätburgunder (Duitse Pinot Noir)", "red", "Spätburgunder", "Pfalz", "Pfalz", "DE", 13),
  style("valpolicella", "Valpolicella Classico", "Valpolicella Classico", "red", "Valpolicella Classico", "Valpolicella", "Veneto", "IT", 10, "c"),
  // Medium reds
  style("chianti", "Chianti Classico", "Chianti Classico", "red", "Chianti Classico", "Chianti Classico", "Tuscany", "IT", 14, "c"),
  style("barbera", "Barbera d'Asti", "Barbera d'Asti", "red", "Barbera d'Asti", "Barbera d'Asti", "Piedmont", "IT", 11, "c"),
  style("cotes-du-rhone", "Côtes du Rhône", "Côtes du Rhône", "red", "Côtes du Rhône", "Côtes du Rhône", "Rhône", "FR", 9, "c"),
  style("rioja-crianza", "Rioja Crianza", "Rioja Crianza", "red", "Rioja Crianza", "Rioja", "Rioja", "ES", 10, "c"),
  style("rioja-reserva", "Rioja Reserva", "Rioja Reserva", "red", "Rioja Reserva", "Rioja", "Rioja", "ES", 15, "cg"),
  style("crozes", "Crozes-Hermitage (Syrah)", "Crozes-Hermitage (Syrah)", "red", "Crozes-Hermitage", "Crozes-Hermitage", "Rhône", "FR", 17),
  style("medoc", "Bordeaux (Médoc, Haut-Médoc)", "Bordeaux (Médoc, Haut-Médoc)", "red", "Haut-Médoc", "Haut-Médoc", "Bordeaux", "FR", 15, "cg"),
  style("saint-emilion", "Saint-Émilion", "Saint-Émilion", "red", "Saint-Émilion Grand Cru", "Saint-Émilion", "Bordeaux", "FR", 22, "g"),
  // Full reds
  style("malbec", "Malbec (Mendoza)", "Malbec (Mendoza)", "red", "Malbec", "Mendoza", "Mendoza", "AR", 10, "c"),
  style("ribera", "Ribera del Duero", "Ribera del Duero", "red", "Ribera del Duero Crianza", "Ribera del Duero", "Castilla y León", "ES", 15, "c"),
  style("primitivo", "Primitivo (Puglia)", "Primitivo (Puglia)", "red", "Primitivo di Manduria", "Primitivo di Manduria", "Puglia", "IT", 10, "c"),
  style("shiraz", "Shiraz (Barossa)", "Shiraz (Barossa)", "red", "Shiraz", "Barossa Valley", "Barossa", "AU", 13, "c"),
  style("chateauneuf", "Châteauneuf-du-Pape", "Châteauneuf-du-Pape", "red", "Châteauneuf-du-Pape", "Châteauneuf-du-Pape", "Rhône", "FR", 30, "g"),
  style("pauillac", "Pauillac (Bordeaux)", "Pauillac (Bordeaux)", "red", "Pauillac", "Pauillac", "Bordeaux", "FR", 40, "g"),
  style("napa-cab", "Napa Valley Cabernet Sauvignon", "Napa Valley Cabernet Sauvignon", "red", "Cabernet Sauvignon", "Napa Valley", "California", "US", 40, "g"),
  style("barolo", "Barolo", "Barolo", "red", "Barolo", "Barolo", "Piedmont", "IT", 35, "g"),
  style("langhe-nebbiolo", "Langhe Nebbiolo", "Langhe Nebbiolo", "red", "Langhe Nebbiolo", "Langhe Nebbiolo", "Piedmont", "IT", 16),
  style("brunello", "Brunello di Montalcino", "Brunello di Montalcino", "red", "Brunello di Montalcino", "Brunello di Montalcino", "Tuscany", "IT", 40, "g"),
  style("amarone", "Amarone della Valpolicella", "Amarone della Valpolicella", "red", "Amarone della Valpolicella", "Amarone della Valpolicella", "Veneto", "IT", 32, "g"),
  // Sweet and fortified
  style("sauternes", "Sauternes", "Sauternes", "dessert", "Sauternes", "Sauternes", "Bordeaux", "FR", 18, "g"),
  style("tokaji", "Tokaji Aszú", "Tokaji Aszú", "dessert", "Tokaji Aszú 5 Puttonyos", "Tokaji", "Tokaj", "HU", 30, "g"),
  style("tawny-port", "Tawny Port (10 years)", "Tawny port (10 jaar)", "fortified", "10 Year Old Tawny Port", "Porto", "Douro", "PT", 20, "cg"),
  style("lbv-port", "Late Bottled Vintage Port", "Late Bottled Vintage port", "fortified", "Late Bottled Vintage Port", "Porto", "Douro", "PT", 15, "c"),
  style("vintage-port", "Vintage Port", "Vintage port", "fortified", "Vintage Port", "Porto", "Douro", "PT", 45, "g"),
  style("fino", "Fino or Manzanilla sherry", "Fino of manzanilla sherry", "fortified", "Fino", "Jerez", "Andalucía", "ES", 9, "c"),
  style("px", "Pedro Ximénez sherry", "Pedro Ximénez sherry", "fortified", "Pedro Ximénez", "Jerez", "Andalucía", "ES", 14),
  style("banyuls", "Banyuls or Maury (sweet red)", "Banyuls of Maury (zoete rode)", "fortified", "Banyuls", "Banyuls", "Roussillon", "FR", 15),
];

export const buyStyleById = (id: string): BuyStyle | undefined =>
  BUY_STYLES.find((s) => s.id === id);
