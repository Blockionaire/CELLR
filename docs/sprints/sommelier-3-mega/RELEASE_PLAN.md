# Sommelier 3.0 — release plan (draft, grows per phase)

Nothing here has been released. Every step below is the owner's to authorise; the agent does not merge, deploy,
push a migration or change a setting. The final version of this plan is written in S8.

## Order

1. PR #88 (system monitoring) first: it adds migration `20261124000047`. This work's migrations are numbered after
   it, at merge time, and follow `docs/MIGRATIONS.md`.
2. The pull requests of this work merge in chain order (S0 → S8). Each is safe on its own: new behaviour sits behind
   switches that are off unless `CELLR_FEATURES` names them.
3. Migrations (S5 consent and friend context; S7 outcomes) are released with the procedure of `docs/MIGRATIONS.md`,
   before the switch that needs them is turned on. With the migration missing, the code fails closed.
4. Switches are turned on one at a time, in Preview first: `sommelier_engine`, then `sommelier_buying`,
   `sommelier_experiences`, and `sommelier_social` last.

## Owner checks before any switch is on in Production

| Check                                                                                              | Why                                                            | State     |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | --------- |
| `CELLR_FEATURES` is not `all` in Production or Preview                                             | `all` would enable every new switch at once (R-02)             | to verify |
| A wine professional reviews the food knowledge and the benchmark labels, or accepts them as drafts | R-01: the knowledge is AI-written and marked `reviewed: false` | open      |
| An AI key in a test environment, to measure V1 and V3 with a model                                 | R-04: no model call has been measured                          | open      |
| Alcohol marketing and age rules for buying advice (NL: no targeting of minors; STIVA code)         | R-07                                                           | open      |
| A retailer source with a licence, before any live offer is shown                                   | R-05: without it, buying advice stays at "style"               | blocked   |
| Consent wording for using a friend's taste in AI answers                                           | D-08, D-15: a privacy default the owner must approve           | open (S5) |

## Rollback

Remove the switch from `CELLR_FEATURES`: V1 answers again, unchanged. Stored answers keep V1's kinds and shapes, so
conversations written by the new engine still open (review finding 8).
