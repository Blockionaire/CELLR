# Search under load: the concurrency ladder and a proposed release gate

**What this is.** The owner's decision of 2026-11-28: `perf16` (people's search with 16 searches executing at once, SQL
p95 under 250 ms) stays the **growth target**, unchanged. The first go-live gets a separate, measured **release gate**.
The owner prefers SQL p95 under 250 ms with at least 4 concurrent searches, and would accept 8. This page covers the
method (`scripts/catalog-tools/ladder.ts`, staging mode `perf-ladder`), the query mix, how representative it is, the
local results, and how to run it on staging.

**The gate below is a proposal.** It is reported by every run and enforced by none, until the owner approves it. Only
then is it recorded in `ACTIVATION.md`. **Nothing here was measured on staging.** Every number is from a local
database built like staging; the staging figures are a prediction (section 5).

## 1. Method

| What              | How                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Search            | `public.catalog_search_pilot` as the service role (pilot and staging databases only). It runs the same `private.catalog_search_impl` as people's `public.catalog_search`, over the scopes pilot + public, so on staging it searches the **100,646 real X-Wines records** (pilot there). The people's path (`--path public`) runs `public.catalog_search` with each household member's claims. Limit 8, as the autocomplete.                                                                                                                                                                                                                                                                          |
| Read-only         | Every message is `begin transaction read only`, with the role and a 15 s statement timeout set for that transaction only (as PostgREST does per request), and ends with `commit`. The inputs (households, members, records) are read the same way. The staging mode reads the database state before and after and requires the two to be equal. Locally the run changed no tuple: `n_tup_ins + n_tup_upd + n_tup_del` over all tables was the same before and after the ladders.                                                                                                                                                                                                                     |
| Levels            | N = 1, 2, 4, 8, 16. Per level, **exactly N clients in a closed loop**: each client sends its next message once the previous one has returned, with no think time. The searches are cut into messages and the clients take them from one shared queue, so the level ends together. Fixed counts per level (default 1,000 / 2,000 / 4,000 / 4,000 / 4,000) and a 150-search warm-up that is not counted.                                                                                                                                                                                                                                                                                               |
| Batching          | A message holds `batch` searches in one read-only transaction, each between two readings of the server's clock. From GitHub's runner the round trip to the staging region is about 150 ms (staging run 46166107062), roughly three times a search. With one search per round trip, N clients would keep only about N/4 searches executing, and a level would be judged at a quarter of its concurrency. `--batch auto` picks, per level and from its warm-up, enough searches per message that the round trip leaves each backend idle at most 2% of the time (1 to 200, and at most searches / (8 × N), so every client sends at least 8 messages). This is checked, not assumed: see the next row. |
| Concurrency       | **Measured in PostgreSQL**, as for perf16. Each search records `clock_timestamp()` before and after itself and its `pg_backend_pid()`. The overlap of those intervals (`perf-accept.ts` `concurrencyOf`, `overlapOf`) gives the peak, median, time-weighted mean, the share of the steady state (the window without its first and last 10%) with N executing, and the number of backends. A sampler reads `pg_stat_activity` every 50 ms on its own session connection, as a cross-check. A whole message counts as active there, so it is an upper bound. The sampler also counts any other active client backend, so a foreign workload would show.                                                |
| SQL time          | The server's clock around each search: the time PostgreSQL took for that search, including its share of the CPU at that concurrency.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Client time       | Each search's SQL time plus its message's overhead. The overhead is the message's round trip at the client minus the SQL time of its searches: network, pooler, begin, role, commit. That is the client's round trip exactly when the batch is 1, and with a batch, what one search would take as its own request. On staging it includes the runner's round trip to eu-central-1 (about 150 ms), which the app (server-side, near the database) does not pay.                                                                                                                                                                                                                                       |
| Resources         | `pg_stat_statements` for the search (calls, execution ms, shared blocks, cache hit, temp blocks) and `pg_stat_database` (transactions, blocks, temp bytes), before and after each level (`perf.ts` `snapshot`, now with the pattern of the path measured). The tool waits 1.5 s before the second reading: a backend flushes its database counters at most once a second.                                                                                                                                                                                                                                                                                                                            |
| Valid measurement | The **exit code** follows these checks only. Per level: exactly N clients; no failed search, warm-up included (a failure is counted by its SQLSTATE; every search of a failed message counts as failed); at least 600 searches at 1, 1,000 at 2, and 1,500 from 4 on; N executing in PostgreSQL (peak N, at least N backends, time-weighted mean at least 85% of N). Fail-closed: a missing value fails.                                                                                                                                                                                                                                                                                             |
| Reports           | `ladder-c<N>.json` per level and `ladder-summary.json`. They hold counts and timings only: no query text, no record, no household id, and failures by SQLSTATE, never by message (a message can quote the query). Tested, and kept by `redact-results.ts` by name only.                                                                                                                                                                                                                                                                                                                                                                                                                              |

## 2. The query mix

The queries are built in memory from real records of the provider (X-Wines: 40,000 read read-only, in a deterministic
random order) and the wines of `eval/catalog/benchmark.json`. They are typed as a person would: lower case, no accents
or punctuation, at most six words. Every search is for a household picked at random from all 201 seeded households
(`seed-load.sql`, read read-only), so the household parts of the search (own wines, owned bottles) vary.

| Kind (bucket)                | Share | Why                                                                                                                                                                                                                                        |
| ---------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `prefix-3`                   | 15%   | With a 250 ms debounce, a person typing a wine at a normal pace sends a few intermediate prefixes and then the whole query. The 3-character prefix is the widest candidate set.                                                            |
| `prefix-5`                   | 15%   | The same, two letters further.                                                                                                                                                                                                             |
| `prefix-8`                   | 15%   | The same, the first word nearly complete.                                                                                                                                                                                                  |
| `full`                       | 20%   | The finished query: "producer wine", or the benchmark's own query text. The most common finished search.                                                                                                                                   |
| `producer`                   | 10%   | Producer only.                                                                                                                                                                                                                             |
| `typo`                       | 10%   | The full query with two neighbouring letters swapped or one letter dropped, in the middle. This exercises the typo tolerance (word similarity).                                                                                            |
| `filtered`                   | 10%   | The full query or the producer, with type and country, type only, or country only (rotating).                                                                                                                                              |
| **Repetition**               |       |                                                                                                                                                                                                                                            |
| `hot` (30% of the stream)    | 30%   | A hot set of 30 queries (popular wines from the benchmark, the same mix of kinds), reused across households: what many people type.                                                                                                        |
| `unique` (70% of the stream) | 70%   | Never repeated anywhere in the run (warm-ups and all levels included), and never one of the hot set, so no unique query benefits from an earlier identical one. The tool refuses to run, rather than repeat one, when the sources run out. |

The shares are exact per level: quotas by largest remainder, then a deterministic shuffle (`--seed`). Every result is
reported per kind and per repetition.

**Not in the mix:** searches for a household's own synthetic cellar names. Own wines are part of every search's
candidates; a query that matches them (`chateau`, say) finds them.

## 3. How representative it is

- **Production-like catalogue:** the 100,646 real X-Wines records, through the same implementation as people's
  search, with a realistic query stream over many households.
- **Pessimistic on index size:** staging's search index also holds the 100,000 synthetic `perf_synth` records
  (scope off, so never returned, but in the trigram and prefix indexes). Production will not have them. The local
  database has them too.
- **The people's wrapper is not exercised on staging.** `public.catalog_search` adds a membership check
  (`private.my_household_ids()`, from the claims) and scope public only. Its extra cost was measured locally (section
  4.3): it is below the run-to-run noise.
- **Left out:** PostgREST and the app server; a cold cache (the database is warmed and fits in memory: 100% cache hits,
  no temp files); concurrent writes (imports, cellar edits). On staging the sampler would show other active backends.
- **Client time on staging is the runner's**, round trip to eu-central-1 included. The SQL time is the gate's measure.

## 4. Local results

**Set-up**, like staging's Micro compute: PostgreSQL 17 pinned to cores 0–1 (`taskset -c 0,1`), `shared_buffers`
256 MB, `max_connections` 60, `pg_stat_statements`. All migrations including 0055, `seed-load.sql` (201 households,
10,300 own wines), the X-Wines file imported as pilot, `perf-synthetic.sql` (100,000 records) then switched off as on
staging, `vacuum analyze`. **The load generator ran on the same cores 0–1** (cores 2–3 were taken by other work). Its
own CPU was 1–4% of one core (reported per level as `client_cpu_percent`). Direct connection (no pooler), so
`--batch auto` chose 3–23 searches per message.

### 4.1 The ladder (pilot path, `--batch auto`, two seeds)

Run C (seed 2026) and run D (seed 2027). Every level was a valid measurement: 0 errors, the concurrency reached.

| N   | searches | SQL p50 (C / D) | SQL p95         | SQL p99     | SQL max       | SQL mean    | client p95    | per s     | in PostgreSQL: peak · median · mean · steady at N | backends |
| --- | -------- | --------------- | --------------- | ----------- | ------------- | ----------- | ------------- | --------- | ------------------------------------------------- | -------- |
| 1   | 1,000    | 2.7 / 2.7 ms    | 17.7 / 17.8     | 24.8 / 27.0 | 95 / 96       | 5.2 / 5.3   | 18.6 / 19.2   | 187 / 186 | 1 · 1 · 0.98 · 98%                                | 1        |
| 2   | 2,000    | 3.9 / 3.6       | 20.8 / 20.3     | 32.4 / 36.3 | 152 / 143     | 6.6 / 6.2   | 21.3 / 21.1   | 299 / 313 | 2 · 2 · 1.97 · 97%                                | 2        |
| 4   | 4,000    | 6.1 / 7.2       | **43.3 / 38.9** | 70.9 / 57.4 | 379 / 207     | 12.2 / 11.7 | 46.4 / 42.5   | 304 / 336 | 4 · 4 · 3.70–3.92 · 74–93%                        | 4        |
| 8   | 4,000    | 14.9 / 15.0     | **79.2 / 81.2** | 118 / 131   | 391 / 434     | 23.2 / 24.6 | 87.9 / 90.0   | 330 / 314 | 8 · 8 · 7.67–7.73 · 74–79%                        | 8        |
| 16  | 4,000    | 31.5 / 31.3     | 162.3 / 163.1   | 229 / 231   | 1,087 / 1,316 | 49.2 / 50.4 | 183.5 / 188.3 | 313 / 304 | 16 · 16 · 15.3–15.4 · 68–78%                      | 16       |

The sampler agreed (mean active 1.0, 1.9, 3.7–3.9, 7.7, 15.4; no other active backend). Throughput saturates at
about 300–335 searches/s from N = 2: both cores are busy, and each step up in N roughly doubles the latency. This is
processor sharing, as in `PERF-OPTIMISATION.md` section 5.

**Resources per search** (run C, `pg_stat_statements`): execution 5.1 / 6.5 / 12.0 / 22.9 / 48.3 ms at N = 1 / 2 / 4
/ 8 / 16, about 560–690 shared blocks, 100% cache hits, 0 temp blocks; `pg_stat_database` 0 blocks read, 0 temp bytes.

**Per bucket** (SQL p50 / p95 ms, run C; run D within a few ms):

| Bucket   | c1         | c2          | c4          | c8          | c16          |
| -------- | ---------- | ----------- | ----------- | ----------- | ------------ |
| prefix-3 | 4.7 / 21.5 | 4.4 / 20.5  | 5.9 / 26.9  | 13.8 / 81.0 | 29.7 / 165.9 |
| prefix-5 | 1.3 / 14.3 | 1.7 / 14.0  | 1.8 / 26.0  | 2.2 / 53.6  | 20.5 / 123.9 |
| prefix-8 | 1.1 / 5.2  | 1.1 / 6.4   | 1.2 / 13.5  | 1.2 / 20.3  | 1.6 / 39.1   |
| full     | 6.1 / 21.2 | 10.2 / 25.8 | 17.3 / 55.1 | 35.3 / 96.0 | 74.7 / 190.5 |
| producer | 1.1 / 4.8  | 1.5 / 17.7  | 1.7 / 18.4  | 1.7 / 46.0  | 2.7 / 71.0   |
| typo     | 4.0 / 13.8 | 6.2 / 19.3  | 13.1 / 39.3 | 29.3 / 74.8 | 61.9 / 159.0 |
| filtered | 2.9 / 23.1 | 6.3 / 24.5  | 12.1 / 59.1 | 29.1 / 98.3 | 57.3 / 207.3 |
| hot      | 3.2 / 22.1 | 3.3 / 21.8  | 5.3 / 47.3  | 15.0 / 89.1 | 31.4 / 187.8 |
| unique   | 2.5 / 14.5 | 4.2 / 19.4  | 6.5 / 39.1  | 14.9 / 71.0 | 31.5 / 158.1 |

`full`, `typo` and `filtered` (the trigram and word-similarity scans) are the expensive kinds. Prefixes of 5 and 8
characters and producer names are about 1 ms at the median. The hot set is no cheaper than the unique queries: it
holds the widest queries (popular names, `cha`). About 1% of searches return nothing.

### 4.2 Why batching: the same ladder with one search per message

With `--batch 1`, the client between two messages (on the same two cores) left PostgreSQL short of N. The time-weighted
mean was 3.3 at 4, 6.1 at 8 and 11.6 at 16. The run is **not valid** and exits 1, by design. Its SQL p95 (39.8 / 74.1
/ 146.6 ms at 4 / 8 / 16) is lower than the batched run's at 8 and 16, because fewer searches were really executing.
At 1 and 2, where both reach N, the two agree: p95 19.2 vs 17.7 ms and 22.5 vs 20.8 ms. So batching does not change a
search's SQL time; it only keeps the concurrency the level claims.

### 4.3 The people's wrapper: pilot path against people's path

On the **same visible records** (locally only: X-Wines switched to public for the comparison and back to pilot after,
synthetic source off, a member added to each local household), with the same queries and households (seed 2026), batch
8, alternating A–B–A–B:

| N   | pilot SQL mean / p95 (A, B) | people's SQL mean / p95 (A, B) | people's − pilot, mean (A, B) | shared blocks per search (pilot / people's) |
| --- | --------------------------- | ------------------------------ | ----------------------------- | ------------------------------------------- |
| 1   | 5.9 / 19.5, 6.4 / 21.2 ms   | 6.3 / 21.2, 6.1 / 20.1 ms      | +0.4, −0.3 ms                 | 681.0 / 680.0                               |
| 4   | 12.9 / 42.1, 14.5 / 47.9    | 13.8 / 45.8, 13.3 / 42.6       | +0.9, −1.2                    | 636.0 / 635.0                               |
| 8   | 24.5 / 81.1, 26.6 / 88.6    | 26.7 / 91.4, 24.4 / 81.4       | +2.2, −2.2                    | 584.2 / 583.2                               |

The wrapper's extra cost is **below the run-to-run noise**: about ±0.4 ms at 1, ±2 ms at 8, with the sign changing
between pairs. The answers matched in size (the same number of empty results), and the people's path read one shared
block fewer per search (its membership check replaces the pilot's household lookup). So the pilot path on staging is
a fair stand-in for people's search, to within a few percent.

## 5. Predicted staging numbers (a model, not a measurement)

**Model** (from `PERF-OPTIMISATION.md` section 5): the search is CPU-bound. Staging's one-client times were 2–3.7× the
local ones in earlier runs (1.6–2.3× for the prefix buckets, 3.0–3.5× for the trigram-heavy ones; with perf16's query
set: about 13 ms locally against 48 ms on staging, mean at one client). Under contention, staging's shared vCPUs lose
more than the local cores (contention factor k = 1.42 on staging against 1.1 locally, each calibrated on one or two
points). So: staging p95(1) ≈ local p95(1) × r, and staging p95(N ≥ 2) ≈ local p95(N) × r × 1.29, with r = 2 to 3.7.

| N   | local SQL p95 (C, D) | predicted staging SQL p95 | against 250 ms            |
| --- | -------------------- | ------------------------- | ------------------------- |
| 1   | 17.7–17.8 ms         | ~35–66 ms                 | under                     |
| 2   | 20.3–20.8            | ~52–99                    | under                     |
| 4   | 38.9–43.3            | **~100–207**              | under (the proposal)      |
| 8   | 79.2–81.2            | **~205–388**              | at or over (the fallback) |
| 16  | 162–163              | ~420–780                  | over (perf16's gap)       |

Predicted staging client time: SQL plus about 150 ms (the runner's round trip). Predicted throughput: about 65–130
searches/s. **The run's duration on staging**: about 15,000 measured searches plus 750 warm-up, so roughly 3–8
minutes, well within the step's 75 minutes and the 35 minutes asked for.

**Reading it:** if the model holds, the proposal (250 ms at 4) passes on staging's Micro compute with some margin, and 8
is at the boundary. The staging run decides. The model is the weak part: r and k come from few points, the mix here is
cheaper per search than perf16's set (local mean 5.2 ms against about 13 ms), and shared vCPUs can be throttled under
sustained load (not verified).

## 6. The proposed release gate (pending the owner's approval)

> **release gate (proposal): SQL p95 < 250 ms at 4 concurrent; at 8 reported**

- Judged on the SQL p95 of all measured searches of the level, and only when that level's measurement is valid (no
  error, N executing in PostgreSQL, enough searches). Otherwise the verdict is "not measured".
- The thresholds are parameters (`--gate-p95`, `--gate-level`, `--gate-report`; in the workflow the defaults 250, 4 and
  8).
- **Reported, not enforced:** the run's exit code fails only when the measurement is not valid, never because of the
  gate. Enforcing it, or choosing 8 instead of 4, is the owner's decision. After approval it is recorded in
  `ACTIVATION.md`.
- perf16 (16 at once, SQL p95 under 250 ms, `perf-accept.ts`) is unchanged and stays the growth target.

## 7. How to run it

**Locally** (a database built as in section 4):

```bash
cd scripts/catalog-tools
taskset -c 0,1 pnpm exec tsx ladder.ts run --db "postgresql://postgres@127.0.0.1:<port>/postgres?sslmode=disable" \
  --set ../../eval/catalog/benchmark.json --out-dir <dir>            # add --path public for the people's path
pnpm exec tsx ladder.ts judge --summary <dir>/ladder-summary.json    # the same verdict from the summary
```

**On staging:** Actions → _Staging catalogue (manual)_ → Run workflow on `main`, mode **perf-ladder**, with the
project ref typed, then approve. The run (staging-pilot.sh `perf-ladder`), in order:

1. The guard and the staging check.
2. X-Wines must hold 100,646 active records.
3. The state is read: X-Wines must be pilot, and the synthetic source must not be shown.
4. The pool probe: N server connections at once.
5. `ladder.ts run` with `--path pilot --batch auto`.
6. The state again, which must be equal.
7. `ladder.ts judge`.
8. The staging check again.

Nothing is made public and nothing is written. If perf16 left the synthetic source public, the run refuses: run
`perf16-cleanup` first. Variables (optional, in the run's environment): `LADDER_LEVELS`, `LADDER_BATCH`,
`LADDER_GATE_P95`, `LADDER_GATE_LEVEL`, `LADDER_GATE_REPORT`. Artifacts: `ladder-c<N>.json`, `ladder-summary.json`,
`ladder-state-before/after.json`, `pool-probe.json` and the staging checks, counts and timings only.

## 8. Not verified

- Nothing on staging: the predicted numbers are a model (section 5).
- The transaction pooler's behaviour with long read-only transactions of up to 200 searches (it holds the server
  connection for the message; the pool probe checks that N connections are available).
- Whether staging's shared vCPUs are throttled under several minutes of sustained load.
- PostgREST, the app server and its network to the database are outside the measurement.
