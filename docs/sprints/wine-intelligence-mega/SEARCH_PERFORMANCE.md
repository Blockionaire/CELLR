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

## Not measured here

- The API route, PostgREST and the network: WI-07.
- Perceived autocomplete latency in the browser (includes a deliberate 250 ms debounce): WI-02 / WI-07.
- A real mobile network, a real phone: `REAL_LABEL_VALIDATION_PENDING` and the device checklist.
- A hosted Supabase instance: nothing was run against one.
