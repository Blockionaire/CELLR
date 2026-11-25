import { describe, expect, it } from "vitest";
import {
  albe,
  bollinger,
  check,
  cuvee1522,
  grandVin,
  langhe,
  musar15,
  musar18,
  pavillon,
  ref,
} from "./sommelier-check.fixtures";

/**
 * Fixed sets that measure the check as a whole (invented for these tests, no real household's data):
 *   EVERYDAY    60 ordinary answers of the kind V1 writes, English and Dutch: every one must be kept.
 *   WEAK_SPOTS  40 sentences an end review found (or that sit next to them) where a careless rule throws a good
 *               answer away: equipment, dishes, places, Dutch word order. Every one must be kept.
 *   INVENTED    invented bottles, vintages, counts, prices, shops and actions: every one must be caught.
 *   KNOWN_MISSES what the check deliberately does not catch (see the module header): asserted, so a change in
 *               either direction is noticed.
 * The rates in the report come from these sets: false positives = kept-expected sentences that were not kept.
 */
const M = ref(musar18);
const M15 = ref(musar15);
const A = ref(albe);
const L = ref(langhe);
const B = ref(bollinger);
const P = ref(pavillon);
const G = ref(grandVin);
const C = ref(cuvee1522);

const EVERYDAY = [
  `For the lamb, ${M} is the one: its spice and soft tannins suit the meat.`,
  `${M} is reserved for the Anniversary, so open ${M15} instead; it is ready now.`,
  `With the steak, ${P} is a classic match. Decant it for half an hour.`,
  `Nothing in your cellar really suits oysters. A Muscadet would be ideal; your ${B} is the closest you have.`,
  `${A} is still young, so keep it a few more years; ${L} is lovely now with the mushroom risotto.`,
  `For the cheese board, ${C} works well with goat cheese, and ${M} with the harder cheeses.`,
  `Both are good choices: ${M} is earthier, ${P} more polished. With the duck I would pick ${M}.`,
  `${G} is a special bottle; save it for an occasion. Tonight ${P} gives you a taste of the same estate.`,
  `A Barolo would be the classic choice, but you have none; ${L} from the same producer comes close.`,
  `Chill ${B} well and serve it as an aperitif with the salty snacks.`,
  `Your cellar has nothing sweet for the chocolate cake, so a glass of port would be the thing to buy.`,
  `You have 3 bottles of ${M}, one of them reserved, so two are free to open.`,
  `For eight guests, plan on four bottles: ${A} has six, so that is plenty.`,
  `${M15} is at its peak; drink it this year rather than keeping it longer.`,
  `If you prefer something lighter, ${L} is fresher than ${A}.`,
  `Serve ${P} at 16–18 °C and give it some air first.`,
  `With fish, ${C} is your best bet: crisp, mineral and dry.`,
  `I would open ${M} tonight; it is drinking beautifully.`,
  `Compared with a young Bordeaux, ${P} is softer and more ready.`,
  `Your taste leans towards savoury reds, so ${M} should appeal to you.`,
  `There is no rosé in your cellar; for the terrace, ${C} chilled is a good stand-in.`,
  `The pasta with tomato sauce wants acidity: ${L} has it.`,
  `${A} needs time: open it in 2028 or later.`,
  `Pair the roast chicken with ${C} or, for a red, ${L}.`,
  `A Champagne like ${B} loves fried food more than people think.`,
  `For a celebration, ${B} is the obvious bottle to open.`,
  `${G} 2010 is still developing; it can wait until 2035.`,
  `The mushroom dish suits ${A}, though it would be better in a few years.`,
  `For the curry, none of your reds is ideal; ${C} with its freshness copes best.`,
  `You asked about 2015: ${M15} and ${P} are both from that year.`,
  // Dutch
  `Bij het lamsvlees past ${M} het best: kruidig en zacht.`,
  `${M} is gereserveerd voor Anniversary, dus open ${M15}; die is nu op dronk.`,
  `Bij de biefstuk is ${P} een klassieker. Geef hem een half uur lucht.`,
  `Niets in je kelder past echt bij oesters. Een Muscadet zou ideaal zijn; ${B} komt het dichtst in de buurt.`,
  `${A} is nog jong, bewaar hem nog een paar jaar; ${L} is nu heerlijk bij de risotto.`,
  `Bij de kaasplank past ${C} bij de geitenkaas en ${M} bij de harde kazen.`,
  `Allebei goed: ${M} is aardser, ${P} verfijnder. Bij de eend zou ik ${M} kiezen.`,
  `${G} is een bijzondere fles; bewaar hem voor een gelegenheid.`,
  `Een Barolo zou de klassieke keuze zijn, maar die heb je niet; ${L} van dezelfde producent komt dichtbij.`,
  `Koel ${B} goed en schenk hem als aperitief bij de borrel.`,
  `Je hebt 3 flessen ${M}, waarvan één gereserveerd, dus er zijn er twee vrij.`,
  `Voor acht gasten reken je op vier flessen: van ${A} heb je er zes, ruim genoeg.`,
  `${M15} is op zijn best; drink hem dit jaar.`,
  `Wil je iets lichters, dan is ${L} frisser dan ${A}.`,
  `Schenk ${P} op 16–18 °C en geef hem wat lucht.`,
  `Bij vis is ${C} je beste keuze: fris, mineraal en droog.`,
  `Ik zou ${M} vanavond openen; hij is prachtig op dronk.`,
  `Vergeleken met een jonge Bordeaux is ${P} zachter.`,
  `Je smaak gaat richting hartige rode wijn, dus ${M} past bij je.`,
  `Er ligt geen rosé in je kelder; voor het terras is ${C} goed gekoeld een prima vervanger.`,
  `De pasta met tomatensaus vraagt om zuren: ${L} heeft die.`,
  `${A} heeft tijd nodig: open hem in 2028 of later.`,
  `Bij de kip past ${C} of, als rode, ${L}.`,
  `Voor een feest is ${B} de fles om te openen.`,
  `${G} is nog in ontwikkeling en kan tot 2035 wachten.`,
  `Bij de curry is geen van je rode wijnen ideaal; ${C} houdt het best stand.`,
  `Je vroeg naar 2015: ${M15} en ${P} zijn allebei van dat jaar.`,
  `Voor zes personen open je twee flessen ${A}.`,
  `Trek er twee open van ${A} als jullie met z'n vieren zijn.`,
  `Van ${M} heb je er drie; open er één van de twee vrije.`,
];

const WEAK_SPOTS = [
  `Pour ${M} into your Riedel Burgundy glasses and decant it for an hour.`,
  `Use your Coravin to pour a glass of ${M}.`,
  `Keep ${A} in your EuroCave until then.`,
  `Serve ${P} in your Zalto glasses.`,
  `Seal it with your Vacu Vin and finish ${M} tomorrow.`,
  `Your WSET notes will help you taste ${M}.`,
  `Your Riedel decanter is perfect for ${A}.`,
  `Your Bordeaux glasses suit ${P}.`,
  `Your Indonesian rijsttafel calls for ${C}.`,
  `Your Swiss raclette loves a white like ${C}.`,
  `Your Sichuan hotpot needs something fruity, like ${L}.`,
  `Your Middle Eastern mezze pairs well with ${M}.`,
  `Your Osso Buco suits ${A}.`,
  `Your Coq au Vin wants ${P}.`,
  `Your Beef Wellington deserves ${G}.`,
  `Your Christmas dinner deserves ${B} to start.`,
  `Your Sunday roast loves ${P}.`,
  `Your Weber is perfect for the steak; open ${M} with it.`,
  `Your Tuscany trip memories will come back with ${L}.`,
  `Your Italian guests will enjoy ${L}.`,
  `Your Big Green Egg brisket wants ${M}.`,
  `Your Le Creuset stew calls for ${M}.`,
  `Je Indonesische rijsttafel vraagt om ${C}.`,
  `Je Surinaamse roti past bij ${M}.`,
  `Bij je Zeeuwse mosselen past ${C}.`,
  `Je Hollandse nieuwe vraagt om ${B}.`,
  `Schenk ${P} in je Riedel glazen.`,
  `Bewaar ${A} in je EuroCave.`,
  `Je Italiaanse gasten zullen ${L} waarderen.`,
  `Voor zes personen open je twee flessen ${A}.`,
  `Pak je Coravin en schenk een glas ${M}.`,
  `Open ${M} for your Thanksgiving turkey.`,
  `With your Pad Thai, ${C} is the safest choice.`,
  `Take the lamb out of the oven and pour ${M}.`,
  `Grab the Riedel glasses from the cabinet and pour ${P}.`,
  `The Bordeaux region is famous for blends like ${P}.`,
  `The Rhône is not in your cellar, but ${M} has a similar warmth.`,
  `A Chablis in the fridge for an hour would be perfect, but ${C} works too.`,
  `Since you love Barolo, your ${A} is the one.`,
  `Je hebt Bourgogne nodig voor dit gerecht; ${P} komt het dichtst bij.`,
];

const INVENTED: ReadonlyArray<readonly [string, string[]]> = [
  // Bottles the cellar does not have, presented as owned.
  ["Serve the Sassicaia 2015 if you want something grander.", ["not-in-cellar"]],
  ["Pour the Tignanello with the steak.", ["not-in-cellar"]],
  ["Go for the Tignanello tonight.", ["not-in-cellar"]],
  ["Grab the Sassicaia from the rack.", ["not-in-cellar"]],
  ["The Tignanello is ready to drink now.", ["not-in-cellar"]],
  ["Schenk de Tignanello bij het vlees.", ["not-in-cellar"]],
  ["Neem de Sassicaia uit je rek.", ["not-in-cellar"]],
  ["Your Pinot Noir is lovely.", ["not-in-cellar"]],
  ["Your Sassicaia 2015 is the obvious choice.", ["not-in-cellar"]],
  ["You have a lovely Opus One in your cellar.", ["not-in-cellar"]],
  ["In je kelder ligt een Sassicaia.", ["not-in-cellar"]],
  ["Your Barbaresco is a great match.", ["not-in-cellar"]],
  ["Your Château Musard is ready.", ["not-in-cellar"]],
  // Wrong vintages.
  ["Your Musar, the 2008, is lovely.", ["wrong-vintage"]],
  ["Your Musar from the 2008 vintage is lovely.", ["wrong-vintage"]],
  ["Open the Musar – 2008 – tonight.", ["wrong-vintage"]],
  [`Open ${M}, a 2008, tonight.`, ["wrong-vintage"]],
  ["Your **Musar** (**2008**) is lovely.", ["wrong-vintage"]],
  ["Je Musar van 2012 is nu op dronk.", ["wrong-vintage"]],
  // Wrong counts.
  [`${A} (×9) is ready.`, ["wrong-count"]],
  [`9x ${A} in the rack.`, ["wrong-count"]],
  [`With 9 ${A} in the cellar you are fine.`, ["wrong-count"]],
  [`There are still 9 of ${A}.`, ["wrong-count"]],
  [`9 bottles of ${A} remain.`, ["wrong-count"]],
  [`Je hebt nog 4 flessen ${A}.`, ["wrong-count"]],
  // Prices and shops.
  ["A Chianti is around 25-30 per bottle.", ["price"]],
  ["Reken op zo'n 25 tot 30 per fles.", ["price"]],
  ["It is usually 25 a bottle.", ["price"]],
  ["It is CHF 30 in Zurich.", ["price"]],
  ["It is 200 kr in Sweden.", ["price"]],
  ["Get it at Sligro.", ["availability"]],
  ["Haal hem bij de ah.", ["availability"]],
  ["De Wijnbeurs heeft hem.", ["availability"]],
  ["Look for it at Henri Bloem.", ["availability"]],
  // Actions.
  ["I've set the Barolo aside for Saturday.", ["action"]],
  ["I put the Musar aside for you.", ["action"]],
  ["Ik zet de Musar voor zaterdag apart.", ["action"]],
  ["Ik heb de Musar in de koelkast gelegd.", ["action"]],
  ["I will put the Musar in the fridge tonight.", ["action"]],
  ["Done: the Musar is now reserved for Saturday.", ["action"]],
];

/** Deliberately not caught: a bare name with nothing that says it is a wine, or a pairing verb alone. */
const KNOWN_MISSES = [
  "Your Krug is ready.",
  "Jouw Tignanello past er perfect bij.",
  "The Musar 2008 is not ready yet.",
  "Your Musar is lovely. The 2008 is even better.",
];

describe("the measured sets", () => {
  it("has the sizes the report names", () => {
    expect(EVERYDAY.length).toBeGreaterThanOrEqual(60);
    expect(WEAK_SPOTS).toHaveLength(40);
    expect(INVENTED.length).toBeGreaterThanOrEqual(40);
  });

  it("keeps every everyday answer (no false positive)", () => {
    const lost = EVERYDAY.filter((text) => check(text).check.text !== "kept");
    expect(lost).toEqual([]);
  });

  it("keeps every weak-spot sentence (no false positive)", () => {
    const lost = WEAK_SPOTS.filter((text) => check(text).check.text !== "kept");
    expect(lost).toEqual([]);
  });

  it("catches every invented claim with its own code", () => {
    const missed = INVENTED.filter(([text, codes]) => {
      const r = check(text).check;
      return JSON.stringify(r.codes) !== JSON.stringify(codes) || r.text === "kept";
    });
    expect(missed).toEqual([]);
  });

  it("the known misses stay what the header says they are", () => {
    for (const text of KNOWN_MISSES)
      expect({ text, codes: check(text).check.codes }).toEqual({ text, codes: [] });
  });
});
