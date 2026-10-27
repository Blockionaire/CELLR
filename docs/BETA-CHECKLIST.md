# CELLR — private beta: checklist

Deze lijst scheidt wat **automatisch getest** wordt van wat **alleen op de gehoste omgeving en een echte
iPhone** te zien is. Een Playwright-test met een iPhone-afmeting is geen iPhone-test: zet bij een
apparaatstap pas ✅ als je het op een fysieke iPhone hebt gezien, met model en iOS-versie erbij.

**CELLR is klaar om testers uit te nodigen als 0, A en B slagen op de gehoste omgeving en minstens één
iPhone, en er geen open P0 is (zie `docs/BETA-OPERATIONS.md`).** Noteer per stap ✅ of ❌ met wat je zag.

Sleutels, wachtwoorden en inlogcodes horen nergens in deze lijst, een chat of de repository: alleen in
Vercel, Supabase en je wachtwoordmanager.

---

## 0. Automatisch (laptop, vóór elke uitnodigingsronde)

| Wat                                   | Commando                                                        | Dekt                                                                                                                         |
| ------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Typen, lint, opmaak, unit-tests       | `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test` | Domeinregels, services, i18n-pariteit NL/EN, architectuurgrenzen, admin-grenzen                                              |
| Database-rechten (RLS)                | `bash scripts/db-test.sh`                                       | Elke tabel: wie mag lezen/schrijven, huishoudens van elkaar gescheiden, feedback alleen schrijven, admin alleen service role |
| Gegenereerde databasetypes            | `pnpm db:types:check`                                           | Migraties en code lopen gelijk                                                                                               |
| Bèta-smoke (serieel, telefoonformaat) | `pnpm build` en dan `pnpm --filter @cellr/web e2e:beta`         | Zie hieronder                                                                                                                |

De bèta-smoke (`e2e:beta`) bevat: acceptatie (stap 1–13 van B, van begin tot eind), smoke (routes, CSP,
uitloggen), flows, kelder, wijnpagina, scannen (drie modi, batch, dubbele foto's), camera (weigeren,
achtergrond, iPhone SE- en 13-formaat), proeven, Mijn beoordelingen, Mijn smaakprofiel, Sommelier (met en
zonder je smaak), account, huishoudens, vrienden, inzichten, taal, opruimen, Home en feedback. Duur lokaal
ongeveer 45–60 minuten. De dure 3D-specs zitten er bewust niet in.

Alle AI is in de tests nep (een lokaal OpenAI-compatibel endpoint): er wordt nooit iets betaald.

---

## A. De gehoste omgeving (laptop, 15 minuten)

1. **Database bij.** Supabase → SQL Editor:

   ```sql
   select
     (select count(*) from pg_tables where schemaname = 'public' and not rowsecurity) as zonder_rls,         -- 0
     (select count(*) from pg_tables where schemaname = 'public'
        and tablename in ('taste_preferences', 'beta_feedback'))                     as nieuwste_tabellen,   -- 2
     (select count(*) from pg_proc where proname = 'admin_beta_feedback')            as feedback_inbox,      -- 1
     (select count(*) from pg_proc where proname = 'recall_confirmed_scan')          as scan_cache,          -- 1
     (select count(*) from pg_proc where proname = 'shared_wine_profile')            as shared_profiles,     -- 1
     (select count(*) from pg_proc where proname = 'catalog_import')                 as catalog_import,      -- 1
     (select mode from public.catalog_learning)                                     as catalogus_leren,     -- off
     (select numeric_scale from information_schema.columns
       where table_name = 'tastings' and column_name = 'score')                     as score_decimalen,     -- 1
     (select count(*) from private.allowed_signups)                                  as beta_lijst;          -- ≥ 1
   ```

   Ontbreekt iets: draai de ontbrekende migraties uit `supabase/migrations/` in volgorde (de nieuwste is
   `20261102000025_decimal_ratings.sql`: beoordelingen in tienden van een ster; bestaande cijfers blijven gelijk).

2. **Beta-lijst.** `select entry from private.allowed_signups;` bevat jouw adres en dat van iedere tester
   (kleine letters). Een lege lijst betekent: iedereen mag een account maken. Dat is níet wat je wilt.
3. **Vercel → Environment Variables** (alleen de namen controleren, niet de waarden):
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
   `OPENAI_API_KEY`, `CELLR_ADMIN_USER_IDS`, `AI_BUDGET_DAILY_USD`, `AI_BUDGET_MONTHLY_USD`; voor
   herinneringen ook `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `CRON_SECRET`.
4. **OpenAI-dashboard:** een harde maandlimiet staat ingesteld (het budget in CELLR is een extra rem, geen
   vervanging).
5. **Deployment Protection** staat uit voor de URL die testers krijgen (anders zien ze een Vercel-inlog).
6. **In de browser**, op die URL:
   - `/sign-in` toont het inlogscherm; `/manifest.webmanifest` en `/sw.js` laden; `/offline.html` toont de
     offline-pagina; `/api/v1/me` geeft `401`.
7. **Iemand die niet op de lijst staat:** na "Stuur me een code" verschijnt _"CELLR is voorlopig alleen op
   uitnodiging…"_ en er komt **geen** mail.
8. **Catalogus leren** staat op `off` totdat jij de privacytekst hebt bijgewerkt en in `/admin/catalog` voor
   opt-out of opt-in kiest (zie `docs/CATALOG.md`). Daarna: een tester voegt een gescande fles toe; in
   `/admin/catalog` verschijnt één kandidaat met "1 label", zonder te zien wie.
9. **Admin:** `/admin` opent voor jou (jouw user-id staat in `CELLR_ADMIN_USER_IDS`); `/admin/feedback`
   toont "Beta feedback" (of zegt dat de migratie nog ontbreekt). Een tester-account krijgt "niet gevonden".

## B. De kernreis op een echte iPhone (Safari, daarna vanaf het beginscherm, 30 minuten)

Gebruik een **nieuw** adres dat op de beta-lijst staat en twee of drie echte flessen.

| #   | Doen                                                                          | Verwacht                                                                                                |
| --- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 1   | URL in Safari, adres invullen, "Stuur me een code", code uit de mail typen    | Mail binnen 1 minuut, geen link, code werkt                                                             |
| 2   | Pincode instellen (of "Niet nu"), huishouden maken, naam invullen             | Lege Home met je naam en "Scan je eerste fles"                                                          |
| 3   | Scan → modus **Eén fles** → "Camera gebruiken" → toestaan → foto              | Live beeld; ontspanner zichtbaar **zonder scrollen** boven de tabbalk                                   |
| 4   | Controleer producent, naam en jaar; verbeter wat niet klopt; plek kiezen      | Opslaan lukt; "Toegevoegd aan je kelder" met de foto                                                    |
| 5   | Scan → **Zelfde wijn** → één etiket → aantal                                  | Formulier start op 2 en zegt dat één scan voor alle flessen geldt; er is één keer gelezen               |
| 6   | Scan → **Batch** → 3 verschillende flessen na elkaar (of 3 foto's kiezen)     | Voortgang per foto; elke foto apart nakijken en toevoegen; na de laatste een korte samenvatting         |
| 7   | Kelder → zoek op naam → wijnpagina → "Fles openen"                            | "Proost!"; de kelder telt één fles minder                                                               |
| 8   | "Hoe was het?" → sterren + notitie → Opslaan                                  | Beoordeling op de wijnpagina; Profiel → Mijn beoordelingen toont hem                                    |
| 9   | Profiel → Mijn smaakprofiel → korte vragen beantwoorden of overslaan          | Profiel toont je antwoorden apart van wat uit beoordelingen blijkt; weinig data = "nog niet genoeg"     |
| 10  | Sommelier → "Wat moet ik vanavond openen?"; daarna "Mijn smaak gebruiken" uit | Met smaak soms "Op basis van je smaakprofiel"; zonder: algemeen advies, nooit dat label                 |
| 11  | Vanavond → een gerecht (bijv. "steak")                                        | Eerlijk oordeel uit je eigen kelder; past niets, dan zegt hij dat en stelt kopen voor binnen het budget |
| 12  | Profiel → Feedback geven → iets korts versturen                               | "Dank je wel!"; jij (admin) ziet het in `/admin/feedback`                                               |
| 13  | Uitloggen → inloggen met pincode                                              | Kelder, beoordelingen en smaakprofiel ongewijzigd                                                       |

## C. Wat alleen een echte iPhone laat zien

1. **Beginscherm-app.** Safari → Deel → _Zet op beginscherm_. Vanaf het icoon: volledig scherm, geen
   adresbalk, niets onder de notch of de home-balk.
2. **Camera: Safari tegenover de beginscherm-app.** CELLR vraagt de camera alleen als je op "Camera
   gebruiken" tikt (of vanzelf als de browser het al toestaat). Binnen één bezoek vraagt hij niet opnieuw
   bij foto → nakijken → volgende foto. **Let op:** iOS kan de toestemming in de beginscherm-app vergeten
   na het sluiten van de app; dan vraagt iOS opnieuw. Dat is gedrag van WebKit, geen CELLR-fout. Noteer
   wél als je binnen één bezoek meer dan één keer wordt gevraagd.
3. **Camera geweigerd.** Weiger in de prompt: het scherm zegt dat CELLR de camera niet mag gebruiken, en de
   ontspanner opent de iPhone-camera. Terug naar het scherm of uit de achtergrond: **geen** nieuwe vraag
   tot je zelf op "Camera opnieuw proberen" tikt.
4. **Foto's uit de bibliotheek** starten de camera niet (geen groen bolletje).
5. **Achtergrond.** Tijdens het scannen naar het beginscherm: het groene camerabolletje gaat uit; terug in
   CELLR komt het beeld terug.
6. **3D-kelder.** Kelder → 3D. Tik een fles: hij schuift uit het rek en staat rechtop. Terugleggen met de
   knop, een tik ernaast en vegen. Noteer haperingen en het iPhone-model; de laptop zegt hier niets over.
7. **Offline en terug.** Vliegtuigmodus aan, app openen: nette offline-pagina. Vliegtuigmodus uit: verder
   waar je was, na een herlaadbeweging. Een scan tijdens offline zegt "Geen verbinding" en bewaart de foto.
8. **Ingelogd blijven.** App sluiten, na een uur en na een dag openen: nog ingelogd, of alleen de pincode.
9. **Herinneringen** (als de VAPID-sleutels staan): Profiel → Herinneringen → aanzetten vanuit de
   beginscherm-app; iOS vraagt toestemming.
10. **Licht/donker en taal.** iOS op donker: scanner, wijnpagina, Sommelier en feedback zijn leesbaar.
    Profiel → taal Nederlands ↔ English: alles wisselt meteen, ook het feedbackformulier.

## D. Herkenning en correctie

1. Scan een fles die je al hebt: "Al in je kelder", één fles erbij, **geen** tweede wijn.
2. Laat CELLR een verkeerde wijn voorstellen → "Niet deze" → "Zoek in je wijnen": de goede kiezen.
3. In een batch twee foto's van dezelfde nieuwe wijn: na het aanmaken bij de eerste foto vindt de tweede
   die wijn (geen dubbele). Dezelfde foto twee keer: apart gezet met een waarschuwing, niet opnieuw gelezen.
4. Een onleesbaar etiket: het formulier om zelf in te vullen staat klaar, de foto is bewaard.
5. **Herkenningscache.** Voeg een fles toe met een foto uit je bibliotheek. Scan daarna **dezelfde foto** nog
   eens: _"Deze foto heb je eerder bevestigd"_ verschijnt vrijwel meteen, en je moet nog steeds zelf
   bevestigen. `/admin/ai` → Recognition cache telt één hit. Een **nieuwe** foto van dezelfde fles gaat
   gewoon naar de AI; dat is verwacht.

## E. Huishoudens en privacy (twee testers)

1. Een tweede tester met een eigen account ziet jouw kelder, foto's, beoordelingen en feedback **niet**.
2. Samen in één huishouden (uitnodigingscode): je ziet dezelfde kelder, maar **niet** elkaars smaakprofiel
   of feedback. De Sommelier van de ander gebruikt de smaak van de ander, nooit de jouwe.
3. Wissel van huishouden (Profiel): kelder én smaak (beoordelingen) horen bij het actieve huishouden.
4. Account verwijderen (Profiel, onderaan): ook de feedback van dat account is weg.

## F. Drinkvensters — wat je mag verwachten

- Een venster komt van het **AI-profiel van die wijn** ("AI-schatting"), van **jezelf** ("Eigen venster"),
  of van een **grove vuistregel** ("Grove schatting").
- Alleen een AI- of eigen venster mag "Binnenkort drinken" of "Over zijn hoogtepunt" zeggen.
- Zou de vuistregel op of over het hoogtepunt uitkomen, dan staat er **"Onvoldoende informatie"**.

## Terugmelden

Per sectie ✅/❌, het iPhone-model en de iOS-versie, Safari of beginscherm-app, en bij ❌ wat je vlak
ervoor deed. Een screenshot mag, maar zonder inlogcodes, mailadressen of andere privégegevens erop.
