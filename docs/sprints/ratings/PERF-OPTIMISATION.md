# People's search: cheaper in CPU, same answers (migration 0055)

**What this is.** The staging load test of people's search (`perf16`, run 46061228880) was **NOT MET**: with 25
searches executing on a 2-vCPU database, SQL p95 was 2,079 ms against an acceptance of 250 ms. The database was
CPU-bound (cache 100%, no temp files, about 3,700 shared buffers per search). Migration
`20261203000055_catalog_search_performance.sql` replaces `private.catalog_search_impl` with a version that does less work
for **exactly the same answers**. This page has the method, the measurements before and after, the result-equality
comparison, and how much of the gap is left for hardware.

**Nothing after 0055 was measured on staging.** The staging figures quoted are those of the perf16 run before it;
every other number below is from a local database, built and loaded like staging.
A staging re-run of `perf16` needs the owner's approval.

## 1. What changed, and why the answers stay the same

| #   | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Why the answer cannot change                                                                                                                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **No second look at the same rows.** The old search counted the trigram LIKE matches once ("is the page already full?", which decides typo tolerance) and then scanned the same rows again in the main query. Now the LIKE candidates (the 400 shortest, as before) are read once as a list of ids, and typo tolerance is decided from that list.                                                                                                                                                                                                                                                                                                                                                                                                      | The old count was "fewer than `limit` matches". The list holds up to 400 matches and `limit` is at most 20, so "the list has fewer than `limit`" is the same test on the same rows, the same filters and the same scope rule, in the same snapshot. |
| 2   | **The word-similarity scan runs only when it is needed.** It is now a separate statement that is not even planned when the LIKE candidates fill the page.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Same condition as before (at least 4 letters, page not full); same operator, threshold 0.6, filters, scope rule, order (`word_similarity desc, id`) and limit 400.                                                                                  |
| 3   | **Less planning.** The LIKE scan stays dynamic SQL: its patterns must be constants for the trigram and prefix indexes. The word-similarity scan and the scoring are static SQL with a cached generic plan (`plan_cache_mode = force_generic_plan` on the function).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Plans change speed, not results. Checked: the generic plan of the word-similarity scan still uses the trigram GIN index (`search_text %> $n`), and the scoring reads the candidates by primary key.                                                 |
| 4   | **Details for the page, not for every candidate.** The old query joined all candidates (up to 800) to wines, producers, aliases, provider records and providers, then took the best `limit`. Now it takes the best `limit` first and joins only those.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | The order uses the candidate's own columns only (score, length, text, id), and every join is a left join to a primary key: nothing can be added, lost or reordered.                                                                                 |
| 5   | **"Every word starts a word" without a regular expression:** `(' ' \|\| text) like ('% ' \|\| word \|\| '%')` instead of `text ~ ('(^\| )' \|\| word)`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | A word of the normalised query is letters and digits only (`normalize_text`), so it holds no regex or LIKE wildcard. Both test "the word at the start or after a space".                                                                            |
| 6   | **One choice that was left to chance is fixed:** when two rows of one wine (two aliases) tie on score, the one with the lower index id is kept.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Before, the sort of the moment decided. No difference was observed in any comparison below; the SQL test pins the choice.                                                                                                                           |
| 7   | **A bounded pending list for the trigram index** (`gin_pending_list_limit = 512` kB, default 4 MB). New index entries wait in an unsorted list until a vacuum or the limit merges them, and **every search reads that whole list**. After an import it can be nearly 4 MB (about 500 pages). The ALTER takes an ACCESS EXCLUSIVE lock on the index (no rewrite) and gives up after 5 s (`lock_timeout`), so it cannot queue searches and catalogue writes behind an import batch or a long query; it then fails the migration as a whole, which is applied again later. Do not apply it during an import or a load test. A pending list that already exists is not merged by the ALTER: the next insert over the limit, or the next vacuum, merges it. | A storage setting of the index: it changes when entries are merged, never what the index returns.                                                                                                                                                   |

| 8 | **pg_trgm's library is loaded first** (a no-op `extensions.similarity('a', 'a')`). The function sets `pg_trgm.word_similarity_threshold`, which exists only once the library is loaded in the session; before that it is a placeholder that, since PostgreSQL 15, only a superuser may put on a function. Supabase applies migrations as `postgres`, not a superuser. | A no-op call. 0037 loaded the library by building the trigram index before its function; 0042 relied on an earlier statement of the same session. Reproduced as a non-superuser in a fresh session: without the call the migration fails with "permission denied to set parameter". |
Kept as they were: `SECURITY DEFINER` with `search_path ''`; the grants (people's search: `authenticated` and
`service_role`, never `anon`; the implementation: no API role); the membership check and scope `public` in
`public.catalog_search`, which is not touched; the sources whose records may be candidates are decided first and
applied inside both candidate scans (0042); the rights re-check of public providers where rows are scored; a record
with a verified link stays hidden behind its catalogue wine; only canonical wines are `verified`, `fuzzy` is never an
identity; `vintages`; the result columns and types; ties broken by name; limit 1–20; a query cut at 8 words and 80
characters.

**Out-of-scope rows filling the 400 candidates.** Checked: in the version of 0042 the scope rule is already applied
inside both candidate scans, so pilot records (X-Wines on staging) and other households' wines cannot take a place
among the 400. The new SQL test pins it with 450 shorter pilot records and 450 look-alike wines of another household.

**Considered and not done** (measured, or a change of behaviour):

- **GiST instead of GIN** for the trigram index: the word-similarity scan took 67–74 ms with GiST against 14–19 ms with
  GIN on the same query and data (and the planner preferred the GiST index when both existed). Not done.
- **A partial trigram index over the short entries** (an exact shortcut: when the shorter entries alone hold 400
  matches, they are the 400 shortest): about 40% less on one very common prefix, but its benefit depends on the length
  distribution of the data, and it adds an index to every import. Not done.
- **`fastupdate = off`** for the trigram index (no pending list at all): import of 100,000 records 41% slower. The
  512 kB limit costs nothing measurable (below).
- Typo tolerance only when there are no regular results, a lower candidate limit, or a higher threshold: changes of
  behaviour. Not done; nothing in this migration changes an answer.

## 2. Method

- **Database:** a local PostgreSQL 17 cluster pinned to 2 cores (`taskset -c 0,1` on the server; the clients on the other
  two cores), `shared_buffers` 256 MB, `max_connections` 60, `pg_stat_statements` (`track = all`, planning tracked). The
  same schema (all migrations), the same data as staging: `seed-load.sql` (10,300 household wines), the X-Wines file
  (100,646 records, scope `pilot`), `perf-synthetic.sql` (100,000 synthetic records, scope `public`), `analyze`. Search
  index 210,946 rows, trigram GIN 22 MB.
- **The old implementation** (0042) was kept in the same database under another name, so old and new ran on the same
  data, side by side, with the same pinning. The machine is shared: timings carry a few percent of noise; the buffer
  counts and the result comparison do not.
- **Two index states**, because the pending list matters (change 7): **A, clean** (pending list merged, as after a
  vacuum) and **B, after an import** (old: the default limit, 499 pending pages, as a 4 MB list after an import; new: the
  512 kB limit, 51 pages). The pending entries were invented wines of another household that no search matches.
- **Load:** `perf.ts --mode public --synthetic perf_synth --rounds 3 --pooler transaction --one-trip --target 16`, as
  `staging-pilot.sh perf16` runs it (locally the transaction mode runs directly against the database), 5,400 searches
  per run, timed inside the database; acceptance by `perf-accept.ts --target 16 --p95 250` (unchanged).
- **Execution time per search (≈ CPU):** `pg_stat_statements` total execution time per call of the top-level search.
  It approximates CPU time because the database is CPU-bound here (100% cache hits, no reads, no temp files, one
  client). The breakdown per statement is from the nested statements.

## 3. Result equality and search quality (before vs after, same data)

**Direct comparison, every column of every row in order** (record and wine ids, names, match, verified, source,
provider and licence fields, vintages, score), old and new on the same database:

| Query set                                                                                                     | Queries | × configurations | Searches   | Identical  | Different |
| ------------------------------------------------------------------------------------------------------------- | ------- | ---------------- | ---------- | ---------- | --------- |
| Synthetic records as `perf.ts` builds them: prefixes 3/5/8, full, full + type and country, typo (300 each)    | 1,800   | 6                | 10,800     | 10,800     | 0         |
| Benchmark (`benchmark.json`): prefixes 3/5/8, full, full + filters, 2 typos per query, filter and other kinds | 1,567   | 6                | 9,402      | 9,402      | 0         |
| Ambiguous and common names ("chateau", "domaine", "reserva", "pinot noir", "riserva", "grand cru", …)         | 37      | 6                | 222        | 222        | 0         |
| Short inputs, filter combinations (region, invalid type or country), household wines, long inputs             | 37      | 6                | 222        | 222        | 0         |
| **Total**                                                                                                     | 3,441   | 6                | **20,646** | **20,646** | **0**     |

Configurations: people's scope (`public`) with limit 8, 20 and the default; pilot + public with limit 8, 20 and 1.
There is no difference to explain.

**`benchmark.ts --db`** (pilot search, the same implementation): the summary and all 247 entries identical before and
after (timings aside).

| Set                                    | Queries | With a covered record | Top-1 | Top-3 | Top-8 | Not found |
| -------------------------------------- | ------- | --------------------- | ----- | ----- | ----- | --------- |
| Sprint 004A set (exact and near names) | 127     | 95                    | 77    | 84    | 92    | 3         |
| All positive                           | 189     | 151                   | 129   | 139   | 147   | 4         |
| New positive                           | 62      | 56                    | 52    | 55    | 55    | 1         |
| Perturbations (typos)                  | 32      | 20                    | 16    | 16    | 17    | 3         |

Before = after for every row. Also unchanged: near twins (10, sibling offered first: 0), filters (6, rows contradicting
the filter: 0), adversarial (16: 5 not a search, 0 errors, 0 over the limit), provider records marked verified 0,
duplicate rows 0.

**`recognition.ts`** (scan readings against search): identical before and after; clean readings 96 of 101 suggested
first (97 in the top 3), misread 55 (56), producer only 29 (51); wrong automatic identities 0, safety violations 0.

**Wine identity:** `identity-pairs.json` drives the domain matcher (`catalog-identity.ts`), which this change does not
touch; its tests run in `pnpm test`. In search, only canonical wines are `verified` and `fuzzy` is never an identity:
pinned in the SQL test.

**SQL test** `supabase/tests/99_catalog_search_performance.test.sql`: the old implementation verbatim, and 1,155
searches on its own test data (55 queries × 21 configurations) must be identical; then the rules one by one (section 6).

## 4. Performance, locally (2 pinned cores)

### One client: execution time (≈ CPU) and buffers per search

`perf.ts`, one client, 5,400 searches, times inside the database (ms):

| State           | Version | p50  | p95  | mean | Exec time (≈ CPU) | Buffers per search |
| --------------- | ------- | ---- | ---- | ---- | ----------------- | ------------------ |
| A, clean        | old     | 22.2 | 38.3 | 22.4 | 22.2 ms           | 3,493              |
| A, clean        | new     | 13.5 | 26.2 | 13.2 | 13.1 ms           | 2,320              |
| B, after import | old     | 29.5 | 45.4 | 27.9 | 27.7 ms           | 4,552              |
| B, after import | new     | 11.9 | 25.2 | 12.3 | 12.2 ms           | 2,387              |

**Execution time (≈ CPU) saved per search: 9.1 ms (41%) on a clean index, 15.6 ms (56%) after an import.** Buffers: −34% and −48%.

Per bucket, p50 / p95 / mean (ms), same runs:

| Bucket       | A old              | A new              | B old              | B new              |
| ------------ | ------------------ | ------------------ | ------------------ | ------------------ |
| full         | 6.4 / 8.4 / 6.6    | 3.0 / 4.4 / 3.1    | 11.8 / 16.8 / 12.1 | 3.0 / 4.0 / 3.1    |
| prefix-3     | 21.8 / 30.1 / 22.8 | 14.7 / 22.7 / 15.7 | 23.3 / 33.1 / 24.4 | 12.5 / 19.1 / 13.6 |
| prefix-5     | 34.2 / 41.6 / 34.7 | 13.6 / 19.3 / 14.2 | 34.9 / 49.2 / 36.4 | 11.7 / 16.4 / 12.2 |
| prefix-8     | 33.3 / 42.2 / 29.2 | 13.3 / 19.4 / 12.2 | 34.5 / 49.1 / 33.5 | 11.3 / 16.9 / 10.7 |
| typo         | 17.0 / 27.9 / 16.6 | 13.5 / 25.8 / 13.3 | 27.4 / 43.0 / 26.2 | 13.8 / 24.8 / 13.4 |
| full+filters | 22.9 / 37.9 / 24.3 | 19.7 / 34.6 / 20.8 | 33.2 / 50.5 / 34.6 | 19.7 / 32.8 / 20.6 |

Execution time (≈ CPU) and buffers per search per bucket (`pg_stat_statements`, the same 300 synthetic records, one client):

| Bucket       | A old ms / buffers | A new ms / buffers | B old ms / buffers | B new ms / buffers |
| ------------ | ------------------ | ------------------ | ------------------ | ------------------ |
| full         | 5.7 / 733          | 2.6 / 596          | 10.4 / 1,714       | 2.9 / 647          |
| prefix-3     | 20.9 / 5,022       | 12.8 / 4,216       | 24.3 / 5,709       | 12.5 / 4,267       |
| prefix-5     | 32.4 / 6,878       | 11.3 / 3,674       | 35.9 / 7,565       | 11.0 / 3,725       |
| prefix-8     | 28.1 / 5,686       | 9.9 / 3,141        | 31.6 / 6,802       | 9.5 / 3,192        |
| typo         | 16.3 / 1,111       | 12.2 / 996         | 25.3 / 2,488       | 13.8 / 1,087       |
| full+filters | 24.2 / 1,523       | 19.0 / 1,292       | 33.2 / 3,027       | 20.0 / 1,396       |
| **all**      | **21.3 / 3,492**   | **11.3 / 2,319**   | **26.8 / 4,551**   | **11.6 / 2,386**   |

Planning per search fell from 1.2–2.4 ms to 0.13–0.2 ms. On the benchmark queries in the pilot search (X-Wines
visible): 8.8 → 5.8 ms execution time and 1,014 → 721 buffers per search.

**Where the time still goes (new, state A):** prefix searches: the LIKE candidate scan 6.9–10.0 ms (every substring
match is read from the table to keep the 400 shortest; a common 3–5 letter start matches 10,000–12,000 rows in this
data), scoring 2.4 ms; full + filters: the word-similarity scan 17.3 ms (the filters leave fewer than 8 regular
results, so typo tolerance fills the page, as before); typo: the word-similarity scan 13.5 ms when it runs. Both scans
are pg_trgm's own work in the GIN index and the table; what is left is the cost of the search's current behaviour.

### Concurrency (2 pinned cores)

`perf.ts --one-trip`, 5,400 searches; "executing" is measured inside PostgreSQL (`perf-accept.ts`):

| State | Version | Clients | Executing (mean, share ≥ 16) | p50 | p95 (at ≥ 16) | p99 | Throughput |
| ----- | ------- | ------- | ---------------------------- | --- | ------------- | --- | ---------- |
| A     | old     | 20      | 18.0, 95%                    | 210 | 376           | 421 | 86/s       |
| A     | old     | 32      | 28.9, 100%                   | 328 | 581           | 685 | 89/s       |
| A     | new     | 20      | 16.3, 71%                    | 113 | 238           | 309 | 155/s      |
| A     | new     | 24      | 19.8, 96%                    | 136 | 286           | 375 | 153/s      |
| A     | new     | 32      | 26.4, 98%                    | 193 | 394           | 537 | 142/s      |
| B     | old     | 20      | 18.5, 97%                    | 270 | 410           | 480 | 72/s       |
| B     | new     | 20      | 16.3, 70%                    | 104 | 249           | 325 | 160/s      |

Throughput on the same 2 cores: **1.8× (A) to 2.2× (B)**. The acceptance locally: the old search fails clearly; the new
search sits on the boundary (p95 238–249 ms with about 16 executing, but then fewer than 80% of the time at 16; with 20
executing p95 is 286 ms).

### Import cost of the 512 kB pending list

Importing 100,000 synthetic records (`perf-synthetic.sql` under another provider id) into copies of the same database:

| Trigram index setting             | Import time (two runs) | Pending list after |
| --------------------------------- | ---------------------- | ------------------ |
| default (4 MB)                    | 37.2 s, 36.2 s         | 327, 52 pages      |
| `gin_pending_list_limit = 512` kB | 36.8 s, 40.0 s         | 25, 25 pages       |
| `fastupdate = off`                | 52.5 s                 | 0                  |

The 512 kB limit costs between nothing and 10% of an import (within the run-to-run noise of a shared machine);
`fastupdate = off` costs 41%.

## 5. What is left for hardware: the model

**Model (processor sharing).** The search is CPU-bound, so with N searches executing on C cores (N ≥ C) each gets C/N of
a core: `p95(N, C) ≈ S95 × N / C × k`, where S95 is the one-client p95 and k the contention factor of the machine.

- **Locally k ≈ 1.1, calibrated** on two points (old at 18 executing: 38.3 × 9.0 × k = 376 ms gives k = 1.09; new at
  19.8 executing: 26.2 × 9.9 × k = 286 ms gives k = 1.10). **Checked against points not used for the fit**, with
  k = 1.10: old at 28.9 executing predicts 609 ms, measured 581 (−5%); new at 26.4 executing predicts 380 ms, measured
  394 (+4%); old at 14.5 executing predicts 305 ms, measured 296 (−3%); state B old at 18.5 executing predicts 461 ms,
  measured 410 (−11%); state B new at 16.3 executing predicts 225 ms, measured 249 (+11%). So about ±10%.
- **On staging k = 1.42, calibrated on its single point** (old at 25 executing: 117 × 12.5 × k = 2,079 ms). There is
  no second staging point to check it against. Shared vCPUs lose more to contention than the local cores.
- **Assumption:** the local ratio new/old carries over to staging. It is not proven: staging's one-client times were
  1.6–3.5× the local ones, unevenly per bucket (the trigram-heavy buckets full, typo and full+filters 3.0–3.5×, the
  prefix buckets 1.6–2.3×).

**Staging estimate after 0055 (not measured).** Scaling staging's one-client p95 (117 ms) by the local ratio new/old:
0.68 (state A) to 0.56 (state B) gives S95 ≈ 65–80 ms; the one-client mean 66 ms becomes about 29–39 ms (**about
27–37 ms of CPU saved per search** at staging's speed). Then, at 16 executing:

| vCPU (staging-like, k = 1.42) | p95 before (S95 117 ms) | p95 after (S95 65–80 ms) | S95 needed for p95 < 250 ms |
| ----------------------------- | ----------------------- | ------------------------ | --------------------------- |
| 2                             | ~1,330 ms               | ~740–910 ms              | ≤ 22 ms                     |
| 4                             | ~665 ms                 | ~370–455 ms              | ≤ 44 ms                     |
| 8                             | ~330 ms                 | ~185–225 ms              | ≤ 88 ms                     |

| Cores (local-like, k = 1.1) | p95 before (S95 38–45 ms) | p95 after (S95 25–26 ms) |
| --------------------------- | ------------------------- | ------------------------ |
| 2                           | ~335–400 ms               | ~220–230 ms              |
| 4                           | ~170–200 ms               | ~110–115 ms              |
| 8                           | ~85–100 ms                | ~55–58 ms                |

**Reading it:** 0055 removes 41–56% of the execution time (≈ CPU) per search with identical answers. On 2 shared vCPUs that is not
enough: the search would still need to be about 3× cheaper again (S95 ≤ 22 ms at staging's speed), which the current
behaviour does not allow (the remaining cost is the trigram scans of the substring and typo matching it promises). By
the model, 16 concurrent searches under 250 ms p95 need about 8 vCPU of staging's kind (before 0055: about 12–16);
on 2 cores of the local kind the new search is at the boundary, as measured (section 4). The model is calibrated on 2 cores only; 4 and 8 are extrapolations,
and the staging rows are scaled, not measured.

**The pending list on staging (inference, not verified).** The staging plan of one search read 533 index buffers in the
LIKE scan and about 950 in the word-similarity branch; the same scans read 88 and 241 here on a clean index. The
difference, about 450 pages each, matches a pending list near its 4 MB limit at that moment; the buffers per search
of the perf16 run itself (3,715) fit a shorter list. Either way the 512 kB limit caps it at 64 pages, and a vacuum
after an import empties it.

## 6. Tests

`supabase/tests/99_catalog_search_performance.test.sql` (in `pnpm db:test`):

- the same answers as 0042 for 1,155 searches (the old implementation is in the test, verbatim);
- typo tolerance next to a few regular results, and not when the page is full; the boundary (exactly as many regular
  results as the limit: none; one fewer: the near-miss is offered and ranks first); fewer than 4 letters: no typo
  tolerance;
- the scope rule inside the typo scan: 450 pilot records exactly as close to a typo as one public record, and indexed
  before it, do not push it out;
- a score tie between two aliases of one wine: the alias indexed first is shown;
- scopes: 450 shorter pilot records neither shown to people nor pushing the public record out; a switched-off source
  never shown; the pilot search sees pilot records;
- households: 450 look-alikes of another household never shown; another household's id finds nothing;
- a verified link hides the record behind its catalogue wine; only canonical wines verified; vintages, attribution,
  licence, scope and "modified" on a record; owned bottles first; aliases;
- filters (type, country, region), invalid filters, limits (1–20, default 10), the query cut at 8 words and 80
  characters, ties in name order, determinism;
- anonymous callers refused; no API role on the implementation; the result columns of people's search, the pilot search
  and the implementation; `SECURITY DEFINER`, `STABLE`, `search_path ''`, threshold 0.6, `plan_cache_mode`; the
  index's pending-list limit.

Each of the last three cases was checked to fail when its rule is broken in the implementation (the scope rule
removed from the typo scan; `<` turned into `<=` at the page-full test; the tie-break reversed). The suite also passes
as a non-superuser owning the search function in a fresh session (the Supabase stack's `postgres`), where the
migration and the test without their pg_trgm preamble fail with "permission denied to set parameter".

## 7. Not done, not verified

- No staging or production run. The staging rows of section 5 are an estimate by the model above.
- PostgreSQL 16 (the test suite) and 17 (the measurements) only.
- The generic plans were checked on this data; on a very different table (e.g. one source of millions of records) the
  word-similarity scan's generic plan should be checked again with `auto_explain` (it uses the trigram index here).
