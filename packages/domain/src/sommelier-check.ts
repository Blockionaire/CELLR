import { z } from "zod";
import { normalizeText, type CellarItem, type WineType } from "./cellar";
import { wineLabel } from "./wine-label";
import {
  BUDGET_EUROS,
  detectIntent,
  type Budget,
  type BuySuggestion,
  type CellarDigest,
  type SommelierBottle,
} from "./sommelier";

/**
 * THE ANSWER CHECK (Sommelier V1+, part `check`). The model chooses the wines; this decides which of its WORDS can be
 * shown. Nothing the answer says about the person's cellar may be invented, and no price, shop or stock claim the app
 * cannot verify is shown as fact. It is deliberately not a filter on wine names: the sommelier may compare wines and
 * talk about wines the person does not own, as long as it does not present them as owned.
 *
 * Layers, most reliable first:
 *   1. Structure. Prompt v7 asks the model to write a cellar wine as its ref (`[[a1b2c3]]`), never by name, and its
 *      schema has no price field. A ref is rendered here from the cellar (`Producer WineName Year`), so the name and
 *      the vintage of an owned wine are the cellar's own words, not the model's. A ref that is not on the list the
 *      model was shown is `unknown-ref`.
 *   2. Claims in the remaining prose, sentence by sentence, in English and Dutch (below, with what each cannot see).
 *   3. Buying: the price is always dropped and the screen shows the person's own budget band, or "price not known".
 *
 * Before reading, markdown emphasis is removed ("**Musar** (**2008**)" is "Musar (2008)"; the screen shows none), extra
 * brackets around a ref are dropped ("[[[[a1b2c3]]]]"), and a ref cut off by the length cap at the very end ("…and
 * [[c0000") is dropped together with the unfinished sentence it is in.
 *
 * Outcome: an invented cellar fact (`unknown-ref`, `wrong-vintage`, `wrong-count`, or `not-in-cellar` with a vintage
 * or a number of bottles in its sentence) replaces the whole text (the screen words a sentence from the cards; one
 * false fact makes every other fact in it doubtful). A `not-in-cellar` that is only a name ("pour your Pétrus
 * instead") removes that sentence, like a `price`, `availability` or `action` sentence: the rest of the answer
 * stays. When nothing is left, the text is replaced.
 *
 * Every rule prefers missing a doubtful claim over removing a good answer. What each rule cannot see:
 *
 * - Rendering refs: only `[[ref]]` (extra brackets ignored), `[ref]` with a hex ref, and a bare token that is exactly
 *   a ref on the list are read as refs. A ref written in any other way (split, misspelled) is just a word.
 * - Cellar wines named in plain words: matched on the producer and wine names of the WHOLE cellar (accents and case
 *   ignored), on whole words. A name that is generic (a grape, an appellation, a style, "Special Cuvée", or a word in
 *   several producers' names) never counts as naming one wine on its own, except a whole name of two or more words
 *   with a place in it ("Langhe Nebbiolo") while only one wine in the cellar has it; an estate word and its name
 *   ("Château Margaux") is that estate. A one-word name counts only when written with a capital. A producer's name
 *   stands for all its wines. Nicknames, abbreviations ("DRC"), translations and misspellings are not the wine.
 * - `wrong-vintage`: a year is read as a vintage only right next to a cellar wine's name ("Musar 2008", "the 2008
 *   Musar", "Musar from (the) 2008 (vintage)", an aside "Musar, the 2008," / "Musar – 2008 –" / "[[ref]], a 2008,"),
 *   after "your 2008" / "open the 2008", or after a possessive phrase ("your 2015 Barolo"); a year after "until",
 *   "by", "tot", in a range ("2025–2030") or after this year is a drinking window and never a vintage. A plain mention
 *   only counts when the sentence presents the wine as owned (your / you have / the / open the / at the start) and
 *   does not mark it as hypothetical or general ("would", "if", "a Musar 2008", "buy", "was", "not", "zou", "als",
 *   "geen" …), so "the Musar 2008 is not ready" is missed on purpose. A vintage said in another sentence ("Your
 *   Musar is lovely. The 2008 is…") is not tied to it. Short years ("'08") are not read.
 * - `wrong-count`: only a STOCK claim ("you have six bottles", "3 bottles left", "9 bottles of … remain", "there are
 *   still 9 of …", "with 9 [[ref]] in the cellar", "[[ref]] (×9)", "9x [[ref]]", "je hebt nog 4 flessen", "er
 *   liggen 2 flessen") about a cellar wine named in the same sentence, in the sentence before when this one says "of
 *   it" / "daarvan" / "je hebt er …", or the wine a short text is about (`previous`, a menu course's wine). Accepted:
 *   the vintage's count, reserved and free counts, the sum over all vintages of the same wine, an estate's bottles
 *   over all its wines when the estate is named, and any number in the counted facts block. A suggestion ("open two
 *   bottles of …", "you need 4 bottles", "je hebt 4 flessen nodig", "open je twee flessen …") is only flagged when it
 *   asks to open more than the cellar holds of that wine. Counts about the whole cellar, about a style ("your 3
 *   bottles of Barolo") or with no wine named are not checked. "a bottle" / Dutch "een fles" are an article, not the
 *   number one; "a dozen" is twelve and "half a dozen" six.
 * - `not-in-cellar`: only after an ownership phrase ("your", "you have", "jouw", "uw", "je hebt"; Dutch "je" only
 *   where it cannot be the subject), an instruction that presumes the bottle is there ("open / pour / serve / grab /
 *   take / try / pick / choose / go for the …", "schenk / neem / pak / kies / probeer / ontkurk de …"), a place it
 *   lies in ("in your cellar", "from the rack", "uit je rek", "in je kelder ligt", a place's own name), or "the …"
 *   in a sentence about drinking it ("the Tignanello is ready to drink"). What follows must be plausibly a wine: a
 *   wine type ("your rosé"), or a capitalised name with a wine word or a vintage after it, a known appellation,
 *   grape, style or estate word in it, a cellar producer, a place, a verb only a wine takes, or a sentence about
 *   drinking it. A capitalised name followed by a lowercase noun that is not a wine word describes that noun ("your
 *   Riedel glasses", "je Indonesische rijsttafel", "your Tuscany trip"), and gear, cuisines, nationalities, days and
 *   holidays are never a wine. It is owned when its words occur in a cellar wine's producer, name, region,
 *   appellation or place, or when a small table of well-known appellations links it to the region of a wine whose
 *   appellation the cellar does not say; a grape only when a cellar wine's own words name it. A producer the cellar
 *   has followed by a wine name none of its wines has ("your Vajra Bricco delle Viole") is not owned. Questions,
 *   conditions ("if you have"), denials ("you have no Barolo"), wanting ("in mind", "nodig") and food after "with /
 *   for / bij / met" are never a claim. Missed on purpose: a bare name with nothing that says it is a wine ("Your
 *   Krug is ready", "Jouw Tignanello past er perfect bij"). Still a false-positive risk: an appellation missing from
 *   the table that is not in a cellar wine's fields, a capitalised dish or brand not in the lists at the end of a
 *   sentence after "pour / open the", or a person's name in a sentence about drinking.
 * - `price`: currency symbols and words (€, $, £, ¥, EUR, CHF, SEK, euro, dollar, bucks, francs, kronor, "200 kr",
 *   cents with a number, "20,-"), price words with a number ("costs about 20", "prijs: 19,95") and an amount per
 *   bottle without a currency ("25-30 per bottle", "zo'n 25 tot 30 per fles", "25 a bottle", "20 de fles").
 *   Spelled-out amounts without a currency word ("twenty"),
 *   "cheap" and "expensive" are not prices. The person's own budget band said back as a band, with its own numbers
 *   ("€15–30", "up to €15", "€60 or more"), is allowed; one end of a closed band alone is a price.
 * - `availability`: fixed phrases ("available at", "in stock", "widely available", "easy to find", "at your local
 *   wine shop", "verkrijgbaar bij", "op voorraad", "overal verkrijgbaar", "bij de ah"), a list of retailers matched
 *   with their capitals (Sligro, De Wijnbeurs, Vinatis, Hanos, Henri Bloem …), and "at / bij / via" a capitalised
 *   name after a buying verb ("look for it at Wijnhuis Peeters") or anywhere in a buy entry ("— at Sligro"). A shop
 *   described in other words, or named without a buying verb, is not seen.
 * - `action`: the sommelier saying it did or will do something it cannot do ("I have reserved", "I've moved", "I'll
 *   order", "let me move", "I've set the Barolo aside", "I'll put it in the fridge", "ik heb … gereserveerd", "ik ga
 *   … bestellen", "ik zet … apart", "ik heb … in de koelkast gelegd"), and something said to have just changed ("is
 *   now reserved", "Done: … reserved", "staat nu gereserveerd"). Passive voice ("has been reserved", "is reserved") is
 *   a fact the digest may state, so it is not read; neither is "I would open" (advice) or "let me add that" (talk).
 * - Buying: clauses of `wine` and `why` with money or a shop are dropped (split on , ; : ( ) and dashes). A buy entry
 *   is owned (`owned-buy`) when it names a cellar wine (a ref, its name, or its producer with all of the wine's own
 *   words) in a vintage the cellar has, or with no vintage; a style from an owned producer ("Barolo, e.g. Vajra")
 *   and another vintage are kept.
 *
 * Cost: the cellar is indexed once per question (`prepareAnswerCheck`; words cached across questions), linear in its
 * size; the words of every wine, needed only to read a name after "your", are indexed on first use.
 */

export { wineLabel } from "./wine-label";

// ---- The result ----------------------------------------------------------------------------------------------

export const CHECK_CODES = [
  "unknown-ref", // a [[ref]] in the text that is not on the list the model was shown
  "not-in-cellar", // a wine presented as owned that the cellar does not hold
  "wrong-vintage", // a year said of a cellar wine that is none of its vintages in the cellar
  "wrong-count", // a number of bottles said of a cellar wine that is not what the cellar holds
  "price", // an amount of money
  "availability", // a shop, a stock or an availability claim
  "action", // claims to have done or to be going to do something (moved, reserved, ordered, opened)
  "owned-buy", // a wine to buy that is already in the cellar
] as const;
export type CheckCode = (typeof CHECK_CODES)[number];

export interface AnswerCheck {
  v: 1;
  /**
   * kept: as the model wrote it (refs rendered). trimmed: sentences removed (a price, a shop, an action, or a wine
   * named as owned that the cellar lacks, with no vintage or count). replaced: text is null, the screen words a
   * card-only sentence (an invented cellar fact: unknown ref, wrong vintage or count, or a missing wine with a vintage
   * or a count; or nothing was left).
   */
  text: "kept" | "trimmed" | "replaced";
  /** What was found, each code once, in a fixed order. Codes only: never the model's words. */
  codes: CheckCode[];
}

export const AnswerCheckSchema: z.ZodType<AnswerCheck> = z.object({
  v: z.literal(1),
  text: z.enum(["kept", "trimmed", "replaced"]),
  codes: z
    .array(z.enum(CHECK_CODES))
    .max(CHECK_CODES.length)
    // Each code once.
    .refine((codes) => new Set(codes).size === codes.length),
});

/** A price band per bottle in whole euros, the upper bound open for the highest band (see BUDGET_EUROS). */
export const PriceBandSchema = z
  .tuple([z.number().int().min(0).max(100_000), z.number().int().min(0).max(100_000).nullable()])
  .readonly()
  .nullable();

/** A buy entry after the check: never the model's price. */
export interface CheckedBuy {
  wine: string;
  why: string;
  price: "";
  priceBand: readonly [number, number | null] | null;
}

/** For a kept answer: a checked buy entry as it is stored (bounded like checkSommelierAnswer's tidy). */
export const CheckedBuySchema: z.ZodType<CheckedBuy> = z.object({
  wine: z.string().min(1).max(120),
  why: z.string().max(240),
  price: z.literal(""),
  priceBand: PriceBandSchema,
});

// ---- Words -----------------------------------------------------------------------------------------------------

const set = (words: string) => new Set(words.split(/\s+/).filter(Boolean));

/** Words in wine names that say nothing about which wine it is: colours, styles, classifications, estate words. */
const GENERIC = /*#__PURE__*/ set(`
  rouge rouges blanc blancs blanche rose rosso rossa bianco bianca rosato tinto tinta blanco blanca rosado red reds
  white whites wit witte rood rode brut extra nature sec demi doux dry sweet zero dosage reserve reserva riserva
  reservas gran grande grand cru crus premier 1er village villages classico superiore vieilles vignes old vines vine
  cuvee cuvees selection selectie estate vintage kabinett spatlese auslese trocken feinherb crianza joven roble
  tradition traditionnel prestige special speciale cellar cellars wines wine wijn vin vino vinho wein sparkling
  cremant cava prosecco champagne spumante sekt frizzante mousseux petillant port porto tawny ruby lbv fino oloroso
  amontillado sherry late harvest noble ice eiswein icewine single vineyard clos chateau domaine tenuta bodega
  bodegas weingut cantina maison castello quinta casa cave caves winery vineyards wijnhuis mas podere fattoria
  azienda agricola schloss de du des la le les di del della dei delle da do dos das von van der den het the of and
  et e y i il lo el en saint st sainte ste san santa sankt mont monte cote cotes coteaux terroir terre terra brut
  dessert fortified orange collection reserve family famille fils freres pere mere
`);

/** Grapes (and the colour they make, when it is one): a grape names a style, never one wine. */
const GRAPES: ReadonlyMap<string, WineType | null> = /*#__PURE__*/ new Map([
  ["cabernet", "red"],
  ["merlot", "red"],
  ["syrah", "red"],
  ["shiraz", "red"],
  ["grenache", "red"],
  ["garnacha", "red"],
  ["tempranillo", "red"],
  ["sangiovese", "red"],
  ["nebbiolo", "red"],
  ["malbec", "red"],
  ["zinfandel", "red"],
  ["primitivo", "red"],
  ["carmenere", "red"],
  ["gamay", "red"],
  ["mourvedre", "red"],
  ["monastrell", "red"],
  ["barbera", "red"],
  ["dolcetto", "red"],
  ["cinsault", "red"],
  ["carignan", "red"],
  ["touriga", "red"],
  ["aglianico", "red"],
  ["pinotage", "red"],
  ["blaufrankisch", "red"],
  ["zweigelt", "red"],
  ["noir", "red"],
  ["pinot", null],
  ["sauvignon", null],
  ["chardonnay", "white"],
  ["riesling", "white"],
  ["chenin", "white"],
  ["viognier", "white"],
  ["gewurztraminer", "white"],
  ["gruner", "white"],
  ["veltliner", "white"],
  ["albarino", "white"],
  ["alvarinho", "white"],
  ["verdejo", "white"],
  ["vermentino", "white"],
  ["semillon", "white"],
  ["marsanne", "white"],
  ["roussanne", "white"],
  ["grigio", "white"],
  ["gris", "white"],
  ["muscadet", "white"],
  ["muscat", null],
  ["moscato", null],
  ["furmint", null],
]);

/** Well-known appellations and the region words a cellar line may have instead ("Barolo" → Piedmont). */
const APPELLATIONS: ReadonlyMap<string, readonly string[]> = /*#__PURE__*/ new Map(
  (
    [
      [
        ["barolo", "barbaresco", "langhe", "roero", "gavi", "asti"],
        ["piedmont", "piemonte"],
      ],
      [
        ["chianti", "brunello", "montalcino", "bolgheri", "montepulciano", "maremma"],
        ["tuscany", "toscana"],
      ],
      [["amarone", "valpolicella", "soave", "bardolino"], ["veneto"]],
      [["etna"], ["sicily", "sicilia"]],
      [["rioja"], ["rioja"]],
      [
        ["ribera", "toro", "rueda"],
        ["castilla", "duero", "leon"],
      ],
      [
        ["priorat", "penedes", "montsant"],
        ["catalonia", "catalunya", "cataluna"],
      ],
      [["jerez"], ["andalusia", "andalucia", "jerez"]],
      [
        [
          "chablis",
          "meursault",
          "puligny",
          "chassagne",
          "pommard",
          "volnay",
          "nuits",
          "gevrey",
          "chambertin",
          "beaune",
          "bourgogne",
          "burgundy",
          "macon",
          "pouilly",
          "fuisse",
          "corton",
          "vosne",
          "romanee",
          "morey",
          "chambolle",
          "santenay",
          "mercurey",
          "givry",
          "beaujolais",
          "morgon",
          "fleurie",
        ],
        ["burgundy", "bourgogne", "beaujolais"],
      ],
      [
        [
          "bordeaux",
          "pauillac",
          "margaux",
          "medoc",
          "pomerol",
          "emilion",
          "graves",
          "sauternes",
          "pessac",
          "leognan",
          "julien",
          "estephe",
          "barsac",
        ],
        ["bordeaux"],
      ],
      [
        [
          "chateauneuf",
          "rhone",
          "hermitage",
          "rotie",
          "crozes",
          "gigondas",
          "condrieu",
          "vacqueyras",
          "cornas",
          "joseph",
          "tavel",
        ],
        ["rhone"],
      ],
      [
        ["sancerre", "vouvray", "chinon", "fume", "saumur", "bourgueil", "anjou", "savennieres"],
        ["loire"],
      ],
      [["alsace"], ["alsace", "elzas"]],
      [
        ["mosel", "rheingau", "pfalz", "nahe", "rheinhessen"],
        ["germany", "mosel", "duitsland"],
      ],
      [
        ["douro", "dao"],
        ["douro", "portugal", "dao"],
      ],
      [
        ["tokaji", "tokaj"],
        ["tokaj", "hungary"],
      ],
      [
        ["languedoc", "minervois", "corbieres", "roussillon"],
        ["languedoc", "roussillon"],
      ],
      [["provence", "bandol"], ["provence"]],
    ] as const
  ).flatMap(([names, regions]) => names.map((n) => [n, regions] as const)),
);

/** Style words a person's wine can be called by, and the type they stand for (a style name also counts by name). */
const TYPE_WORDS: ReadonlyMap<string, WineType> = /*#__PURE__*/ new Map([
  ["red", "red"],
  ["reds", "red"],
  ["rood", "red"],
  ["rode", "red"],
  ["white", "white"],
  ["whites", "white"],
  ["wit", "white"],
  ["witte", "white"],
  ["rose", "rose"],
  ["roses", "rose"],
  ["sparkling", "sparkling"],
  ["sparklings", "sparkling"],
  ["bubbles", "sparkling"],
  ["bubbly", "sparkling"],
  ["fizz", "sparkling"],
  ["bubbels", "sparkling"],
  ["mousserende", "sparkling"],
  ["champagne", "sparkling"],
  ["cava", "sparkling"],
  ["prosecco", "sparkling"],
  ["cremant", "sparkling"],
  ["dessert", "dessert"],
  ["dessertwijn", "dessert"],
  ["sauternes", "dessert"],
  ["port", "fortified"],
  ["porto", "fortified"],
  ["sherry", "fortified"],
  ["madeira", "fortified"],
]);

/** After a type word: it describes food, not a wine ("your red meat"). */
const FOOD_AFTER_TYPE = /*#__PURE__*/ set(
  "meat meats vlees sauce saus onion onions ui uien pepper peppers paprika fruit fruits cabbage kool curry berries bessen beans bonen rice rijst pesto lentils linzen",
);

/** Capitalised words that are never a wine after "your": days, holidays, nationalities, places in the app. */
const STOP_CAPS = /*#__PURE__*/ set(`
  monday tuesday wednesday thursday friday saturday sunday maandag dinsdag woensdag donderdag vrijdag zaterdag zondag
  january february march april may june july august september october november december januari februari maart mei
  juni juli augustus oktober christmas xmas easter thanksgiving kerst kerstmis kerstdiner pasen valentine valentijn
  sinterklaas new nieuwjaar i sommelier cellr cellar kelder wijnkelder fridge koelkast rack cabinet kast collection
  italian french spanish portuguese german austrian greek american californian australian chilean argentinian
  argentine south african hungarian lebanese japanese chinese thai indian mexican dutch belgian british english
  moroccan turkish vietnamese korean italiaanse italiaans franse frans spaanse spaans portugese duitse duits
  oostenrijkse griekse amerikaanse australische chileense argentijnse zuid afrikaanse hongaarse libanese japanse
  thaise indiase mexicaanse nederlandse belgische britse engelse marokkaanse turkse aziatische asian mediterranean
  coq boeuf bourguignon wellington paella tagine moussaka ratatouille cassoulet choucroute stamppot hutspot
  bitterballen sunday roast birthday anniversary verjaardag indonesian indonesische surinamese surinaamse swiss
  zwitserse sichuan szechuan cantonese middle eastern oosterse caribbean caribische peruvian peruaanse korean koreaanse
  ethiopian ethiopische scandinavian scandinavische nordic levantine russian russische polish poolse irish ierse
  scottish schotse welsh danish deense swedish zweedse norwegian noorse finnish finse osso buco raclette fondue
  rijsttafel roti mezze hotpot dim tapas sushi bbq barbecue
  riedel zalto coravin eurocave vacu vinturi durand laguiole weber kamado green egg thermomix creuset wset dwwa
  vivino liebherr
`);

/** Words that start an estate's name. */
const ESTATE = /*#__PURE__*/ set(
  "chateau domaine tenuta bodega bodegas weingut cantina maison castello quinta clos mas podere fattoria schloss casa",
);

/** Connectors inside a capitalised name ("Château de la Tour", "Nuits-Saint-Georges", "Coq au Vin"). */
const CONNECTORS = /*#__PURE__*/ set(
  "de du des la le les di del della dei da do dos das von van der den y e et au aux sur sous of the",
);

const POSSESSIVE = /*#__PURE__*/ set("your jouw uw");
const SUBJECT = /*#__PURE__*/ set("you je jij u jullie");
const HAVE = /*#__PURE__*/ set("have ve got own hold holds hebt heeft hebben heb bezit bezitten");
const NEGATION = /*#__PURE__*/ set(
  "no not none never nothing don doesn didn isn aren wasn haven hasn t geen niet nooit niks niets",
);
const CONDITION = /*#__PURE__*/ set("if when whether unless als wanneer mocht indien tenzij");
/** A sentence with one of these talks hypothetically or in general, so a year in it is not said of an owned bottle. */
const NOT_OWNED = /*#__PURE__*/ set(
  "would could might if ideally ideal wish buy buying bought purchase look shop than was were zou zouden kon als mocht kopen koop aanschaffen ideaal dan waren nooit",
);
const INDEFINITE = /*#__PURE__*/ set(
  "a an een any another some other older younger oudere jongere andere",
);
const DEFINITE = /*#__PURE__*/ set("the that this those these de het die deze dat");
const IMPERATIVE = /*#__PURE__*/ set(
  "open pour serve decant drink try pick take choose grab chill schenk pak neem drink decanteer serveer kies probeer proef koel",
);
/** Words that may sit between an ownership word and the name ("your lovely 2015 Barolo", "you have a bottle of"). */
const SKIP_FORWARD = /*#__PURE__*/ set(`
  a an the some any one de het een er nog still also only just already ook al alleen maar own eigen few couple paar
  enkele more meer other andere lovely beautiful fine young old older younger mature remaining last mooie jonge oude
  rijpe laatste overige bottle bottles fles flessen flesje flesjes magnum magnums of van
`);
const SKIP_BACK = /*#__PURE__*/ set(`
  of van bottle bottles fles flessen flesje magnum own eigen still nog also ook only alleen just maar er lovely
  beautiful fine young mature remaining last mooie jonge rijpe laatste
`);
/** Before "your": what follows is the food or the occasion, not a wine. */
const FOOD_PREP = /*#__PURE__*/ set("with alongside for to bij met voor naast along");
/** Dutch "je" is possessive after these (a preposition or an imperative); elsewhere it may be "you". */
const JE_POSSESSIVE_AFTER = /*#__PURE__*/ set(
  "in uit van bij met voor naar op aan onder over open schenk pak neem drink bewaar serveer kies probeer proef decanteer koel zet laat",
);

const BOTTLE = /*#__PURE__*/ set("bottle bottles fles flessen flesje flesjes magnum magnums");
const COUNT_ADJ = /*#__PURE__*/ set("more other free extra spare andere vrije losse");
const UNITS = /*#__PURE__*/ set(
  "people persons guests gasten mensen personen glasses glass glazen glas minutes minute min minuten hours hour uur years year jaar jaren degrees graden cl ml l liter litre euro euros percent procent",
);
/** Before a count: the number is what the person has. */
const STOCK_BEFORE = /*#__PURE__*/ set(
  "have ve got own hold holds hebt heeft hebben bezit liggen ligt staan staat still nog only just maar alleen your je jouw uw those die are is zijn er there remaining",
);
const STOCK_AFTER = /*#__PURE__*/ set(
  "left remaining remain remains resterend over reserved gereserveerd free vrij kept bewaard liggen staan cellar kelder",
);
/** Before a count: the number is advice (how many to open, or to need), not what the person has. */
const SUGGEST_BEFORE = /*#__PURE__*/ set(
  "open opening openen trek pour serve schenk decant chill bring take need needs needed nodig buy kopen koop plan reken would zou for voor maybe perhaps misschien neem pak zet haal",
);
const OPEN_VERBS = /*#__PURE__*/ set("open opening openen trek pour serve schenk decant");
/** "Open the …", "grab the …": an instruction that presumes the bottle is there. */
const OPEN_THE = /*#__PURE__*/ set(
  "open uncork decant pour serve grab take try pick choose ontkurk decanteer trek schenk neem pak kies serveer probeer",
);
/** Right after a name: it is a wine ("your Krug cuvée", "je Sassicaia fles"). */
const WINE_WORDS = /*#__PURE__*/ set(
  "wine wines bottle bottles magnum red reds white whites rose cuvee vintage vintages wijn wijnen fles flessen rood rode wit witte jaargang sparkling bubbly",
);
/**
 * Lowercase words that may follow a wine's name without making it the name of something else ("your Krug is …",
 * "jouw Tignanello past …"). Any other lowercase word right after a capitalised name is read as the noun it
 * describes ("your Riedel glasses", "je Indonesische rijsttafel", "your Tuscany trip"): not a wine.
 */
const AFTER_NAME = /*#__PURE__*/ set(`
  is are was were will would could should can may might must has have had needs need deserves suits suit works goes
  pairs matches makes keeps drinks tastes stays remains looks sounds lets fits shines loves wants calls asks gives
  brings and or but nor with from in at for to of on by as than which that who whose really still also too here
  there now tonight today first next instead again already just only perfectly beautifully nicely well better best
  ist zijn waren wordt worden past passen kan kunnen moet moeten mag zal zou heeft hebben smaakt blijft lijkt
  verdient en of maar met uit van in bij voor op aan als dan die dat wat nog ook nu hier daar vanavond straks eerst
  echt goed beter best prima perfect mooi er hem het een de al maar zo dus wel niet even gewoon zeker alvast rustig
  a an the so not then right slowly gently about around
`);
/** A sentence that says what a wine does in the glass: what it names is a wine. */
const DRINK_SIGNAL =
  /\b(?:ready to drink|drinking (?:well|beautifully|nicely|now)|at its peak|op dronk|drinkklaar|klaar om te drinken|op zijn best|needs? (?:air|decanting|time in the glass)|decant(?:ed|ing)?|pour(?:ed|ing)?|uncork|tannins?|op de dronk|ontkurk|decanteer|gekoeld|well chilled|ready to open|klaar om te openen|open (?:it|that|this one|hem|die|deze))\b/i;
/** Words that only occur in wine names: a capitalised name holding one is a wine ("Les 7 Cépages", "Cuvée 1523"). */
const WINE_NAME_WORDS = /*#__PURE__*/ set(`
  cuvee cuvees cepages cru crus premier grand reserve reserva riserva gran crianza vignes vieilles clos cote cotes
  coteaux blanc blancs rouge rosso bianco tinto brut sec demi spatlese auslese kabinett trocken classico superiore
  villages chateau domaine tenuta bodega bodegas weingut cantina quinta podere fattoria schloss maison castello vin
  vino vinho wein sekt cremant spumante champagne
`);

const NUMBER_WORDS: ReadonlyMap<string, number> = /*#__PURE__*/ new Map([
  ["one", 1],
  ["two", 2],
  ["three", 3],
  ["four", 4],
  ["five", 5],
  ["six", 6],
  ["seven", 7],
  ["eight", 8],
  ["nine", 9],
  ["ten", 10],
  ["eleven", 11],
  ["twelve", 12],
  ["thirteen", 13],
  ["fourteen", 14],
  ["fifteen", 15],
  ["sixteen", 16],
  ["seventeen", 17],
  ["eighteen", 18],
  ["nineteen", 19],
  ["twenty", 20],
  ["dozen", 12],
  ["twee", 2],
  ["drie", 3],
  ["vier", 4],
  ["vijf", 5],
  ["zes", 6],
  ["zeven", 7],
  ["acht", 8],
  ["negen", 9],
  ["tien", 10],
  ["elf", 11],
  ["twaalf", 12],
  ["dertien", 13],
  ["veertien", 14],
  ["vijftien", 15],
  ["zestien", 16],
  ["zeventien", 17],
  ["achttien", 18],
  ["negentien", 19],
  ["twintig", 20],
  ["dozijn", 12],
]);

/** Abbreviations whose full stop does not end a sentence. */
const ABBREVIATIONS = /*#__PURE__*/ set(
  "eg ie e g i st ste ch dom mr mrs ms dr vs ca bijv nr resp approx incl excl mt no vol",
);

// ---- Money, shops and actions (read on the sentence as written) -----------------------------------------------

const MONEY =
  /[€$£¥]|\b(?:eur|euro|euros|usd|gbp|chf|sek|nok|dkk|dollar|dollars|bucks|francs?|kron(?:a|or|er|en)|yen|tientje|tientjes|eurocent|eurocents)\b/i;
const CENTS = /\b\d+\s*(?:cent|cents)\b|\b\d+\s*kr\b|\bkr\.?\s*\d/i;
/** "25-30 per bottle", "zo'n 25 tot 30 per fles", "usually 25 a bottle": an amount per bottle needs no currency. */
const PER_BOTTLE =
  /\b\d{1,4}(?:[.,]\d{1,2})?(?:\s*(?:-|–|—|to|tot)\s*\d{1,4}(?:[.,]\d{1,2})?)?\s*(?:per bottle|a bottle|each|per fles|de fles|per stuk|a pop)\b/i;
const DUTCH_PRICE = /\b\d+,[-–]{1,2}(?=\s|$|[.,;!?)])/;
/** "buy it at Sligro", "haal hem bij Hanos": a buy verb and a named place to buy it. */
const BUY_AT =
  /\b(?:[Bb]uy|[Gg]et|[Oo]rder|[Pp]ick up|[Ff]ind|[Ll]ook for|[Kk]oop|[Hh]aal|[Bb]estel|[Vv]ind|[Zz]oek)\b[^.!?]{0,40}?\b(?:at|bij|via)\s+(?:de\s+|the\s+)?(\p{Lu}[\p{L}&'-]+)/u;
/** In a buy entry: "Tignanello 2019 — at Sligro". */
const AT_NAME = /\b(?:at|bij|via)\s+(?:de\s+|the\s+)?(\p{Lu}[\p{L}&'-]+)/u;
const PRICE_WORD =
  /\b(?:prices?|priced|pricing|prijs|prijzen|costs?|costing|kost|kosten|kostte|pay|paying|betaal|betaalt|betalen|retails?|sells? for|verkocht voor)\b[^.!?\d]{0,20}\d{1,3}(?:[.,]\d{1,2})?\b(?!\d)/i;

const AVAILABILITY: readonly RegExp[] = [
  /\b(?:available|verkrijgbaar|leverbaar|te koop|for sale|sold|te krijgen|te vinden)\s+(?:at|from|in|via|bij|on|online|op)\b/i,
  /\b(?:widely|readily|easily|generally|commonly|overal|ruim|breed|goed|makkelijk|gemakkelijk|vaak)\s+(?:available|verkrijgbaar|leverbaar|te vinden|te krijgen|to find|found)\b/i,
  /\b(?:easy|hard|difficult|makkelijk|moeilijk|lastig)\s+(?:to find|to get|te vinden|te krijgen|verkrijgbaar)\b/i,
  /\b(?:in stock|out of stock|on stock|op voorraad|uit voorraad|uitverkocht|sold out|on offer|in de aanbieding|in de uitverkoop|on sale)\b/i,
  /\b(?:at|from|bij|via|in|op)\s+(?:(?:the|your|a|any|most|de|het|je|een|elke|iedere|meeste|local|lokale|good|goede|nearest|dichtstbijzijnde|well-stocked|online)\s+){0,3}(?:supermarkets?|supermarkt(?:en)?|wine ?shops?|wine ?stores?|wine ?merchants?|liquor stores?|bottle shops?|off-licen[cs]es?|slijter(?:ij|s)?|wijnwinkels?|wijnhandel(?:s|aars?)?|wijnspeciaalzaak|webshops?|online shops?|retailers?|shops?|stores?|winkels?)\b/i,
  /\b(?:order|buy|get)\s+(?:it|them|one|some)?\s*online\b|\bonline\s+(?:bestellen|kopen|te koop|besteld)\b/i,
  /\b(?:Albert Heijn|AH|Gall ?& ?Gall|Jumbo|Lidl|Aldi|Mitra|Wijnvoordeel|Waitrose|Tesco|Sainsbury'?s|Majestic Wine|Costco|Total Wine|Carrefour|Delhaize|Colruyt|Systembolaget|Vinmonopolet|Wine-Searcher|Amazon|bol\.com|Vomar|Hoogvliet|Dirk van den Broek|Sligro|De Wijnbeurs|Wijnbeurs|Vinatis|Hanos|Henri Bloem|Makro|Metro)\b/,
  /\bbij (?:de )?ah\b/i,
];

const ACTION: readonly RegExp[] = [
  /\b(?:i|we)(?:\s+have|\s*'ve|\s+had)?\s+(?:just\s+|already\s+|also\s+|now\s+|gone ahead and\s+)?(?:reserved|moved|ordered|removed|booked|bought|purchased|marked|saved|deleted|logged|scheduled|chilled|decanted|opened|transferred|set aside|put aside|noted down)\b/i,
  /\b(?:i|we)(?:\s+have|\s*'ve)?\s+(?:just\s+|already\s+|also\s+)?added\b[^.!?]{0,60}\b(?:to|aan)\s+(?:your|the|de|je)\b/i,
  /\b(?:i\s*(?:'ll|’ll|will|shall|am going to|'m going to|’m going to)|we\s*(?:'ll|’ll|will)|let me|i can)\s+(?:also\s+|now\s+|just\s+|go ahead and\s+)?(?:reserve|move|add|order|open|remove|book|buy|purchase|mark|save|note|update|delete|log|schedule|remind|chill|decant|put aside|set aside|transfer)\b(?!\s+(?:that|this|one thing|a note that)\b)/i,
  /\b(?:ik|we)\s+(?:heb|hebben)\b[^.!?,;]{0,60}?\b(?:gereserveerd|verplaatst|toegevoegd|besteld|geopend|opengetrokken|verwijderd|gemarkeerd|opgeslagen|genoteerd|gekocht|apart gezet|apartgezet|klaargezet|koud gezet|koudgezet|ingepland|bijgewerkt|gedecanteerd|vastgelegd)\b/i,
  /\b(?:heb|hebben)\s+(?:ik|we)\b[^.!?,;]{0,60}?\b(?:gereserveerd|verplaatst|toegevoegd|besteld|geopend|opengetrokken|verwijderd|gemarkeerd|opgeslagen|genoteerd|gekocht|apart gezet|apartgezet|klaargezet|koud gezet|koudgezet|ingepland|gedecanteerd)\b/i,
  /\b(?:ik\s+(?:ga|zal)|we\s+(?:gaan|zullen)|laat\s+me|ik\s+kan)\b(?!\s+ervan\s+uit)[^.!?,;]{0,40}?\b(?:reserveren|verplaatsen|toevoegen|bestellen|openen|opentrekken|verwijderen|markeren|opslaan|noteren|kopen|apart zetten|klaarzetten|koud zetten|inplannen|herinneren|decanteren)\b/i,
  /\bik\s+(?:reserveer|bestel|verplaats|noteer|markeer)\b/i,
  // A verb and its particle with words between: "I've set the Barolo aside", "ik zet de Musar apart".
  /\b(?:i|we)(?:\s+have|\s*'ve|\s+had|\s*'ll|\s+will|\s+am going to|\s*'m going to)?\s+(?:just\s+|already\s+|also\s+)?(?:set|put|placed|place|laid|lay|moved|move|kept)\b[^.!?;]{0,40}?\b(?:aside|away|in the fridge|in your fridge|into the fridge|on ice|in the rack|in your rack|to chill)\b/i,
  /\blet me\s+(?:set|put|place|lay|move)\b[^.!?;]{0,40}?\b(?:aside|away|in the fridge|in your fridge|on ice)\b/i,
  /\b(?:ik|we)\s+(?:zet|zetten|leg|leggen)\b[^.!?;]{0,40}?\b(?:apart|klaar|koud|opzij|in de koelkast|in je koelkast|in het rek)\b/i,
  /\b(?:ik|we)\s+(?:heb|hebben)\b[^.!?;]{0,60}?\b(?:gelegd|gezet|neergezet|weggezet|opzij gezet|apart gelegd|klaargelegd)\b/i,
  // "Done: the Musar is now reserved", "Klaar, de Musar staat nu gereserveerd".
  /\b(?:is|are|has been|have been)\s+now\s+(?:reserved|moved|ordered|added|booked|marked|set aside)\b/i,
  /\b(?:done|all set|klaar|gedaan|geregeld)\b\s*[:!,.–—-][^.!?]{0,60}\b(?:reserved|moved|ordered|added|booked|gereserveerd|verplaatst|besteld|toegevoegd)\b/i,
  /\b(?:staat|staan|is|zijn)\s+nu\s+(?:gereserveerd|verplaatst|besteld|toegevoegd|apart gezet)\b/i,
];

// ---- The cellar, indexed for this check -----------------------------------------------------------------------

/**
 * Producers, names, regions and places repeat across a cellar and across questions: each distinct string is
 * normalised once and kept (a bounded cache of plain strings; it changes no result, only the time it takes).
 */
const WORDS_CACHE = new Map<string, readonly string[]>();
const WORDS_CACHE_MAX = 50_000;
function cachedWords(text: string): readonly string[] {
  let out = WORDS_CACHE.get(text);
  if (!out) {
    if (WORDS_CACHE.size >= WORDS_CACHE_MAX) WORDS_CACHE.clear();
    out = words(text);
    WORDS_CACHE.set(text, out);
  }
  return out;
}

/** normalizeText's words; plain ASCII (most names) takes a shortcut with the same result. */
const words = (text: string) =>
  (/^[\x20-\x7e]*$/.test(text)
    ? text.toLowerCase().replace(/[^a-z0-9]+/g, " ")
    : normalizeText(text)
  )
    .split(" ")
    .filter(Boolean);

interface Group {
  items: CellarItem[];
  vintages: Set<number | null>;
  /** Bottles of this wine over every vintage. */
  total: number;
  /** Producer key (normalised), to find a producer's other wines. */
  producer: string;
  wineTokens: readonly string[];
}

interface Phrase {
  tokens: readonly string[];
  groups: Group[];
  kind: "wine" | "producer";
  /** Made of generic words only ("Langhe Nebbiolo"): a name only while one wine in the cellar has it. */
  weak: boolean;
}

interface Haystack {
  item: CellarItem;
  /** Every word of its producer, name, region, appellation, country and places. */
  words: Set<string>;
  regions: Set<string>;
  /** The line says which appellation it is (a field, or a known appellation in its name). */
  appellationKnown: boolean;
}

interface CellarWords {
  haystacks: Haystack[];
  haystackOf: Map<CellarItem, Haystack>;
  /** Every word of the haystacks → the wines whose words hold it. */
  wordItems: Map<string, CellarItem[]>;
}

interface Cellar {
  groups: Group[];
  groupOf: Map<CellarItem, Group>;
  /** First token → phrases starting with it, longest first. */
  phrases: Map<string, Phrase[]>;
  /** The words of every wine (built on first use: most answers never need them). */
  hay: () => CellarWords;
  byType: Map<WineType, CellarItem[]>;
  /** The distinctive words of the cellar's producers ("musar", "vajra"). */
  producerWords: Set<string>;
  /** The words of the places bottles lie in ("Wine fridge"). */
  placeWords: Set<string>;
  types: Set<WineType>;
  years: Set<number>;
  /** Bottles of each wine (by wineId), over all its vintages. */
  wineTotals: Map<string, number>;
}

const free = (i: CellarItem) => Math.max(0, i.count - (i.reserved?.count ?? 0));

function indexCellar(items: readonly CellarItem[]): Cellar {
  const tok = (text: string | null | undefined) => cachedWords(text ?? "");
  const per = items.map((item) => ({
    item,
    p: tok(item.producer),
    w: tok(item.wineName),
    ra: [...tok(item.region), ...tok(item.appellation)],
  }));

  const byKey = new Map<string, Group>();
  const groupOf = new Map<CellarItem, Group>();
  const wineTotals = new Map<string, number>();
  for (const { item, p, w } of per) {
    const producer = p.join(" ");
    const key = `${producer}|${w.join(" ")}`;
    let group = byKey.get(key);
    if (!group) {
      group = { items: [], vintages: new Set(), total: 0, producer, wineTokens: w };
      byKey.set(key, group);
    }
    group.items.push(item);
    group.vintages.add(item.year);
    group.total += item.count;
    groupOf.set(item, group);
    wineTotals.set(item.wineId, (wineTotals.get(item.wineId) ?? 0) + item.count);
  }
  const groups = [...byKey.values()];

  // A word is generic in this cellar when it is a region or appellation, or in several producers' wine names.
  const local = new Set<string>();
  const producersOf = new Map<string, Set<string>>();
  for (const { p, w, ra } of per) {
    for (const x of ra) local.add(x);
    const producer = p.join(" ");
    for (const x of w) {
      const seen = producersOf.get(x);
      if (seen) seen.add(producer);
      else producersOf.set(x, new Set([producer]));
    }
  }
  for (const [x, producers] of producersOf) if (producers.size > 1) local.add(x);
  const distinctiveSeen = new Map<string, boolean>();
  const distinctive = (x: string) => {
    let d = distinctiveSeen.get(x);
    if (d === undefined) {
      d = isDistinctive(x);
      distinctiveSeen.set(x, d);
    }
    return d;
  };
  const isDistinctive = (x: string) =>
    x.length >= 3 &&
    // A number is part of a name ("Cuvée 1522"), unless it could be a vintage.
    (!/^\d+$/.test(x) || Number(x) < 1800) &&
    !GENERIC.has(x) &&
    !GRAPES.has(x) &&
    !APPELLATIONS.has(x) &&
    !local.has(x);
  const usable = (tokens: readonly string[]) =>
    (tokens.some(distinctive) && (tokens.length > 1 || (tokens[0]?.length ?? 0) >= 4)) ||
    // "Château Margaux", "Domaine Leflaive": an estate word and its name is one estate, even when the name is
    // also an appellation.
    (tokens.length >= 2 && ESTATE.has(tokens[0]!) && !CONNECTORS.has(tokens[1]!));
  /** The name without generic words at its edges: "Château Musar" → "musar", "Barolo Albe" → "albe". */
  const core = (tokens: readonly string[]) => {
    let a = 0;
    let b = tokens.length;
    const weak = (x: string | undefined) => x === undefined || !distinctive(x);
    while (a < b && weak(tokens[a])) a += 1;
    while (b > a && weak(tokens[b - 1])) b -= 1;
    return tokens.slice(a, b);
  };

  const byPhrase = new Map<string, Phrase>();
  // A wine's whole name of two or more words that holds an appellation or a region ("Langhe Nebbiolo").
  const placeName = (tokens: readonly string[]) =>
    tokens.length >= 2 && tokens.some((t) => APPELLATIONS.has(t) || local.has(t));
  const add = (tokens: readonly string[], group: Group, kind: Phrase["kind"]) => {
    if (tokens.length === 0) return;
    const weak = !usable(tokens);
    if (weak && (kind === "producer" || !placeName(tokens))) return;
    const key = `${kind}:${tokens.join(" ")}`;
    let phrase = byPhrase.get(key);
    if (!phrase) {
      phrase = { tokens, groups: [], kind, weak };
      byPhrase.set(key, phrase);
    }
    // A group adds the same phrase only right after itself (its full name may equal its own name).
    if (phrase.groups.at(-1) !== group) phrase.groups.push(group);
  };
  const byProducer = new Map<string, Group[]>();
  for (const group of groups) {
    const p = tok(group.items[0]!.producer);
    const w = group.wineTokens;
    const startsWithProducer = p.length > 0 && p.every((t, i) => w[i] === t);
    add(startsWithProducer ? w : [...p, ...w], group, "wine");
    add(w, group, "wine");
    add(core(w), group, "wine");
    const list = byProducer.get(group.producer);
    if (list) list.push(group);
    else byProducer.set(group.producer, [group]);
  }
  // A producer stands for all its wines (grouped once: linear in the cellar's size).
  const producerWords = new Set<string>();
  for (const list of byProducer.values()) {
    const p = tok(list[0]!.items[0]!.producer);
    const c = core(p);
    for (const g of list) {
      add(p, g, "producer");
      add(c, g, "producer");
    }
    for (const t of c) if (distinctive(t)) producerWords.add(t);
  }
  const phrases = new Map<string, Phrase[]>();
  for (const phrase of byPhrase.values()) {
    const list = phrases.get(phrase.tokens[0]!);
    if (list) list.push(phrase);
    else phrases.set(phrase.tokens[0]!, [phrase]);
  }
  for (const list of phrases.values())
    list.sort((a, b) => b.tokens.length - a.tokens.length || (a.kind === "wine" ? -1 : 1));

  const placeWords = new Set<string>();
  for (const item of items)
    for (const label of item.places)
      for (const t of tok(label)) if (t.length >= 3) placeWords.add(t);
  // Every word of every wine, for reading a name after "your": built the first time a sentence needs it.
  let words_: CellarWords | null = null;
  const hay = () => {
    if (words_) return words_;
    const wordItems = new Map<string, CellarItem[]>();
    const haystacks = per.map(({ item, p, w, ra }) => {
      const all = new Set([
        ...p,
        ...w,
        ...ra,
        ...tok(item.countryCode),
        ...item.places.flatMap((label) => tok(label)),
      ]);
      for (const x of all) {
        const list = wordItems.get(x);
        if (list) list.push(item);
        else wordItems.set(x, [item]);
      }
      return {
        item,
        words: all,
        regions: new Set(ra),
        appellationKnown: Boolean(item.appellation) || w.some((x) => APPELLATIONS.has(x)),
      };
    });
    words_ = { haystacks, haystackOf: new Map(haystacks.map((h) => [h.item, h])), wordItems };
    return words_;
  };
  const byType = new Map<WineType, CellarItem[]>();
  for (const item of items) {
    const list = byType.get(item.type);
    if (list) list.push(item);
    else byType.set(item.type, [item]);
  }
  return {
    groups,
    groupOf,
    phrases,
    hay,
    byType,
    producerWords,
    placeWords,
    types: new Set(items.map((i) => i.type)),
    years: new Set(items.flatMap((i) => (i.year === null ? [] : [i.year]))),
    wineTotals,
  };
}

// ---- Tokens and sentences -------------------------------------------------------------------------------------

interface Token {
  raw: string;
  /** normalizeText of a word; "" for punctuation and refs. */
  norm: string;
  kind: "word" | "ref" | "punct";
  start: number;
  end: number;
  /** Written with a capital first letter. */
  cap: boolean;
  /** For a ref: the cellar wine it stands for, or null when it is not on the list. */
  item?: CellarItem | null;
}

const TOKEN =
  /\[\[([^[\]\n]{0,64})\]\]|\[\s*([0-9a-fA-F][0-9a-fA-F-]{5,35})\s*\]|[\p{L}\p{N}]+|[^\s\p{L}\p{N}]/gu;

function tokenize(text: string, digest: CellarDigest): Token[] {
  const lookup = (ref: string) =>
    digest.refs.get(ref.trim()) ?? digest.refs.get(ref.trim().toLowerCase()) ?? null;
  const tokens: Token[] = [];
  for (const m of text.matchAll(TOKEN)) {
    const raw = m[0];
    const start = m.index;
    const end = start + raw.length;
    const ref = m[1] ?? m[2];
    if (ref !== undefined) {
      tokens.push({ raw, norm: "", kind: "ref", start, end, cap: false, item: lookup(ref) });
      continue;
    }
    if (/^[\p{L}\p{N}]/u.test(raw)) {
      // A bare ref the model forgot to put in brackets is still the wine it stands for.
      const bare = raw.length >= 6 && /^[0-9a-f]+$/.test(raw) ? digest.refs.get(raw) : undefined;
      if (bare) {
        tokens.push({ raw, norm: "", kind: "ref", start, end, cap: false, item: bare });
        continue;
      }
      tokens.push({
        raw,
        norm: normalizeText(raw),
        kind: "word",
        start,
        end,
        cap: /^\p{Lu}/u.test(raw),
      });
    } else tokens.push({ raw, norm: "", kind: "punct", start, end, cap: false });
  }
  return tokens;
}

interface Sentence {
  /** Where it starts and ends in the text (the end includes the space before the next one). */
  start: number;
  end: number;
  tokens: Token[];
  /** Words and refs only, in order. */
  w: Token[];
  question: boolean;
}

const ENDS = /*#__PURE__*/ new Set([".", "!", "?", "…"]);
const CLOSERS = /*#__PURE__*/ new Set([")", '"', "'", "”", "’", "»", "]"]);

function sentences(text: string, tokens: Token[]): Sentence[] {
  const cuts: number[] = [];
  for (let i = 0; i < tokens.length - 1; i += 1) {
    const t = tokens[i]!;
    let j = i + 1;
    const gapHasNewline = /\n/.test(text.slice(t.end, tokens[j]!.start));
    if (gapHasNewline) {
      cuts.push(j);
      continue;
    }
    if (t.kind !== "punct" || !ENDS.has(t.raw)) continue;
    while (j < tokens.length && (ENDS.has(tokens[j]!.raw) || CLOSERS.has(tokens[j]!.raw))) j += 1;
    const next = tokens[j];
    if (!next) break;
    if (!/\s/.test(text.slice(tokens[j - 1]!.end, next.start))) continue;
    if (/\n/.test(text.slice(tokens[j - 1]!.end, next.start))) {
      cuts.push(j);
      i = j - 1;
      continue;
    }
    const startsNew =
      next.kind === "ref" ||
      (next.kind === "word" && (next.cap || /^\d/.test(next.raw))) ||
      ['"', "“", "'", "‘", "(", "«"].includes(next.raw);
    if (!startsNew) continue;
    const before = tokens[i - 1];
    if (
      t.raw === "." &&
      before?.kind === "word" &&
      (/^\p{L}$/u.test(before.raw) || ABBREVIATIONS.has(before.norm))
    )
      continue;
    cuts.push(j);
    i = j - 1;
  }
  const out: Sentence[] = [];
  let from = 0;
  for (const cut of [...cuts, tokens.length]) {
    const list = tokens.slice(from, cut);
    if (list.length > 0) {
      const start = out.length === 0 ? 0 : list[0]!.start;
      const end = cut < tokens.length ? tokens[cut]!.start : text.length;
      const last = [...list].reverse().find((t) => t.kind === "punct" && ENDS.has(t.raw));
      out.push({
        start,
        end,
        tokens: list,
        w: list.filter((t) => t.kind !== "punct"),
        question: last?.raw === "?" || list.at(-1)?.raw === "?",
      });
    }
    from = cut;
  }
  return out;
}

// ---- Reading one sentence -------------------------------------------------------------------------------------

interface Mention {
  /** First and last index in the sentence's words. */
  a: number;
  b: number;
  groups: Group[];
  /** A ref: exactly this vintage. */
  item: CellarItem | null;
  kind: "ref" | Phrase["kind"];
  /** The words are the producer's own name ("Château Margaux" is both an estate and its first wine). */
  producer: boolean;
}

function mentionsIn(w: readonly Token[], cellar: Cellar): Mention[] {
  const out: Mention[] = [];
  for (let i = 0; i < w.length; i += 1) {
    const t = w[i]!;
    if (t.kind === "ref") {
      if (t.item)
        out.push({
          a: i,
          b: i,
          groups: [cellar.groupOf.get(t.item)!],
          item: t.item,
          kind: "ref",
          producer: false,
        });
      continue;
    }
    const found = (cellar.phrases.get(t.norm) ?? []).find(
      (p) =>
        (!p.weak || p.groups.length === 1) &&
        p.tokens.every((tok, k) => w[i + k]?.kind === "word" && w[i + k]!.norm === tok) &&
        // One word is a name only when written as one.
        (p.tokens.length > 1 || t.cap),
    );
    if (!found) continue;
    // "Vajra Barolo Albe": a producer right before one of its own wines is one mention of that wine.
    const prev = out.at(-1);
    const shared =
      prev && prev.b === i - 1 ? prev.groups.filter((g) => found.groups.includes(g)) : [];
    if (prev && !prev.item && shared.length > 0) {
      prev.b = i + found.tokens.length - 1;
      prev.groups = shared;
      prev.kind = "wine";
      prev.producer = false;
      i += found.tokens.length - 1;
      continue;
    }
    // The same words as the producer's name stand for all its wines ("Château Margaux 2015" may be its second wine).
    const asProducer = (cellar.phrases.get(t.norm) ?? []).find(
      (p) => p.kind === "producer" && p.tokens.join(" ") === found.tokens.join(" "),
    );
    out.push({
      a: i,
      b: i + found.tokens.length - 1,
      groups: asProducer ? asProducer.groups : found.groups,
      item: null,
      kind: found.kind,
      producer: asProducer !== undefined,
    });
    i += found.tokens.length - 1;
  }
  return out;
}

const yearOf = (t: Token | undefined): number | null => {
  if (!t || t.kind !== "word" || !/^\d{4}$/.test(t.raw)) return null;
  const y = Number(t.raw);
  return y >= 1800 && y <= 2099 ? y : null;
};

/** Words between a wine's name and its year ("Musar from 2008", "Musar uit de 2008", "the 2008 vintage"). */
const AFTER_FILLERS = /*#__PURE__*/ set("from uit van of vintage jaargang s the de het");
const AFTER_FILLERS_ASIDE = /*#__PURE__*/ set(
  "from uit van of vintage jaargang s the de het a an een",
);

/** Before a year: it is a drinking window or a date, not a vintage. */
const WINDOW_BEFORE = /*#__PURE__*/ set(
  "until till by before after since in through to around circa ca tot vanaf voor na sinds rond omstreeks tussen between beyond past uiterlijk",
);

/** Part of a range ("2025–2030", "2025 to 2030"): a window. */
function inRange(text: string, w: readonly Token[], i: number): boolean {
  const gap = (a: Token | undefined, b: Token | undefined) =>
    a && b ? text.slice(a.end, b.start) : "";
  const prev = w[i - 1];
  const next = w[i + 1];
  if (yearOf(prev) !== null && /^\s*[-–—/]\s*$/.test(gap(prev, w[i]))) return true;
  if (yearOf(next) !== null && /^\s*[-–—/]\s*$/.test(gap(w[i], next))) return true;
  if (
    next &&
    ["to", "tot", "and", "en", "or", "of"].includes(next.norm) &&
    yearOf(w[i + 2]) !== null
  )
    return true;
  return false;
}

function numberOf(t: Token | undefined): number | null {
  if (!t || t.kind !== "word") return null;
  if (/^\d{1,3}$/.test(t.raw)) {
    const n = Number(t.raw);
    return n >= 1 ? n : null;
  }
  if (t.raw.toLowerCase() === "één") return 1;
  return NUMBER_WORDS.get(t.norm) ?? null;
}

const has = (w: readonly Token[], from: number, to: number, words: ReadonlySet<string>) => {
  for (let i = Math.max(0, from); i <= Math.min(w.length - 1, to); i += 1)
    if (words.has(w[i]!.norm)) return true;
  return false;
};

interface Context {
  text: string;
  cellar: Cellar;
  nowYear: number;
  /** Numbers the counted facts block stated: these were counted by code and may be restated. */
  factNumbers: ReadonlySet<number>;
  factWords: ReadonlySet<string>;
  /** The person's budget band, which the answer may say back. */
  band: readonly [number, number | null] | null;
}

/** Dutch "je" before a name is "your" only where it cannot be "you". */
function isPossessive(w: readonly Token[], i: number): boolean {
  const t = w[i]!;
  if (POSSESSIVE.has(t.norm)) return true;
  if (t.norm !== "je") return false;
  return i === 0 || JE_POSSESSIVE_AFTER.has(w[i - 1]!.norm);
}

/** "you have", "you've got", "je hebt", "heb je", "u heeft": the index of the verb, or -1. Not when negated. */
function haveAt(w: readonly Token[], i: number): "own" | "denied" | null {
  const t = w[i]!;
  if (!HAVE.has(t.norm)) return null;
  const subjectBefore =
    SUBJECT.has(w[i - 1]?.norm ?? "") ||
    (SUBJECT.has(w[i - 2]?.norm ?? "") &&
      set("still also only just already nog ook al alleen maar ve").has(w[i - 1]!.norm)) ||
    (t.norm === "got" && w[i - 1]?.norm === "ve" && SUBJECT.has(w[i - 2]?.norm ?? ""));
  const subjectAfter =
    set("heb hebt hebben heeft").has(t.norm) && SUBJECT.has(w[i + 1]?.norm ?? "");
  if (!subjectBefore && !subjectAfter) return null;
  // "you have to", "you have been": not about having wine.
  if (["to", "been", "had"].includes(w[i + 1]?.norm ?? "")) return null;
  if (t.norm === "ve" && w[i + 1]?.norm !== "got" && !SKIP_FORWARD.has(w[i + 1]?.norm ?? ""))
    return null;
  const start = subjectAfter ? i + 2 : i + 1;
  if (has(w, i - 3, i - 1, NEGATION) || has(w, start, start + 1, NEGATION)) return "denied";
  if (has(w, i - 3, i - 1, CONDITION)) return null;
  return "own";
}

/** "Have" that is not having: "in mind", "on your mind", "nodig" (need), "voor ogen", "zin in". */
const IDIOM_NOT_OWNED =
  /\b(?:in mind|on your mind|a taste for|a soft spot for|nodig|in gedachten|voor ogen|zin in)\b/i;

/** The sentence says the person does not have something: claims in it are not read as ownership. */
const DENIAL =
  /\b(?:don'?t|do not|doesn'?t|haven'?t|have no|has no|have none|not in your|isn'?t in your|nothing in your|heb je niet|hebt geen|heeft geen|hebben geen|heb je geen|niet in je|niet in jouw|niet in uw|niets in je|geen\s+\S+\s+in je)\b/i;

interface Found {
  codes: Set<CheckCode>;
  /** A cellar fact is wrong (not only a name): the whole text goes, not just this sentence. */
  fatal: boolean;
  /** A year written right after a ref that only repeats the ref's own year (left out when rendering). */
  repeatYears: Set<Token>;
}

/** Reads one sentence; `previous` is what the sentence before it named ("…Musar. You have 3 bottles of it."). */
function readSentence(
  s: Sentence,
  ctx: Context,
  found: Found,
  previous: readonly Mention[],
): Mention[] {
  const { w } = s;
  const raw = ctx.text.slice(s.start, s.end).replace(/’/g, "'");
  const norms = w.map((t) => t.norm);
  const sentenceNotOwned = norms.some((n) => NOT_OWNED.has(n) || NEGATION.has(n));
  const denied = DENIAL.test(raw);

  const fail = (code: "unknown-ref" | "wrong-vintage" | "wrong-count") => {
    found.codes.add(code);
    found.fatal = true;
  };
  for (const t of w) if (t.kind === "ref" && !t.item) fail("unknown-ref");

  const mentions = mentionsIn(w, ctx.cellar);
  const inMention = new Set<number>();
  for (const m of mentions) for (let i = m.a; i <= m.b; i += 1) inMention.add(i);

  const vintagesOf = (groups: readonly Group[]) => {
    const out = new Set<number>();
    for (const g of groups) for (const y of g.vintages) if (y !== null) out.add(y);
    return out;
  };
  const isVintageClaim = (i: number) => {
    const y = yearOf(w[i]);
    if (y === null || inMention.has(i)) return null;
    if (y > ctx.nowYear || inRange(ctx.text, w, i)) return null;
    if (WINDOW_BEFORE.has(w[i - 1]?.norm ?? "")) return null;
    return y;
  };
  const wrongYear = (y: number, allowed: ReadonlySet<number>) =>
    !allowed.has(y) && !ctx.factNumbers.has(y);

  // ---- Years next to a cellar wine's name ----
  for (const m of mentions) {
    // After: "Musar 2008", "Musar (2008)", "Musar from 2008", "de Musar uit 2008".
    // Also an aside: "Your Musar, the 2008, is lovely", "Musar – 2008 –", "[[ref]], a 2008,", "from the 2008 vintage".
    let j = m.b + 1;
    let fillers = 0;
    const firstGap = w[j] ? ctx.text.slice(w[m.b]!.end, w[j]!.start) : "";
    const aside = /[,–—]|\s-\s/.test(firstGap);
    const fillerWords = aside ? AFTER_FILLERS_ASIDE : AFTER_FILLERS;
    while (fillers < 3 && fillerWords.has(w[j]?.norm ?? "")) {
      j += 1;
      fillers += 1;
    }
    const gapAfter = w[j] ? ctx.text.slice(w[j - 1]!.end, w[j]!.start) : "";
    const closesAside = w[j] ? /^\s*(?:[,)–—]|-\s|$)/.test(ctx.text.slice(w[j]!.end)) : false;
    const after =
      (fillers > 0 ? /^\s*$/.test(gapAfter) : /^[\s(]*$/.test(gapAfter) || aside) &&
      (!aside || closesAside) &&
      !WINDOW_BEFORE.has(w[j - 1]?.norm ?? "")
        ? isVintageClaim(j)
        : null;
    // Before: "the 2008 Musar" (only a space between).
    const before =
      w[m.a - 1] && /^\s+$/.test(ctx.text.slice(w[m.a - 1]!.end, w[m.a]!.start))
        ? isVintageClaim(m.a - 1)
        : null;
    for (const [y, lead] of [
      [after, m.a],
      [before, m.a - 1],
    ] as const) {
      if (y === null) continue;
      if (m.item) {
        // A ref is one vintage: a year beside it is that vintage or a contradiction.
        if (y === m.item.year) {
          if (lead === m.a && fillers === 0 && !aside) found.repeatYears.add(w[j]!);
        } else fail("wrong-vintage");
        continue;
      }
      if (!wrongYear(y, vintagesOf(m.groups))) continue;
      const signal = ownershipBefore(w, lead, m.b, j);
      if (signal === "strong" ? !denied : signal === "medium" && !sentenceNotOwned && !denied)
        fail("wrong-vintage");
    }
  }

  // ---- Ownership phrases: "your X", "you have X", "open the X", "X in your cellar", "the X is ready to drink" ----
  const claims: Claim[] = [];
  for (let i = 0; i < w.length; i += 1) {
    const poss = isPossessive(w, i);
    const have = poss ? null : haveAt(w, i);
    if (!poss && have !== "own") continue;
    if (poss && FOOD_PREP.has(w[i - 1]?.norm ?? "")) continue;
    if (poss && has(w, i - 3, i - 1, CONDITION)) continue;
    let j = i + 1;
    if (have && set("je jij u jullie").has(w[j]?.norm ?? "")) j += 1;
    const years: number[] = [];
    for (let steps = 0; steps < 6 && w[j]; steps += 1) {
      const y = isVintageClaim(j);
      if (y !== null) years.push(y);
      else if (!SKIP_FORWARD.has(w[j]!.norm) && numberOf(w[j]) === null) break;
      j += 1;
    }
    claims.push({ head: j, years, viaHave: have === "own", source: have ? "have" : "poss" });
  }
  // "Open the Musar", "grab the Sassicaia", "go for the Tignanello", "decanteer je Barolo": only a bottle the person
  // has can be opened or picked.
  for (let i = 0; i < w.length - 2; i += 1) {
    const verb = w[i]!.norm === "for" && w[i - 1]?.norm === "go" ? "go for" : w[i]!.norm;
    if (verb !== "go for" && !OPEN_THE.has(verb)) continue;
    if (!DEFINITE.has(w[i + 1]!.norm) && !POSSESSIVE.has(w[i + 1]!.norm) && w[i + 1]!.norm !== "je")
      continue;
    if (has(w, i - 3, i - 1, CONDITION)) continue;
    // "Open the 2012 first": a year alone is a vintage the person is said to have.
    let j = i + 2;
    const years: number[] = [];
    for (let y = isVintageClaim(j); y !== null; y = isVintageClaim(j)) {
      years.push(y);
      j += 1;
    }
    claims.push({ head: j, years, viaHave: true, source: "open", verb });
  }
  // "the Barolo in your cellar", "de Barolo in je kelder", "the Sassicaia from the rack": the name before it.
  for (let k = 1; k < w.length - 2; k += 1) {
    const place = placeAt(w, k, ctx);
    if (!place) continue;
    let j = k - 1;
    const back = set(
      "you have ve got is are there lies lie ligt liggen staat staan er nog still already also ook al the a an de het een of van bottle bottles fles flessen",
    );
    const years: number[] = [];
    while (j >= 0 && (back.has(w[j]!.norm) || isVintageClaim(j) !== null)) {
      const y = isVintageClaim(j);
      if (y !== null) years.push(y);
      j -= 1;
    }
    if (j < 0) continue;
    const named = mentions.find((m) => m.b === j);
    // Walk back over a capitalised name to its first word; a capital that only starts the sentence ("Open") or a
    // determiner is not part of it.
    let a = j;
    while (a > 0 && (w[a - 1]!.cap || CONNECTORS.has(w[a - 1]!.norm)) && w[a - 1]!.kind === "word")
      a -= 1;
    const lead = (n: string) =>
      CONNECTORS.has(n) ||
      IMPERATIVE.has(n) ||
      DEFINITE.has(n) ||
      INDEFINITE.has(n) ||
      SKIP_FORWARD.has(n) ||
      STOP_CAPS.has(n);
    while (a < j && lead(w[a]!.norm)) a += 1;
    const head = named ? named.a : w[j]!.cap ? a : j;
    // "There is no Sassicaia in your cellar": said not to be there.
    if (has(w, head - 2, head - 1, NEGATION)) continue;
    // "A Chablis in the fridge would be perfect": only "your" places claim a bottle in a sentence that wonders.
    if (!place.yours && (sentenceNotOwned || INDEFINITE.has(w[head - 1]?.norm ?? ""))) continue;
    claims.push({ head, years, viaHave: true, source: "place" });
  }
  // Dutch order, "in je kelder ligt (nog) een Sassicaia", "in your cellar you have a …".
  for (let k = 0; k < w.length - 3; k += 1) {
    if (!set("in uit").has(w[k]!.norm) || !set("your je jouw uw").has(w[k + 1]!.norm)) continue;
    if (!set("cellar kelder wijnkelder").has(w[k + 2]!.norm)) continue;
    let j = k + 3;
    const verbs = set("ligt liggen staat staan zit zitten heb hebt is are have");
    if (!has(w, j, j + 2, verbs)) continue;
    const skip = set(
      "ligt liggen staat staan zit zitten heb hebt is are have you je jij er there nog still ook also een a an de het the",
    );
    while (w[j] && skip.has(w[j]!.norm)) j += 1;
    if (w[j] && !has(w, k + 3, j - 1, NEGATION))
      claims.push({ head: j, years: [], viaHave: true, source: "place" });
  }
  // "The Tignanello is ready to drink now": a named bottle said to be in the glass soon is one the person has.
  if (DRINK_SIGNAL.test(raw) && !sentenceNotOwned)
    for (let i = 0; i < w.length - 1; i += 1)
      if (set("the de het").has(w[i]!.norm) && w[i + 1]!.cap && w[i + 1]!.kind === "word")
        claims.push({ head: i + 1, years: [], viaHave: true, source: "definite" });

  const counted = w.some((t, k) => numberOf(t) !== null && BOTTLE.has(w[k + 1]?.norm ?? ""));
  for (const claim of claims) {
    const outcome = readHead(w, claim, ctx, mentions, raw);
    if (outcome === null) {
      // "your 2015" with nothing after it that names a wine: some wine of that year must be in the cellar.
      const next = w[claim.head];
      const bare =
        !next ||
        set(
          "is was will has needs can should would could still deserves and or en of wordt heeft kan moet mag zal verdient first now tonight today next for with eerst nu vanavond vandaag straks voor bij met",
        ).has(next.norm);
      if (bare && !denied)
        for (const y of claim.years) if (wrongYear(y, ctx.cellar.years)) fail("wrong-vintage");
      continue;
    }
    if (outcome.kind === "owned") {
      if (!denied)
        for (const y of [...claim.years, ...outcome.years])
          if (wrongYear(y, outcome.vintages)) fail("wrong-vintage");
      continue;
    }
    // Not in the cellar: only a statement (not a question, a condition or a denial) claims it.
    if (s.question || denied) continue;
    if (claim.viaHave && has(w, 0, claim.head, CONDITION)) continue;
    // "you have Burgundy in mind", "je hebt Bourgogne nodig": wanting it, not having it.
    if (claim.viaHave && IDIOM_NOT_OWNED.test(raw)) continue;
    found.codes.add("not-in-cellar");
    // With a vintage or a number of bottles it is an invented cellar fact; a name alone loses only its sentence.
    if (claim.years.length > 0 || outcome.years.length > 0 || counted) found.fatal = true;
  }

  // ---- Bottle counts ----
  /** A number of bottles said to be there: the vintage's count, reserved or free, or the wine's (estate's) total. */
  function stock(n: number, bound: Mention) {
    const items = bound.item ? [bound.item] : bound.groups.flatMap((g) => g.items);
    const allowed = new Set<number>(bound.groups.map((g) => g.total));
    if (bound.producer || bound.kind === "producer") {
      const producers = new Set(bound.groups.map((g) => g.producer));
      allowed.add(
        ctx.cellar.groups
          .filter((g) => producers.has(g.producer))
          .reduce((sum, g) => sum + g.total, 0),
      );
    }
    for (const i of items) {
      allowed.add(ctx.cellar.wineTotals.get(i.wineId) ?? i.count);
      allowed.add(i.count);
      allowed.add(free(i));
      if (i.reserved) allowed.add(i.reserved.count);
    }
    if (!allowed.has(n) && !ctx.factNumbers.has(n)) fail("wrong-count");
  }
  for (let k = 0; k < w.length; k += 1) {
    if (inMention.has(k)) continue;
    // "half a dozen" is six.
    const half = w[k]!.norm === "dozen" && w[k - 1]?.norm === "a" && w[k - 2]?.norm === "half";
    const n = half ? 6 : numberOf(w[k]);
    if (
      n === null ||
      (w[k]!.norm === "one" && !BOTTLE.has(w[k + 1]?.norm ?? "") && w[k + 1]?.norm !== "of")
    )
      continue;
    const next = w[k + 1]?.norm ?? "";
    if (UNITS.has(next)) continue;
    const bottle = BOTTLE.has(next) || (COUNT_ADJ.has(next) && BOTTLE.has(w[k + 2]?.norm ?? ""));
    const ofThem =
      (next === "of" && set("them these those it").has(w[k + 2]?.norm ?? "")) ||
      set("daarvan ervan").has(next);
    const haveRightBefore =
      HAVE.has(w[k - 1]?.norm ?? "") ||
      (HAVE.has(w[k - 2]?.norm ?? "") && set("er nog still only just maar").has(w[k - 1]!.norm)) ||
      (HAVE.has(w[k - 3]?.norm ?? "") && w[k - 2]?.norm === "er" && w[k - 1]?.norm === "nog");
    // "With 9 [[ref]] in the cellar", "there are still 9 of the Musar".
    const mentionAt = (j: number) => mentions.some((m) => m.a === j);
    // Only a ref right after a number: a plain name after it may be part of a name ("Les 8 Cépages").
    const direct = mentions.some((m) => m.a === k + 1 && m.item !== null);
    const ofMention =
      set("of van").has(next) &&
      (mentionAt(k + 2) ||
        (set("the de het your je").has(w[k + 2]?.norm ?? "") && mentionAt(k + 3)));
    if (!bottle && !ofThem && !haveRightBefore && !direct && !ofMention) continue;
    // What decides: the nearest word before that says "have" or "open"; a "need" after it ("nodig") is advice.
    let kind: "stock" | "suggest" | null = null;
    for (let i = k - 1; i >= Math.max(0, k - 4) && kind === null; i -= 1) {
      const t = w[i]!.norm;
      // "open je twee flessen", "pour you two glasses": a verb before its subject still decides.
      const before = w[i - 1]?.norm ?? "";
      if (SUBJECT.has(t) && (SUGGEST_BEFORE.has(before) || OPEN_VERBS.has(before)))
        kind = "suggest";
      else if (SUGGEST_BEFORE.has(t)) kind = "suggest";
      else if (STOCK_BEFORE.has(t)) kind = "stock";
    }
    if (has(w, k + 1, k + 6, set("nodig needed required"))) kind = "suggest";
    if (kind === null && has(w, k + 1, k + 5, STOCK_AFTER)) kind = "stock";
    if (kind === null) continue;
    const opens = kind === "suggest" && has(w, k - 3, k - 1, OPEN_VERBS);
    if (kind === "suggest" && !opens) continue;
    // "of it", "daarvan", "je hebt er 3": the wine of the sentence before, when this one names none.
    const pronoun =
      has(w, k + 1, k + 3, set("it them daarvan ervan")) || has(w, k - 2, k - 1, set("er"));
    const bound =
      mentions.length === 0
        ? pronoun && kind === "stock"
          ? (previous.at(-1) ?? null)
          : null
        : bindCount(mentions, k, w, kind === "suggest");
    if (!bound) continue;
    const items = bound.item ? [bound.item] : bound.groups.flatMap((g) => g.items);
    const totals = bound.groups.map((g) => g.total);
    // "3 bottles of Château Margaux": all of that producer's wines together.
    if (bound.producer || bound.kind === "producer") {
      const producers = new Set(bound.groups.map((g) => g.producer));
      totals.push(
        ctx.cellar.groups
          .filter((g) => producers.has(g.producer))
          .reduce((sum, g) => sum + g.total, 0),
      );
    }
    for (const i of items) totals.push(ctx.cellar.wineTotals.get(i.wineId) ?? i.count);
    if (kind === "suggest") {
      // Asking to open more than there is says there is more than there is.
      if (n > Math.max(...totals, ...items.map((i) => i.count))) fail("wrong-count");
      continue;
    }
    stock(n, bound);
  }

  // ---- Inventory notation: "[[ref]] (×9)", "[[ref]] x9", "9x [[ref]]", "9 × [[ref]]" ----
  const gap = (a: Token | undefined, b: Token | undefined) =>
    a && b ? ctx.text.slice(a.end, b.start) : "";
  for (const m of mentions) {
    const next = w[m.b + 1];
    if (!next) continue;
    const times =
      /^[x×](\d{1,3})$/i.exec(next.raw) ??
      (/×\s*$/.test(gap(w[m.b], next)) ? /^(\d{1,3})$/.exec(next.raw) : null);
    if (times) stock(Number(times[1]), m);
  }
  for (let k = 0; k < w.length; k += 1) {
    const t = w[k]!;
    const glued = /^(\d{1,3})[x×]$/i.exec(t.raw);
    const m1 = mentions.find((m) => m.a === k + 1);
    if (glued && m1) stock(Number(glued[1]), m1);
    const n = /^\d{1,3}$/.test(t.raw) ? Number(t.raw) : null;
    if (n === null) continue;
    if (m1 && /×/.test(gap(t, w[k + 1]))) stock(n, m1);
    const m2 = mentions.find((m) => m.a === k + 2);
    if (m2 && w[k + 1]?.norm === "x") stock(n, m2);
  }

  // ---- Money, shops, actions ----
  if (isPrice(raw, ctx)) found.codes.add("price");
  if (AVAILABILITY.some((r) => r.test(raw)) || namedShop(BUY_AT, raw))
    found.codes.add("availability");
  if (ACTION.some((r) => r.test(raw))) found.codes.add("action");
  return mentions;
}

interface Claim {
  head: number;
  years: number[];
  viaHave: boolean;
  source: "poss" | "have" | "open" | "place" | "definite";
  verb?: string;
}

/** Places a bottle lies in: "in your cellar", "from the rack", "uit je rek", "in the Wine fridge" (a place's own name). */
const PLACE_NOUNS = /*#__PURE__*/ set(
  "cellar kelder wijnkelder collection collectie rack rek wijnrek fridge koelkast wijnkoelkast klimaatkast wijnklimaatkast cabinet kast",
);
function placeAt(w: readonly Token[], k: number, ctx: Context): { yours: boolean } | null {
  if (!set("in from uit among op on").has(w[k]!.norm)) return null;
  const det = w[k + 1]?.norm ?? "";
  const yours = set("your je jouw uw").has(det);
  if (!yours && !set("the de het").has(det)) return null;
  for (let j = k + 2; j <= k + 3 && w[j]; j += 1) {
    if (PLACE_NOUNS.has(w[j]!.norm) || ctx.cellar.placeWords.has(w[j]!.norm)) return { yours };
    if (!set("wine wijn").has(w[j]!.norm) && !ctx.cellar.placeWords.has(w[j]!.norm)) break;
  }
  return null;
}

/** How the words before a wine's name present it: as theirs (strong), as a known bottle (medium), or not at all. */
function ownershipBefore(
  w: readonly Token[],
  lead: number,
  end: number,
  afterYear: number,
): "strong" | "medium" | "none" {
  // "... in your cellar" right after the name (and its year) is ownership.
  for (let j = Math.max(end, afterYear) + 1; j <= Math.max(end, afterYear) + 2; j += 1)
    if (
      set("in uit from").has(w[j]?.norm ?? "") &&
      set("your je jouw uw").has(w[j + 1]?.norm ?? "")
    )
      return "strong";
  let i = lead - 1;
  for (let steps = 0; steps < 4 && i >= 0 && SKIP_BACK.has(w[i]!.norm); steps += 1) i -= 1;
  if (i < 0) return "medium";
  const t = w[i]!.norm;
  if (isPossessive(w, i)) return "strong";
  const have = haveAt(w, i);
  if (have === "own") return "strong";
  if (have === "denied" || INDEFINITE.has(t)) return "none";
  if (DEFINITE.has(t) || IMPERATIVE.has(t)) return "medium";
  return "none";
}

type HeadOutcome =
  | { kind: "owned"; vintages: ReadonlySet<number>; years: number[] }
  | { kind: "missing"; years: number[] }
  | null;

/** What the words at `head` name, after an ownership phrase: a cellar wine, a wine the cellar lacks, or no wine. */
function readHead(
  w: readonly Token[],
  claim: Claim,
  ctx: Context,
  mentions: readonly Mention[],
  raw: string,
): HeadOutcome {
  const head = claim.head;
  const t = w[head];
  if (!t) return null;
  const yearsAfter = (end: number) => {
    let j = end + 1;
    while (j <= end + 2 && set("from uit van of vintage jaargang").has(w[j]?.norm ?? "")) j += 1;
    const y = yearOf(w[j]);
    return y !== null &&
      y <= ctx.nowYear &&
      !inRange(ctx.text, w, j) &&
      !WINDOW_BEFORE.has(w[j - 1]?.norm ?? "")
      ? [y]
      : [];
  };
  const mention = mentions.find((m) => m.a === head);
  if (t.kind === "ref") {
    if (!t.item) return null; // already unknown-ref
    return {
      kind: "owned",
      vintages: new Set(t.item.year === null ? [] : [t.item.year]),
      years: [],
    };
  }
  if (mention) {
    // "your Vajra Bricco delle Viole": the producer is in the cellar, but a wine name after it that none of its
    // wines has is a wine the cellar does not hold.
    if (mention.kind === "producer") {
      const hay = new Set<string>();
      for (const g of mention.groups)
        for (const i of g.items)
          for (const x of ctx.cellar.hay().haystackOf.get(i)!.words) hay.add(x);
      for (let j = mention.b + 1; j < w.length && j <= mention.b + 4; j += 1) {
        const t = w[j]!;
        if (t.kind !== "word" || !(t.cap || CONNECTORS.has(t.norm))) break;
        if (CONNECTORS.has(t.norm) || GENERIC.has(t.norm) || GRAPES.has(t.norm)) continue;
        if (STOP_CAPS.has(t.norm) || TYPE_WORDS.has(t.norm)) break;
        if (!hay.has(t.norm)) return { kind: "missing", years: [] };
      }
    }
    // Years right after a name are checked with the name itself (above).
    const vintages = new Set<number>();
    for (const g of mention.groups) for (const y of g.vintages) if (y !== null) vintages.add(y);
    return { kind: "owned", vintages, years: [] };
  }
  const itemsVintages = (items: readonly CellarItem[]) =>
    new Set(items.flatMap((i) => (i.year === null ? [] : [i.year])));

  if (!t.cap) {
    const type = TYPE_WORDS.get(t.norm);
    // "rose" is a flower unless written "rosé".
    if (
      !type ||
      (t.norm === "rose" && !/é/i.test(t.raw)) ||
      (t.norm === "roses" && !/é/i.test(t.raw))
    )
      return null;
    if (FOOD_AFTER_TYPE.has(w[head + 1]?.norm ?? "")) return null;
    const items = [
      ...new Set([
        ...(ctx.cellar.byType.get(type) ?? []),
        ...(ctx.cellar.hay().wordItems.get(t.norm) ?? []),
      ]),
    ];
    return items.length > 0
      ? { kind: "owned", vintages: itemsVintages(items), years: yearsAfter(head) }
      : { kind: "missing", years: yearsAfter(head) };
  }

  // A capitalised name: its words up to five, with connectors inside it.
  let end = head;
  while (
    end + 1 < w.length &&
    end - head < 4 &&
    w[end + 1]!.kind === "word" &&
    yearOf(w[end + 1]) === null &&
    (w[end + 1]!.cap ||
      // A connector or a number inside a name: "Château de la Tour", "Les 7 Cépages".
      /^\d+$/.test(w[end + 1]!.raw) ||
      (CONNECTORS.has(w[end + 1]!.norm) && w[end + 2]?.cap === true && w[end + 2]?.kind === "word"))
  )
    end += 1;
  const run = w.slice(head, end + 1);
  const content = run.map((r) => r.norm).filter((n) => !CONNECTORS.has(n));
  if (content.length === 0 || content.some((n) => STOP_CAPS.has(n))) return null;
  // "your Riedel glasses", "je Indonesische rijsttafel", "your Tuscany trip": a capitalised word before a noun that
  // is not a wine word describes that noun.
  const next = w[end + 1];
  let wineWord = false;
  const attached = next ? /^\s+$/.test(ctx.text.slice(w[end]!.end, next.start)) : false;
  if (
    next &&
    attached &&
    next.kind === "word" &&
    !next.cap &&
    yearOf(next) === null &&
    !/^\d+$/.test(next.raw)
  ) {
    if (WINE_WORDS.has(next.norm)) wineWord = true;
    else if (!AFTER_NAME.has(next.norm)) return null;
  }
  const yearsHere = yearsAfter(end);
  // Only what is plausibly a wine is read as one: a wine word or a vintage with it, a known appellation, grape,
  // style or estate word, a cellar producer, a place it lies in, a verb only a wine takes, or a sentence about
  // drinking it. "Your Weber is ready" is not a wine; "your Krug is ready to drink" is.
  const plausible =
    wineWord ||
    yearsHere.length > 0 ||
    claim.years.length > 0 ||
    content.some(
      (n) =>
        APPELLATIONS.has(n) ||
        GRAPES.has(n) ||
        TYPE_WORDS.has(n) ||
        WINE_NAME_WORDS.has(n) ||
        ctx.cellar.producerWords.has(n),
    ) ||
    claim.source === "place" ||
    claim.source === "definite" ||
    (claim.source === "open" && !set("serve serveer take").has(claim.verb ?? "")) ||
    DRINK_SIGNAL.test(raw);
  if (!plausible) return null;
  const phrase = run.map((r) => r.raw).join(" ");
  if (detectIntent(phrase).dish !== null) return null;
  if (content.every((n) => ctx.factWords.has(n))) return null; // a place or a word of the counted facts
  const type = TYPE_WORDS.get(content[0]!);
  if (content.length === 1 && type && FOOD_AFTER_TYPE.has(w[head + 1]?.norm ?? "")) return null;

  // A word of the cellar's, or the same word with an ending ("Barolos", "Txakoli" for "Txakolina"), but never a
  // near miss one letter apart ("Musard" is not "Musar"). Looked up in the cellar's word index, not wine by wine.
  const close = (a: string, b: string) => {
    const [short, long] = a.length <= b.length ? [a, b] : [b, a];
    if (short.length < 5 || !long.startsWith(short)) return false;
    return long.length - short.length >= 2 || long === `${short}s`;
  };
  const literal = (n: string): Set<CellarItem> => {
    const out = new Set(ctx.cellar.hay().wordItems.get(n) ?? []);
    if (n.length >= 5)
      for (const [word, list] of ctx.cellar.hay().wordItems)
        if (word !== n && close(n, word)) for (const i of list) out.add(i);
    return out;
  };
  /** null: every wine. */
  const intersect = (sets: ReadonlyArray<Set<CellarItem> | null>): Set<CellarItem> | null =>
    sets.reduce<Set<CellarItem> | null>(
      (acc, x) => (x === null ? acc : acc === null ? new Set(x) : keepBoth(acc, x)),
      null,
    );
  const words_ = content.filter((n) => !CONNECTORS.has(n));
  const byWords = intersect(words_.map(literal));
  // An appellation the line names by its region ("your Barolo", the line says Piedmont), a style by its type.
  const byKind = intersect(
    words_.map((n): Set<CellarItem> | null => {
      const regions = APPELLATIONS.get(n);
      if (regions) {
        // By region only for a wine whose appellation the cellar does not say ("your Barbaresco" is not a Barolo
        // from the same region).
        const out = literal(n);
        for (const r of regions)
          for (const i of ctx.cellar.hay().wordItems.get(r) ?? [])
            if (
              !ctx.cellar.hay().haystackOf.get(i)!.appellationKnown &&
              ctx.cellar.hay().haystackOf.get(i)!.regions.has(r)
            )
              out.add(i);
        return out;
      }
      // A grape is owned only where a cellar wine's own words say it ("Pinot Noir" in its name), never because
      // the cellar has some wine of its colour.
      if (GRAPES.has(n)) return literal(n);
      if (GENERIC.has(n)) return null;
      const style = TYPE_WORDS.get(n);
      return style !== undefined ? new Set(ctx.cellar.byType.get(style) ?? []) : new Set();
    }),
  );
  const owners = [
    ...new Set([
      ...(byWords ?? ctx.cellar.hay().haystacks.map((h) => h.item)),
      ...(byKind ?? ctx.cellar.hay().haystacks.map((h) => h.item)),
    ]),
  ];
  if (owners.length > 0)
    return { kind: "owned", vintages: itemsVintages(owners), years: yearsHere };
  return { kind: "missing", years: yearsHere };
}

/** The cellar wine a count is about: the one right after "of / van", else the nearest one named. */
function bindCount(
  mentions: readonly Mention[],
  k: number,
  w: readonly Token[],
  strict: boolean,
): Mention | null {
  for (let j = k + 1; j <= k + 4; j += 1) {
    const m = mentions.find((x) => x.a === j);
    if (m && has(w, k + 1, j - 1, set("of van bottles bottle fles flessen the de het your je")))
      return m;
    if (m && j === k + 1) return m; // "3 [[ref]]"
  }
  if (strict) return null;
  let best: Mention | null = null;
  let distance = Infinity;
  for (const m of mentions) {
    const d = m.a > k ? m.a - k : k - m.b;
    if (d < distance) {
      best = m;
      distance = d;
    }
  }
  return best;
}

/** An amount of money, unless it is the person's own budget band said back with its own numbers. */
function isPrice(raw: string, ctx: Pick<Context, "band">) {
  if (CENTS.test(raw) || DUTCH_PRICE.test(raw) || PRICE_WORD.test(raw)) return true;
  if (!MONEY.test(raw)) return PER_BOTTLE.test(raw);
  const band = ctx.band;
  if (!band) return true;
  const allowed = new Set([band[0], ...(band[1] === null ? [] : [band[1]])]);
  // The band as a band: both ends, or the one end an open or a from-zero band has ("€60 or more", "up to €15").
  const required =
    band[0] === 0 && band[1] !== null ? [band[1]] : band[1] === null ? [band[0]] : [...allowed];
  // Numbers near a currency mark, and the far end of a range ("€15–30").
  const near = new Set<number>();
  const money = new RegExp(MONEY.source, "gi");
  for (const m of raw.matchAll(money)) {
    const around = raw.slice(Math.max(0, m.index - 12), m.index + m[0].length + 12);
    for (const d of around.matchAll(/\d+(?:[.,]\d+)?/g)) near.add(Number(d[0].replace(",", ".")));
  }
  for (const m of raw.matchAll(/(\d+)\s*(?:[-–—]|to|tot|and|en)\s*[€$£]?\s*(\d+)/g)) {
    near.add(Number(m[1]));
    near.add(Number(m[2]));
  }
  if (near.size === 0) return true;
  return [...near].some((n) => !allowed.has(n)) || required.some((n) => !near.has(n));
}

const keepBoth = <T>(a: ReadonlySet<T>, b: ReadonlySet<T>): Set<T> =>
  new Set([...a].filter((x) => b.has(x)));

/** "at Sligro", "bij Hanos": a capitalised name after "at / bij / via" that is not a day, a dish or a nationality. */
function namedShop(pattern: RegExp, raw: string): boolean {
  const m = pattern.exec(raw);
  if (!m) return false;
  const name = normalizeText(m[1] ?? "");
  return name !== "" && !STOP_CAPS.has(name) && detectIntent(name).dish === null;
}

// ---- Rendering ------------------------------------------------------------------------------------------------

function render(text: string, s: Sentence, repeat: ReadonlySet<Token>): string {
  let out = "";
  let at = s.start;
  for (const t of s.tokens) {
    if (t.kind === "ref" && t.item) {
      out += text.slice(at, t.start) + wineLabel(t.item);
      at = t.end;
    } else if (repeat.has(t)) {
      out += text.slice(at, t.start).replace(/[ \t(]+$/, "");
      at = t.end;
      if (text[at] === ")") at += 1;
    }
  }
  return out + text.slice(at, s.end);
}

const tidyText = (text: string) =>
  text
    .replace(/[ \t]+/g, " ")
    .replace(/ +\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/ ([,.;:!?])/g, "$1")
    .trim();

// ---- Buying ---------------------------------------------------------------------------------------------------

/** Drops the clauses of a buy entry's words that state a price or a shop; the rest stays as written. */
function withoutClaims(value: string, digest: CellarDigest, codes: Set<CheckCode>) {
  const tokens = tokenize(value, digest);
  const parts = sentences(value, tokens);
  const kept: string[] = [];
  let changed = false;
  for (const s of parts) {
    const raw = value.slice(s.start, s.end);
    const claim = (text: string): CheckCode | null => {
      if (isPrice(text, { band: null })) return "price";
      if (AVAILABILITY.some((r) => r.test(text)) || namedShop(AT_NAME, text)) return "availability";
      if (
        /\[\[[^\]]*\]\]/.test(text) &&
        tokenize(text, digest).some((t) => t.kind === "ref" && !t.item)
      )
        return "unknown-ref";
      return null;
    };
    if (claim(raw) === null) {
      kept.push(render(value, s, new Set()));
      continue;
    }
    changed = true;
    const clauses = raw
      .split(/\s*(?:[;:()]|,(?![\d-])|\s[–—-]\s)\s*/)
      .map((c) => c.trim())
      .filter(Boolean);
    const good: string[] = [];
    for (const c of clauses) {
      const code = claim(c);
      if (code === null) good.push(c);
      else if (code !== "unknown-ref") codes.add(code);
    }
    if (good.length === 0) continue;
    let joined = good.join(", ");
    for (const t of tokenize(joined, digest))
      if (t.kind === "ref" && t.item) joined = joined.replace(t.raw, wineLabel(t.item));
    if (/[.!?]\s*$/.test(raw) && !/[.!?]$/.test(joined)) joined += ".";
    kept.push(joined);
  }
  const out = tidyText(changed ? kept.join(" ") : kept.join(""));
  return out.replace(/^[,;:\s]+|[,;:\s]+$/g, "");
}

/** A buy entry that names a wine the cellar holds (in a vintage it holds, when a year is said). */
function namesCellarWine(value: string, digest: CellarDigest, cellar: Cellar, nowYear: number) {
  const tokens = tokenize(value, digest);
  const w = tokens.filter((t) => t.kind !== "punct");
  if (w.some((t) => t.kind === "ref" && t.item)) return true;
  const said = new Set(w.map((t) => t.norm));
  const years = w.map(yearOf).filter((y): y is number => y !== null && y <= nowYear);
  for (const m of mentionsIn(w, cellar)) {
    // A producer alone is not one of its wines: all of the wine's own words must be there too.
    const groups =
      m.kind === "producer"
        ? m.groups.filter((g) => g.wineTokens.every((t) => said.has(t)))
        : m.groups;
    if (groups.length === 0) continue;
    if (years.length === 0) return true;
    if (years.some((y) => groups.some((g) => g.vintages.has(y)))) return true;
  }
  return false;
}

// ---- The check ------------------------------------------------------------------------------------------------

/**
 * Before reading: markdown emphasis goes (the screen shows none, and "**Musar** (**2008**)" is "Musar (2008)"), extra
 * brackets around a ref are noise ("[[[[a1b2c3]]]]"), and a ref cut off by the length cap at the very end
 * ("…and [[c0000") is dropped with the unfinished sentence it is in. Returns whether something was cut.
 */
function prepareText(text: string): { text: string; cut: boolean } {
  let out = text
    .replace(/\*\*|__/g, "")
    .replace(/(^|[\s(])[*_](?=\S)/g, "$1")
    .replace(/(\S)[*_](?=[\s).,;:!?]|$)/g, "$1")
    .replace(/\[{2,}\s*([^[\]\n]{0,64}?)\s*\]{2,}/g, "[[$1]]");
  const dangling = /\[\[?[^\]\n]*$/.exec(out);
  if (!dangling) return { text: out, cut: false };
  out = out.slice(0, dangling.index);
  let end = -1;
  for (const m of out.matchAll(/[.!?…](?=\s|$)|\n/g)) end = m.index + m[0].length;
  return { text: end < 0 ? "" : out.slice(0, end), cut: true };
}

/** What a prepared check reads each time: one answer's words and buying ideas. */
export interface AnswerClaims {
  text: string;
  bottles: readonly SommelierBottle[];
  buy: readonly BuySuggestion[];
  /** The wine a short text is about when it does not name it (a menu course's wine): "You have 12 bottles of it". */
  previous?: CellarItem | null;
}
export type CheckedAnswer = { text: string | null; buy: CheckedBuy[]; check: AnswerCheck };

/**
 * Indexes the cellar ONCE for several checks against the same cellar and question (a menu checks every course's
 * words). The returned function is the check itself; `checkAnswerClaims` is it called once.
 */
export function prepareAnswerCheck(base: {
  digest: CellarDigest;
  items: readonly CellarItem[];
  budget: Budget | null;
  facts?: string | null;
  now?: Date;
}): (claims: AnswerClaims) => CheckedAnswer {
  const cellar = indexCellar(base.items);
  const band = base.budget ? BUDGET_EUROS[base.budget] : null;
  const facts = base.facts ?? "";
  const shared = {
    cellar,
    nowYear: (base.now ?? new Date()).getUTCFullYear(),
    factNumbers: new Set([...facts.matchAll(/\d+/g)].map((m) => Number(m[0]))),
    factWords: new Set(words(facts)),
    band,
  };
  return (claims) => {
    const prepared = prepareText(claims.text);
    const text = prepared.text;
    const ctx: Context = { ...shared, text };
    const codes = new Set<CheckCode>();

    // ---- The text ----
    const tokens = tokenize(text, base.digest);
    const parts = sentences(text, tokens);
    const kept: string[] = [];
    let removed = prepared.cut;
    let factFailure = false;
    let previous: Mention[] = claims.previous
      ? [
          {
            a: -1,
            b: -1,
            groups: [cellar.groupOf.get(claims.previous)].filter(
              (g): g is Group => g !== undefined,
            ),
            item: claims.previous,
            kind: "ref" as const,
            producer: false,
          },
        ].filter((m) => m.groups.length > 0)
      : [];
    for (const s of parts) {
      const found: Found = { codes: new Set(), repeatYears: new Set(), fatal: false };
      const named = readSentence(s, ctx, found, previous);
      if (named.length > 0) previous = named;
      for (const c of found.codes) codes.add(c);
      if (found.fatal) factFailure = true;
      if (found.codes.size > 0) {
        removed = true;
        // A removed sentence keeps its paragraph break.
        const tail = text.slice(s.tokens.at(-1)!.end, s.end);
        if (tail.includes("\n")) kept.push(tail);
      } else kept.push(render(text, s, found.repeatYears));
    }
    const rest = tidyText(kept.join(""));
    const status: AnswerCheck["text"] =
      factFailure || rest === "" ? "replaced" : removed ? "trimmed" : "kept";

    // ---- Buying ----
    const buy: CheckedBuy[] = [];
    for (const b of claims.buy) {
      if (b.price.trim() !== "") codes.add("price");
      const wine = withoutClaims(b.wine, base.digest, codes);
      if (wine === "") continue;
      if (namesCellarWine(b.wine, base.digest, cellar, ctx.nowYear)) {
        codes.add("owned-buy");
        continue;
      }
      const why = withoutClaims(b.why, base.digest, codes);
      buy.push({ wine: wine.slice(0, 120), why: why.slice(0, 240), price: "", priceBand: band });
    }

    return {
      text: status === "replaced" ? null : rest,
      buy,
      check: { v: 1, text: status, codes: CHECK_CODES.filter((c) => codes.has(c)) },
    };
  };
}

export function checkAnswerClaims(input: {
  text: string; // after checkSommelierAnswer (tidied, ≤ 900 chars); may contain [[ref]]
  bottles: readonly SommelierBottle[]; // the cards (V1's choice; never changed here)
  buy: readonly BuySuggestion[];
  digest: CellarDigest; // what the model was shown (refs → items)
  items: readonly CellarItem[]; // the whole cellar (a name can be real without being in the digest)
  budget: Budget | null; // the band the person chose, if any
  /** The counted "Cellar facts" block the model was shown, for a question about the cellar itself. */
  facts?: string | null;
  /** Today, for telling a vintage from a drinking window (a year after this one is never a vintage). */
  now?: Date;
  /** The wine a short text is about when it does not name it (see AnswerClaims). */
  previous?: CellarItem | null;
}): CheckedAnswer {
  return prepareAnswerCheck(input)(input);
}
