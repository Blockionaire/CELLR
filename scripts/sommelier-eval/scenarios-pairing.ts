import type { Scenario } from "./types";

/**
 * PAIRING SCENARIOS: everyday and hard pairings, misleading dish names, cellars with no suitable wine, an empty
 * cellar, wines with missing metadata, and inventory constraints (reserved bottles, drinking windows, counts).
 * "auto" verdicts follow from the dish card in dishes.ts and the scenario's cellar.
 */
export const PAIRING_SCENARIOS: readonly Scenario[] = [
  {
    id: "ps-001",
    category: "pairing-simple",
    lang: "en",
    cellar: "all",
    turns: [
      {
        user: "What should I open with a grilled ribeye tonight?",
      },
    ],
    dish: "grilled-ribeye-steak",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ps-002",
    category: "pairing-simple",
    lang: "nl",
    cellar: "all",
    turns: [
      {
        user: "Ik maak vanavond stoofvlees, welke wijn past erbij?",
      },
    ],
    dish: "beef-stew",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ps-003",
    category: "pairing-simple",
    lang: "en",
    cellar: "all",
    turns: [
      {
        user: "We're having roast chicken for Sunday dinner. Which bottle should I pull?",
      },
    ],
    dish: "roast-chicken",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ps-004",
    category: "pairing-simple",
    lang: "nl",
    cellar: "all",
    turns: [
      {
        user: "Lamsbout uit de oven met rozemarijn en knoflook. Wat schenk ik?",
      },
    ],
    dish: "roast-lamb",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ps-005",
    category: "pairing-simple",
    lang: "en",
    cellar: "all",
    turns: [
      {
        user: "burgers on the grill tonight, what wine?",
      },
    ],
    dish: "burger",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ps-006",
    category: "pairing-simple",
    lang: "nl",
    cellar: "all",
    turns: [
      {
        user: "Wat drink ik bij varkenskoteletjes met gebakken aardappels?",
      },
    ],
    dish: "pork-chops",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ps-007",
    category: "pairing-simple",
    lang: "en",
    cellar: "all",
    turns: [
      {
        user: "Making spaghetti bolognese for the family. Any wine for the grown-ups?",
      },
    ],
    dish: "spaghetti-bolognese",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ps-008",
    category: "pairing-simple",
    lang: "nl",
    cellar: "all",
    turns: [
      {
        user: "wijn bij pizza margherita?",
      },
    ],
    dish: "pizza-margherita",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ps-009",
    category: "pairing-simple",
    lang: "en",
    cellar: "all",
    turns: [
      {
        user: "Salmon fillet from the oven with potatoes and green beans. What goes with it?",
      },
    ],
    dish: "salmon-fillet",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ps-010",
    category: "pairing-simple",
    lang: "nl",
    cellar: "all",
    turns: [
      {
        user: "We halen fish and chips, welke fles maak ik open?",
      },
    ],
    dish: "fish-and-chips",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ps-011",
    category: "pairing-simple",
    lang: "en",
    cellar: "all",
    turns: [
      {
        user: "Light dinner: a big caesar salad. Is there a wine that works?",
      },
    ],
    dish: "caesar-salad",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ps-012",
    category: "pairing-simple",
    lang: "nl",
    cellar: "all",
    turns: [
      {
        user: "Ik maak een risotto met paddenstoelen. Welke wijn uit mijn kelder?",
      },
    ],
    dish: "mushroom-risotto",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ps-013",
    category: "pairing-simple",
    lang: "en",
    cellar: "all",
    turns: [
      {
        user: "Friends are coming over for a cheese board with comté, aged cheddar and parmesan. Which wine?",
      },
    ],
    dish: "cheese-board-hard",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ps-014",
    category: "pairing-simple",
    lang: "nl",
    cellar: "all",
    turns: [
      {
        user: "Salade met warme geitenkaas en honing-mosterddressing, wat past daarbij?",
      },
    ],
    dish: "goat-cheese-salad",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ps-015",
    category: "pairing-simple",
    lang: "en",
    cellar: "all",
    turns: [
      {
        user: "Putting out a charcuterie board with salami and prosciutto, what should I pour?",
      },
    ],
    dish: "charcuterie-board",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ps-016",
    category: "pairing-simple",
    lang: "nl",
    cellar: "all",
    turns: [
      {
        user: "Boerenkool met rookworst vanavond. Kan daar een wijntje bij?",
      },
    ],
    dish: "stamppot-boerenkool",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ps-017",
    category: "pairing-simple",
    lang: "en",
    cellar: "all",
    turns: [
      {
        user: "What wine goes with a wedge of Stilton after dinner?",
      },
    ],
    dish: "blue-cheese",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ps-018",
    category: "pairing-simple",
    lang: "nl",
    cellar: "all",
    turns: [
      {
        user: "Welke wijn bij een rijpe brie?",
      },
    ],
    dish: "brie-camembert",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ps-019",
    category: "pairing-simple",
    lang: "en",
    cellar: "all",
    turns: [
      {
        user: "Got a nice piece of aged Gouda. What should I drink with it?",
      },
    ],
    dish: "aged-gouda",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ps-020",
    category: "pairing-simple",
    lang: "nl",
    cellar: "all",
    turns: [
      {
        user: "Als dessert chocoladefondant van pure chocolade. Welke wijn schenk ik erbij?",
      },
    ],
    dish: "dark-chocolate-fondant",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ps-021",
    category: "pairing-simple",
    lang: "en",
    cellar: "all",
    turns: [
      {
        user: "Is there a dessert wine for tiramisu in my cellar?",
      },
    ],
    dish: "tiramisu",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ps-022",
    category: "pairing-simple",
    lang: "nl",
    cellar: "all",
    turns: [
      {
        user: "Appeltaart met slagroom op verjaardag van mijn moeder, past daar een wijn bij?",
      },
    ],
    dish: "appeltaart-slagroom",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ps-023",
    category: "pairing-simple",
    lang: "en",
    cellar: "all",
    turns: [
      {
        user: "Just some salted nuts and olives before dinner. What's a good aperitif?",
      },
    ],
    dish: "nuts-olives",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ps-024",
    category: "pairing-simple",
    lang: "nl",
    cellar: "all",
    turns: [
      {
        user: "wijn bij mosselen met friet?",
      },
    ],
    dish: "mosselen-friet",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ps-025",
    category: "pairing-simple",
    lang: "en",
    cellar: "all",
    turns: [
      {
        user: "Lasagne in the oven, six of us at the table. Which bottle?",
      },
    ],
    dish: "lasagne",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ps-026",
    category: "pairing-simple",
    lang: "nl",
    cellar: "all",
    turns: [
      {
        user: "Oma's draadjesvlees met rode kool en aardappels, welke rode wijn?",
      },
    ],
    dish: "draadjesvlees",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ps-027",
    category: "pairing-simple",
    lang: "en",
    cellar: "all",
    turns: [
      {
        user: "What do I serve with crème brûlée?",
      },
    ],
    dish: "creme-brulee",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ps-028",
    category: "pairing-simple",
    lang: "nl",
    cellar: "all",
    turns: [
      {
        user: "Hutspot met klapstuk vanavond. Wat drinken we?",
      },
    ],
    dish: "hutspot-klapstuk",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ps-029",
    category: "pairing-simple",
    lang: "en",
    cellar: "all",
    turns: [
      {
        user: "Movie night with crisps and fries. Anything in the cellar for that?",
      },
    ],
    dish: "crisps-fries",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ps-030",
    category: "pairing-simple",
    lang: "nl",
    cellar: "all",
    turns: [
      {
        user: "Gebakken slibtongetjes met citroen, welke witte wijn?",
      },
    ],
    dish: "gebakken-slibtong",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ps-031",
    category: "pairing-simple",
    lang: "en",
    cellar: "all",
    turns: [
      {
        user: "Baked a New York cheesecake. Wine pairing?",
      },
    ],
    dish: "cheesecake",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ps-032",
    category: "pairing-simple",
    lang: "nl",
    cellar: "all",
    turns: [
      {
        user: "Aardbeien met slagroom als toetje. Is daar een wijn voor?",
      },
    ],
    dish: "strawberries-cream",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ph-001",
    category: "pairing-hard",
    lang: "en",
    cellar: "all",
    turns: [
      {
        user: "Pan-seared sea bass with a lemon butter sauce tonight. What should I open?",
      },
    ],
    dish: "sea-bass-lemon-butter",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ph-002",
    category: "pairing-hard",
    lang: "nl",
    cellar: "all",
    turns: [
      {
        user: "Kabeljauw met beurre blanc, welke wijn past het best?",
      },
    ],
    dish: "cod-beurre-blanc",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ph-003",
    category: "pairing-hard",
    lang: "en",
    cellar: "all",
    turns: [
      {
        user: "Doing a classic sole meunière for my partner's birthday. Which wine?",
      },
    ],
    dish: "sole-meuniere",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ph-004",
    category: "pairing-hard",
    lang: "nl",
    cellar: "everyday",
    turns: [
      {
        user: "Dorade van de grill met venkel en olijfolie. Wat schenk ik?",
      },
    ],
    dish: "sea-bream-fennel",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ph-005",
    category: "pairing-hard",
    lang: "en",
    cellar: "all",
    turns: [
      {
        user: "We splurged on lobster with melted butter. What's the right bottle?",
      },
    ],
    dish: "lobster-butter",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ph-006",
    category: "pairing-hard",
    lang: "nl",
    cellar: "all",
    turns: [
      {
        user: "Voorgerecht: gebakken coquilles op bloemkoolpuree. Welke wijn?",
      },
    ],
    dish: "scallops-cauliflower",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ph-007",
    category: "pairing-hard",
    lang: "en",
    cellar: "everyday",
    turns: [
      {
        user: "Chicken in a creamy mushroom sauce with rice. What goes with that?",
      },
    ],
    dish: "chicken-cream-mushroom",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ph-008",
    category: "pairing-hard",
    lang: "nl",
    cellar: "all",
    turns: [
      {
        user: "Kip uit de oven met citroen, tijm en rozemarijn. Wat drinken we erbij?",
      },
    ],
    dish: "chicken-lemon-herbs",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ph-009",
    category: "pairing-hard",
    lang: "en",
    cellar: "all",
    turns: [
      {
        user: "Duck breast with a cherry sauce for a dinner party of four. Which wine?",
      },
    ],
    dish: "duck-cherry",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ph-010",
    category: "pairing-hard",
    lang: "nl",
    cellar: "dry-only",
    turns: [
      {
        user: "Eendenconfit met gebakken aardappeltjes, welke fles?",
      },
    ],
    dish: "duck-confit",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ph-011",
    category: "pairing-hard",
    lang: "en",
    cellar: "all",
    turns: [
      {
        user: "Slow-roasted pork belly with apple compote. Wine?",
      },
    ],
    dish: "pork-belly-apple",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ph-012",
    category: "pairing-hard",
    lang: "nl",
    cellar: "all",
    turns: [
      {
        user: "Kalfsmedaillons met morieljes in roomsaus. Wat past daarbij?",
      },
    ],
    dish: "veal-morels",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ph-013",
    category: "pairing-hard",
    lang: "en",
    cellar: "all",
    turns: [
      {
        user: "Venison steak with red wine sauce and braised red cabbage. What should I open?",
      },
    ],
    dish: "venison-red-wine-cabbage",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ph-014",
    category: "pairing-hard",
    lang: "nl",
    cellar: "everyday",
    turns: [
      {
        user: "Lamsschenkels urenlang gestoofd in tomaat en wijn. Welke wijn kies ik?",
      },
    ],
    dish: "braised-lamb-shank",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ph-015",
    category: "pairing-hard",
    lang: "en",
    cellar: "all",
    turns: [
      {
        user: "Steak au poivre tonight - which red?",
      },
    ],
    dish: "steak-peppercorn",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ph-016",
    category: "pairing-hard",
    lang: "nl",
    cellar: "dry-only",
    turns: [
      {
        user: "Biefstuk met bearnaisesaus en friet. Welke wijn?",
      },
    ],
    dish: "steak-bearnaise",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ph-017",
    category: "pairing-hard",
    lang: "en",
    cellar: "all",
    turns: [
      {
        user: "I've had a beef bourguignon in the oven all afternoon. What do we drink?",
      },
    ],
    dish: "beef-bourguignon",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ph-018",
    category: "pairing-hard",
    lang: "nl",
    cellar: "all",
    turns: [
      {
        user: "Osso buco met gremolata en risotto. Welke wijn past?",
      },
    ],
    dish: "osso-buco",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ph-019",
    category: "pairing-hard",
    lang: "en",
    cellar: "everyday",
    turns: [
      {
        user: "Quick carbonara for two, what bottle?",
      },
    ],
    dish: "pasta-carbonara",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ph-020",
    category: "pairing-hard",
    lang: "nl",
    cellar: "all",
    turns: [
      {
        user: "Spaghetti vongole vanavond, welke wijn?",
      },
    ],
    dish: "pasta-vongole",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ph-021",
    category: "pairing-hard",
    lang: "en",
    cellar: "all",
    turns: [
      {
        user: "Pasta with fresh basil pesto. Red or white?",
      },
    ],
    dish: "pasta-pesto",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ph-022",
    category: "pairing-hard",
    lang: "nl",
    cellar: "everyday",
    turns: [
      {
        user: "Penne arrabbiata, lekker pittig. Wat drink ik daarbij?",
      },
    ],
    dish: "pasta-arrabbiata",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ph-023",
    category: "pairing-hard",
    lang: "en",
    cellar: "all",
    turns: [
      {
        user: "Fresh tagliatelle with shaved truffle and butter. Which wine does it justice?",
      },
    ],
    dish: "truffle-pasta",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ph-024",
    category: "pairing-hard",
    lang: "nl",
    cellar: "all",
    turns: [
      {
        user: "Ratatouille met stokbrood, wat schenk ik?",
      },
    ],
    dish: "ratatouille",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ph-025",
    category: "pairing-hard",
    lang: "en",
    cellar: "all",
    turns: [
      {
        user: "Green asparagus with hollandaise as a starter. Is there a wine that won't clash?",
      },
    ],
    dish: "green-asparagus-hollandaise",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ph-026",
    category: "pairing-hard",
    lang: "nl",
    cellar: "all",
    turns: [
      {
        user: "Asperges met ham, ei en gesmolten boter. Welke wijn?",
      },
    ],
    dish: "white-asparagus-flemish",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ph-027",
    category: "pairing-hard",
    lang: "en",
    cellar: "dry-only",
    turns: [
      {
        user: "Steamed artichokes with a vinaigrette dip. Any wine that works?",
      },
    ],
    dish: "artichoke-vinaigrette",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ph-028",
    category: "pairing-hard",
    lang: "nl",
    cellar: "everyday",
    turns: [
      {
        user: "Tomatensalade met rode ui en vinaigrette, welke wijn?",
      },
    ],
    dish: "tomato-salad",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ph-029",
    category: "pairing-hard",
    lang: "en",
    cellar: "all",
    turns: [
      {
        user: "Got a dozen raw oysters. What should I open?",
      },
    ],
    dish: "raw-oysters",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ph-030",
    category: "pairing-hard",
    lang: "nl",
    cellar: "all",
    turns: [
      {
        user: "We bestellen sushi en sashimi, met sojasaus en wasabi. Welke wijn?",
      },
    ],
    dish: "sushi-sashimi",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ph-031",
    category: "pairing-hard",
    lang: "en",
    cellar: "all",
    turns: [
      {
        user: "Making sea bass ceviche with lime and a bit of chili. Wine?",
      },
    ],
    dish: "ceviche",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ph-032",
    category: "pairing-hard",
    lang: "nl",
    cellar: "all",
    turns: [
      {
        user: "Gerookte paling op toast, wat past daarbij?",
      },
    ],
    dish: "smoked-eel",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ph-033",
    category: "pairing-hard",
    lang: "en",
    cellar: "all",
    turns: [
      {
        user: "Thai green chicken curry, pretty hot. What wine can handle that?",
      },
    ],
    dish: "thai-green-curry",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ph-034",
    category: "pairing-hard",
    lang: "nl",
    cellar: "all",
    turns: [
      {
        user: "We eten een vindaloo, echt heel pittig. Is er een wijn die dat aankan?",
      },
    ],
    dish: "vindaloo",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ph-035",
    category: "pairing-hard",
    lang: "en",
    cellar: "dry-only",
    turns: [
      {
        user: "Mild butter chicken with naan. What do I pour?",
      },
    ],
    dish: "butter-chicken",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ph-036",
    category: "pairing-hard",
    lang: "nl",
    cellar: "all",
    turns: [
      {
        user: "Mapo tofu met Sichuanpeper, behoorlijk heet. Welke wijn?",
      },
    ],
    dish: "mapo-tofu",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ph-037",
    category: "pairing-hard",
    lang: "en",
    cellar: "all",
    turns: [
      {
        user: "Miso-glazed black cod, Nobu-style. Which bottle?",
      },
    ],
    dish: "miso-cod",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ph-038",
    category: "pairing-hard",
    lang: "nl",
    cellar: "all",
    turns: [
      {
        user: "Koreaanse barbecue met bulgogi en kimchi. Welke wijn?",
      },
    ],
    dish: "korean-bbq",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ph-039",
    category: "pairing-hard",
    lang: "en",
    cellar: "all",
    turns: [
      {
        user: "Peking duck with pancakes and hoisin tonight. What should we open?",
      },
    ],
    dish: "peking-duck",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ph-040",
    category: "pairing-hard",
    lang: "nl",
    cellar: "everyday",
    turns: [
      {
        user: "Pad thai met garnalen, wat drink ik erbij?",
      },
    ],
    dish: "pad-thai",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ph-041",
    category: "pairing-hard",
    lang: "en",
    cellar: "all",
    turns: [
      {
        user: "Beef pho for dinner. Is wine even a thing with that?",
      },
    ],
    dish: "pho",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ph-042",
    category: "pairing-hard",
    lang: "nl",
    cellar: "all",
    turns: [
      {
        user: "Mezze-avond: hummus, baba ganoush, tabouleh, olijven. Welke wijn?",
      },
    ],
    dish: "hummus-mezze",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ph-043",
    category: "pairing-hard",
    lang: "en",
    cellar: "all",
    turns: [
      {
        user: "Shakshuka for a late brunch. Wine?",
      },
    ],
    dish: "shakshuka",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ph-044",
    category: "pairing-hard",
    lang: "nl",
    cellar: "all",
    turns: [
      {
        user: "Kibbeling met ravigotesaus van de markt, welke wijn?",
      },
    ],
    dish: "kibbeling-ravigote",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ph-045",
    category: "pairing-hard",
    lang: "en",
    cellar: "all",
    turns: [
      {
        user: "Eggs benedict brunch with friends. What bottle?",
      },
    ],
    dish: "eggs-benedict",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ph-046",
    category: "pairing-hard",
    lang: "nl",
    cellar: "all",
    turns: [
      {
        user: "Quiche lorraine met een groene salade. Welke wijn?",
      },
    ],
    dish: "quiche-lorraine",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ph-047",
    category: "pairing-hard",
    lang: "en",
    cellar: "all",
    turns: [
      {
        user: "French onion soup with the cheesy crouton. Which wine?",
      },
    ],
    dish: "french-onion-soup",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ph-048",
    category: "pairing-hard",
    lang: "nl",
    cellar: "all",
    turns: [
      {
        user: "Rendang met rijst en atjar. Kan daar een wijn bij?",
      },
    ],
    dish: "rendang",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ph-049",
    category: "pairing-hard",
    lang: "en",
    cellar: "all",
    turns: [
      {
        user: "Seafood paella for eight in the garden. What do I open?",
      },
    ],
    dish: "seafood-paella",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ph-050",
    category: "pairing-hard",
    lang: "nl",
    cellar: "all",
    turns: [
      {
        user: "Hollandse nieuwe met uitjes. Kan daar wijn bij?",
      },
    ],
    dish: "hollandse-nieuwe",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ph-051",
    category: "pairing-hard",
    lang: "en",
    cellar: "all",
    turns: [
      {
        user: "Teriyaki salmon with rice. Which wine?",
      },
    ],
    dish: "teriyaki-salmon",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ph-052",
    category: "pairing-hard",
    lang: "nl",
    cellar: "all",
    turns: [
      {
        user: "Kipsaté met pindasaus en kroepoek, wat schenk ik?",
      },
    ],
    dish: "sate-pindasaus",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ph-053",
    category: "pairing-hard",
    lang: "nl",
    cellar: "everyday",
    turns: [
      {
        user: "Nasi goreng met een gebakken ei. Welke wijn?",
      },
    ],
    dish: "nasi-goreng",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ph-054",
    category: "pairing-hard",
    lang: "en",
    cellar: "all",
    turns: [
      {
        user: "Bouillabaisse with rouille and croutons. What wine?",
      },
    ],
    dish: "bouillabaisse",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ph-055",
    category: "pairing-hard",
    lang: "nl",
    cellar: "all",
    turns: [
      {
        user: "Borrel met bitterballen, wat maken we open?",
      },
    ],
    dish: "bitterballen",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ph-056",
    category: "pairing-hard",
    lang: "en",
    cellar: "all",
    turns: [
      {
        user: "Smoked salmon blinis for New Year's Eve. What should I serve?",
      },
    ],
    dish: "smoked-salmon",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "ph-057",
    category: "pairing-hard",
    lang: "nl",
    cellar: "all",
    turns: [
      {
        user: "Falafel met tahinsaus in een wrap. Past daar wijn bij?",
      },
    ],
    dish: "falafel-tahini",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
  },
  {
    id: "pm-001",
    category: "pairing-misleading",
    lang: "en",
    cellar: "all",
    turns: [
      {
        user: "Making coq au vin tonight. What should I open?",
      },
    ],
    dish: "coq-au-vin",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
    note: "Chicken, but braised in red wine: wants Pinot Noir, not a white.",
  },
  {
    id: "pm-002",
    category: "pairing-misleading",
    lang: "nl",
    cellar: "whites-and-bubbles",
    turns: [
      {
        user: "Coq au vin vanavond, welke wijn uit mijn kelder?",
      },
    ],
    dish: "coq-au-vin",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
      noBottles: true,
    },
    note: "Chicken in red wine; this cellar has no red, and no white suits it: no bottle.",
  },
  {
    id: "pm-003",
    category: "pairing-misleading",
    lang: "en",
    cellar: "all",
    turns: [
      {
        user: "Beef carpaccio with rocket and parmesan as a starter. Wine?",
      },
    ],
    dish: "beef-carpaccio",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
    note: "Beef, but raw and light with lemon: not a big steak red.",
  },
  {
    id: "pm-004",
    category: "pairing-misleading",
    lang: "nl",
    cellar: "reds-only",
    turns: [
      {
        user: "Carpaccio met pijnboompitten en parmezaan, welke rode?",
      },
    ],
    dish: "beef-carpaccio",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
    note: "Raw, light beef: only the lightest reds work, the big ones do not.",
  },
  {
    id: "pm-005",
    category: "pairing-misleading",
    lang: "en",
    cellar: "all",
    turns: [
      {
        user: "Steak tartare with fries. What do I pour?",
      },
    ],
    dish: "steak-tartare",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
    note: "Steak in the name, but raw with capers and yolk: light red or rosé.",
  },
  {
    id: "pm-006",
    category: "pairing-misleading",
    lang: "nl",
    cellar: "all",
    turns: [
      {
        user: "Tonijnsteak kort gebakken, rood vanbinnen. Welke wijn?",
      },
    ],
    dish: "seared-tuna",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
    note: "Fish that takes a light red.",
  },
  {
    id: "pm-007",
    category: "pairing-misleading",
    lang: "en",
    cellar: "reds-only",
    turns: [
      {
        user: "Seared tuna steak, only reds in my rack right now. Which one?",
      },
    ],
    dish: "seared-tuna",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
    note: "Fish with reds only: light, low-tannin reds are good, the tannic ones are not.",
  },
  {
    id: "pm-008",
    category: "pairing-misleading",
    lang: "nl",
    cellar: "all",
    turns: [
      {
        user: "Vitello tonnato als voorgerecht, welke wijn?",
      },
    ],
    dish: "vitello-tonnato",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
    note: "Veal, but cold with tuna mayonnaise: white or rosé, not red.",
  },
  {
    id: "pm-009",
    category: "pairing-misleading",
    lang: "en",
    cellar: "all",
    turns: [
      {
        user: "Big pot of chili con carne for game night. What wine?",
      },
    ],
    dish: "chili-con-carne",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
    note: "'Chili' is the dish: beefy, moderately hot; ripe, soft red, not an off-dry white for fiery food.",
  },
  {
    id: "pm-010",
    category: "pairing-misleading",
    lang: "nl",
    cellar: "all",
    turns: [
      {
        user: "Kaasfondue met vrienden, welke wijn?",
      },
    ],
    dish: "cheese-fondue",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
    note: "Cheese, but melted Alpine fondue: crisp dry white, not a hard-cheese red.",
  },
  {
    id: "pm-011",
    category: "pairing-misleading",
    lang: "en",
    cellar: "all",
    turns: [
      {
        user: "Doing a matelote, fish stewed in red wine. Which bottle?",
      },
    ],
    dish: "fish-red-wine-sauce",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
    note: "Fish, but in red wine sauce: light red, not a white-fish white.",
  },
  {
    id: "pm-012",
    category: "pairing-misleading",
    lang: "nl",
    cellar: "whites-and-bubbles",
    turns: [
      {
        user: "Vis in rodewijnsaus, maar ik heb alleen wit en bubbels. Wat nu?",
      },
    ],
    dish: "fish-red-wine-sauce",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
    note: "Fish in red wine with whites only: at best acceptable.",
  },
  {
    id: "pm-013",
    category: "pairing-misleading",
    lang: "en",
    cellar: "all",
    turns: [
      {
        user: "Lamb rogan josh with basmati rice. What should I open?",
      },
    ],
    dish: "lamb-rogan-josh",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
    note: "Lamb, but a spiced curry: soft ripe red or aromatic white, not a tannic lamb red.",
  },
  {
    id: "pm-014",
    category: "pairing-misleading",
    lang: "nl",
    cellar: "all",
    turns: [
      {
        user: "Mousse van witte chocolade met frambozen, welke dessertwijn?",
      },
    ],
    dish: "white-chocolate-mousse",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
    note: "Chocolate in the name, but white and with berries: Moscato, not port.",
  },
  {
    id: "pm-015",
    category: "pairing-misleading",
    lang: "en",
    cellar: "all",
    turns: [
      {
        user: "Surf and turf tonight, steak and lobster tail. One bottle for both?",
      },
    ],
    dish: "surf-and-turf",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
    note: "Steak plus lobster: a bridge wine, not a big Cabernet.",
  },
  {
    id: "pm-016",
    category: "pairing-misleading",
    lang: "nl",
    cellar: "all",
    turns: [
      {
        user: "Chili con carne met rijst en zure room. Welke wijn?",
      },
    ],
    dish: "chili-con-carne",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
    note: "'Chili' is the dish, not a chili pepper heat bomb.",
  },
  {
    id: "ns-001",
    category: "no-suitable-wine",
    lang: "en",
    cellar: "big-reds",
    turns: [
      {
        user: "Opening oysters tonight. What from my cellar?",
      },
    ],
    dish: "raw-oysters",
    needs: ["pairing", "buying"],
    expect: {
      verdict: "auto",
      noBottles: true,
      buy: {
        given: true,
        maxLevel: "style",
      },
    },
    note: "No wine in this cellar suits the dish.",
  },
  {
    id: "ns-002",
    category: "no-suitable-wine",
    lang: "nl",
    cellar: "dry-only",
    turns: [
      {
        user: "Chocoladefondant als toetje. Welke wijn heb ik daarvoor?",
      },
    ],
    dish: "dark-chocolate-fondant",
    needs: ["pairing", "buying"],
    expect: {
      verdict: "auto",
      noBottles: true,
      buy: {
        given: true,
        maxLevel: "style",
      },
    },
    note: "No wine in this cellar suits the dish.",
  },
  {
    id: "ns-003",
    category: "no-suitable-wine",
    lang: "en",
    cellar: "big-reds",
    turns: [
      {
        user: "Pork vindaloo, very hot. Which bottle should I open?",
      },
    ],
    dish: "vindaloo",
    needs: ["pairing", "buying"],
    expect: {
      verdict: "auto",
      noBottles: true,
      buy: {
        given: true,
        maxLevel: "style",
      },
    },
    note: "No wine in this cellar suits the dish.",
  },
  {
    id: "ns-004",
    category: "no-suitable-wine",
    lang: "nl",
    cellar: "light-whites",
    turns: [
      {
        user: "Hertenbiefstuk met rodewijnsaus en rode kool, welke wijn uit mijn kelder?",
      },
    ],
    dish: "venison-red-wine-cabbage",
    needs: ["pairing", "buying"],
    expect: {
      verdict: "auto",
      noBottles: true,
      buy: {
        given: true,
        maxLevel: "style",
      },
    },
    note: "No wine in this cellar suits the dish.",
  },
  {
    id: "ns-005",
    category: "no-suitable-wine",
    lang: "en",
    cellar: "sweet-only",
    turns: [
      {
        user: "Ribeye on the barbecue. What do I have that goes with it?",
      },
    ],
    dish: "grilled-ribeye-steak",
    needs: ["pairing", "buying"],
    expect: {
      verdict: "auto",
      noBottles: true,
      buy: {
        given: true,
        maxLevel: "style",
      },
    },
    note: "No wine in this cellar suits the dish.",
  },
  {
    id: "ns-006",
    category: "no-suitable-wine",
    lang: "nl",
    cellar: "reds-only",
    turns: [
      {
        user: "Citroentaart als dessert, wat schenk ik?",
      },
    ],
    dish: "lemon-tart",
    needs: ["pairing", "buying"],
    expect: {
      verdict: "auto",
      noBottles: true,
      buy: {
        given: true,
        maxLevel: "style",
      },
    },
    note: "No wine in this cellar suits the dish.",
  },
  {
    id: "ns-007",
    category: "no-suitable-wine",
    lang: "en",
    cellar: "big-reds",
    turns: [
      {
        user: "Thai green curry tonight, hot one. What should I open?",
      },
    ],
    dish: "thai-green-curry",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
      noBottles: true,
    },
    note: "No wine in this cellar suits the dish.",
  },
  {
    id: "ns-008",
    category: "no-suitable-wine",
    lang: "nl",
    cellar: "light-whites",
    turns: [
      {
        user: "Crème brûlée na het eten. Welke wijn?",
      },
    ],
    dish: "creme-brulee",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
      noBottles: true,
    },
    note: "No wine in this cellar suits the dish.",
  },
  {
    id: "ns-009",
    category: "no-suitable-wine",
    lang: "en",
    cellar: "big-reds",
    turns: [
      {
        user: "Sushi delivery tonight. Which of my wines?",
      },
    ],
    dish: "sushi-sashimi",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
      noBottles: true,
    },
    note: "No wine in this cellar suits the dish.",
  },
  {
    id: "ns-010",
    category: "no-suitable-wine",
    lang: "nl",
    cellar: "light-whites",
    turns: [
      {
        user: "Roquefort na het diner, welke wijn heb ik?",
      },
    ],
    dish: "blue-cheese",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
      noBottles: true,
    },
    note: "No wine in this cellar suits the dish.",
  },
  {
    id: "ns-011",
    category: "no-suitable-wine",
    lang: "en",
    cellar: "reds-only",
    turns: [
      {
        user: "Ceviche for lunch, what can I pour?",
      },
    ],
    dish: "ceviche",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
      noBottles: true,
    },
    note: "No wine in this cellar suits the dish.",
  },
  {
    id: "ns-012",
    category: "no-suitable-wine",
    lang: "nl",
    cellar: "reds-only",
    turns: [
      {
        user: "Kaasfondue vanavond. Wat kan ik openen?",
      },
    ],
    dish: "cheese-fondue",
    needs: ["pairing", "buying"],
    expect: {
      verdict: "auto",
      noBottles: true,
      buy: {
        given: true,
        maxLevel: "style",
      },
    },
    note: "No wine in this cellar suits the dish.",
  },
  {
    id: "ns-013",
    category: "no-suitable-wine",
    lang: "en",
    cellar: "light-whites",
    turns: [
      {
        user: "Roast chicken tonight. What should I open?",
      },
    ],
    dish: "roast-chicken",
    needs: ["pairing", "buying"],
    expect: {
      verdict: "auto",
      buy: {
        given: true,
        maxLevel: "style",
      },
    },
    note: "Only acceptable wines in this cellar.",
  },
  {
    id: "ns-014",
    category: "no-suitable-wine",
    lang: "nl",
    cellar: "big-reds",
    turns: [
      {
        user: "Chocoladefondant, welke wijn uit de kelder?",
      },
    ],
    dish: "dark-chocolate-fondant",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
    note: "Only acceptable wines in this cellar.",
  },
  {
    id: "ns-015",
    category: "no-suitable-wine",
    lang: "en",
    cellar: "big-reds",
    turns: [
      {
        user: "Stilton and crackers. What wine do I have?",
      },
    ],
    dish: "blue-cheese",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
    note: "Only acceptable wines in this cellar.",
  },
  {
    id: "ns-016",
    category: "no-suitable-wine",
    lang: "nl",
    cellar: "reds-only",
    turns: [
      {
        user: "Salade met geitenkaas, maar ik heb alleen rood. Welke dan?",
      },
    ],
    dish: "goat-cheese-salad",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
    note: "Only acceptable wines in this cellar.",
  },
  {
    id: "ns-017",
    category: "no-suitable-wine",
    lang: "en",
    cellar: "everyday",
    turns: [
      {
        user: "Baked salmon tonight. Which bottle?",
      },
    ],
    dish: "salmon-fillet",
    needs: ["pairing", "buying"],
    expect: {
      verdict: "auto",
      buy: {
        given: true,
        maxLevel: "style",
      },
    },
    note: "Only acceptable wines in this cellar.",
  },
  {
    id: "ns-018",
    category: "no-suitable-wine",
    lang: "nl",
    cellar: "everyday",
    turns: [
      {
        user: "Paddenstoelenrisotto, wat schenk ik?",
      },
    ],
    dish: "mushroom-risotto",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
    note: "Only acceptable wines in this cellar.",
  },
  {
    id: "ec-001",
    category: "empty-cellar",
    lang: "en",
    cellar: "empty",
    turns: [
      {
        user: "Grilling steaks tonight, what should I open?",
      },
    ],
    dish: "grilled-ribeye-steak",
    needs: ["pairing", "buying"],
    expect: {
      verdict: "none",
      noBottles: true,
      buy: {
        given: true,
        maxLevel: "style",
      },
    },
  },
  {
    id: "ec-002",
    category: "empty-cellar",
    lang: "nl",
    cellar: "empty",
    turns: [
      {
        user: "Mosselen met friet vanavond, welke wijn?",
      },
    ],
    dish: "mosselen-friet",
    needs: ["pairing", "buying"],
    expect: {
      verdict: "none",
      noBottles: true,
      buy: {
        given: true,
        maxLevel: "style",
      },
    },
  },
  {
    id: "ec-003",
    category: "empty-cellar",
    lang: "en",
    cellar: "empty",
    turns: [
      {
        user: "Roast chicken for dinner. Which bottle?",
      },
    ],
    dish: "roast-chicken",
    needs: ["pairing", "buying"],
    expect: {
      verdict: "none",
      noBottles: true,
      buy: {
        given: true,
        maxLevel: "style",
      },
    },
  },
  {
    id: "ec-004",
    category: "empty-cellar",
    lang: "nl",
    cellar: "empty",
    turns: [
      {
        user: "Appeltaart met slagroom, past daar een wijn bij?",
      },
    ],
    dish: "appeltaart-slagroom",
    needs: ["pairing", "buying"],
    expect: {
      verdict: "none",
      noBottles: true,
      buy: {
        given: true,
        maxLevel: "style",
      },
    },
  },
  {
    id: "ec-005",
    category: "empty-cellar",
    lang: "en",
    cellar: "empty",
    turns: [
      {
        user: "What should I open tonight?",
      },
    ],
    needs: ["pairing"],
    expect: {
      noBottles: true,
    },
  },
  {
    id: "ec-006",
    category: "empty-cellar",
    lang: "nl",
    cellar: "empty",
    turns: [
      {
        user: "Welke fles zal ik vanavond opentrekken?",
      },
    ],
    needs: ["pairing"],
    expect: {
      noBottles: true,
    },
  },
  {
    id: "mm-001",
    category: "missing-metadata",
    lang: "en",
    cellar: "all",
    mods: {
      strip: "all",
    },
    turns: [
      {
        user: "Ribeye tonight, what should I open?",
      },
    ],
    dish: "grilled-ribeye-steak",
    needs: ["pairing", "evidence"],
    expect: {
      verdict: "auto",
      maxConfidence: "medium",
    },
  },
  {
    id: "mm-002",
    category: "missing-metadata",
    lang: "nl",
    cellar: "all",
    mods: {
      strip: ["muscadet", "chablis", "sancerre", "champagne"],
    },
    turns: [
      {
        user: "Oesters vanavond, welke wijn?",
      },
    ],
    dish: "raw-oysters",
    needs: ["pairing", "evidence"],
    expect: {
      verdict: "auto",
      maxConfidence: "medium",
    },
  },
  {
    id: "mm-003",
    category: "missing-metadata",
    lang: "en",
    cellar: "all",
    mods: {
      strip: "all",
    },
    turns: [
      {
        user: "Sea bass with lemon butter. Which bottle?",
      },
    ],
    dish: "sea-bass-lemon-butter",
    needs: ["pairing", "evidence"],
    expect: {
      verdict: "auto",
      maxConfidence: "medium",
    },
  },
  {
    id: "mm-004",
    category: "missing-metadata",
    lang: "nl",
    cellar: "everyday",
    mods: {
      strip: "all",
    },
    turns: [
      {
        user: "Stoofvlees vanavond, wat schenk ik?",
      },
    ],
    dish: "beef-stew",
    needs: ["pairing", "evidence"],
    expect: {
      verdict: "auto",
      maxConfidence: "medium",
    },
  },
  {
    id: "mm-005",
    category: "missing-metadata",
    lang: "en",
    cellar: "all",
    mods: {
      strip: ["pauillac", "napa-cab", "crozes", "rioja-reserva"],
    },
    turns: [
      {
        user: "Roast lamb on Sunday, which red?",
      },
    ],
    dish: "roast-lamb",
    needs: ["pairing", "evidence"],
    expect: {
      verdict: "auto",
      maxConfidence: "medium",
    },
  },
  {
    id: "mm-006",
    category: "missing-metadata",
    lang: "nl",
    cellar: "one-red",
    mods: {
      strip: "all",
    },
    turns: [
      {
        user: "Ik maak stoofvlees. Past mijn fles daarbij?",
      },
    ],
    dish: "beef-stew",
    needs: ["pairing", "evidence"],
    expect: {
      verdict: "auto",
      maxConfidence: "low",
    },
  },
  {
    id: "mm-007",
    category: "missing-metadata",
    lang: "en",
    cellar: "one-white",
    mods: {
      strip: "all",
    },
    turns: [
      {
        user: "Goat cheese salad tonight. Does my wine work?",
      },
    ],
    dish: "goat-cheese-salad",
    needs: ["pairing", "evidence"],
    expect: {
      verdict: "auto",
      maxConfidence: "low",
    },
  },
  {
    id: "mm-008",
    category: "missing-metadata",
    lang: "nl",
    cellar: "one-red",
    mods: {
      strip: "all",
    },
    turns: [
      {
        user: "Spaghetti bolognese, kan ik mijn fles openen?",
      },
    ],
    dish: "spaghetti-bolognese",
    needs: ["pairing", "evidence"],
    expect: {
      verdict: "auto",
      maxConfidence: "low",
    },
  },
  {
    id: "mm-009",
    category: "missing-metadata",
    lang: "en",
    cellar: "one-white",
    mods: {
      strip: "all",
    },
    turns: [
      {
        user: "Raw oysters. Will the bottle I have do?",
      },
    ],
    dish: "raw-oysters",
    needs: ["pairing", "evidence"],
    expect: {
      verdict: "auto",
      maxConfidence: "low",
    },
  },
  {
    id: "mm-010",
    category: "missing-metadata",
    lang: "nl",
    cellar: "one-white",
    mods: {
      strip: "all",
    },
    turns: [
      {
        user: "Kip met citroen en kruiden, past mijn witte wijn?",
      },
    ],
    dish: "chicken-lemon-herbs",
    needs: ["pairing", "evidence"],
    expect: {
      verdict: "auto",
      maxConfidence: "low",
    },
  },
  {
    id: "inv-001",
    category: "inventory",
    lang: "en",
    cellar: "all",
    mods: {
      reserved: {
        pauillac: 2,
        "napa-cab": 2,
      },
    },
    turns: [
      {
        user: "Grilling a ribeye tonight. What should I open?",
      },
    ],
    dish: "grilled-ribeye-steak",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
      never: ["pauillac", "napa-cab"],
    },
    note: "The two best steak wines are fully reserved; others remain good.",
  },
  {
    id: "inv-002",
    category: "inventory",
    lang: "nl",
    cellar: "all",
    mods: {
      reserved: {
        pauillac: 2,
      },
    },
    turns: [
      {
        user: "Lamsbout zondag, welke wijn trek ik open?",
      },
    ],
    dish: "roast-lamb",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
      never: ["pauillac"],
    },
    note: "Pauillac fully reserved.",
  },
  {
    id: "inv-003",
    category: "inventory",
    lang: "en",
    cellar: "all",
    mods: {
      reserved: {
        champagne: 1,
      },
    },
    turns: [
      {
        user: "Oysters tonight. What should I open?",
      },
    ],
    dish: "raw-oysters",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
    },
    note: "One of two Champagne bottles reserved; one is still free.",
  },
  {
    id: "inv-004",
    category: "inventory",
    lang: "en",
    cellar: "all",
    mods: {
      years: {
        barolo: 2024,
        pauillac: 2024,
      },
    },
    turns: [
      {
        user: "Venison with red wine sauce tonight. Which bottle?",
      },
    ],
    dish: "venison-red-wine-cabbage",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
      never: ["barolo", "pauillac"],
    },
    note: "Barolo and Pauillac far too young.",
  },
  {
    id: "inv-005",
    category: "inventory",
    lang: "nl",
    cellar: "all",
    mods: {
      years: {
        barolo: 2024,
      },
    },
    turns: [
      {
        user: "Osso buco vanavond, welke wijn?",
      },
    ],
    dish: "osso-buco",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
      never: ["barolo"],
    },
    note: "Barolo far too young; Chianti remains good.",
  },
  {
    id: "inv-006",
    category: "inventory",
    lang: "en",
    cellar: "one-white",
    mods: {
      years: {
        sancerre: 2010,
      },
    },
    turns: [
      {
        user: "Goat cheese salad tonight. Can I open my white?",
      },
    ],
    dish: "goat-cheese-salad",
    needs: ["pairing"],
    expect: {
      verdict: "auto",
      flags: ["past"],
    },
    note: "The only wine is past its window.",
  },
  {
    id: "inv-007",
    category: "inventory",
    lang: "en",
    cellar: "everyday",
    turns: [
      {
        user: "How many bottles do I have?",
      },
    ],
    needs: ["facts"],
    expect: {
      facts: {
        bottles: 16,
        wines: 8,
      },
    },
  },
  {
    id: "inv-008",
    category: "inventory",
    lang: "nl",
    cellar: "all",
    mods: {
      counts: {
        "rioja-reserva": 5,
      },
    },
    turns: [
      {
        user: "Hoeveel flessen Rioja heb ik?",
      },
    ],
    needs: ["facts"],
    expect: {
      facts: {
        matchedBottles: 5,
      },
    },
  },
  {
    id: "inv-009",
    category: "inventory",
    lang: "en",
    cellar: "all",
    mods: {
      counts: {
        champagne: 3,
      },
    },
    turns: [
      {
        user: "How many bottles of Champagne have I got left?",
      },
    ],
    needs: ["facts"],
    expect: {
      facts: {
        matchedBottles: 3,
      },
    },
  },
];
