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

| Path                                                                                   |                                                           Model calls |       Tokens | Latency of the engine's own work (p50 / p95) | Source                                      |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------: | -----------: | -------------------------------------------- | ------------------------------------------- |
| V1 without AI (`v1-basic`)                                                             |                                                                     0 |            0 | 0.7 ms / 2.7 ms                              | `BASELINE.md` §3                            |
| V1 with AI                                                                             |                                                                     1 | not measured | not measured                                 | needs the owner's key                       |
| Sommelier 3.0 engines alone (`v3-engines`), pairing                                    |                                                                     0 |            0 | 0.3 ms / 0.8 ms (S2 run)                     | `progress/S2.md`                            |
| Sommelier 3.0 in the app (`v3-app`): pairing, buying, menu, serving, keeping, quantity |                                                                     0 |            0 | 1.9 ms / 4.4 ms                              | `results/s6-v3-app.json`, run of 2026-11-20 |
| Sommelier 3.0, a general question about wine                                           | 1 (the V1 call, with any name taken out when the social switch is on) | not measured | not measured                                 | needs the owner's key                       |

The engines' latency is their own work on this machine: no database, network or model time is in it. In the app a
question also costs the reads it always cost (the cellar, the profiles, the taste) and one rate-limit check.

## What the engines change about cost

Over the 222 benchmark scenarios the app's engines can attempt, **0 model calls** were made. In V1 every question
that is not a counted fact costs one model call carrying up to 120 wines. So with the switches on, the model's
cost falls to the share of questions that are general questions about wine. That share is not known: it is what
`/admin/sommelier` ("By the engines") will show once the switches are on for real people.

No number for money saved is given here: V1's cost per AI question was never measured (no key), and a saving
computed from an unmeasured number would be invented.

## The duplicate model call (#76)

Two identical requests at the same moment can both call the model (V1, accepted then). Not fixed in this work
(`DECISIONS.md` D-25). To decide, the owner can run this on production (read-only; it returns one number):

```sql
select count(*) as double_sends_30d
  from public.ai_usage a
  join public.ai_usage b
    on b.user_id = a.user_id and b.task = a.task and b.id > a.id
   and b.at - a.at < interval '2 seconds'
 where a.task = 'sommelier_chat' and a.at > now() - interval '30 days';
```

Zero or a handful: leave it. A steady number: build the claim table the issue describes.

## Infrastructure

No new infrastructure. No new dependency in the app; the benchmark package uses `tsx`, which the repository already
has.
