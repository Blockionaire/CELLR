# Sommelier — cost report

Only measured numbers. A line that could not be measured says so. Paid evaluation runs need the owner's budget
approval (D-51); none has been made for V1+.

## AI spend on evaluation

| Run                                                  | Date       | Approval                  | Calls |      Cost | Source (branch, file)                                                               |
| ---------------------------------------------------- | ---------- | ------------------------- | ----: | --------: | ----------------------------------------------------------------------------------- |
| S0–S8: benchmark of the engines and V1 without AI    | 2026-11-19 | –                         |     0 |        $0 | `results/baseline-v1-basic.json`, `s2-*`, `s4-*` (on `main`)                        |
| S9: V1 with AI against Sommelier 3.0, 5 runs per set | 2026-11-20 | owner (S9)                | 1,095 |   $0.0961 | S9 branch (#100), `docs/sprints/sommelier-3-mega/results/s9-ai-comparison.json`     |
| S10: V1 with AI (A) against variants B, C and D      | 2026-11-20 | owner, at most $2         | 2,687 |   $0.2618 | S10 branch (#104), `docs/sprints/sommelier-3-mega/results/s10-paid-comparison.json` |
| **V1+ (P2 onwards)**                                 | –          | **pending** (proposed $3) |     0 |        $0 | –                                                                                   |
| **Total so far**                                     |            |                           | 3,782 | **$0.36** |                                                                                     |

All runs sent only made-up benchmark cellars and questions; no person's data. The model was `gpt-6-luna`, reasoning
`none`, called through the app's own sommelier service and provider. The result files are on the unmerged branches
and are ported to `main` in P2.

## Per question

| Path                                        |       Model calls | Cost per answer                           | Latency (p50 / p95)                             | Source                                           |
| ------------------------------------------- | ----------------: | ----------------------------------------- | ----------------------------------------------- | ------------------------------------------------ |
| V1 without AI (`v1-basic`)                  |                 0 | $0                                        | 0.7 ms / 2.7 ms (code only)                     | `BASELINE.md` §3                                 |
| V1 with AI                                  |                 1 | about $0.00009 (S9 mean: $0.0961 / 1,095) | 1.5–1.9 s / 2.2–2.9 s, across 3 sets and 5 runs | S9 result file, `latency_ms_p50_p95` per run     |
| Engines' plan (dormant on `main`)           |                 0 | $0                                        | p95 about 4–8 ms (code only)                    | S8 report (#98); a local re-run in the S11 audit |
| V1+ parts `check`, `annotate`, `quantities` | 0 extra (planned) | not measured yet                          | not measured yet                                | measured in P3–P5                                |

The first run of each S9 set cost about 2–3× the later ones ($0.0233 against $0.0085 on the main set): the later runs
reused the provider's prompt cache. A cost estimate therefore takes the first-run price.

## Infrastructure

No new infrastructure. No new dependency in the app. The benchmark package uses `tsx`, which the repository already
has.
