# Search performance (WI-01 baseline)

Measured 2026-11-13 by `scripts/catalog-tools/perf.ts` inside `pilot.sh`. Raw output: `results/perf-*.json`,
`results/query-plans.txt`, `results/index-size.txt`. WI-07 adds the API and the browser on top of this.

## Environment (read this before quoting a number)

| Item          | Value                                                                                                                                                                  |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Machine       | cloud container, 4 vCPU (Intel Xeon 2.1 GHz), 15 GB RAM, shared; load generator and database on the same machine                                                       |
| Database      | Postgres 16, throwaway cluster, `fsync=off`, default settings otherwise                                                                                                |
| Data          | 100,646 X-Wines records + 12 fixture records (provider), 10,300 household wines (300 the test household's, 10,000 of 200 other households) = 110,958 index rows        |
| What is timed | one `catalog_search` call at the client: database time + local round trip. **Not** PostgREST, the API route, the network or the browser                                |
| Load          | each query "typed": its first 3, 5 and 8 characters, the whole query, and the whole query with type and country filters; plus 8 common words. 3 rounds after a warm-up |

These are local SQL latencies. They are not production API latencies and say nothing about a phone on a mobile
network.

## Results

| Path                                                 | Clients | Searches | p50 ms | p95 ms | p99 ms | max ms | per second | 004A p95 |
| ---------------------------------------------------- | ------: | -------: | -----: | -----: | -----: | -----: | ---------: | -------: |
| Pilot search, 100k records, the 127 queries of 004A  |       1 |    1,914 |    8.0 |   26.2 |   70.6 |    136 |         92 |       24 |
| same                                                 |       8 |    1,914 |   15.5 |   52.0 |  109.7 |    296 |        365 |       47 |
| same                                                 |      16 |    1,914 |   32.6 |   98.4 |  192.5 |    521 |        360 |       93 |
| Pilot search, all 221 named entries of version 2     |      16 |    3,321 |   36.4 |  101.1 |  195.9 |    508 |        353 |        — |
| People's search (no provider is public), 127 queries |       8 |    1,914 |   11.7 |   44.9 |  102.8 |    283 |        447 |       36 |

**Target: SQL p95 under 250 ms at 16 clients on 100k+ provider and 10k+ household records — met (98 ms).** The
numbers are within run-to-run noise of Sprint 004A's on a shared machine (two runs of this sprint gave 105 and 98 ms):
nothing in WI-01 changes the search function. Sixteen clients on four cores means queueing; the slowest searches are
whole names with a typo (the similarity path), whose p99 was 472 ms.

By kind of search, 16 clients, 127 queries:

| Bucket                   | p50 ms | p95 ms | p99 ms |
| ------------------------ | -----: | -----: | -----: |
| first 3 characters       |   47.7 |   89.3 |  135.2 |
| first 5 characters       |   20.8 |   69.8 |   94.8 |
| first 8 characters       |   20.4 |   67.7 |   96.0 |
| whole query              |   38.7 |  123.7 |  471.8 |
| whole query with filters |   39.6 |  123.7 |  364.9 |
| common words             |   69.2 |   88.9 |   96.3 |

Single calls of the widest queries (one client, from the benchmark run): "chateau" 20 ms, "domaine" 17 ms, "bodega"
22 ms, "reserva" 21 ms. In the first run "chateau" filtered to Italian whites took 103 ms and found nothing: a common
word with a selective filter is the slowest shape, because the filter is applied after the word's candidates are
collected.

## Query plans

`catalog_search` is a PL/pgSQL function, opaque to `EXPLAIN`; its two index paths are shown directly in
`results/query-plans.txt`:

| Path                                           | Plan                                                                       | Rows touched |    Time |
| ---------------------------------------------- | -------------------------------------------------------------------------- | -----------: | ------: |
| every 3+ letter word as a trigram `LIKE`       | Bitmap Index Scan on `catalog_search_entries_trgm` (GIN), both words ANDed |          146 |  1.5 ms |
| a typo, by trigram word similarity (`<%`, 0.6) | Bitmap Index Scan on the same GIN index, 1,938 candidates rechecked to 424 |        1,938 | 36.0 ms |

Whole-function times (`EXPLAIN ANALYZE`, one call each): "chateau" 31 ms, "chateau margaux" 19 ms, "chateau margau"
26 ms, "marques de riscal reserva" 35 ms. No sequential scan of the index table appears.

## Sizes

| Object                                      |                       Size |
| ------------------------------------------- | -------------------------: |
| `private.catalog_search_entries` (table)    |                      31 MB |
| its trigram GIN index                       |                      22 MB |
| its other indexes (prefix, unique, by wine) |                     ~23 MB |
| **search index, total**                     | **76 MB** for 110,958 rows |
| `public.catalog_external_records` (table)   |                      93 MB |
| its indexes                                 |                     ~24 MB |

Roughly 190 MB for 100k provider records, all told (the exact sizes vary a few MB between runs with table bloat from
the second import). By simple proportion a second provider of 200k records would add about 400 MB; that is an
estimate, not a measurement.

## Import time

100,646 records: 77 s to import (≈ 1,300 records/s), 62 s to re-import unchanged, in batches of 500 through
`catalog_external_import`, including the new check that every record is written under an open run. Before that, the
tool inspects the whole file (layout, encoding, unique ids, ragged rows): 5.2 s for this file, measured separately.

## After the hardening round (migration `…0042`)

Migration `20261119000042` replaced the search function: sources that people may not see are now left out before
the 400 candidates are taken, not after (`progress/WI-08-hardening.md`, finding 3). The same pilot was run once more
on the same machine (one run; files in `results/after-0042/`). The coverage benchmark, the import invariants and the
pilot separation are identical to the run above, entry for entry.

| Path                                                 | Clients | p50 ms before → after | p95 ms before → after | p99 ms before → after |
| ---------------------------------------------------- | ------: | --------------------: | --------------------: | --------------------: |
| Pilot search, 100k records, the 127 queries of 004A  |       1 |             8.0 → 8.7 |           26.2 → 29.7 |           70.6 → 84.0 |
| same                                                 |       8 |           15.5 → 17.5 |           52.0 → 64.7 |         109.7 → 122.0 |
| same                                                 |      16 |           32.6 → 36.8 |          98.4 → 115.1 |         192.5 → 224.9 |
| Pilot search, all 221 named entries of version 2     |      16 |           36.4 → 39.2 |         101.1 → 116.0 |         195.9 → 220.3 |
| People's search (no provider is public), 127 queries |       8 |           11.7 → 15.1 |           44.9 → 83.7 |         102.8 → 218.3 |

**The target (SQL p95 under 250 ms at 16 clients) is still met: 115 ms.** The pilot path is 10–17% slower; two runs of
WI-01 already differed by 7%, so part of that may be noise, and the rest is the extra condition in the scan.

The people's path is slower because it now does work it used to skip. In this pilot database no source is public,
so every one of the 100k records is hidden from people. Before, a common word such as "chateau" filled the 400
candidates with hidden records; they counted as a full page, the typo-tolerant pass was skipped, the hidden records
were dropped at the end, and the person got an empty answer quickly. Now hidden records are discarded while the index
is read, the page is not counted as full, and the typo-tolerant pass runs as it would in a database without that
source. The "common words" bucket shows it most (p50 23 → 135 ms, p95 48 → 242 ms at 8 clients). The number of empty
answers went from 1,911 to 1,908 of 1,914: three searches that the defect had emptied. This reading comes from the
function's text and these numbers; the two passes were not timed separately.

Not done: a separate index for the people's path. It would matter only while a large source is loaded but hidden,
which is the pilot state. Once a source is public its records are candidates, and the path is the pilot path above.

## Not measured here

- The API route, PostgREST and the network: WI-07.
- Perceived autocomplete latency in the browser (includes a deliberate 250 ms debounce): WI-02 / WI-07.
- A real mobile network, a real phone: `REAL_LABEL_VALIDATION_PENDING` and the device checklist.
- A hosted Supabase instance: nothing was run against one.
