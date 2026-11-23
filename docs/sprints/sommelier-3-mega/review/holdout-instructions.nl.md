# De onafhankelijke holdout schrijven — instructies (40 scenario's)

**Wie:** iemand met wijnkennis (en voor de gerechten één of twee mensen die koken), die niet aan CELLR heeft gewerkt
en geen AI gebruikt bij het schrijven. **Waarvoor:** een blinde test of de sommelier gerechten goed combineert die hij
nooit heeft gezien. Zolang dit er niet is, rust elke uitspraak over kwaliteit op scenario's die een AI schreef.

## Wat je invult

Open `holdout-template.csv`. Het heeft 40 rijen; de kolom `id` is ingevuld (`hh-01` … `hh-40`), de rest is aan jou.
Per rij één gerecht:

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
   en verzegelt het (`holdout-from-csv`, daarna `seal-human-holdout`; zie de Engelse versie voor de commando's). Het
   omzetprogramma weigert elk pad binnen de repository en toont alleen een aantal en rijnummers, nooit een gerecht.
3. De eigenaar legt **alleen** het zegel vast (`SEAL.json`: de hash van het bestand en het aantal gerechten). De
   benchmark leest het bestand van het pad van de eigenaar en weigert het als het niet bij het zegel past.
4. **De agent die CELLR ontwikkelt of meet, mag het bestand niet zien vóór de meting**, en de set wordt alleen in
   totalen gerapporteerd. Een wijziging na de eerste meting krijgt een nieuw zegel en een geschreven reden.

**Over de omvang:** het S10-plan vraagt minstens 100 gerechten; dit formulier vraagt er nu 40. Met 40 faalt de
bewaringstest tot de eigenaar óf om 60 extra vraagt, óf schriftelijk besluit dat 40 voor deze release genoeg is.

Ingevuld door: ____________ Datum: ________ — niets telt voordat je hebt ondertekend.
