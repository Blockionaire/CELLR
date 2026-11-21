# Sommelier 3.0 — release plan

Updated in S11, 2026-11-21. **The agent merged, deployed, applied and switched on nothing.** The owner merged #90 and
#91 into `main` on 2026-11-21 (§1). Every further step is the owner's to authorise.

**The verdict in three lines** (the reasons are in §7): V1 with AI stays the sommelier; merging what is left of the
stack with every switch off is safe code, but brings migrations 0051–0053 into the next database release (§1); no
sommelier switch is to be named in Production or Preview.

State on 2026-11-21, read from GitHub and Supabase (read-only): `main` is at `4ffa39f` (#90 and #91 merged; before
them #101 brought migration `20261128000050_r27_wine_record_origins.sql`, not applied). Production records 0001–0047.
This work's drafts were renumbered in S11 to come after 0050: **0051, 0052, 0053**, none on `main`.

## 0. Before anything is merged

| Check                                                                                 | Why                                                                                                                 |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `CELLR_FEATURES` in Production and Preview names none of the eight sommelier switches | `all` turns none of them on (tested), so only a name can; make sure no name is there (R-02)                         |
| The newest migration on `main` is older than this work's 0051 (S11: `…28000050` is)   | The CLI refuses a version older than the newest applied one; a parallel migration merged first means renaming again |
| Read `FINAL_REPORT.md` §6                                                             | The few things that change with every switch off                                                                    |

## 1. Merge (switches off)

Order: #90 → #91 → #93 → #94 → #95 → #97 → #98 → #100 → #104 → S11. Each is safe alone: new behaviour is
behind switches that are off. **A pull request must have `main` as its base when it is merged**: GitHub retargets the
next one only when the merged base branch is deleted. Every branch of the stack contains `main` as of `e27e533` and
merges without conflict (S11); #95, #97, #98, #100 and #104 are drafts and must be marked ready first.

**State, 2026-11-21:** #90 and #91 are on `main`. **#93 was merged into `claude/sommelier-3-s2-food-pairing`, not into
`main`** (its base had not been retargeted), so `main` does not hold S3+S4. To land it: a pull request from
`claude/sommelier-3-s3-wine` to `main` (the diff #93 reviewed), then change #94's base to `main` before merging it.
Whether to go past #93 at all is the choice of §7 (S11).

From the moment #94 is on `main`, migration 0051 is in `supabase/migrations`; from #97, 0052; from the S9 pull
request, 0053. **A `db push` from `main` after that applies them.** That is
a release step of its own (§2), not a side effect to let happen.

CI runs the browser tests on pushes to `main` only: the first run of `sommelier-plan.spec.ts` in CI is after the
merge. It adds a fourth server to that job; watch its duration.

## 2. Migrations

With the procedure of `docs/MIGRATIONS.md`, when the owner decides, each right before the switch that needs it:

| Migration                                         | Needed by                                                                  | What applying it makes live, whatever the app's switches say (R-14)                                                                                                                                                                                                                                                        |
| ------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20261129000051_social_sommelier.sql`             | `sommelier_social`                                                         | A signed-in person can set their own consent (off by default) and ask about their own accepted friends; taste signals come back only for a friend who turned their consent on                                                                                                                                              |
| `20261130000052_sommelier_learning.sql`           | `sommelier_learning`, the admin report, plan codes on ratings              | A signed-in person can record their own outcome for a bottle their own kept plan offered (no plan is kept while the engine is off). It also replaces `sommelier_set_feedback` (same checks and grants, plus the plan's codes)                                                                                              |
| `20261201000053_sommelier_friend_cellar.sql` (S9) | a friend's cellar and "a present they do not own" under `sommelier_social` | A signed-in person can set a second consent of their own (off by default) and ask for the wines of an accepted friend. Wines come back only for a friend who shows their cellar to them **and** turned that consent on: producer, wine, vintage, colour, origin; never a count, a place, a rating or a note. It needs 0051 |

Order: 0051, 0052, 0053 (0047, not this work's, is applied). 0053 alters the table 0051 creates. All three are additive. With a switch on and its migration missing, the app fails closed: no button, a 404, or the
answer "nothing", never a 500 (tested or reviewed for both).

## 3. Switches, in Preview first, one step at a time

| Step | Name                                          | Needs                                      | Note                                                                                                                                                        |
| ---- | --------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `sommelier_engine` **and** `sommelier_buying` | nothing                                    | Together: with the engine alone, V1's buy list is dropped and nothing replaces it                                                                           |
| 2    | `sommelier_experiences`                       | step 1                                     | Serving, keeping, wine-to-food, menus, quantities                                                                                                           |
| 3    | `sommelier_learning`                          | step 1, 0052                               | Outcome buttons; `/admin/sommelier` starts to fill                                                                                                          |
| 4    | `sommelier_social`                            | step 1, 0051, the approved consent wording | Last: it is the one that touches other people's data                                                                                                        |
| 4b   | (no new switch) a friend's cellar             | step 4, 0053, its own consent wording      | Part of `sommelier_social`. Without 0053 the second consent switch is not shown and a friend's cellar is never read (tested)                                |
| 5    | `sommelier_dish_ai` (S10)                     | step 1, an AI key, a platform budget       | A model reads dishes the parser could not place; costs a call per routed dish (shared through the cache). Budget mode closed: no budget configured, no call |
| 6    | `sommelier_second_opinion` (S10, experiment)  | step 5, the paid evaluation's result       | Only if `HYBRID_EVALUATION.md` shows it helps; it is not an approved architecture                                                                           |
| 7    | `sommelier_v1_guard` (S11, shadow)            | nothing                                    | V1+: counts what the guard would flag, changes no answer. Only to measure, after the owner decides to; Preview first                                        |

Steps 2 to 6 do nothing without `sommelier_engine` (tested); step 7 needs nothing and changes no answer.

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

## 7. GO / NO-GO (S11, replaces the S10 verdict below it)

### V1 with AI stays the sommelier: **GO** (no change)

V1+ (`V1PLUS_ARCHITECTURE.md`): V1's model keeps choosing; code supplies facts, rules and a guard. Nothing of it
is on for anyone.

### Merging the rest of the stack with every switch off

- **#93 (S3+S4), re-landed on `main`: GO.** No migration; the switch-off changes are listed in `progress/S11.md` §6.3.
- **#94 onward: the owner's choice** (`progress/S11.md` §6.3). The code is safe with the switches off, but from #94
  on, migrations 0051–0053 are in `supabase/migrations`, and the next `db push` for any reason applies all three.
  Recommended: stop after #93 and take V1+ (the guard) as its own small pull request on `main`, with no migration,
  until it is decided whether the social and learning parts are wanted in Production at all.
- #104 also changes, with every switch off, how much the platform budget holds per AI call (it counts the schema).

### Switching anything on for real users: **NO-GO**

Unchanged from S10. Not to be used: `sommelier_engine` in front of V1, `sommelier_dish_ai`,
`sommelier_second_opinion`. The guard (`sommelier_v1_guard`) changes no answer and may be measured in Preview or
Production in shadow once the owner decides to; it is not a release of anything a person sees.

## 7b. GO / NO-GO (S10)

### Merging the stack with every switch off: **GO**

S10 adds two switches, both named-only and off, no migration and no new table. With them off nothing calls a
model and the only change in behaviour is inside `sommelier_engine` (off): the conservative selection, which offers
fewer bottles and never changes the first one or the outcome. All suites pass (`progress/S10.md` §8); the
independent reviews' P0 and P1 findings are fixed (§7 there).

### Switching anything on for real users: **NO-GO**; V1 with AI stays the default

The owner's rule for S10: activation only if the hybrid sommelier is shown to give better and safer advice than V1
with AI on unseen dishes. The paid comparison (`HYBRID_EVALUATION.md` §7, $0.26) shows it is not:

- On safety all three engine variants are behind V1 with AI: no poor bottle offered −12 points [−22, −4], useful
  answers −16 [−27, −5].
- On the first bottle B and C are behind (−15 [−28, −1]); D is closest (−10 [−23, +3]) and ahead nowhere.
- The decision rule written before the run is not met by any variant.
- Even a favourable result would have been provisional until the human holdout and the expert review exist (both
  BLOCKED on people), and the S9 conditions (consent wording, the alcohol marketing and age check) still stand.

None of the seven sommelier switches is to be named in Production or Preview. The next step is S11 (variant E: V1
decides, the engine only vetoes; `HYBRID_EVALUATION.md` §8).

## 7a. GO / NO-GO (S9)

### Merging the stack with every switch off: **GO**

- With no switch named, the app answers as it does today. That is tested: the end-to-end suite with switches off,
  the unit suites of V1, Tonight and Wine Intelligence unchanged, and `CELLR_FEATURES=all` turning none of the
  five on.
- A missing migration is survived: with 0051, 0052 or 0053 absent the app shows no button and reads nothing.
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
