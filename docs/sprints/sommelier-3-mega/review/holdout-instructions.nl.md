# De onafhankelijke holdout schrijven — instructies (100 gerechten, in twee series)

**Wie:** iemand met wijnkennis (en voor de gerechten één of twee mensen die koken), die niet aan CELLR heeft gewerkt
en geen AI gebruikt bij het schrijven. **Waarvoor:** een blinde test of de sommelier gerechten goed combineert die hij
nooit heeft gezien. Zolang dit er niet is, rust elke uitspraak over kwaliteit op scenario's die een AI schreef.

## Twee series: 40, daarna 60

Het voorlopige doel van de eigenaar (24-11-2026) is **100 onafhankelijke gerechten**, geschreven in twee series:

| Serie | Formulier                      | Gerechten | ids                     | Geschreven door                                                           |
| ----- | ------------------------------ | --------: | ----------------------- | ------------------------------------------------------------------------- |
| 1     | `holdout-template-series1.csv` |        40 | `hh-s1-01` … `hh-s1-40` | de eerste schrijvers                                                      |
| 2     | `holdout-template-series2.csv` |        60 | `hh-s2-01` … `hh-s2-60` | mensen die **geen** resultaat van serie 1 hebben gezien (ook geen totaal) |

Een meting op serie 1 alleen wordt gerapporteerd als **voorlopig**: 40 gerechten vangen alleen een grote
achteruitgang, en kunnen niet aantonen dat V1+ binnen 5 punten even goed is als V1 (`P8_POWER_ANALYSIS.md`). Alleen
de volledige 100 is de holdout die de poort vraagt.

## Wat je invult

Open het formulier van jouw serie. De kolom `id` is ingevuld; de rest is aan jou. Per rij één gerecht:

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
   en verzegelt het **per serie** (`holdout-from-csv 1`, `seal-human-holdout` → `SEAL-series1.json`; later serie 2,
   `holdout-from-csv merge` en het zegel van de volledige set, `SEAL.json`; zie de Engelse versie voor de commando's). Het
   omzetprogramma weigert elk pad binnen de repository en toont alleen een aantal en rijnummers, nooit een gerecht.
3. De eigenaar legt **alleen** de zegels vast (`SEAL-series1.json`, later `SEAL.json`: de hash van een bestand en het
   aantal gerechten). De benchmark leest serie 1 als set `human-series1` en de volledige 100 als set `human`, elk van
   het pad van de eigenaar, en weigert een bestand dat niet bij zijn zegel past.
4. **De agent die CELLR ontwikkelt of meet, mag het bestand niet zien vóór de meting**, en de set wordt alleen in
   totalen gerapporteerd. Een wijziging na de eerste meting krijgt een nieuw zegel en een geschreven reden.

**Omvang:** de volledige set houdt zijn minimum van 100 gerechten; serie 1 alleen is een aparte set met een
duidelijke naam (`human-series1`, precies 40), waarvan elk rapport begint met `PROVISIONAL` (voorlopig).

Ingevuld door: ____________ Datum: ________ — niets telt voordat je hebt ondertekend.
