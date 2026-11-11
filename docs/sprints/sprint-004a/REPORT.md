# Sprint #004A — Global Wine Catalog Foundation: technical report

Date: 2026-11-11 · Branch: `claude/festive-tesla-m2tp25` (from `main` @ `95ef649`) · Status: foundation built, **no
production import, no deployment**.

## 0. Summary

| Question                                                                          | Answer                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Does CELLR already have a catalogue?                                              | Yes: a canonical/provisional Wine Master with producers, wines, vintages, aliases, sources, links, learning and corrections (§1). This sprint **extends** it; nothing is duplicated.                                                                                                                                                                                                                                                                   |
| What was built?                                                                   | A provider-independent **staging catalogue** (providers with licence and rights status, import runs, external records with per-record provenance, record→canonical links), a trigger-maintained **search index**, a ranked **search function** + `GET /api/v1/catalog/search`, a **provenance model** for a future "Bronnen & betrouwbaarheid" section, provider adapters (X-Wines, LWIN-shaped, fixture), and import / benchmark / load-test tooling. |
| Which provider?                                                                   | None is cleared for production. **X-Wines** (CC0, 100,646 wines) works technically and was used for the pilot, but its provenance is a legal blocker. **LWIN** is **blocked**: its CC BY page conflicts with Liv-ex's website and membership terms. **WineAPI.io** is unsuitable (public beta, 100–1,000 requests/day, undisclosed sources, free tier non-commercial) (§2, §3).                                                                        |
| Coverage (127-wine benchmark, X-Wines)                                            | 56 exact + 20 same-wine-different-label-name (manual review) = **76 (60%)** present without ambiguity; 11 need a choice; 23 have only the producer (often only its second wine); 15 missing; 2 uncertain (§4).                                                                                                                                                                                                                                         |
| Search quality                                                                    | Of 95 queries with a covered record: **77 top-1, 84 top-3, 92 top-8**. No provider result was ever marked verified (§4.3).                                                                                                                                                                                                                                                                                                                             |
| Performance (100,646 records + 10,300 household wines, local Postgres 16, 4 vCPU) | p95 **23 ms** (1 client), **48 ms** (8), **90 ms** (16 concurrent clients); target was < 250 ms (§7).                                                                                                                                                                                                                                                                                                                                                  |
| Tests                                                                             | 75 new SQL assertions (1108 total, all passing), 41 new unit tests; existing Scan, cellar and Purchase Check suites pass unchanged (§10).                                                                                                                                                                                                                                                                                                              |

---

## 1. Existing architecture (audit)

### 1.1 What exists and is reused

| Area                                                                                                                              | Where                                                   | Reused as                                                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Producers, wines, vintages, aliases, grapes, sources; `status` canonical / provisional; `owner_household_id`                      | `supabase/migrations/20261010000003_catalog.sql`        | The **canonical CELLR wine** and **vintage** remain the identity. External records point _to_ them; they never become them.                             |
| RLS: canonical readable by all, provisional private to the household, writes to canonical only with the service role              | same                                                    | Search runs as the person and filters on `private.my_household_ids()` exactly like `find_wines_by_label_text`.                                          |
| `private.normalize_text` (lower, `unaccent`, punctuation → space) and its TS twin `normalizeText` (pinned together by a SQL test) | `…0001_foundation.sql`, `packages/domain/src/cellar.ts` | The **only** normaliser for index, records and queries.                                                                                                 |
| `pg_trgm` GIN indexes on `producers/wines/wine_aliases.normalized_*`                                                              | `…0003_catalog.sql`                                     | Same extension and operator class for the new combined index.                                                                                           |
| `provenance_source` enum (`verified`, `licensed_import`, `label_ocr`, `user_entered`, `ai_estimate`, `heuristic`)                 | `…0001_foundation.sql`                                  | Mapped 1:1 onto the four origins of the provenance model (`packages/domain/src/provenance.ts`).                                                         |
| `wine_sources (source_name, source_ref, license, url, retrieved_at)`                                                              | `…0003_catalog.sql`                                     | Kept for **curated** canonical sources (the `catalog_import` requirement of an https source). Provider records carry their own, richer provenance (§5). |
| `catalog_import(entries, apply)` — dry-run, idempotent, never overwrites, conflicts reported                                      | `…0023_catalog_activation.sql`                          | Remains the **only** path to canonical wines. Provider records are never fed into it automatically.                                                     |
| Exact-identity rule (`isCatalogIdentity`: producer + name or verified alias, no colour/country contradiction)                     | `packages/domain/src/scan.ts`                           | The import's link suggestion uses the same rule in SQL; the benchmark reuses `nameSimilarity`.                                                          |
| `wine_links` (household wine → canonical), `master_audit`                                                                         | `…0030_wine_master.sql`                                 | Record→canonical decisions are audited in `master_audit` (entity type `link`).                                                                          |
| Catalogue learning / corrections (candidates, evidence, review)                                                                   | `…0024`, `…0029`                                        | Untouched; complementary (households' confirmations vs. external data).                                                                                 |
| Shared AI profiles (`shared_wine_profiles`, canonical wines only)                                                                 | `…0022_shared_wine_profiles.sql`                        | **Untouched.** A provider record has no vintage row, so it can never receive or share a profile.                                                        |
| Rate limiting (`consume_rate_limit`, `LIMITS`)                                                                                    | `…0002`, `apps/web/src/server/ratelimit`                | New bucket `catalog_search` (600/h).                                                                                                                    |
| Layered app: route → service → repository; domain package pure                                                                    | `apps/web/src`, `packages/domain`                       | Followed; the architecture lint test passes.                                                                                                            |

### 1.2 What needed extending (and why)

| Gap                                                                                                                                     | Consequence today                                                                                  | This sprint                                                                                            |
| --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `GET /api/v1/wines` returns **every** wine the household can see; scan matching (`matchLabel`) and manual entry rank them **in memory** | Works for tens or hundreds of canonical wines; cannot scale to a 100k+ catalogue or to the browser | Server-side search with indexes, bounded to 20 rows. Existing flows are not changed yet (Sprint 004B). |
| Trigram indexes only per column (producer _or_ wine)                                                                                    | "margaux pavillon" cannot use one index                                                            | One combined `producer + name` index, plus aliases.                                                    |
| No notion of an external provider, licence status, import run or record provenance                                                      | No safe place for licensed data                                                                    | §5.                                                                                                    |
| `wine_sources` has no rights status, modification notice or run                                                                         | Cannot prove what was imported under which terms                                                   | Provider rights status + per-run licence snapshot + per-record modifications.                          |

### 1.3 Functionality that already existed (not rebuilt)

Accent/case-insensitive identity, alias matching for canonical wines, dry-run/idempotent curated import, provisional vs
canonical separation, audit, label-text (OCR) lookup, recognition cache, Purchase Check recognition. All left as they are.

---

## 2. External providers — evidence

All facts below come from the providers' own pages and files, read on 2026-11-11.

|                           | **Liv-ex LWIN**                                                                                                                                                                              | **X-Wines**                                                                                                                                         | **WineAPI.io**                                                                                                                                                                   |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Size / coverage           | "more than 205,000 wines" ([download page](https://www.liv-ex.com/lwin-database-download/)); fine-wine trade focus                                                                           | 100,646 wines, 30,510 wineries, 62 countries (README; verified by counting the file)                                                                | Not stated; "the catalog is not exhaustive and coverage is uneven" (`/data-coverage`)                                                                                            |
| Identity fields           | LWIN-7 (wine), -11 (+vintage), -16 (+bottle size), -18 (+pack) ([FAQ](https://www.liv-ex.com/contact-faqs/)); "region, colour and classification" metadata. Column layout **not published**. | WineID, WineName, Type, Grapes, ABV, Country + ISO code, RegionName, WineryID/Name, Website, Vintages (file header)                                 | Search, identification (text and image), pricing, pairings, notes (Terms §1)                                                                                                     |
| Vintages                  | In the code (LWIN-11)                                                                                                                                                                        | List per wine; 6,504 wines list "N.V."; median 50 vintages for benchmark matches — **listed vintages are years users rated, not verified releases** | Not stated                                                                                                                                                                       |
| Search                    | Matching tool "available exclusively to Liv-ex members"                                                                                                                                      | None (a file)                                                                                                                                       | REST, image and text identification                                                                                                                                              |
| Licence                   | CC BY ([LWIN CC page](https://www.liv-ex.com/lwin-creative-commons-licence/)), **but** see §3.2                                                                                              | **CC0 1.0** (`LICENSE` in the repository, commit `5e43c7f`)                                                                                         | Proprietary terms ([/terms], effective 2026-09-04); Free tier "Personal use only — not for commercial or business use"                                                           |
| Attribution               | CC BY: credit, licence link, indicate changes                                                                                                                                                | Not legally required (CC0); citation of the paper requested for publications                                                                        | Not stated                                                                                                                                                                       |
| Storage / import          | Contested (§3.2)                                                                                                                                                                             | Permitted by CC0 for the authors' rights                                                                                                            | Not stated; "Resell, redistribute, or sublicense raw API responses as a standalone dataset" prohibited; "systematically download data beyond your tier's rate limits" prohibited |
| Updates                   | "Keep your database synced"; no frequency stated                                                                                                                                             | Single release "X-Wines Dataset 1.0 (January, 2023)"                                                                                                | Live API, "public beta"                                                                                                                                                          |
| Cost                      | Free download (registration form)                                                                                                                                                            | Free                                                                                                                                                | $0 (100 req/day, personal), $25/mo (250/day), $100/mo (1,000/day), Enterprise                                                                                                    |
| Provenance                | Liv-ex, trade-maintained                                                                                                                                                                     | "Data were collected on the open Web in 2022" (paper abstract); sources not itemised; "We are not responsible for the accuracy" (Dataset README)    | "compiled from various sources" (Terms §9)                                                                                                                                       |
| Downloaded in this sprint | **No** (registration form; terms unresolved)                                                                                                                                                 | **Yes**, official Drive folder; SHA-256 verified against the authors' `INFO_Hashing.txt`                                                            | **No** (account required; free tier excludes commercial evaluation)                                                                                                              |

**Not used:** Vivino or any other commercial platform was not scraped or accessed.

### 2.1 Recommendation

1. **Short term (004B): grow CELLR's own canonical catalogue** from households' confirmed wines (Sprint J learning) and
   curated imports. It is the only source with no third-party rights question, and it is what search ranks highest.
2. **LWIN as the long-term identity spine**, _after_ Liv-ex confirms in writing that a commercial consumer app may store
   and display LWIN codes and names under CC BY 4.0 (§3.2). LWIN codes are designed as cross-system identifiers, which
   suits `catalog_external_records.external_id` and the verified links.
3. **X-Wines: evaluation only** until its provenance is cleared (§3.3). It was invaluable for measuring coverage and
   performance on 100k real names.
4. **WineAPI.io: not now.** Daily limits are incompatible with autocomplete (and the architecture forbids per-keystroke
   provider calls anyway); terms, provenance and coverage are not established. Revisit as an on-demand enrichment
   source behind a cache, if its terms allow caching.

---

## 3. Licensing and compliance assessment

> This is an engineering assessment to make the legal questions explicit. It is **not legal advice**. Every item
> marked **BLOCKER** must be resolved (in writing, by the provider or by counsel) before a production import.

### 3.1 Legal framework for CELLR (commercial consumer app, EU)

- **Copyright** rarely protects individual facts (a producer's name, a region, a year). Selections and arrangements can be
  protected, and descriptive texts, tasting notes, label photos and reviews usually are.
- **The EU sui generis database right** (Directive 96/9/EC) protects the maker of a database who made a substantial
  investment in obtaining, verifying or presenting its contents. It covers the extraction or re-use of a substantial
  part, and the repeated, systematic extraction of insubstantial parts, for 15 years from completion or substantial
  change. _The EUR-Lex text could not be retrieved in this session; the articles are therefore not quoted here and
  must be confirmed by counsel._ Relevance: a wine database assembled by a platform can carry this right **even when
  every individual fact is free**, and it can be infringed by importing "just the names".
- **CC0 1.0** waives the affirmer's copyright **and** "database rights (such as those arising under Directive 96/9/EC…)"
  (CC0 §1), but "Affirmer disclaims responsibility for clearing rights of other persons that may apply to the Work"
  (CC0 §4(3), [legal code](https://creativecommons.org/publicdomain/zero/1.0/legalcode.en)). CC0 cannot waive rights the
  affirmer never held.
- **CC BY 4.0** licenses sui generis database rights too (§4): extracting and re-using all or a substantial portion is
  allowed, a database containing it becomes Adapted Material, and sharing it requires the §3(a) attribution conditions.
  §3(a)(1) requires keeping creator identification and the copyright, licence and warranty-disclaimer notices and a
  URI where reasonably practicable (A); indicating modifications "and retain an indication of any previous
  modifications" (B); and indicating the CC BY licence (C). §2(a)(6) says nothing in the licence permits you to assert
  or imply that you are "connected with, or sponsored, endorsed, or granted official status by, the Licensor"
  ([legal code](https://creativecommons.org/licenses/by/4.0/legalcode.en)).
- **Derived datasets**: CELLR's normalised records (accents folded, types mapped, fields dropped) are modifications under
  CC BY 4.0. A canonical wine whose identity was confirmed using a provider record is a derived fact; the link is
  recorded, so the derivation can always be shown or undone.
- **Trademarks**: provider names ("Liv-ex", "LWIN") are trademarks. Credit them by name, but never use them as an
  endorsement or in CELLR branding. Liv-ex's membership terms (37.6, as read) name "Liv-ex, LWIN and Wine Matcher" as
  brand terms.

### 3.2 Liv-ex LWIN — BLOCKER (status `blocked`)

| Source                                                                                           | What it says                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [LWIN page](https://www.liv-ex.com/lwin/)                                                        | "Free to use"; "It's free to download, and always will be under the Creative Commons licence."                                                                                                                                                                                                           |
| [LWIN CC licence page](https://www.liv-ex.com/lwin-creative-commons-licence/)                    | CC BY summary: share and adapt "even commercially"; credit, licence link, indicate changes; "No additional restrictions".                                                                                                                                                                                |
| [Website terms](https://www.liv-ex.com/website-terms-of-use/) 11.3–11.4                          | No large-scale "data harvesting… for storage, analysis or use" and no AI/ML training; no "copy, download, store, distribute, sell" content or data "without our prior written permission".                                                                                                               |
| [Membership terms](https://www.liv-ex.com/liv-ex-membership-terms/) 9.3, 9.13, 9.14, 9.6.4/9.7.4 | Data licence "solely for your own, internal, non-commercial activities"; no right to "sub-license, copy, download, store, distribute, sell" without written permission; no scraping or AI training; republishing and derived data require acknowledgement "in accordance with our Display Requirements". |
| [Enterprise page](https://web.liv-ex.com/staticPageContent.do?pageKey=Enterprise)                | A separate paid "Liv-ex Data Service Licence – Enterprise" (PDF) covers the paid data services, including "L-WIN associated feeds".                                                                                                                                                                      |
| [Case study](https://www.liv-ex.com/customer-success/vinotheque-case-study/)                     | Describes LWIN as available under "OpenData licence terms".                                                                                                                                                                                                                                              |

**No LWIN-specific licence agreement text was found** (an "LWIN SLA" is referenced, and its page returns 404). It is
unclear whether the downloaded LWIN file falls under the CC BY page (open, commercial) or under the website/membership
terms (internal, non-commercial, no storing). **Do not import LWIN** until Liv-ex confirms in writing (e.g. via
data@liv-ex.com), for a commercial EU consumer app:

1. which licence applies to the downloaded LWIN database (and its version);
2. that storing it in CELLR's database and showing names and codes to consumers is allowed;
3. the exact attribution wording and any "Display Requirements";
4. whether LWIN codes may be used as CELLR's cross-reference identifiers;
5. whether the AI-training prohibitions (website 11.3, membership 9.14) affect CELLR's AI features — e.g. passing
   LWIN-derived names to an LLM prompt for a wine profile. Treat this as prohibited until answered.

Also unresolved: the download's column layout (the adapter refuses files without the expected columns; §6).

### 3.3 X-Wines — BLOCKER for production (status `unverified`, pilot only)

- **Licence:** CC0 1.0 (repository `LICENSE`). Commercial use, storage and redistribution are allowed **for the authors'
  rights**.
- **BLOCKER (provenance):** the data "were collected on the open Web in 2022". The sources are not itemised; the
  repository's `Evaluation/sources.csv` lists winery websites for an evaluation subset only. The data's shape — a 1–5
  half-star rating scale, 21M ratings by 1M users, a vintages list per wine — suggests a consumer wine-rating platform.
  **This is an inference, not evidence**, and it is exactly the case CC0 §4(3) excludes: if the data came from a platform
  with an EU sui generis database right, that right is not cleared by the authors' CC0 dedication.
- **Quality:** the authors accept no responsibility for accuracy. Vintages are years with ratings, not verified
  releases. Producer and brand are sometimes swapped ("Casillero del Diablo" as the producer); names often carry their
  appellation ("Rioja Reserva").
- **Needed before production:** the authors' written statement of the sources and of the rights under which the data was
  collected; or counsel's opinion that CELLR's use (identity fields only: names, type, country, region) does not
  extract a substantial part of a protected database.
- **Pilot data in the repository:** `results/benchmark-results.json` contains the names of the ~300 X-Wines records that
  matched benchmark wines (identity fields only), as evidence for the coverage numbers. No ratings were read or stored.

### 3.4 WineAPI.io — not evaluated against data (no account)

The free tier forbids "commercial or business purposes", so even an evaluation for CELLR needs a paid plan, which this
sprint does not start. Provenance: "compiled from various sources". Caching and storage rights are not stated; storing
results as a CELLR dataset would risk the "redistribute… as a standalone dataset" prohibition. Operator: Pinnacle Ridge
Cloud Solutions (Terms §9). **Not suitable** until its terms state caching and display rights for commercial apps.

### 3.5 What the system enforces (so nothing rests on memory)

| Rule                                                                                                                              | Enforced by                                                                                                                                           |
| --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| No import of a provider whose licence does not allow storing                                                                      | `catalog_import_run_start` / `catalog_external_import` refuse (`may_store`)                                                                           |
| No import at all while rights are `blocked` (LWIN)                                                                                | Both functions refuse, even for pilots (tested)                                                                                                       |
| No non-pilot import before rights are `verified`                                                                                  | `catalog_import_run_start` refuses (tested); the pilot runner shows the refusal for X-Wines                                                           |
| `verified` needs evidence, a date and who verified it                                                                             | Check constraint (tested)                                                                                                                             |
| Records reach people only when storing **and** displaying are allowed; publicly only with verified commercial rights              | `search_scope` constraints (`off` / `pilot` / `public`) (tested)                                                                                      |
| The import tool never sets `public` and refuses non-local databases                                                               | `scripts/catalog-tools/import.ts`, `assertSafeTarget` (unit-tested)                                                                                   |
| Each run keeps the licence and rights status it was imported under, the retrieval date, file hash, source URL and dataset version | `catalog_import_runs` (tested)                                                                                                                        |
| Each record keeps provider, external id, its source URL, first/last run and what CELLR modified                                   | `catalog_external_records` (tested)                                                                                                                   |
| No ratings, prices or reviews in provider records                                                                                 | Import refuses `details` with those keys (tested); adapters never read them                                                                           |
| Provider data stays separate from CELLR's and households' data                                                                    | Separate tables; a record never becomes a canonical wine; links are admin-verified and audited                                                        |
| Attribution, licence link, modification flag and scope travel with every provider search result                                   | `catalog_search` columns → `CatalogSearchHit.provider`                                                                                                |
| No implied endorsement                                                                                                            | `noEndorsement()` text; a unit test rejects "partner", "powered by", "official", "in samenwerking", "aangeboden door" in credits and provider notices |

### 3.6 Production-import blockers (open, not assumed)

| #   | Blocker                                                                                                                                                                       | Owner action                                             |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| B1  | LWIN: which terms apply (CC BY page vs website and membership terms); storage, display, attribution wording, identifier use, AI-training clause                               | Written confirmation from Liv-ex                         |
| B2  | X-Wines: provenance of the underlying data and third-party database rights                                                                                                    | Authors' statement or counsel's opinion                  |
| B3  | EU sui generis database right: the articles were not verified from EUR-Lex in this session                                                                                    | Counsel to confirm the analysis in §3.1                  |
| B4  | WineAPI.io: caching, storage and display rights for a commercial app                                                                                                          | Provider terms or a written answer, before any paid plan |
| B5  | Attribution wording and placement for each provider that is cleared                                                                                                           | Provider's display requirements                          |
| B6  | Privacy notice: none needed for provider data itself (no personal data), but search queries are processed server-side and counted for rate limiting (no query text is stored) | Note in the privacy information                          |

---

## 4. Benchmark and coverage

### 4.1 The set (`eval/catalog/benchmark.json`, 127 wines)

| Segment        | Wines | Notes                                                                                                                   |
| -------------- | ----: | ----------------------------------------------------------------------------------------------------------------------- |
| fr             |    21 | Bordeaux grand vins and second wines, Rhône, Burgundy, Loire, Alsace, Languedoc                                         |
| it             |    13 | Super Tuscans, Piedmont, Veneto, Sicily, Campania                                                                       |
| es             |    15 | Rioja, Ribera del Duero, Priorat, Rías Baixas, Penedès                                                                  |
| sparkling      |    12 | Champagne NV and vintage, Prosecco, Franciacorta, Trento, Cava                                                          |
| rose           |     3 | Provence                                                                                                                |
| nl-supermarket |    22 | International brands as sold at Dutch supermarkets (Chile, Australia, South Africa, US, Portugal, France, Spain, Italy) |
| nl-wine        |     2 | Dutch wineries (Apostelhoeve, De Kleine Schorre)                                                                        |
| eu-specialist  |    14 | Germany, Austria, Portugal, Greece, Hungary                                                                             |
| similar        |    10 | Similar producers (Léoville ×3, Pichon ×2) and the same wine name at different producers (Brunello, Barolo, Amarone)    |
| variant        |    15 | Typing variants of the above: typos, missing accents, nicknames, word order, transliteration (ue/ü)                     |

It covers multiple vintages, non-vintage (11 NV wines covered), similar names, accents and spellings. Expected identities
are written from general wine knowledge **as search targets only**; they are not imported anywhere, and a wine counts as
covered only when the provider's own record says so.

### 4.2 Coverage of X-Wines (automatic classification)

`scripts/catalog-tools/benchmark.ts`, using the scan matcher's `nameSimilarity` (producer ≥ 0.85; name ≥ 0.9 = same,
0.6–0.9 = close):

| Segment        |   Wines |  exact | ambiguous | partial | producer-only | missing |
| -------------- | ------: | -----: | --------: | ------: | ------------: | ------: |
| fr             |      21 |      8 |         0 |       7 |             6 |       0 |
| similar        |      10 |      6 |         0 |       2 |             1 |       1 |
| sparkling      |      12 |      1 |         0 |       8 |             3 |       0 |
| rose           |       3 |      1 |         0 |       1 |             1 |       0 |
| nl-supermarket |      22 |     15 |         0 |       5 |             0 |       2 |
| it             |      13 |      8 |         1 |       0 |             1 |       3 |
| es             |      15 |      5 |         0 |       5 |             2 |       3 |
| nl-wine        |       2 |      0 |         0 |       0 |             1 |       1 |
| eu-specialist  |      14 |      7 |         0 |       5 |             0 |       2 |
| variant        |      15 |      5 |         0 |       5 |             2 |       3 |
| **all**        | **127** | **56** |     **1** |  **38** |        **17** |  **15** |

**Manual review of the 38 "partial" entries** (my reading of `results/benchmark-results.json`, by entry id):

| Reviewed as                                                        |   n | Entries                                                                                             | Example                                                                  |
| ------------------------------------------------------------------ | --: | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Same wine, provider name adds appellation, region or a translation |  20 | b024 b025 b026 b028 b030 b031 b046 b054 b062 b070 b073 b074 b080 b081 b106 b107 b112 b116 b117 b118 | "Rioja Reserva", "Impérial Brut Champagne", "Reserva Vinhas Velhas"      |
| Only a second or third wine; the grand vin is absent               |   6 | b004 b005 b009 b011 b013 b014                                                                       | "Pauillac de Latour", "Le Petit Mouton", "Pavillon de Léoville Poyferré" |
| Several candidates: the person must choose                         |  10 | b022 b035 b047 b071 b075 b083 b096 b110 b111 b121                                                   | Sancerre Blanc/Rosé/Rouge; Casillero del Diablo filed as a producer      |
| Uncertain                                                          |   2 | b007 b122                                                                                           | "Sauternes d'Yquem"                                                      |

**Reviewed totals:** present without ambiguity **76 / 127 (60%)**; needs a choice 11 (9%); producer only, or only its
second wine, 23 (18%); missing 15 (12%); uncertain 2.

Findings:

- **Iconic wines are missing or present only as second wines**: Tignanello, Ornellaia, Solaia, Pichon Baron, Viña
  Tondonia, Sangre de Toro, Egon Müller Scharzhof are missing. Lafite, Haut-Brion, Petrus, Palmer, Léoville Las Cases,
  Pichon Comtesse and La Tâche have only the producer.
- **Supermarket brands cover best** (15/22 exact): X-Wines' consumer-rating origin shows.
- **Dutch wineries**: 0/2 exact.
- **Vintages:** every exact match lists vintages (median 50), but these are rated years, not a verified vintage list.
  Use them as hints, never as CELLR vintages.
- **NV:** 10 of 11 covered NV wines are flagged "N.V." in the record.
- **Ambiguity is real**: Masi Costasera vs Costasera Riserva vs Nectar Costasera; brand-as-producer. This confirms the
  rule that a provider match is a suggestion, never an identity.

### 4.3 Search quality (the same 127 queries through `catalog_search`, as a household member)

| Measure                                                 |                                                                                                                       Result |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------: |
| Queries with a covered record                           |                                                                                                                           95 |
| Covered record ranked 1st / top 3 / top 8               |                                                                                                             **77 / 84 / 92** |
| Covered record not in the top 8                         |                 3 (b071, b083, b121: brand-as-producer, where search shows the right wine under the provider's own producer) |
| Provider results marked `verified`                      |                                                                                                                        **0** |
| Empty results                                           |                                                                               3 (wines the provider lacks: b052, b097, b098) |
| Similar producers (Léoville, Brunello, Barolo, Amarone) |                                                                                       right one 1st in 6/8 covered, 2nd in 2 |
| Typing variants with a covered record ranked 1st        | chateau margau, sasicaia, moet imperial, amarone allegrini, vega sicilla. "veuve cliquot" ranks 8th, "marquis de riscal" 5th |

---

## 5. Database design (`supabase/migrations/20261114000037_catalog_search.sql`)

```
catalog_providers ─┐ licence, attribution, legal notice, modification notice,
                   │ may_store/may_display/commercial_use, rights_status + evidence, search_scope
catalog_import_runs┤ dataset version, source URL, SHA-256, retrieved_at, pilot, licence + rights at import
catalog_external_records (provider_id, external_id) unique
                   │ producer, name, type, country, region, appellation, vintages[], non_vintage,
                   │ details (identity extras; never ratings/prices), source_url, modifications[],
                   │ content_hash, status active/withdrawn, first/last run
catalog_record_links record → canonical wine, state suggested/verified/rejected (admin, audited)
private.catalog_search_entries  one row per wine name, canonical alias, provider record (triggers)

public.wines / producers / wine_vintages / wine_aliases   ← unchanged; canonical vs provisional preserved
households' bottles, tastings, valuations                  ← unchanged; never referenced by provider data
shared_wine_profiles / vintage_insights                    ← unchanged
```

How the separations asked for map onto the design:

| Concept                        | Where it lives                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------- |
| External catalogue record      | `catalog_external_records`                                                      |
| Canonical CELLR wine / vintage | `wines` (canonical) / `wine_vintages` (unchanged)                               |
| External provider identifiers  | `(provider_id, external_id)`; LWIN-7 also in `details.lwin7`                    |
| Aliases                        | `wine_aliases`: verified, canonical only. Provider names are **not** aliases.   |
| Source metadata and provenance | provider, run and record columns (§3.5)                                         |
| AI profile and analysis data   | `vintage_insights`, `shared_wine_profiles` (unchanged; canonical vintages only) |
| Household-specific information | provisional wines, bottles and the rest (unchanged; RLS)                        |

- **No duplicates:** `(provider, external_id)` is unique, and re-imports are idempotent through the content hash. The
  same identity under two ids of one provider is reported (`possible_duplicates`), not merged. A verified record is
  hidden in search behind its canonical wine.
- **No conflicting identities:** links go only to canonical wines (trigger). Only an admin verifies (audited). An import
  suggests a link only for exactly one exact identity. A rejected link leaves the record an unverified provider result.
- **Reversible:** additive only. Nothing existing is altered except triggers added on `wines`, `producers` and
  `wine_aliases`, which only maintain the index. To undo: drop the new triggers, functions and tables.
- **Not deployed.** It follows `docs/MIGRATIONS.md` §2 like any other migration.

---

## 6. Search implementation

`public.catalog_search(household, query, type?, country?, region?, limit?)` → compact rows. Exposed through
`GET /api/v1/catalog/search?q=&type=&country=&region=&limit=` (`apps/web/src/app/api/v1/catalog/search/route.ts` →
`server/catalog/search.ts` → `search-repository.ts`).

| Requirement                     | How                                                                                                                                                                                                               |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Producer, wine name, combined   | Index text = normalised "producer name"; every typed word must start a word of it, in any order                                                                                                                   |
| Accent- and case-insensitive    | `private.normalize_text` on both sides (unaccent + lower + punctuation)                                                                                                                                           |
| Prefix                          | Each 3+ letter word becomes a trigram `LIKE '%w%'` (the GIN index ANDs them), then a word-start regex. Shorter input uses btree `text_pattern_ops` on producer and name                                           |
| Controlled fuzzy                | `pg_trgm` word similarity ≥ **0.6**, only for 4+ characters and only when prefix matching gives less than a page. Labelled `match: "fuzzy"`                                                                       |
| Aliases                         | Canonical aliases are indexed; labelled `match: "alias"` with `matchedAlias`                                                                                                                                      |
| Filters                         | Type, country, region (accent-insensitive substring)                                                                                                                                                              |
| Bounded, ranked                 | At most 20 (default 8). Exact > prefix > fuzzy, then owned bottles (+0.6), the household's own wines (+0.4), verified catalogue (+0.3), provider records (0), then trigram similarity. One row per wine or record |
| Validation and abuse protection | Zod (≤ 200 chars, enum type, ISO country, limit 1–20); the database cuts to 8 words / 80 characters; under 2 letters costs nothing; 600 searches/hour/person; candidate sets capped at 400 per branch             |
| RLS and household isolation     | `security definer` with an explicit membership check: another household's id returns nothing. Rows are limited to `household_id is null or = caller's`. Tested with two households and an outsider                |
| Fuzzy is never an identity      | `verified` only for canonical wines (in SQL and again in `toSearchHit`). `needsConfirmation()` is true for fuzzy, prefix and every provider record                                                                |
| Missing provider / empty        | No providers → CELLR wines only. Before the migration → `{ available: false }` and the manual flow continues                                                                                                      |
| No external calls per keystroke | None: the search reads the local database only                                                                                                                                                                    |
| Existing flows                  | Unchanged: Scan, manual entry, Purchase Check and `/api/v1/wines` still work as before                                                                                                                            |

---

## 7. Measured performance

Setup: the full X-Wines file (100,646 records) plus 300 own wines (100 with bottles) in the test household and 10,000
wines in 200 other households (synthetic, `seed-load.sql`). Postgres 16 on 4 vCPU / 15 GB, local socket. The load:
each benchmark query typed as its first 3, 5 and 8 characters, then in full, with and without filters, plus 8 very
common words. That is 638 searches × 3 shuffled rounds = **1,914 searches per run**, after one warm-up pass. Timings are
measured at the client: database time plus the local round trip. They exclude the API layer and the network.

| Concurrent clients |     p50 |         p95 |    p99 |    max | throughput |
| -----------------: | ------: | ----------: | -----: | -----: | ---------: |
|                  1 |  7.2 ms | **23.3 ms** |  61 ms | 153 ms |      101/s |
|                  8 | 13.7 ms | **47.6 ms** | 110 ms | 298 ms |      414/s |
|                 16 | 29.1 ms | **89.9 ms** | 192 ms | 543 ms |      398/s |

- **Tuning that got here** (measured on the same data): the first version used threshold 0.55 and always ran the fuzzy
  branch, with p95 63 / 119 / 272 ms. "chateau margau" took 476 ms because 15,505 rows passed word similarity 0.55;
  at 0.6 only 424 do, with the same typo recall on the benchmark. Skipping fuzzy when prefix matches fill a page,
  and capping each branch at 400, brought very common words from 137–187 ms to 17–32 ms.
- **Index:** 110,951 rows, **72 MB** (table + indexes).
- **Import:** 100,646 records in 86 s (500 per call); a re-import of the same file took 56 s and reported **100,646
  unchanged**.
- **Expect in production:** a PostgREST hop plus the service's own queries (active household and rate limit), roughly
  +10–40 ms on Supabase. That still fits a debounced autocomplete under 250 ms at p95. To be measured on staging in 004B.

---

## 8. Pilot import

`bash scripts/catalog-tools/pilot.sh <XWines_Full_100K_wines.csv>`, on a throwaway local Postgres that is deleted
afterwards. Results are in `docs/sprints/sprint-004a/results/`.

1. **Fixture** (`eval/catalog/fixture-xwines-layout.csv`, CELLR-written fictitious wines). A dry run writes nothing.
   Applying it inserted 5 records; the adapter refused 2 bad rows. Re-importing gave 5 unchanged.
2. **X-Wines non-pilot import: refused** ("rights are not verified; only a pilot run is allowed").
3. **X-Wines pilot import:** SHA-256 `eac2d812…a4662cc` matched the authors' published hash. 100,646 inserted, 0
   invalid. Duplicates within the provider are reported: 171 on the first run, 331 on the second (the second run counts
   both members of each pair).
4. **Re-import:** 0 inserted, 0 updated, 100,646 unchanged (idempotent). `--withdraw-missing` withdrew 0.
5. **Search** against the imported records: §4.3 and §7.

---

## 9. Provenance and the future "Bronnen & betrouwbaarheid" section (design; no UI this sprint)

Foundation built:

- `catalog_record_provenance(household, record)`: provider, homepage, licence and link, attribution, legal notice,
  modification notice, rights status, scope, external id, source URL, first and last retrieval date, dataset version,
  licence at import, CELLR's modifications, and the link state.
- `packages/domain/src/provenance.ts`: four origins (`cellr_catalog`, `external_catalog`, `ai_estimate`,
  `user_provided`), mapped from the existing `provenance_source` enum. It provides `attributionLine()`,
  `noEndorsement()`, `groupByOrigin()` and `sourcesOf()`, in nl and en.

UI design for a wine detail page (for 004B or later):

```
┌ Bronnen & betrouwbaarheid ───────────────────────────── (collapsed by default, one line) ┐
│  ● CELLR-catalogus (gecontroleerd)   producent, naam, kleur, herkomst                     │
│  ● Externe wijndatabase              regio, druiven           Bron: X · licentie CC BY 4.0 · bewerkt door CELLR  ⓘ │
│  ● Schatting door CELLR (AI)         drinkvenster, profiel    "schatting, geen feit"      │
│  ● Door jullie ingevoerd             prijs, locatie, notities                             │
│                                                         Volledige bronvermeldingen ›      │
└────────────────────────────────────────────────────────────────────────────────────────┘
"Volledige bronvermeldingen" (sheet): per source the provider, licence name + link, the required attribution verbatim,
the legal notice, "Gewijzigd door CELLR: …" (the record's modifications), record id + source page, retrieved on <date>,
dataset version, and "<Provider> is niet verbonden aan CELLR en onderschrijft CELLR niet."
```

Rules:

- Every fact sits under exactly one origin.
- External facts always show their credit line.
- AI estimates are always labelled as estimates (as the existing UI already does).
- Household data is never mixed into the catalogue groups.
- Pilot-scope data shows "proefgegevens" and is never presented as licensed.
- No provider logos or "powered by"-style wording.

---

## 10. Checks run

| Check                                                                                   | Result                                                                                                           |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `pnpm db:test`: migrations + permission suite (Postgres 16)                             | **1108 passed**, 0 failed (75 new in `99_catalog_search.test.sql`; the 1033 existing ones unchanged and passing) |
| `pnpm test`: unit tests, all packages (includes Scan, cellar and Purchase Check)        | see the PR description for the final run                                                                         |
| `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm db:types:check`, `pnpm build` | see the PR description                                                                                           |
| Pilot (`pilot.sh`)                                                                      | passed end to end (§8)                                                                                           |

Not run here: `pnpm e2e` (main / nightly only in CI) and the real-Supabase-stack job (needs Docker). CI runs both.

---

## 11. Proposal for Sprint #004B

1. **Use the search in the existing flows, behind a flag.** Manual entry and Purchase Check type-ahead call
   `/api/v1/catalog/search` (debounce 250 ms, abort on new input). Choosing a CELLR wine uses its id. Choosing a
   provider record pre-fills the form and creates the household's own wine as today, keeping `record_id` as a hint
   (not a link).
2. **Scan:** replace the in-memory `listWines()` candidate set for `matchLabel` with a bounded `catalog_search` on the
   read producer and name. The `isCatalogIdentity` rules stay the same.
3. **Admin review of record links** at `/admin/catalog` (verify / reject suggested links), reusing the Wine Master
   pages.
4. **Resolve blockers B1–B5** (§3.6). If Liv-ex confirms: obtain the file, verify the LWIN adapter's column layout,
   then run a staging import with `search_scope = 'pilot'`, review, and only then go `public`.
5. **Measure on staging** (Supabase, PostgREST, real network): p95 at the API.
6. **Build "Bronnen & betrouwbaarheid"** (§9) on the wine page, starting with AI estimates vs household data, which
   exist today.
7. **Grow the canonical catalogue** through Sprint J learning and curated imports, using the benchmark as the yardstick.

## 12. Risks and unanswered questions

- **Legal:** blockers B1–B6 (§3.6). **No production import until they are resolved.**
- **Coverage:** X-Wines lacks many fine wines and Dutch wineries. Coverage numbers are for one provider and one
  127-wine set chosen by the author, so they indicate rather than prove.
- **Classification:** coverage uses heuristic thresholds; the review of partials is one person's reading. All matches
  are in `benchmark-results.json` for re-review.
- **Trigger cost:** every wine, producer or alias write now also refreshes its index rows (a few small writes). This
  is negligible at current scale; for bulk curated imports, measure on staging.
- **Ranking:** the weights (owned +0.6, own +0.4, catalogue +0.3) are first choices validated on this benchmark only.
  Tune with real query logs: count them, do not store query text.
- **Search scope `pilot` in production** would show unverified data. It is visible in every result
  (`provider.scope`), but the production checklist must confirm no provider has `pilot` scope.
- **LWIN adapter** is written against an assumed column layout and refuses other files. It is unverified.

## 13. Reproduce

```bash
pnpm install
bash scripts/db-test.sh
# X-Wines: download XWines_Full_100K_wines.zip from the authors' Drive folder (linked in the repository README),
# check its SHA-256 against their INFO_Hashing.txt, unzip, then:
bash scripts/catalog-tools/pilot.sh /path/to/XWines_Full_100K_wines.csv
```
