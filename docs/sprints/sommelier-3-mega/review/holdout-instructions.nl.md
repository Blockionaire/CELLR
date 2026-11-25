# De onafhankelijke holdout schrijven — instructies (100 gerechten: 40 verkennend, 60 definitief)

**Wie:** iemand met wijnkennis (en voor de gerechten één of twee mensen die koken), die niet aan CELLR heeft gewerkt
en geen AI gebruikt bij het schrijven. **Waarvoor:** een blinde test of de sommelier gerechten goed combineert die hij
nooit heeft gezien. Zolang dit er niet is, rust elke uitspraak over kwaliteit op scenario's die een AI schreef.

## Twee delen: 40 verkennend, 60 definitief (besluit van de eigenaar, 25-11-2026)

| Deel               | Formulier                          | Gerechten | ids                   | Waarvoor                                                                                                             |
| ------------------ | ---------------------------------- | --------: | --------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Verkennend         | `holdout-template-exploratory.csv` |        40 | `hh-x-01` … `hh-x-40` | Een eerste blik; elk rapport zegt EXPLORATORY. Vangt alleen een grote achteruitgang                                  |
| Definitief (blind) | `holdout-template-definitive.csv`  |        60 | `hh-d-01` … `hh-d-60` | De meting. Verzegeld, nooit gezien door een agent of ontwikkelaar, **één keer** gescoord, nadat de build bevroren is |

De definitieve 60 worden geschreven door mensen die **geen** resultaat van de verkennende 40 hebben gezien (ook geen
totaal). Op het verkennende deel rust geen uitspraak dat CELLR "even goed" is als voorheen (`P8_POWER_ANALYSIS.md`).

## Wat je invult

Open het formulier van jouw deel. De kolom `id` is ingevuld; de rest is aan jou. Per rij één gerecht:

| Kolom                         | Wat je schrijft                                                                                                 |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------- |
| dish (English), dish (Dutch)  | Het gerecht in een paar woorden, in beide talen                                                                 |
| question (English, Dutch)     | Hoe iemand het de app zou vragen ("We eten vanavond …, welke wijn?")                                            |
| main                          | Waar het gerecht op gebouwd is: één van de woorden in de kolomkop                                               |
| weight                        | 1 licht … 5 heel rijk                                                                                           |
| fat, acid, sweet, heat, umami | 0 niet … 3 overheersend (heat = pittig)                                                                         |
| right wines                   | De wijnen uit `holdout-wines.csv` die je met overtuiging zou schenken, met hun **key**, gescheiden door spaties |
| acceptable wines              | De wijnen die zonder botsing kunnen, met hun key                                                                |
| nothing suits                 | `yes` als geen van de 30 wijnen goed of acceptabel is; anders leeg                                              |
| why                           | Eén regel: je redenering                                                                                        |
| written by                    | Initialen of een rol ("kok 1", "sommelier"), nooit een volledige naam zonder toestemming                        |

Elke wijn die je niet noemt, telt als een **slechte** keuze bij dat gerecht. "Niets past" is een echt antwoord:
gebruik het als het waar is. `holdout-wines.csv` noemt de 30 wijnen (key, naam, soort, jaar, appellation, streek,
druiven); het zijn de wijnen van de testkelder, met verzonnen producenten.

**Regels:** een echte mix (gewoon Nederlands eten, andere keukens, restaurantgerechten, desserts, kaas, vage
omschrijvingen, een saus of bereiding die ertoe doet). Niets overnemen uit de bestaande benchmark, en geen gerecht
kiezen omdat je verwacht dat CELLR het fout doet. Kijk niet naar de antwoorden van CELLR tijdens het schrijven.

## Bewaring: het ingevulde bestand komt nooit in de repository

1. Vul het formulier in **op je eigen computer**. Zet het niet in de repository, niet op een gedeelde schijf die de
   ontwikkelaars kunnen lezen en niet in een chat met een AI.
2. Stuur het alleen naar de eigenaar. De eigenaar bewaart het in een privémap buiten de repository en zet het daar om
   en verzegelt het **per deel** (`holdout-from-csv exploratory` en `seal-human-holdout` → `SEAL-exploratory.json`;
   `holdout-from-csv definitive` → `SEAL-definitive.json`; daarna `merge` en het zegel van de volledige 100, `SEAL.json`;
   zie de Engelse versie voor de commando's). Het
   omzetprogramma weigert elk pad binnen de repository en toont alleen een aantal en rijnummers, nooit een gerecht.
3. De eigenaar legt **alleen** de zegels vast. De benchmark leest het verkennende deel als set `human-exploratory` en
   het definitieve als set `human-definitive`, elk van het pad van de eigenaar, en weigert een bestand dat niet bij zijn
   zegel past. De definitieve set wordt geweigerd tenzij de build bevroren is en `--definitive --frozen-at <sha>`
   gegeven is, en een tweede scoring van hetzelfde zegel door dezelfde engine wordt geweigerd.
4. **De agent die CELLR ontwikkelt of meet, mag het bestand niet zien vóór de meting**, en de set wordt alleen in
   totalen gerapporteerd. Een wijziging na de eerste meting krijgt een nieuw zegel en een geschreven reden.

**Omvang:** de volledige set houdt zijn minimum van 100 gerechten; die is een controle op omvang en bewaring en wordt
niet als zodanig gescoord: de definitieve gerechten worden alleen in hun eigen set gescoord, één keer.

Ingevuld door: ____________ Datum: ________ — niets telt voordat je hebt ondertekend.
