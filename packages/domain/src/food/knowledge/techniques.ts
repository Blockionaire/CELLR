/**
 * TECHNIQUES. Written for CELLR from general culinary knowledge; drafted by an AI engineering agent and not yet
 * reviewed by a human expert (`reviewed: false`, see `FOOD_PROVENANCE`).
 *
 * A technique's `delta` is added to the main ingredient's structure (see `composeStructure`). Deltas stay within
 * −2 … +2 on the same scales as ingredients: weight/intensity 1–5, every other axis 0–3. A technique with no
 * delta (steamed, poached) is still worth recognising: it tells the engine nothing was added.
 */
import type { Technique } from "../types";

// prettier-ignore
export const TECHNIQUES: readonly Technique[] = [
  // ---- How it tastes, said on top of whatever the dish is ----
  { id: "spicy", en: ["spicy", "very spicy", "extra spicy", "hot and spicy", "fiery", "extra hot"], nl: ["pittig", "pittige", "heel pittig", "extra pittig", "scherp", "scherpe", "heet", "hete", "spicy"], delta: { heat: 1.5, intensity: 0.5 }, modifier: true },
  { id: "mild", en: ["mild", "not spicy", "not too spicy"], nl: ["mild", "milde", "niet pittig", "niet te pittig", "niet scherp"], delta: { heat: -1 }, modifier: true },
  { id: "creamy", en: ["creamy", "in cream"], nl: ["romig", "romige", "in room"], delta: { fat: 1, weight: 0.5 }, tags: ["cream"], modifier: true },
  { id: "raw", en: ["raw", "uncooked", "crudo", "carpaccio-style", "served raw"], nl: ["rauw", "rauwe", "ongekookt"], delta: { weight: -0.5, intensity: -0.3 } },
  { id: "cured", en: ["cured", "marinated", "salt-cured", "dry-cured", "brined", "salted", "salt cured", "dry aged", "dry-aged"], nl: ["gemarineerd", "gemarineerde", "gezouten", "gepekeld", "gepekelde", "gecured", "dry aged", "droog gerijpt"], delta: { salt: 1 }, tags: ["cured"] },
  { id: "citrus-cured", en: ["ceviche-style", "citrus-cured", "citrus cured", "lime-cured", "lime cured", "tiradito"], nl: ["in citrus gegaard", "gegaard in limoen", "citrus-gegaard", "in limoensap gegaard"], delta: { acid: 2 }, tags: ["citrus"] },
  { id: "steamed", en: ["steamed", "en papillote", "in parchment", "steam-cooked"], nl: ["gestoomd", "gestoomde", "en papillote", "in papillot", "stomen"], delta: {} },
  { id: "poached", en: ["poached", "simmered", "gently poached"], nl: ["gepocheerd", "gepocheerde", "pocheren", "zacht gegaard"], delta: {} },
  { id: "boiled", en: ["boiled", "cooked in water", "blanched"], nl: ["gekookt", "gekookte", "geblancheerd", "geblancheerde"], delta: {} },
  { id: "sous-vide", en: ["sous vide", "sous-vide", "water bath"], nl: ["sous vide", "sousvide", "sous-vide gegaard"], delta: {} },
  { id: "pan-fried", en: ["pan-fried", "pan fried", "fried", "sauteed", "sautéed", "saute", "sauté", "shallow-fried", "pan-cooked", "fried in butter"], nl: ["gebakken", "in de pan gebakken", "gesauteerd", "gesauteerde", "bakken", "sauteren", "gebakken in boter", "uit de pan", "gebakken in de pan"], delta: { weight: 0.3, fat: 0.5 } },
  { id: "pan-seared", en: ["pan-seared", "pan seared", "seared", "crispy-skinned", "crispy skin", "skin-on", "seared in the pan"], nl: ["op de huid gebakken", "dichtgeschroeid", "aangebraden", "krokant gebakken", "geschroeid", "kort gebakken", "op de huid"], delta: { weight: 0.3, intensity: 0.3, fat: 0.5 } },
  { id: "deep-fried", en: ["deep-fried", "deep fried", "battered", "beer-battered", "beer battered", "fried in batter", "crispy fried", "frito", "fritto"], nl: ["gefrituurd", "gefrituurde", "in beslag", "in beslag gefrituurd", "krokant gefrituurd", "uit de frituur", "frituren"], delta: { weight: 1, fat: 1.5 }, tags: ["fried"] },
  { id: "tempura", en: ["tempura", "tempura-fried", "in tempura batter"], nl: ["tempura", "in tempurabeslag", "tempurabeslag"], delta: { weight: 0.5, fat: 1 }, tags: ["fried"] },
  { id: "stir-fried", en: ["stir-fried", "stir fried", "stir-fry", "stir fry", "wok-fried", "wok fried", "wokked", "from the wok"], nl: ["roergebakken", "gewokt", "gewokte", "uit de wok", "wokken", "roerbakken", "wok"], delta: { intensity: 0.3, fat: 0.5 } },
  { id: "grilled", en: ["grilled", "chargrilled", "char-grilled", "griddled", "flame-grilled", "broiled", "plancha", "a la plancha", "on the grill", "from the grill", "charred", "grill"], nl: ["gegrild", "gegrilde", "grill", "van de grill", "grillen", "op de grill", "geblakerd", "geblakerde", "van de plancha", "a la plancha", "grillpan"], delta: { intensity: 0.7, bitter: 0.3, smoke: 0.5 }, tags: ["charred"] },
  { id: "barbecued", en: ["barbecued", "bbq", "barbecue", "from the barbecue", "on the barbecue", "on the bbq", "low and slow", "smoked bbq", "bbq'd", "wood-fired grill"], nl: ["van de barbecue", "van de bbq", "barbecue", "bbq", "gebarbecued", "gebarbecuede", "op de barbecue", "op de bbq", "kamado"], delta: { weight: 0.5, intensity: 1, smoke: 1.5 }, tags: ["charred"] },
  { id: "roasted", en: ["roasted", "roast", "oven-roasted", "oven roasted", "oven-baked", "oven baked", "spit-roasted", "rotisserie", "from the oven", "wood-fired", "slow-roasted", "slow roasted"], nl: ["geroosterd", "geroosterde", "uit de oven", "gebraden", "ovengebakken", "ovengebakken", "in de oven", "oven", "braden", "aan het spit", "ovengeroosterd"], delta: { weight: 0.5, intensity: 0.5, sweet: 0.2 } },
  { id: "baked", en: ["baked", "bake", "oven bake", "casserole-baked"], nl: ["in de oven gebakken", "gebakken in de oven", "ovenschotel", "gebakken uit de oven"], delta: { weight: 0.3 } },
  { id: "braised", en: ["braised", "stewed", "slow-cooked", "slow cooked", "stew", "casserole", "pot-roasted", "pot roasted", "slow-braised", "slow braised", "simmered for hours", "ragout"], nl: ["gestoofd", "gestoofde", "gesmoord", "gesmoorde", "stoof", "stoven", "stoofpot", "stoofpotje", "langzaam gegaard", "slowcooked", "stoofschotel", "ragout", "sudderen", "gesudderd"], delta: { weight: 1, intensity: 0.7, umami: 0.7 }, tags: ["braised"] },
  { id: "confit", en: ["confit", "confited", "slow-cooked in fat", "cooked in duck fat"], nl: ["gekonfijt", "gekonfijte", "confit", "in eigen vet gegaard"], delta: { weight: 1, fat: 1.5 } },
  { id: "smoked", en: ["smoked", "hot-smoked", "cold-smoked", "smoke-roasted", "hot smoked", "cold smoked"], nl: ["gerookt", "gerookte", "warmgerookt", "warmgerookte", "koudgerookt", "koudgerookte", "warm gerookt"], delta: { intensity: 0.7, salt: 0.5, smoke: 2 }, tags: ["smoked"] },
  { id: "gratinated", en: ["gratinated", "au gratin", "gratin", "gratineed", "baked with cheese", "cheese-topped", "gratinéed", "under the grill with cheese"], nl: ["gegratineerd", "gegratineerde", "gratin", "gratineren", "met kaas gegratineerd", "uit de oven met kaas"], delta: { weight: 1, fat: 1, umami: 0.5 } },
  { id: "breaded", en: ["breaded", "crumbed", "schnitzel-style", "panko", "panko-crusted", "in breadcrumbs", "breadcrumbed", "coated in breadcrumbs"], nl: ["gepaneerd", "gepaneerde", "paneren", "in paneermeel", "panko", "met paneermeel"], delta: { weight: 0.7, fat: 1 }, tags: ["fried"] },
  { id: "caramelised", en: ["caramelised", "caramelized", "candied", "sugar-glazed"], nl: ["gekarameliseerd", "gekarameliseerde", "gesuikerd", "gesuikerde"], delta: { sweet: 1 } },
  { id: "pickled", en: ["pickled", "quick-pickled", "soused", "in vinegar", "quick pickled"], nl: ["ingelegd", "ingelegde", "zuur ingelegd", "in het zuur", "in azijn"], delta: { acid: 2 }, tags: ["pickled"] },
  { id: "stuffed", en: ["stuffed", "filled", "with stuffing"], nl: ["gevuld", "gevulde", "met vulling"], delta: { weight: 0.5 } },
  { id: "flambeed", en: ["flambeed", "flambéed", "flambé", "flambe", "flamed"], nl: ["geflambeerd", "geflambeerde", "flambé"], delta: { intensity: 0.3, sweet: 0.3 } },
  { id: "mashed", en: ["mashed", "pureed", "puréed", "crushed", "smashed", "creamed", "whipped"], nl: ["gepureerd", "gepureerde", "gestampt", "gestampte", "fijngestampt"], delta: { weight: 0.3, fat: 0.5 } },
  { id: "glazed", en: ["glazed", "honey-glazed", "honey glazed", "lacquered", "sticky", "maple-glazed"], nl: ["geglaceerd", "geglaceerde", "gelakt", "gelakte", "met honing geglaceerd", "kleverig"], delta: { sweet: 1 }, tags: ["sweet-glaze"] },
  { id: "blackened", en: ["blackened", "spice-rubbed", "spice rubbed", "dry-rubbed", "dry rubbed", "cajun", "cajun-spiced", "jerk-spiced", "rubbed", "spiced"], nl: ["pittig gekruid", "pittig gekruide", "cajun", "met dry rub", "dry rubbed", "gekruid met cajun"], delta: { heat: 0.5, spice: 1.5 } },
];
