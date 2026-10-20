# CELLR — private beta: wat alleen op de echte omgeving en een echte iPhone te testen is

Alles wat lokaal te automatiseren is, draait als test (`apps/web/e2e/acceptance.spec.ts` doet stap 1–13
hieronder van begin tot eind, `scan-camera.spec.ts` en `scan-live.spec.ts` de scanner op 375×667 en 390×844).
De vaste bèta-smoke-set (de kritieke reizen, ±20–40 min lokaal) draait met `pnpm --filter @cellr/web e2e:beta`
na `pnpm build`; zie `docs/sprints/sprint-d.md` voor wat erin zit en waarom.
Wat overblijft hangt af van de echte Supabase, Vercel, OpenAI en een fysieke iPhone, en staat hier.

**CELLR is pas klaar voor de private beta als A, B en C hieronder op de gehoste omgeving én minstens één
iPhone zijn geslaagd.** Noteer bij elke stap ✅ of ❌ met wat je zag; een screenshot bij ❌ helpt.

Sleutels en wachtwoorden horen nergens in deze lijst, een chat of de repository: alleen in Vercel en je
wachtwoordmanager.

---

## A. De omgeving (laptop, 10 minuten)

1. **Database bij.** Supabase → SQL Editor:

   ```sql
   select
     (select count(*) from pg_tables where schemaname = 'public' and not rowsecurity) as zonder_rls,      -- 0
     (select count(*) from pg_tables where schemaname = 'public'
        and tablename in ('friendships', 'wine_recommendations', 'account_pins'))     as nieuwste_tabellen, -- 3
     (select count(*) from private.allowed_signups)                                    as beta_lijst;       -- ≥ 1
   ```

2. **Beta-lijst.** `select entry from private.allowed_signups;` bevat jouw adres en dat van iedere tester
   (kleine letters). Een lege lijst betekent: iedereen mag een account maken.
3. **Vercel → Environment Variables** (alleen de namen controleren, niet de waarden): `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`; voor herinneringen ook
   `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `CRON_SECRET`.
4. **Deployment Protection** staat uit (anders ziet de telefoon een Vercel-inlog in plaats van CELLR).
5. **In de browser op de laptop**, op de URL die je testers krijgen:
   - `/sign-in` toont het inlogscherm;
   - `/manifest.webmanifest` en `/sw.js` laden (geen 404);
   - `/offline.html` toont de offline-pagina;
   - `/api/v1/me` geeft `401` (niet ingelogd), geen foutpagina.
6. **Iemand die niet op de lijst staat** (een adres dat je zeker niet hebt toegevoegd): na "Stuur me een code"
   verschijnt _"CELLR is voorlopig alleen op uitnodiging…"_ en er komt **geen** mail.

## B. De kernflow op de iPhone (Safari, daarna vanaf het beginscherm, 20 minuten)

Gebruik een **nieuw** adres dat op de beta-lijst staat, en een echte fles.

| #   | Doen                                                                       | Verwacht                                                                                                   |
| --- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 1   | Open de URL in Safari, vul het adres in, "Stuur me een code"               | "Check je mail"                                                                                            |
| 2   | Typ de code uit de mail                                                    | Mail komt binnen 1 minuut, afzender CELLR, onderwerp "Your CELLR code", geen link. Code wordt geaccepteerd |
| 3   | "Pincode instellen", kies 6 cijfers, twee keer                             | Daarna door naar het huishouden                                                                            |
| 4   | Maak een huishouden, vul je naam in                                        | Je komt op Home met je naam                                                                                |
| 5   | Scan → sta de camera toe → richt op het etiket → druk op de ontspanner     | Live beeld vult het scherm, ontspanner zichtbaar **zonder scrollen**, boven de tabbalk                     |
| 6   | Controleer de gelezen wijn en het jaar                                     | Producent, naam, jaar kloppen of zijn makkelijk te verbeteren                                              |
| 7   | Zet het aantal op 3                                                        | De knop zegt "3 flessen toevoegen"                                                                         |
| 8   | "Nieuwe plek" → aanmaken → toevoegen                                       | "In Wijnkoelkast." (of de naam die je koos)                                                                |
| 9   | Op de wijnpagina: achteretiket toevoegen (foto)                            | Voor- en achteretiket staan allebei op de pagina                                                           |
| 10  | Kelder → zoek op de naam                                                   | Precies deze wijn, 3 flessen                                                                               |
| 11  | Wijnpagina → "Fles openen" → "Open hem"                                    | "Proost!"; de kelder telt nog 2 flessen                                                                    |
| 12  | "Hoe was het?" → sterren + notitie → Opslaan; daarna Kelder → Geschiedenis | Beoordeling staat op de wijnpagina; geschiedenis toont "Geopend op …"                                      |
| 13  | Profiel → Uitloggen → inloggen met de pincode                              | Je bent terug, kelder ongewijzigd (2 flessen, je beoordeling)                                              |

Herhaal 5–8 eenmaal met **Meerdere na elkaar** (2–3 flessen achter elkaar fotograferen).

## C. Wat alleen een echte iPhone laat zien

1. **Beginscherm-app.** Safari → Deel → _Zet op beginscherm_. Open vanaf het icoon: volledig scherm, geen
   adresbalk, niets onder de notch of de home-balk.
2. **Camera in de beginscherm-app.** Scan opnieuw vanaf het icoon. iOS vraagt de camera daar soms opnieuw;
   na toestaan is er live beeld. Werkt live beeld niet, dan moet de ontspanner de iPhone-camera openen
   (dat is de terugvaloptie, geen fout).
3. **Camera geweigerd.** Instellingen → Safari → Camera → _Weiger_ (of weiger in de prompt): het scherm zegt
   dat CELLR de camera niet mag gebruiken, en de ontspanner opent alsnog de iPhone-camera. Zet het daarna terug.
4. **Foto uit de bibliotheek.** De fotoknop links van de ontspanner kiest een bestaande foto; bij
   "Meerdere na elkaar" meerdere tegelijk.
5. **Naar de achtergrond.** Tijdens het scannen naar het beginscherm en terug: het groene camerabolletje gaat
   uit als je weg bent, en het beeld komt terug.
6. **Ingelogd blijven.** App helemaal sluiten (omhoog vegen), na een uur en na een dag opnieuw openen: je bent
   nog ingelogd, of je komt binnen met alleen de pincode.
7. **Offline.** Vliegtuigmodus aan, app openen: de nette offline-pagina ("You're offline", met daaronder
   "Je bent offline"), geen Safari-fout.
8. **Herinneringen** (als de VAPID-sleutels in Vercel staan): Profiel → Herinneringen → _Aanzetten op deze
   telefoon_ vanuit de beginscherm-app. iOS vraagt toestemming; de kaart zegt daarna dat het aan staat.
9. **Licht en donker.** Zet iOS op donker: de scanner, de wijnpagina en Home zijn leesbaar.
10. **Tweede huishouden.** Een tweede tester met een eigen account ziet jouw kelder, foto's en
    beoordelingen **niet**.

## D. Wat sinds de vorige lijst is bijgekomen (iPhone, 20 minuten)

1. **Eerste keer, zonder hulp.** Een nieuwe tester komt van de mail tot de eerste fles zonder uitleg:
   inloggen → (pincode of "Niet nu") → huishouden → naam → lege Home → "Scan je eerste fles". Stopwatch:
   rond de twee minuten is goed; noteer waar iemand twijfelde.
2. **Verkeerde herkenning.** Scan een fles die je al hebt maar laat CELLR een andere wijn voorstellen ("Niet
   deze"): met "Al in je kelder? Zoek in je wijnen" kies je de goede, zonder een dubbele wijn te maken.
3. **Uitnodigen.** Als eigenaar: Profiel → "Iemand uitnodigen" → code naar een tweede tester. Die kiest bij
   het huishouden "Meedoen met een code". Als lid zie je geen uitnodigknop.
4. **Vertrekken.** Ben je de enige in een huishouden, dan staat er uitleg in plaats van "Huishouden
   verlaten". Een lid kan wel vertrekken.
5. **Vrienden.** Twee testers worden vrienden (zoek op @naam of code). Bij "Accepteren" staat wat de ander
   te zien krijgt. Zet bij "Wat je deelt" je beoordelingen op "Niemand": de vriend ziet ze daarna niet meer.
6. **3D-kelder.** Kelder → 3D. Tik een fles: hij schuift uit het rek en staat rechtop met het etiket naar je
   toe. Terugleggen met de knop, met een tik ernaast en met vegen. Let op haperingen bij uitschuiven en
   terugleggen en noteer het iPhone-model; een test op de laptop zegt hier niets over.
7. **Licht/donker en taal.** Profiel → Licht en Donker; taal Nederlands ↔ English. Alles wisselt
   meteen en blijft na het sluiten van de app zo staan. Geen Engelse foutmelding in het Nederlands (probeer:
   een huishouden zonder naam, een lege naam).
8. **Inzichten en geschiedenis.** Inzichten toont waarde alleen als die bekend is ("2 van 6 flessen
   gewaardeerd"); ontbrekend is niet nul. In Geschiedenis vraagt "Terugzetten" eerst nog een keer.

## E. Drinkvensters — wat je mag verwachten

- Een venster komt van het **AI-profiel van die wijn** ("AI-schatting"), van **jezelf** ("Eigen venster"),
  of van een **grove vuistregel** ("Grove schatting").
- Alleen een AI- of eigen venster mag "Binnenkort drinken" of "Over zijn hoogtepunt" zeggen, op Home staan
  of een herinnering sturen.
- Zou de vuistregel zeggen dat een fles op of over zijn hoogtepunt is, dan staat er **"Onvoldoende
  informatie"**. Dat is bewust: liever niets dan iets onjuists.
- Het AI-profiel wordt na het toevoegen vanzelf gemaakt (binnen het uurbudget); daarna kan het label van
  "Grove schatting" naar "AI-schatting" gaan. Ook dat blijft een schatting, geen geverifieerd feit.

Controleer met een fles waarvan je het venster kent (bijvoorbeeld Château Musar): nooit "Over zijn
hoogtepunt" op grond van alleen een grove schatting.

## Terugmelden

Per sectie ✅/❌, het iPhone-model en de iOS-versie, en bij ❌ een screenshot en wat je deed vlak ervoor.
