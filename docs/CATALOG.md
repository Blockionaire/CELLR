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

## Privacy

The catalogue holds only public wine identity: names, colour, origin, years and public sources. It never holds
anything from households:

- no user or household id, photo, scan fingerprint or bottle;
- no price, note, rating, valuation or cellar location.

Household wines are never used as a feed. A future "suggest this wine for the catalogue" flow would need its own
consent model, and is not built.

## Not in this sprint

- reusing a profile's stable facts across vintages (next sprint, see `docs/RECOGNITION-ROADMAP.md`);
- promotion from scans;
- cross-photo recognition, OCR or barcodes;
- third-party catalogue imports.

These are tracked in GitHub issue #32.
