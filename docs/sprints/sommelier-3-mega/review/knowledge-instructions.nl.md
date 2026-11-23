# De kennis achter de fallback — beoordelingsinstructies

**Wie:** een wijnprofessional. **Waarom:** als de AI er niet is, antwoorden de eigen engines van de app (het onderdeel
`fallback`). Dat blijft in productie uit tot een professional heeft beoordeeld wat ze weten (besluit D-49). Vier
formulieren, elk gemaakt uit de huidige code; de woorden erin zijn de uitkomsten van de regels, in gewoon Engels.

| Formulier                | Rijen | Wat je ziet                                                                                                                                                                        |
| ------------------------ | ----: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `knowledge-serving.csv`  |    26 | Een wijnsoort en hoe hij is (body, tannine, zoet, hout, leeftijd) → de temperatuur, koelkasttijd, het decanteren en het glas volgens de regels                                     |
| `knowledge-windows.csv`  |    54 | Een wijn (soort, appellation, land) → als welke stijl hij gelezen wordt, en van hoeveel jaar na de oogst tot hoeveel hij goed te drinken is; ook voor een fles van €60             |
| `knowledge-pairings.csv` |    60 | Een gerecht en een wijn → het oordeel van de engine (goed / acceptabel / geen van beide / slecht) en de redenen voor en tegen, willekeurig gekozen met een vaste startwaarde       |
| `knowledge-fallback.csv` |    20 | De antwoorden van de fallback die het meest afwijken van de labels van de benchmark; **die labels zijn door een AI geschreven en door niemand gecontroleerd**, dus beoordeel beide |

Vul per rij de kolommen `YOUR VERDICT` in: `agree` (eens), `disagree` (oneens) of `unsure` (weet niet), en waarom
(wat het zou moeten zijn). In het fallback-formulier zijn er twee oordelen: over de keuze van de fallback en over het
door de AI geschreven label. Gebruik de drie woorden van [criteria.nl.md](criteria.nl.md).

Laat een cel alleen leeg als je die rij niet hebt beoordeeld. Ingevuld door: ____________ Datum: ________ — niets telt
als beoordeeld voordat je hebt ondertekend.
