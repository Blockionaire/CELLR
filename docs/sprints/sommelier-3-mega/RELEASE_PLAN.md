# Sommelier 3.0 — release plan

Final version, S8, 2026-11-20. **Nothing here has been done.** Every step is the owner's to authorise: the agent
did not merge, deploy, apply a migration or change a setting, and will not.

## 0. Before anything is merged

| Check                                                                                | Why                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CELLR_FEATURES` in Production and Preview names none of the five sommelier switches | `all` turns none of them on (tested), so only a name can; make sure no name is there (R-02)                                                                                                                                                                                 |
| Pull request #88 (migration `20261124000047`): merged and applied first, or not?     | This work's 0051 and 0052 come after it. If #88 will not go first, rename 0051 and 0052 **in pull requests #94 and #97 before merging them**: once a migration is on `main`, CI forbids renaming it, and the CLI refuses a version older than the newest one applied (R-03) |
| Read `FINAL_REPORT.md` §6                                                            | The few things that change with every switch off                                                                                                                                                                                                                            |

## 1. Merge (switches off)

Order: #90 → #91 → #93 → #94 → #95 → #97 → the S8 pull request. Each is safe alone: new behaviour is behind
switches that are off. When a base branch is merged and deleted, GitHub retargets the next pull request to `main`.

From the moment #94 is on `main`, migration 0051 is in `supabase/migrations`; from #97, 0052. **A `db push` from
`main` after that applies them.** That is a release step of its own (§2), not a side effect to let happen.

CI runs the browser tests on pushes to `main` only: the first run of `sommelier-plan.spec.ts` in CI is after the
merge. It adds a fourth server to that job; watch its duration.

## 2. Migrations

With the procedure of `docs/MIGRATIONS.md`, when the owner decides, each right before the switch that needs it:

| Migration                               | Needed by                                                     | What applying it makes live, whatever the app's switches say (R-14)                                                                                                                                                           |
| --------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20261129000051_social_sommelier.sql`   | `sommelier_social`                                            | A signed-in person can set their own consent (off by default) and ask about their own accepted friends; taste signals come back only for a friend who turned their consent on                                                 |
| `20261130000052_sommelier_learning.sql` | `sommelier_learning`, the admin report, plan codes on ratings | A signed-in person can record their own outcome for a bottle their own kept plan offered (no plan is kept while the engine is off). It also replaces `sommelier_set_feedback` (same checks and grants, plus the plan's codes) |

Both are additive. With a switch on and its migration missing, the app fails closed: no button, a 404, or the
answer "nothing", never a 500 (tested or reviewed for both).

## 3. Switches, in Preview first, one step at a time

| Step | Name                                          | Needs                                      | Note                                                                              |
| ---- | --------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------- |
| 1    | `sommelier_engine` **and** `sommelier_buying` | nothing                                    | Together: with the engine alone, V1's buy list is dropped and nothing replaces it |
| 2    | `sommelier_experiences`                       | step 1                                     | Serving, keeping, wine-to-food, menus, quantities                                 |
| 3    | `sommelier_learning`                          | step 1, 0052                               | Outcome buttons; `/admin/sommelier` starts to fill                                |
| 4    | `sommelier_social`                            | step 1, 0051, the approved consent wording | Last: it is the one that touches other people's data                              |

Each of the last four does nothing without `sommelier_engine` (tested).

## 4. Before a switch is on in Production

| Check                                                                                                                           | Why                                                                     | State   |
| ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------- |
| A wine professional reviews the food and wine knowledge and the benchmark labels, or the owner accepts them as a labelled trial | R-01, R-11: AI-written, `reviewed: false`; four thresholds missed       | open    |
| An AI key in a test environment, to run the benchmark through V1's AI path (about 250 calls)                                    | R-04: "better than today" is unproven                                   | open    |
| Consent wording for using a friend's taste in a friend's sommelier                                                              | A privacy default the owner must approve (D-08, D-15)                   | open    |
| Alcohol marketing and age rules for buying advice (NL: no targeting of minors; STIVA code)                                      | R-07                                                                    | open    |
| A retailer source with a licence, before any live offer                                                                         | R-05: without it buying advice stays at "style", and the screen says so | blocked |
| A person looks at the screens on a phone, and someone uses a screen reader on them                                              | Accessibility is machine-checked only                                   | open    |
| Decide on issue #76 with the query in `COST_REPORT.md`                                                                          | D-25                                                                    | open    |

## 5. What to watch once a switch is on

`/admin/sommelier`: the share answered by the engines (model cost falls with it), thumbs by outcome and confidence
(a "good, high confidence" answer that is rated down is the first place to look), outcomes ("with the dish: not
well" on a "good" pairing points at a rule). Small numbers prove nothing (R-13). Errors of the sommelier route in
the platform's own logs.

## 6. Rollback

Remove the switch from `CELLR_FEATURES` and redeploy: V1 answers again. Conversations kept by the engines still
open (a kept plan is drawn as it was; the outcome buttons disappear). The migrations stay: they are additive,
and nothing reads their tables with the switches off.
