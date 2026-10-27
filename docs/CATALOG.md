# The shared wine catalogue

CELLR has two kinds of wine:

- **Catalogue (canonical) wines.** Curated by the owner, identical for every household, and read-only for people.
  Only these can reuse shared wine profiles (Sprint H).
- **A household's own (provisional) wines.** Created when someone adds a wine the catalogue does not have. They
  are private to that household and never shared, promoted or relinked automatically.

This page explains how to fill the catalogue safely and what CELLR does with it.

## What already existed (before Sprint I)

| Part                                                                                                               | State before Sprint I                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Tables `producers`, `wines`, `wine_vintages`, `wine_aliases`, `wine_sources` with `status` canonical / provisional | Existed, with RLS: canonical rows readable by everyone, writable only with the service role                                                     |
| Uniqueness                                                                                                         | One canonical producer per (name, country); one canonical wine per (producer, name, colour); one vintage per (wine, year), non-vintage included |
| Wine lists (`/wines`), scan matching (`matchLabel`)                                                                | Already included catalogue wines, but did not know which ones they were                                                                         |
| Typing a wine by hand (`findOrCreateProducer`)                                                                     | Picked whichever producer of that name the database returned first: canonical or private, at random                                             |
| A bottle of a catalogue wine in a year without a vintage row                                                       | **Failed**: people may not write catalogue vintages                                                                                             |
| Shared profiles (Sprint H)                                                                                         | Worked for catalogue wines; the catalogue was empty                                                                                             |

## What Sprint I adds

### Filling the catalogue

`public.catalog_import(entries, apply)`:

- **Access:** service role and the Supabase SQL editor only.
- **Dry run by default.** Nothing is kept unless you pass `true`.
- **Idempotent.** Importing the same list twice adds nothing.
- **Never overwrites.** A different region, appellation, classification or country for an existing wine is
  reported as a conflict. Only empty details are filled in.
- **Provenance required.** Every wine needs at least one `https` source.
- **Ambiguity is reported, not guessed:**
  - the same producer name in another country;
  - an alias that names another wine of the producer (a reserve is not the standard wine);
  - a new wine named like another wine's alias;
  - the same wine twice in one file.
- **Unfilled template entries are refused.** Any entry still containing a `"TODO:` value is never imported.
- **Per entry, all or nothing.** One bad entry never blocks the rest.

### Finding catalogue wines on a scanned label

`matchLabel`, deterministic, with no AI call:

- **Exact identity** is: the producer's name, the wine's name or a verified alias (ignoring case, accents and
  punctuation), and no contradiction in colour or country.
- **Only an exact identity is ever "found".** Then it is found even next to a close sibling ("Cuvée Alpha" next to
  "Cuvée Alpha Réserve").
- **A similar name is offered as a choice.** So are two candidates, or the household's own wine that fits equally
  well.
- **The year read from the label is never changed** by the match.
- **The person still confirms**, in all three scan modes.

### Typing a wine by hand

`createWine`, for a producer, wine name and colour typed exactly:

1. The household's own wine of that name comes first. It is never silently swapped.
2. Otherwise exactly one catalogue wine with that identity is used, so no private duplicate is made.
3. Otherwise (a similar name, a different colour or country, two candidates) a private wine is made, as before.

The producer for a new private wine is chosen explicitly, in this order:

1. the household's own producer in the same country;
2. the catalogue producer in the same country;
3. a new private producer.

### A year the catalogue does not list yet

`public.catalog_vintage(wine, year)`:

- Called by the server when someone adds bottles of a catalogue wine they chose.
- It adds only the `(wine, year)` row, only for a canonical wine, only for 1800 to next year (or the non-vintage).
- It is safe to run twice at once.
- People still cannot write the catalogue in any other way.

### Measuring

`/admin/ai` → **Wine catalogue** shows:

- the number of producers, wines, aliases and vintages;
- the share of new bottles on catalogue wines;
- how many private wines were created.

The **Shared wine profiles** section on the same page shows the research calls the catalogue saved.

## Populating the first 20–50 wines

### 1. Choose the wines

Start with wines testers actually have, for example your own cellar. Each entry is **one exact wine**:

- The second wine, the reserve and the white are separate entries.
- Vintages are listed per wine. Add only years you have seen evidence for.

### 2. Gather a source for each wine

Use a public page that names **this exact wine**, for example:

- the producer's own website (best);
- an official appellation or classification register;
- the importer's product page.

The import needs at least one source per wine. Two are better when the name is easy to confuse. Do not use a
search result, an AI answer or a shop listing you cannot open again.

Record facts only: names, colour, origin and years. Do not copy texts or photos.

### 3. Fill in the template

Copy `docs/catalog/catalog-template.json` and replace every `TODO:` value; remove lines you do not need. The
producer name is written as the producer writes it.

- `producer_country` and `country` use the same 2-letter codes as the app (FR, IT, ES, DE, PT, AT, US, …).
- `vintages` holds years, plus `null` for a non-vintage wine.
- `aliases` holds other names of **this** wine only, as printed on labels, for example "Pavillon Rouge" for
  "Pavillon Rouge du Château Margaux".

Have someone else read the list, or at least look at it the next day.

### 4. Dry run in Supabase

Open the Supabase **SQL Editor** and run:

```sql
select jsonb_pretty(public.catalog_import($catalog$
  [ … paste the JSON list here … ]
$catalog$::jsonb));
```

The report lists every entry as `created`, `updated`, `unchanged`, `conflict` or `invalid`, with the reason.
Nothing has been written yet (`"applied": false`). Fix every `invalid` and `conflict` entry in the file and run
the dry run again until the report is what you expect.

### 5. Apply

Run the same statement with `, true` after the closing `::jsonb`:

```sql
select jsonb_pretty(public.catalog_import($catalog$ [ … ] $catalog$::jsonb, true));
```

Keep the JSON file, for example in a private folder or a reviewed PR. It is the record of what you imported, and
running it again is harmless.

### 6. Check

- `/admin/ai` → Wine catalogue shows the new counts.
- In the app, add one of the wines by hand: the wine you get should be the catalogue one. The household's own
  same-named wine still wins if it has one.

## Correcting a mistake

The import never changes an existing identity. A wrong entry is corrected by hand in the SQL editor:

- **A wrong alias:**
  `delete from public.wine_aliases where alias = '…' and wine_id = (select id from public.wines where name = '…' and status = 'canonical');`
- **A wrong detail** (region, appellation, classification):
  `update public.wines set region = '…' where id = '…' and status = 'canonical';`
- **A wrong vintage nobody has bottles of:** `delete from public.wine_vintages where id = '…';`. The database
  refuses if bottles use it.
- **A wine that should not be in the catalogue.** If no household has bottles of it, delete it. Otherwise leave it
  and ask: households' bottles are never relinked automatically.

## Catalogue learning (Sprint J): confirmed wines become candidates

When households add wines the catalogue does not have, CELLR can group those confirmations into **candidates**.
The owner reviews them at `/admin/catalog` and publishes the good ones. Nothing is published automatically.

### It is off until you switch it on

Today CELLR tells people, on the scan screen, that nothing but the label photo is shared. Collecting confirmations
is a new use of household data, so it ships **off**: `catalog_learning.mode = 'off'`, and nothing is recorded.

**Before switching it on:**

1. **Decide the legal basis**, with whoever advises you on the GDPR. This document does not decide it.
   - **Opt-out** (`opt_out`): everyone counts unless they said no. Usually argued as legitimate interest. It
     processes minimal, pseudonymous identity facts, with a clear notice and an easy "no".
   - **Opt-in** (`opt_in`): only people who said yes count. Consent is the safer choice if in doubt.
2. **Update the privacy information you give testers** (invitation, tester guide) with the text below.
3. **Switch it on** at `/admin/catalog` → Collection. You can switch it back off at any time. Already collected
   evidence stays until people or households are deleted, or people say no.

**What people see once it is on:**

- **On the scan screen:** a line under "nothing else is shared": "When you add the wine, its name, colour and
  origin may help CELLR's shared wine list (never the photo or your cellar). You can turn this off in Profile."
- **In Profile → "Help improve the shared wine list":** what is and is never shared, and a Help / Stop helping
  button. Saying no deletes what that person contributed, straight away.

Normal use is unchanged: nobody submits, approves or waits for anything.

### What creates a signal (and what it proves)

**What creates a signal.** A signal is recorded only when a person **adds bottles** of a household's own wine, in
the scan or the manual flow. The database function `catalog_record_confirmation` checks that:

- learning is on and this person may count;
- the wine belongs to the caller's own household, so nobody can vote with another household's wine;
- the bottles really exist.

Nothing is recorded:

- from an unconfirmed AI reading;
- for a catalogue wine;
- for imported wines;
- when the wine is already in the catalogue under that identity.

**Two strengths:**

- **Label (scan):** the vision model read **this** photo as this producer and cuvée (and colour), the photo is
  on the bottles of that year, and that reading was noted for the same person and not used before. An old or
  unrelated photo, a photo read as another wine, an expired reading or a replayed call is only **typed**. This is
  the only kind that counts towards review.
- **Typed (manual):** shown apart. It never counts as an independent label confirmation.

**What a confirmation proves:** the household says "this bottle is this producer, this cuvée, this colour, this
year". It does **not** prove the AI's other facts. Several households agreeing with the same AI reading are not
independent proof either. That is why **a verified public source is always required** to publish.

### How households are counted

| Situation                                                | Counted as                                             |
| -------------------------------------------------------- | ------------------------------------------------------ |
| Many bottles, scans, retries or members of one household | **one** household (counted per household, not per row) |
| Another vintage                                          | the same candidate, its own year row                   |
| A person in two households                               | each household counts once                             |

Evidence is kept **per person** (`unique (candidate, household, year, person)`), so each person's choice holds:
if one member says no, only their rows go, and the household still counts through a member who still helps.

A confirmation **stops counting** when:

- the household removes the bottles as a mistake;
- the household renames or recolours its wine, or changes its producer;
- the person says no (only that person's rows);
- the household or the account is deleted (that household's, or that person's, rows are deleted).

### Grouping

A candidate is exactly: the normalised producer, the normalised wine name, the colour and the country. Nothing is
merged on similarity, so these are always separate candidates:

- a reserve and the standard wine;
- a second wine and the grand vin;
- different colours;
- different countries.

The same producer and name in another colour or country is flagged as a **conflict**. So are households
disagreeing on the appellation, and a wine the catalogue already has.

### States and thresholds (`packages/domain/src/catalog-learning.ts`, `CATALOG_REVIEW`)

| State        | When                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------ |
| collecting   | fewer than **5** households confirmed it from a label                                                  |
| review_ready | **5** or more households confirmed it from a label (high priority from **10**)                         |
| conflict     | a rival colour or country, disagreeing appellations, or already in the catalogue                       |
| approved     | published by you                                                                                       |
| rejected     | rejected by you. New evidence for it stays with it, so it does not come back as new; you can reopen it |
| merged       | folded into another candidate by you                                                                   |

**Automatic publication is OFF** (`AUTO_PUBLISH_ENABLED = false`): approval is always your explicit action.

The detail page shows an advisory **automation verdict**: it would qualify only with at least 5 label households,
no conflict, at least one verified source, and no similarly named sibling. It exists to learn whether automation
would have been right. Enabling it is a later, separate decision; there is no timer or worker.

### What you see, and what you do (`/admin/catalog`)

**What you see:**

- **The list:** counts per state, the catalogue size, shared profiles, and filters and sorting.
- **Per candidate:**
  - identity, type and origin, vintages;
  - households (label / typed);
  - state and priority, sources, and the last confirmation.
- **The detail:**
  - how households wrote it, with counts but no names;
  - households per vintage;
  - rivals and appellation disagreement;
  - the catalogue's wines and other candidates of the producer;
  - the automation verdict;
  - the history.

**You never see which household or person confirmed anything.**

**What you do:**

1. **Correct** the proposed identity (producer, name, colour, country, region, appellation, classification,
   aliases).
2. **Add a public source** and tick that you checked it names this exact wine.
3. **Approve and publish**, choosing which confirmed vintages to publish.
4. **Reject** it, with an optional note, or **reopen** it later.
5. **Merge** it into another open candidate of the producer that is truly the same wine. Its name becomes an alias
   suggestion. Where both hold a row for the same person, household and year, the stronger one (label) is kept.

Every action is in the audit, with the admin and the time, never households.

**Publishing** goes through `catalog_import` (Sprint I), with the same rules:

- a verified https source is required;
- an existing canonical producer or wine is reused;
- conflicts are reported, never overwritten;
- it is idempotent: approving twice changes nothing;
- only vintages households confirmed are inserted.

Household wines and bottles are **not relinked**. New additions find the catalogue wine through Sprint I's
matching, and Sprint H's shared profiles then apply.

### Data kept

| Where                       | What                                                                                                                     | Who can read it                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| `catalog_candidates`        | producer, name, colour, country, region, appellation, classification, aliases, state, review note                        | service role only                            |
| `catalog_evidence`          | candidate, household, person, the household's wine, year, scan or typed, how they wrote the name, region and appellation | service role only; never shown per household |
| `catalog_scan_reads`        | at most 24 hours, only for people who may count: photo id, household, person, and the producer, name and colour read     | service role only                            |
| `catalog_candidate_sources` | public source pages you added                                                                                            | service role only                            |
| `catalog_audit`             | the action, its details (no households), the admin, the time                                                             | service role only                            |

Never stored for learning:

- photos, scan fingerprints, bottles or quantities;
- locations, prices, notes, ratings, profiles or valuations;
- e-mail addresses or names.

**Retention:** evidence lives as long as the household, the person and the household's wine do (deletion
cascades). Candidates hold no personal data and stay as review history.

### Scan readings (`catalog_scan_reads`)

After a scan, the server notes what the vision model read off that photo (`catalog_note_scan_read`, service role
only), so the person's next confirmation can count as a label confirmation. No extra AI call: it is the scan's own
reading.

**Only for a person who may count at that moment.** The server passes the signed-in user from its verified session
(people cannot call the function, so no client can name someone else). The database then checks, before storing
anything, that this person:

- is a member of the photo's household;
- may count under the current mode: nothing while learning is **off**; under **opt-out** everyone except who said
  no; under **opt-in** only who said yes.

**Deleted:**

- the moment it is used for a confirmation (only that person can use it);
- at once when that person says no, or withdraws a yes;
- at once for everybody who no longer counts when you change the mode (all of them when you switch learning off);
- when the photo, the household or the account is deleted;
- after **23 hours**, by a purge that runs on every scan and confirmation **and every 15 minutes on a schedule**,
  so a reading is never kept longer than 24 hours, even when nobody scans.

**The schedule is a `pg_cron` job** (`catalog-scan-reads-purge`, every 15 minutes, calling
`public.catalog_purge_scan_reads()`). The migration creates the extension and the job on Supabase, where `pg_cron`
is available; it needs no other configuration. Check it once after running the migration:

```sql
select jobname, schedule, active from cron.job where jobname = 'catalog-scan-reads-purge';
-- one row: catalog-scan-reads-purge | */15 * * * * | true
select status, start_time from cron.job_run_details
 where jobid = (select jobid from cron.job where jobname = 'catalog-scan-reads-purge')
 order by start_time desc limit 3;   -- after 15 minutes: "succeeded"
```

If the migration printed the warning _"pg_cron is not available"_ (or _"could not schedule"_), the 24-hour limit is
**not** guaranteed: enable `pg_cron` (Supabase → Database → Extensions) and run

```sql
select cron.schedule('catalog-scan-reads-purge', '*/15 * * * *', 'select public.catalog_purge_scan_reads()');
```

Keep learning **off** until the job exists.

## Privacy

The catalogue holds only public wine identity: names, colour, origin, years and public sources. It never holds
anything from households:

- no user or household id, photo, scan fingerprint or bottle;
- no price, note, rating, valuation or cellar location.

Catalogue learning only ever reads what a person confirmed, and only while it is switched on and they did not say
no. Publication is your decision, backed by a public source.

## Not in this sprint

- reusing a profile's stable facts across vintages (next sprint, see `docs/RECOGNITION-ROADMAP.md`);
- automatic publication;
- cross-photo recognition, OCR or barcodes;
- third-party catalogue imports.

These are tracked in GitHub issue #32.
