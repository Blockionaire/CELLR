# Sommelier 3.0 — release plan

Updated in S9, 2026-11-20. **Nothing here has been done.** Every step is the owner's to authorise: the agent
did not merge, deploy, apply a migration or change a setting, and will not.

**The verdict in two lines** (the reasons are in §7): merging the stack with every switch off is a **GO**;
switching anything on for real users is a **NO-GO** for now.

State of `main` and Production, checked read-only on 2026-11-20 (Supabase migration history, a second time after
the owner applied 0047): pull requests #88 (system monitoring) and #92 (3D sprint 4) are merged; `main` is at
`6ab4350` and holds migration `20261124000047_system_health.sql`. **Production records 0001–0047: `main` and
Production are level again.** A `db push` from `main` has nothing to apply until a pull request of this stack
that carries a migration (#94, #97, #100) is merged.

## 0. Before anything is merged

| Check                                                                                | Why                                                                                                              |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `CELLR_FEATURES` in Production and Preview names none of the five sommelier switches | `all` turns none of them on (tested), so only a name can; make sure no name is there (R-02)                      |
| Migration `20261124000047` (#88): applied in Production (checked 2026-11-20)         | This work's 0048, 0049 and 0050 are later than it, so the order is right as it stands and nothing needs renaming |
| Read `FINAL_REPORT.md` §6                                                            | The few things that change with every switch off                                                                 |

## 1. Merge (switches off)

Order: #90 → #91 → #93 → #94 → #95 → #97 → #98 → #100 → #104. Each is safe alone: new behaviour is
behind switches that are off. When a base branch is merged and deleted, GitHub retargets the next pull request to
`main`. Every branch of the stack contains `main` as of `6ab4350` and merges without conflict (checked in S9);
#95, #97 and #98 are drafts and must be marked ready first.

From the moment #94 is on `main`, migration 0048 is in `supabase/migrations`; from #97, 0049; from the S9 pull
request, 0050. **A `db push` from `main` after that applies them.** That is
a release step of its own (§2), not a side effect to let happen.

CI runs the browser tests on pushes to `main` only: the first run of `sommelier-plan.spec.ts` in CI is after the
merge. It adds a fourth server to that job; watch its duration.

## 2. Migrations

With the procedure of `docs/MIGRATIONS.md`, when the owner decides, each right before the switch that needs it:

| Migration                                         | Needed by                                                                  | What applying it makes live, whatever the app's switches say (R-14)                                                                                                                                                                                                                                                        |
| ------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20261125000048_social_sommelier.sql`             | `sommelier_social`                                                         | A signed-in person can set their own consent (off by default) and ask about their own accepted friends; taste signals come back only for a friend who turned their consent on                                                                                                                                              |
| `20261126000049_sommelier_learning.sql`           | `sommelier_learning`, the admin report, plan codes on ratings              | A signed-in person can record their own outcome for a bottle their own kept plan offered (no plan is kept while the engine is off). It also replaces `sommelier_set_feedback` (same checks and grants, plus the plan's codes)                                                                                              |
| `20261127000050_sommelier_friend_cellar.sql` (S9) | a friend's cellar and "a present they do not own" under `sommelier_social` | A signed-in person can set a second consent of their own (off by default) and ask for the wines of an accepted friend. Wines come back only for a friend who shows their cellar to them **and** turned that consent on: producer, wine, vintage, colour, origin; never a count, a place, a rating or a note. It needs 0048 |

Order: 0048, 0049, 0050 (0047, not this work's, is applied). 0050 alters the table 0048 creates. All three are additive. With a switch on and its migration missing, the app fails closed: no button, a 404, or the
answer "nothing", never a 500 (tested or reviewed for both).

## 3. Switches, in Preview first, one step at a time

| Step | Name                                          | Needs                                      | Note                                                                                                                                                        |
| ---- | --------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `sommelier_engine` **and** `sommelier_buying` | nothing                                    | Together: with the engine alone, V1's buy list is dropped and nothing replaces it                                                                           |
| 2    | `sommelier_experiences`                       | step 1                                     | Serving, keeping, wine-to-food, menus, quantities                                                                                                           |
| 3    | `sommelier_learning`                          | step 1, 0049                               | Outcome buttons; `/admin/sommelier` starts to fill                                                                                                          |
| 4    | `sommelier_social`                            | step 1, 0048, the approved consent wording | Last: it is the one that touches other people's data                                                                                                        |
| 4b   | (no new switch) a friend's cellar             | step 4, 0050, its own consent wording      | Part of `sommelier_social`. Without 0050 the second consent switch is not shown and a friend's cellar is never read (tested)                                |
| 5    | `sommelier_dish_ai` (S10)                     | step 1, an AI key, a platform budget       | A model reads dishes the parser could not place; costs a call per routed dish (shared through the cache). Budget mode closed: no budget configured, no call |
| 6    | `sommelier_second_opinion` (S10, experiment)  | step 5, the paid evaluation's result       | Only if `HYBRID_EVALUATION.md` shows it helps; it is not an approved architecture                                                                           |

Each of the last four does nothing without `sommelier_engine` (tested).

## 4. Before a switch is on in Production

| Check                                                                                                                           | Why                                                                                                                                                           | State                                      |
| ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| A wine professional reviews the food and wine knowledge and the benchmark labels, or the owner accepts them as a labelled trial | R-01, R-11: AI-written, `reviewed: false`; four thresholds missed                                                                                             | open                                       |
| The comparison with V1's AI (`AI_COMPARISON.md` §8–§9), run on 2026-11-20 for $0.10                                             | R-04. Result: 3.0 is **not** shown to be better than today's sommelier with AI; on unseen dishes the model picks better first bottles and far fewer poor ones | done; the result is a reason for the NO-GO |
| Quality on unseen dishes (`progress/S9.md` §2.4): 72% of dishes understood, every measure below its gate                        | R-15: the main set flatters the engine                                                                                                                        | open                                       |
| Consent wording for using a friend's taste, and separately a friend's cellar, in a friend's sommelier                           | Privacy defaults the owner must approve (D-08, D-29)                                                                                                          | open                                       |
| Alcohol marketing and age rules for buying advice (NL: no targeting of minors; STIVA code)                                      | R-07                                                                                                                                                          | open                                       |
| A retailer source with a licence, before any live offer                                                                         | R-05: without it buying advice stays at "style", and the screen says so                                                                                       | blocked                                    |
| A person looks at the screens on a phone, and someone uses a screen reader on them                                              | Accessibility is machine-checked only                                                                                                                         | open                                       |
| Decide on issue #76 with the query in `COST_REPORT.md`                                                                          | D-25                                                                                                                                                          | open                                       |

## 5. What to watch once a switch is on

`/admin/sommelier`: the share answered by the engines (model cost falls with it), thumbs by outcome and confidence
(a "good, high confidence" answer that is rated down is the first place to look), outcomes ("with the dish: not
well" on a "good" pairing points at a rule). Small numbers prove nothing (R-13). Errors of the sommelier route in
the platform's own logs.

## 6. Rollback

Remove the switch from `CELLR_FEATURES` and redeploy: V1 answers again. Conversations kept by the engines still
open (a kept plan is drawn as it was; the outcome buttons disappear). The migrations stay: they are additive,
and nothing reads their tables with the switches off.

## 7. GO / NO-GO (S10, replaces the S9 verdict below it)

### Merging the stack with every switch off: **GO**

S10 adds two switches, both named-only and off, no migration and no new table. With them off nothing calls a
model and the only change in behaviour is inside `sommelier_engine` (off): the conservative selection, which offers
fewer bottles and never changes the first one or the outcome. All suites pass (`progress/S10.md` §8); the
independent reviews' P0 and P1 findings are fixed (§7 there).

### Switching anything on for real users: **NO-GO**

The owner's rule for S10: activation only if the hybrid sommelier is shown to give better and safer advice than V1
with AI on unseen dishes. That is **not shown**:

- Without a paid call, B (3.0 as it is now) is behind A on unseen dishes on the first bottle (63–64% against
  73–85%) and on poor bottles offered (85–88% without one, against 97–99%), and a perfect dish reader does not
  close that gap (`HYBRID_EVALUATION.md` §3).
- C and D are built and tested, but not measured: the paid run waits for approval (`HYBRID_EVALUATION.md` §6),
  with its decision rule written down before it.
- Even a favourable paid result would be provisional until the human holdout exists and the expert review is
  done (both BLOCKED on people), and the S9 conditions (consent wording, the alcohol marketing and age check) still
  stand.

## 7a. GO / NO-GO (S9)

### Merging the stack with every switch off: **GO**

- With no switch named, the app answers as it does today. That is tested: the end-to-end suite with switches off,
  the unit suites of V1, Tonight and Wine Intelligence unchanged, and `CELLR_FEATURES=all` turning none of the
  five on.
- A missing migration is survived: with 0048, 0049 or 0050 absent the app shows no button and reads nothing.
- No open P0 or P1 from the independent reviews. The last one (`progress/S9.md` §7) found four P1; all four
  are fixed and tested in the S9 branch.
- Conditions, all the owner's: check that `CELLR_FEATURES` in Production and Preview names none of the five; merge
  in the order of §1; treat every `db push` from `main` as a release of its own.

What merging does change with everything off is listed in `FINAL_REPORT.md` §6 and is unchanged by S9.

### Switching functionality on for real users: **NO-GO**, for these reasons

| Reason                                                                                                                                                                                | Kind                          | Lifts when                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------- |
| On dishes it had not seen, the engine understands 72% and misses every quality gate (`progress/S9.md` §2.4)                                                                           | quality                       | Food knowledge is widened or a model reads the dishes the parser misses                              |
| Measured against today's sommelier with AI, 3.0 is not better: on unseen dishes it offers a poor bottle several times as often and picks a worse first bottle (`AI_COMPARISON.md` §9) | quality, measured             | The model reads the dishes the parser cannot (`progress/S9.md` §10), then the comparison is repeated |
| The knowledge and the labels are unreviewed by a wine professional; a blind second opinion disputes 14 labels and half-disputes 26                                                    | evidence, BLOCKED on a person | A professional's review, or the owner accepts a labelled trial                                       |
| Consent wording (taste; cellar) is not approved                                                                                                                                       | privacy                       | The owner approves it                                                                                |
| Alcohol marketing and age rules for buying advice are not checked                                                                                                                     | legal                         | The owner's check (R-07)                                                                             |
| Live availability                                                                                                                                                                     | BLOCKED on a licence          | A retailer source                                                                                    |

A **Preview** trial with the owner's own account is reasonable after the merge and the migrations: `sommelier_engine`
with `sommelier_buying`, then the others in the order of §3. That is a trial, not a launch.
