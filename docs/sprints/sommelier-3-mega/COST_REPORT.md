# Sommelier 3.0 — cost report

Only measured numbers. A line that could not be measured says so.

## AI spend by this work

| Item                                            | Calls | Cost |
| ----------------------------------------------- | ----: | ---: |
| Model calls made by the agent for evaluation    |     0 |   $0 |
| Model calls made by the benchmark (all engines) |     0 |   $0 |

No model key is available to this work (RISK R-04). Sub-agents of the development environment wrote data and
reviews; that is development tooling, not product AI spend, and nothing of it runs in the app.

## Per question

| Path                       | Model calls |       Tokens | Latency of the engine's own work (p50 / p95) | Source                |
| -------------------------- | ----------: | -----------: | -------------------------------------------- | --------------------- |
| V1 without AI (`v1-basic`) |           0 |            0 | 0.7 ms / 2.7 ms                              | `BASELINE.md` §3      |
| V1 with AI                 |           1 | not measured | not measured                                 | needs the owner's key |

Later phases add their rows here as they are measured.

## Infrastructure

No new infrastructure. No new dependency in the app; the benchmark package uses `tsx`, which the repository already
has.
