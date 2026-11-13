# UX acceptance and field validation

What was checked by automated tests in a browser, and what still needs a person, real labels and a real phone. The
two are never mixed: **"automated pass" is not "field validated".**

| Status                          | Meaning                                                                                  |
| ------------------------------- | ---------------------------------------------------------------------------------------- |
| AUTOMATED PASS                  | Playwright against the local stack (Chromium; "phone" = emulated iPhone 13 viewport)     |
| `REAL_LABEL_VALIDATION_PENDING` | needs consented photographs of real labels: **0 exist**                                  |
| DEVICE PENDING                  | needs a physical iPhone (Safari / installed app), a mobile network, a camera: **0 runs** |

## 1. Wine search in "add a bottle" and Koopcheck (WI-02) — AUTOMATED PASS

Feature `wine_search`. Spec: `apps/web/e2e/wine-search.spec.ts` (12 tests × phone and desktop), unit:
`apps/web/src/features/wine-search/controller.test.ts` (17 tests).

| Behaviour                                                                                             | Checked by                                            |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| The field has focus on arrival; nothing typed shows the own list ("Recently added"), as before        | e2e                                                   |
| An owned wine, typed without accents, is found and shows "In your cellar ×2"                          | e2e                                                   |
| Arrow keys move, Enter chooses, Escape lets go of the list and never of the text                      | e2e                                                   |
| A screen reader hears the number of results ("3 wines found" / "3 wijnen gevonden")                   | e2e (`role=status`), axe                              |
| A catalogue wine found by its verified alias; a year the catalogue lacks is added to that wine        | e2e + database check                                  |
| A reserve is its own result, never folded into the wine it resembles                                  | e2e                                                   |
| Nothing found: the typed text starts the "new wine" form, and coming back keeps it                    | e2e                                                   |
| A record of an external source: named as unverified, opens the form, becomes the household's own wine | e2e + database check (test-only provider)             |
| Switching that source off while the screen is open: the next search no longer offers it               | e2e                                                   |
| Too many searches: one notice, the own list, no further requests                                      | e2e (request count), unit                             |
| Offline: the text stays; "Try again" works                                                            | e2e, unit                                             |
| A deployment without the search endpoint: the own list, exactly as before                             | e2e, unit                                             |
| A slow answer to an earlier query never replaces newer results                                        | e2e (delayed response), unit (4 race tests)           |
| Koopcheck: "Handmatig zoeken" → choose → vintage empty (never "this year") → price → verdict          | e2e                                                   |
| Koopcheck writes nothing: bottles, wines, vintages, images unchanged; no AI usage row                 | e2e + database check                                  |
| Koopcheck: "Typ handmatig zonder een resultaat te kiezen" still works and says what it does not know  | e2e                                                   |
| "Search again" and "Correct the wine" come back to what was typed and chosen                          | e2e                                                   |
| Dutch and English; dark and light                                                                     | e2e, axe in both themes, screenshots                  |
| No serious accessibility violation (WCAG 2.1 A/AA rules of axe-core) on any of these screens          | axe in 6 places                                       |
| The API answer holds wine facts only, is bounded, private per household, closed to strangers          | e2e (exact key list, two households, 401)             |
| With the feature off, the add-bottle and scan screens download and start what they did before         | the search component is loaded lazily; existing specs |

Screenshots (written by the run, not committed): `apps/web/test-results/shots/wi02-search-nl-{dark,light}-{phone,desktop}.png`.

### Latency, as measured here

Local stack on one shared 4-vCPU machine: Next.js + PostgREST + Postgres on localhost, Chromium. **Not** production,
not a mobile network, not a phone.

| Measure                                                               | Desktop project | "Phone" project (emulated) |
| --------------------------------------------------------------------- | --------------: | -------------------------: |
| `GET /api/v1/catalog/search` through the app, 48 calls, p50           |           83 ms |                      97 ms |
| same, p95                                                             |          105 ms |                     255 ms |
| typing a full query → first result visible (includes 250 ms debounce) |     0.82–0.86 s |                0.83–0.89 s |

The typed-to-visible times include the deliberate 250 ms debounce and the test runner's own polling, so they are an
upper bound of what a person perceives on this machine. The brief's initial target (p95 ≤ ~700 ms for server and
network, excluding the debounce) is met here; it has **not** been measured on a real network (WI-07 lists it as
pending, not as passed).

### Deliberate choices

- One ranked list with a source label per row ("In jouw kelder", "Jouw wijn", "CELLR-catalogus", "Externe databron,
  nog niet geverifieerd"), not grouped sections: grouping would reorder results and could push an exact catalogue
  match below a merely similar owned wine.
- Eight rows shown, "Toon nog n" reveals up to the server's bound of twenty from the same answer (no second request).
- An answer is remembered for a minute, so backspacing costs nothing; after that the server is asked again (a source
  may have been switched off meanwhile).
- No vintage is ever pre-filled from a source's list of years: a listed year is the dataset's statement, not the
  bottle in the person's hand.
- Nothing about a chosen external record is stored (ADR-001, decision 7).

## 2. Scan review with the resolver (WI-03) — AUTOMATED PASS on programmed readings

Feature `scan_resolver`. Specs: `apps/web/e2e/scan-resolver.spec.ts` (2 tests × phone and desktop),
`scripts/scan-eval/golden.test.ts` (57 tests on the golden set `eval/scan/golden-resolver.json`).

| Behaviour                                                                                          | Checked by      |
| -------------------------------------------------------------------------------------------------- | --------------- |
| An exact reading: one wine, said to be "Precies deze naam in de CELLR-catalogus", still to confirm | e2e             |
| "Niet deze" / "Not this one" leads to the editable form with what was read                         | e2e             |
| Red and white of one name, colour not read: both offered, each with its colour and why             | e2e + axe       |
| "None of these: it is a new wine" opens the form; nothing was created until then                   | e2e             |
| The vintage is the label's: an unread year stays unknown, an impossible one is dropped             | e2e, golden set |
| With the feature off the review looks exactly as before (no reasons, no colour in the detail line) | existing specs  |

The readings in these tests are programmed answers of the local stack's fake model and hand-written texts. They prove
the pipeline and the identity rules; they say **nothing** about how well real labels are read (§3).

## 3. Real labels: acquisition protocol — `REAL_LABEL_VALIDATION_PENDING`

No real label photograph exists in this repository or was used anywhere in this epic. Count of consented real photos:
**0**. This protocol is what has to happen before any recognition-accuracy number may be quoted. It builds on the
existing private harness `pnpm scan:eval` (`eval/scan/README.md`, `docs/SCAN-EVAL.md`), whose photos and expected
values are git-ignored and stay on the owner's machine.

### 3.1 What may be collected, from whom

| Rule               | Detail                                                                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Who                | the owner's own bottles first; other people only after they read and accept the text in 3.2                                                                   |
| What               | the front (and optionally back) label of a wine bottle; nothing else in frame                                                                                 |
| Not allowed        | people, faces, hands with jewellery, receipts, price stickers with a shop's name, addresses, screens, other products, another app's or website's label images |
| Source             | photographs the contributor took themselves; never an image downloaded from a shop, a producer's site, a wine database or a search engine                     |
| Metadata           | location and device serial are stripped before the file is kept (the app's own upload path already does this; for files copied by hand, strip EXIF first)     |
| Minimum useful set | 30–50 bottles (decision D9 of the architecture plan), spread as in 3.4                                                                                        |

### 3.2 Consent text (for anyone but the owner; to be reviewed before use)

> I took these photos of wine labels myself. CELLR may use them only to measure how well its label recognition works.
> They are stored privately, are not shown to other users, are not published, are not given to wine-data providers,
> and are not used to train any model. I can ask for them to be deleted at any time, and they are deleted when the
> measurement set is retired.

Recorded per contributor: name or initials, date, the sentence above as accepted, the file names. No account data.

### 3.3 Storage, retention, deletion

- Where: `eval/scan/photos/` on the owner's machine (git-ignored), or a private folder the owner controls. Never the
  repository, never the production database, never a provider's staging tables.
- Sent where: to the configured vision model, by `pnpm scan:eval`, exactly as a scan in the app would send it — and
  nowhere else. Never into `catalog_external_records`, never into a shared profile, never to a wine-data provider.
- Retention: until the measurement set is replaced, at most 24 months; deleted on request within a week.
- Deletion: remove the file and its row in `expected.json`; nothing else refers to it.

### 3.4 What the set must contain (benchmark schema)

`eval/scan/expected.json` (existing format) with, per photo: `producer`, `wine`, `vintage` (or `null` for NV),
`type`, `country`, `region`, `grapes`. For this epic add, per photo, in a side file `eval/scan/conditions.json`
(same keys, not committed):

| Field        | Values                                                                             |
| ------------ | ---------------------------------------------------------------------------------- |
| `capture`    | `iphone-camera`, `iphone-library`, `android`, `desktop-upload`                     |
| `light`      | `good`, `dim`, `glare`                                                             |
| `label`      | `flat`, `curved`, `foil`, `script-font`, `handwritten`, `damaged`                  |
| `in_catalog` | `true` / `false`: is this exact wine a canonical CELLR wine at the time of the run |
| `expected`   | `found` / `choose` / `new`: what a careful person says the right outcome is        |

Spread: at least 5 each of Bordeaux/Burgundy, Champagne or sparkling, Italy, Spain/Portugal, Germany/Austria, New
World, supermarket; at least 5 near twins (a reserve next to the standard wine, a second wine, a red and a white of
one name); at least 5 non-vintage or without a readable year; at least 5 hard photos (glare, curve, script).

### 3.5 What is reported, and how

| Measure                                                  | Target before any accuracy claim     |
| -------------------------------------------------------- | ------------------------------------ |
| Wrong wine asserted as "found"                           | **0**                                |
| Right outcome (`found` / `choose` containing it / `new`) | reported per segment, no target yet  |
| Read from printed text without the model                 | reported (the saving), no target yet |
| Year wrong after confirmation screen                     | reported                             |

Each number is reported with the count of photos behind it and the model and prompt version, and labelled "n real
photos, one household" until there are more.

## 4. Physical device checklist — DEVICE PENDING

Nothing below was run. A browser's phone emulation is not a phone: no camera pipeline, no Safari engine, no real
network, no thermal or memory limits.

| #   | Check (on an iPhone, Safari and the installed app, on 4G)                                                   | Record                             | Status  |
| --- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------- | ------- |
| D1  | Wine search: type a producer; results appear; choose with a tap; the on-screen keyboard does not cover them | time to first result, by stopwatch | PENDING |
| D2  | Wine search with VoiceOver: the field announces itself as a combobox, results are announced and reachable   | pass / what was heard              | PENDING |
| D3  | Koopcheck "Handmatig zoeken" one-handed in a shop: search, vintage, price, verdict                          | taps, seconds                      | PENDING |
| D4  | Scan 10 real labels: first-use OCR download time, per-scan time, outcome per label                          | `/admin/ai` → recognition paths    | PENDING |
| D5  | Scan in poor signal: the photo is kept, "try again" works                                                   | pass / fail                        | PENDING |
| D6  | Sources section on a wine page: readable, the details open and close, links open outside the app            | pass / fail (after WI-05)          | PENDING |
| D7  | Dark and light, Dutch and English, on the device                                                            | screenshots                        | PENDING |
