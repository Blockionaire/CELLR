# Sommelier V1+ — closeout and release plan

2026-11-22, against `main` at `ecde6eb`. This document replaces the parallel Sommelier 3.0 sprint plan. It turns the
seven open pull requests (#94, #95, #97, #98, #100, #104, #106) and the merged S0–S4 work into one release project with
V1 AI as the primary sommelier.

Every claim below was checked against code on `main` or on the branch named, not against progress reports. Nothing in
this document has been merged, migrated, deployed or switched on. Statements about hosted environments (which
migrations a database has, which switches a deployment sets) are deliberately not recorded here: the repository is
public (`CLAUDE.md`). They are checked read-only before each release step and reported to the owner.

## 1. Decision this plan starts from

V1, with its model, keeps choosing the wine. It is measured, on dishes the engines were not developed on (88 scenarios
across 44 dishes, `gpt-6-luna`, five runs; `results/s10-paid-comparison.json` on the S10 branch):

| Unseen dishes                     | V1 with AI | Best engine variant (B/C/D) |
| --------------------------------- | ---------: | --------------------------: |
| First bottle right                |    **78%** |                         69% |
| No poor bottle offered (n=74)     |    **99%** |                         86% |
| Useful answer                     |    **92%** |                         76% |
| "Nothing suits" when right (n=14) |        79% |                     **86%** |

The engines must not be switched on in front of V1. They are kept for what code does reliably: facts, rules, limits
and a fallback when V1 has no model.

**Limits of this evidence.**

- The labels were written by an AI agent and have not been reviewed by a wine professional (R-01).
- The holdout-dev set has been read since S9, so it is no longer unseen.
- The per-scenario vectors behind the dish-clustered intervals of S11 are not committed; only the aggregates are.
- Groundedness (no invented bottle) is recorded for S9 (100%) but not in the S10 file.

## 2. Inventory

### 2.1 On `main` and active for users (switches off)

| Function                                             | Where                                                                       | Notes                                                                                                                           |
| ---------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| V1 chat and Tonight: one model call per question     | `server/sommelier/service.ts` (`generateObject`, task `sommelier_chat`)     | Prompt `sommelier_chat@v6`; at most three wines, only refs from the cellar list; 60 calls an hour                               |
| Cellar grounding                                     | `domain/sommelier.ts` `cellarDigest`, `checkSommelierAnswer`                | Cards whose ref is not in the cellar are dropped. **The answer text and the buy entries are not checked**                       |
| Drinking window and reserved bottles                 | digest fields `drink:` and reservation; prompt rules                        | The model is told; code does not annotate the card                                                                              |
| Counted cellar facts                                 | `cellarFacts` and `cellarFactsText`                                         | "How many reds…" is answered from counts, not by the model                                                                      |
| Fallback without a model (no key, limit, model down) | `service.ts` `plain()`, Tonight picks, `worthOpening`                       | Measured weak: below the engines' plan by 20–35 points on first bottle (§5)                                                     |
| Conversation memory (7 days) and thumbs              | migration 0046, `server/sommelier/conversation.ts`, feedback route          | Ratings are stored and **never read** (R-SOM-1)                                                                                 |
| Buying suggestions                                   | prompt rule "one well-known producer … about €20"; `BuySuggestion.price`    | **The model's producer and price are unverified claims**, shown as a chip with "prices are rough". No link, shop or stock claim |
| Koopcheck (recognise and compare)                    | `server/purchase-check/service.ts`                                          | Compare is deterministic; recognise uses label text, then one vision call                                                       |
| Tests                                                | `sommelier*.spec.ts`, `purchase-intel.spec.ts`, service and SQL tests       | No test, and no evaluation, runs V1 **with** a model on `main` (the eval on `main` runs with `llm: null`)                       |
| Translations                                         | `messages/{en,nl}.json`: `sommelier` (157 keys), `purchaseCheck` (127 keys) | Complete in both languages                                                                                                      |

### 2.2 On `main`, built but dormant

| Function                                                      | Gate                                  | State                                                                                                       |
| ------------------------------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Food engine, pairing engine, plan, conversation state (S1–S3) | `sommelier_engine`                    | Answers **before** V1 and drops V1's verdict and buy list. Measured worse than V1 with AI: do not switch on |
| Style buying advice with "usually from about" bands (S4)      | `sommelier_buying` (needs the engine) | No offers: no provider exists (R-05)                                                                        |
| Serving, quantity, menu, social libraries                     | none                                  | Library code with tests, **no caller**. The plan emits `serving: []` and `quantity: null`                   |
| `sommelier_social`, `sommelier_experiences`                   | switches                              | **Read nowhere on `main`.** Turning them on changes nothing                                                 |
| Offline benchmark                                             | `scripts/sommelier-eval`              | 246 + 88 scenarios; V1 without AI only on `main`                                                            |

### 2.3 Only in open pull requests

| PR   | Phase | Own size      | Delivers                                                                                                                                    | Migration                                                |
| ---- | ----- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| #94  | S5    | +1,784 lines  | `@friend` taste in the engine's ranking, consent card and route, mention stripping before any model                                         | **0051** `sommelier_sharing`, `sommelier_friend_context` |
| #95  | S6    | +3,479 lines  | Wiring and refinements: serving, keeping (window), guests to bottles, `parseMenu` and `planMenu`, dishes for a wine, routing for "which of" | none                                                     |
| #97  | S7    | +2,469 lines  | Outcome capture ("opened / with the dish / enjoyed"), admin counts, plan codes on ratings, answer metrics                                   | **0052** `sommelier_outcomes`, `admin_sommelier_report`  |
| #98  | S8    | +2,143 lines  | Release documents and one pinned benchmark test                                                                                             | none                                                     |
| #100 | S9    | +7,998 lines  | Rule tuning, holdout sets, friend cellar, **paid V1-with-AI harness** (`engines/v1-ai.ts`), failure analysis                                | **0053** `sommelier_friend_cellar`                       |
| #104 | S10   | +10,356 lines | AI dish reader, second opinion (variant D), dish cache, hybrid eval, human-holdout frame, expert sheet                                      | none                                                     |
| #106 | S11   | +2,377 lines  | Variant E guard (shadow only), dish-clustered statistics, V1+ architecture proposal                                                         | none                                                     |

**Shared state of the stack.** It is stacked: #94 is on `main`, and every other PR is a draft on the one before it. All
seven are 57 commits behind `main`. Each conflicts with `main` in the architecture register (`registry.ts`). Their
inventories are stale against `main`'s required check **Architecture · register matches the code**.

### 2.4 Missing for a complete V1+

| Gap                                                                                                                           | Why it matters                                 |
| ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Facts attached to **V1's** cards: serving, keep or drink now, reserved, where it lies. Today these are engine-only or unwired | The visible V1+ improvement                    |
| A check of V1's answer **text** against the cellar (a sentence may name a wine not on the cards)                              | Hallucination guard                            |
| Buying without unverified prices: a budget band or "price not known" instead of the model's number                            | No fabricated prices                           |
| Guests to bottles, and a menu per course, on top of V1's choice                                                               | Scope of the brief                             |
| Engines as fallback **only** when V1 has no model (proposal V1PLUS §5; not built)                                             | Measured gain where V1 is weakest              |
| A V1-with-AI evaluation on `main`: the harness and statistics are on the S9–S11 branches only                                 | The release gate cannot be measured without it |
| A human holdout and a wine-expert review                                                                                      | Quality claims (blocked on people)             |
| One release configuration instead of eight interdependent switches                                                            | Controllability                                |

## 3. Outdated decisions and plans

| Item                                                                                                      | Now                                                                                                                                                                |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D-01 "The engine decides, the model words"; D-17                                                          | **Superseded by D-40/D-41** ("V1 with AI stays the default; V1's model chooses, code supplies facts, rules and a guard"). The log should say so in D-01 itself     |
| D-24 "No cache across questions" vs D-35 (dish readings cached)                                           | Contradictory, and neither names the other. Moot for V1+: the dish reader does not ship (§4.4)                                                                     |
| RELEASE_PLAN.md order (merge S0→S8 in chain, switches on one by one, Preview trial of `sommelier_engine`) | **Void.** No chain merge, no engine in front of V1. Replaced by §6 of this document                                                                                |
| RELEASE_PLAN.md and S11 §6.2 "S3+S4 not on main"                                                          | Wrong: S3+S4 are on `main` (#111)                                                                                                                                  |
| STATUS.md resume block (S3 in progress, "V1's AI path NOT measured")                                      | Stale. V1 with AI was measured on S9/S10 branches ($0.36 in total), but not on `main`                                                                              |
| COST_REPORT.md "V1 with AI not measured, 0 model calls"                                                   | Stale: p50 1.5–1.7 s, p95 2.2–2.8 s, about $0.0001 per answer (S9)                                                                                                 |
| Social option B (V1PLUS §7, D-45)                                                                         | Owner chose **A**: no friend data, name or question to a model. Since `sommelier_social` requires `sommelier_engine`, A means social **stays off** in this release |
| Guard "active mode" gate (V1PLUS §4)                                                                      | Needs the paid shadow run, now declined: the guard can only run in shadow                                                                                          |
| Migration 0053 header "after 0047, not yet applied"                                                       | Stale text; content unchanged                                                                                                                                      |
| R-04 (V1 AI path not measured)                                                                            | Partly closed (branch measurement). Closes fully when the harness is on `main` (P2)                                                                                |

P1 (§6) corrects these, together with this document. The decision log then gets D-46 for this plan
and supersession notes on D-01, D-17 and D-24.

## 4. V1+ architecture

### 4.1 Who decides what

```text
question ─▶ [facts]     cellar digest, counted facts, reserved, drink window, taste          (main, unchanged)
          ▼
          [select]    V1's model chooses wines from the refs it was shown                     (main, unchanged)
          ▼
          [check]     refs not in the cellar dropped (main) + answer text checked (new, P3)
          ▼
          [annotate]  per chosen card: drink now / keep, serving temperature and decanting,
                      reserved, where it lies; for a guest count, bottles needed              (new, P4–P5)
          ▼
          [buy]       style and budget band, or "price not known"; never the model's number  (new, P3)
          ▼
answer    no model (no key, limit, model down) ─▶ [fallback] engines' plan, not plain()       (new, P7)
```

Code never replaces V1's choice. It adds facts that it can prove from the cellar or from a reviewed table, and it
removes claims it cannot prove.

### 4.2 Release configuration: one switch, named parts

The eight sommelier switches (`sommelier_engine`, `_buying`, `_social`, `_experiences`, `_learning`, `_dish_ai`,
`_second_opinion`, `_v1_guard`) depend on each other, and two of them do nothing on `main`. V1+ uses **one**
environment variable, read in one module:

```text
CELLR_SOMMELIER = "" | "check,annotate,quantities,menu,fallback"      (comma list of parts; empty = V1 exactly as today)
```

- **Each part is independent.** None requires another, and each can be tested alone: unit tests take the parts as an
  argument, and the end-to-end server names the parts it tests.
- **Fails closed.** Missing or unknown means off; an unknown name is logged once and ignored.
- **Not part of `CELLR_FEATURES`**, so `all` can never turn the sommelier on (R-02).
- **Registered once** in the architecture register, under `svc-sommelier`.
- **Old switches go.** `sommelier_social` and `sommelier_experiences`, which do nothing, are removed in P2.
  `sommelier_engine` and `sommelier_buying` stay for the offline benchmark only. The switches that exist only on the
  stack (`_learning`, `_dish_ai`, `_second_opinion`, `_v1_guard`) are not brought to `main` unless their part is
  scheduled.

### 4.3 What V1+ reuses

| Code                                                                                                                                                 | From                       | Use in V1+                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | -------------------------------------------------------- |
| `experiences/serving.ts` `servingAdvice` (pure, tested), with S6's refinements (no forced air for sparkling, rosé, sweet or 15+ years; `basis` rule) | `main` + #95               | Serving line on a V1 card                                |
| `drink-window.ts` `drinkStatus`, `item.drink`                                                                                                        | `main` + #95               | "Drink now / keep until" on a V1 card                    |
| `experiences/quantity.ts` `bottlesFor`, `enoughFor` (pure, tested)                                                                                   | `main` + #95               | "For 8 people: 4 bottles; you have 3 of these"           |
| `food/parse.ts` `parseMenu` (pure, capped at 8 courses)                                                                                              | #95                        | Splits a menu into courses for V1, one choice per course |
| `asksEnoughFor`, `asksWhichOf`, ALREADY_OPEN routing                                                                                                 | #95                        | Question classification without a model                  |
| `SommelierPlanSchema` fields `keeping`, bounded `serving` and `quantity`                                                                             | #95                        | Typed annotation contract                                |
| Engines' plan (`server/sommelier/intelligence.ts`)                                                                                                   | `main`                     | No-model fallback (P7)                                   |
| `engines/v1-ai.ts`, `paid.ts` (owner phrase), `stats.ts` (clustered bootstrap), `compare.ts`, holdout sets                                           | #100, #104, #106           | The release gate (P2)                                    |
| `guard.ts` and `v1-guard.ts` (variant E, shadow)                                                                                                     | #106                       | Optional, later (§4.4)                                   |
| Mention parser `findMentions` and stripping                                                                                                          | `main` (`social.ts`) + #94 | Later social release                                     |

### 4.4 Deliberately not in the first V1+ release

| Part                                                   | Why not now                                                                                                                                                                                              | What it would take                                                                  |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Social sommelier (#94, 0051; friend cellar #100, 0053) | Requires the engine to choose. Under option A no friend data reaches a model, so a social answer cannot be V1's. 0053 reads a whole household on one member's consent (the objection D-15 itself raised) | Own release: design without the engine choosing, consent wording, a security review |
| Outcome learning (#97, 0052)                           | Outcomes are kept with **no expiry**, **not exported**, and cannot be deleted by the person after 7 days. `sommelier_set_outcome` requires an engine plan. Nothing feeds back (D-26)                     | Retention and export fixed, a V1 card id instead of a plan, then its own release    |
| AI dish reader and second opinion (#104)               | Measured: no gain over the engine alone; extra paid calls                                                                                                                                                | None planned                                                                        |
| Guard, variant E (#106)                                | Only measured on V1 without AI. The active-mode gate needs a paid shadow run (declined)                                                                                                                  | Later: shadow in Preview, then an expert check of flagged pairs                     |
| Live offers, shops, stock                              | No licensed source (R-05); alcohol marketing rules (R-07)                                                                                                                                                | A provider contract and a legal check                                               |

## 5. Quality gate

V1+ is compared with **V1 with AI** (today's production behaviour), not with V1's plain fallback. The fallback part
is compared with `plain()`. All comparisons draw dishes (`stats.ts`, D-43); the per-scenario vectors are committed
this time.

| Measure                                                      | Set                                          | Release threshold                                                                            |
| ------------------------------------------------------------ | -------------------------------------------- | -------------------------------------------------------------------------------------------- |
| First bottle right                                           | unseen (holdout-test) + human holdout        | Not worse than V1: the lower bound of the 95% interval of (V1+ − V1) above −5 points         |
| No poor bottle offered                                       | same                                         | ≥ V1's rate (99%) within the interval                                                        |
| Useful answer                                                | same                                         | ≥ V1 within the interval                                                                     |
| Invented bottle, vintage or cellar fact (cards and text)     | all sets                                     | **0**                                                                                        |
| Unverified price, producer-as-available, shop or stock claim | all sets with buying                         | **0** shown as fact                                                                          |
| Annotation correctness (window, serving, quantity, location) | unit fixtures + a checked sample of 50       | 100% on fixtures; sample reviewed by a person                                                |
| Privacy                                                      | tests                                        | No friend data, name or `@` question to a model; no new stored text                          |
| Latency                                                      | the eval run                                 | p95 ≤ V1 + 300 ms (annotations are pure code)                                                |
| Cost per answer                                              | the eval run                                 | ≤ V1 + 10% (no new model calls in the first release)                                         |
| Fallback (no model)                                          | holdout sets                                 | Engines' plan better than `plain()` on first bottle and no poor bottle, lower bounds above 0 |
| Mobile, Dutch and English                                    | end-to-end tests, phone and desktop projects | Every part in both languages on the 390 px phone profile; no overflow; reduced motion        |

**Conditions on the gate.**

- **Claims need people.** Quality claims for production need the human holdout (escrowed, D-44) and at least one
  wine expert. Both are blocked on people. Until then the gate states "not worse than V1 on the AI-labelled sets",
  and nothing more.
- **Paid runs need the owner's approval** (D-32, the phrase `SOMMELIER_EVAL_PAID=owner-approved`).
  - Proposed budget for the whole release: **at most $3**. The S9 and S10 runs together cost $0.36; this allows
    about six full comparisons.
  - The budget is asked for before P3, the first change V1's model sees.

## 6. Pull requests, in order

Rules:

- Every PR branches from the current `main` and is small and self-contained.
- At most two Sommelier PRs are open at a time, and none is stacked on another.
- Each PR updates the architecture register and inventory itself (`CLAUDE.md`) and passes the full CI, including all
  end-to-end shards (by hand, as end-to-end tests do not run on pull requests).

| #   | PR                                                                                                                                                                                                                                                                              | Visible change                                         | Acceptance                                                                                                                                                  | Migration | Paid calls      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | --------------- |
| P1  | **Closeout docs.** This document; STATUS, RELEASE_PLAN, COST_REPORT and DECISIONS corrected (§3); RISK_REGISTER R-04 updated                                                                                                                                                    | none                                                   | Docs only; CI green                                                                                                                                         | –         | –               |
| P2  | **Gate and release config.** Port `engines/v1-ai.ts`, `paid.ts`, `stats.ts`, `compare.ts` and the holdout sets from #100/#104/#106 onto `main`'s eval. Add `CELLR_SOMMELIER` (parts, fails closed); remove the two dead switches                                                | none (empty = today)                                   | Benchmark tests pass; `--estimate` runs free; the paid path refuses without the phrase; one baseline V1-with-AI run **if approved**, with vectors committed | –         | optional, 1 run |
| P3  | **Trust: `check`.** Answer text checked against the digest (a sentence naming a cellar wine that is not on the cards falls back to a card-only sentence). Buy entries without a model price: the budget band if one is set, else "price not known"; prompt v7 drops "about €20" | Fewer, truer claims; buy chips without invented prices | Gate (§5) on unseen sets vs V1 v6; 0 invented prices; unit tests for every check; e2e NL/EN                                                                 | –         | yes             |
| P4  | **`annotate`.** Per V1 card: drink now / keep until, serving temperature and decanting, reserved, where it lies. Reuses the serving and window modules with #95's refinements                                                                                                   | Richer cards                                           | Fixtures 100%; V1's choice byte-identical with the part on or off (test); latency within gate; e2e phone NL/EN                                              | –         | no              |
| P5  | **`quantities`.** "We are 8": bottles needed, against what the cellar has of V1's picks (`bottlesFor`, `asksEnoughFor`)                                                                                                                                                         | Quantity line                                          | Fixtures; no change to V1's choice; e2e                                                                                                                     | –         | no              |
| P6  | **`menu`.** `parseMenu` splits courses; V1 is asked once with the courses as structure; one card per course, with annotations; comparison "which of these two" routed to V1 with both wines' facts                                                                              | Menu planning, comparisons                             | Gate on a menu set (new, small, labelled); ≤ 1 model call per question                                                                                      | –         | yes             |
| P7  | **`fallback`.** With no model, the engines' plan replaces `plain()`; reason shown                                                                                                                                                                                               | Better answers when AI is off or limited               | Free measurement vs `plain()` (§5); **production activation only after R-01** (expert review of the knowledge)                                              | –         | no              |
| P8  | **Release.** Preview with all parts, real-UI walkthrough on phone and desktop in both languages, then the owner's production decision                                                                                                                                           | –                                                      | §7                                                                                                                                                          | –         | –               |

**Scope of the first complete V1+ release: P1–P8.** None of these PRs needs a migration.

**Later, each its own project:**

- the guard in shadow (#106);
- outcome learning (#97 rebuilt, 0052 reworked);
- the social sommelier (#94 and #100 redesigned, 0051 and 0053);
- live offers.

### 6.1 What happens to the open pull requests

None is merged or closed before the owner agrees. The proposal:

| PR   | Proposal                                                                                                                                                                                      | When            |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| #98  | Close: its documents are superseded by P1                                                                                                                                                     | after P1 merges |
| #100 | Close: the harness and holdout sets are ported in P2; the rule tuning stays unported (the engine does not choose); the friend cellar and 0053 are deferred with social                        | after P2 merges |
| #104 | Close: statistics and the human-holdout frame are ported in P2; the dish reader, second opinion and cache are not shipped (measured, no gain). The branch is kept as reference                | after P2 merges |
| #106 | Close: the stats are ported in P2; the guard is deferred, and its code is kept on the branch                                                                                                  | after P2 merges |
| #95  | Close: the serving, window, quantity and menu parts are ported in P4–P6; engine orchestration and `planMenu` are not                                                                          | after P6 merges |
| #94  | Keep open as a draft, or close with its branch kept, until the social project starts (owner's choice). **Do not merge**: it would release consent UI for a feature that cannot be switched on | owner decision  |
| #97  | As #94, until the learning project starts. **Do not merge**: 0052's retention is not acceptable as is                                                                                         | owner decision  |

Each closing comment lists the code taken over (with the PR that took it), the functions deliberately not taken, and
the risks that remain.

### 6.2 Migrations

- V1+ needs **no migration**. 0051, 0052 and 0053 exist only on the stack.
- None of them may be applied automatically. Each would go with its own deferred project, after its redesign.
- Before any of them is released:
  - the hosted migration history is checked read-only against `docs/MIGRATIONS.md`, and the owner gives explicit
    approval;
  - its number is checked against the newest migration on `main` at that time. The 0048–0049 gap on `main` is
    intentional: 0048 was the first draft number of the social migration.

## 7. Definition of done and GO/NO-GO

Technically complete (agent):

- P1–P7 are merged by the owner. The current `main` is fully green, including every end-to-end shard and the required
  architecture check.
- The §5 gate passes on the AI-labelled sets, the per-scenario vectors are committed, and the cost stays within the
  approved budget.
- Every part works in the real UI, on phone and desktop, in Dutch and English, with `CELLR_SOMMELIER` set on a Preview
  deployment.
- Privacy and security are checked: no new stored text, no friend data, no unverified price shown, and the register
  updated.

Production activation (owner):

- Read-only check of the hosted configuration: `CELLR_SOMMELIER` unset on Production until the decision, and
  `CELLR_FEATURES` not naming the old engine switches.
- `fallback` only after the R-01 expert review.
- Quality claims (for example "better advice") only after the human holdout and an expert review. Until then the
  release is described as "same choices, more facts, fewer unproven claims".
- The order of parts on Production: `check`, then `annotate` and `quantities`, then `menu`, then `fallback`. Each is
  watched for a week (errors, latency, thumbs).

**GO/NO-GO today:**

- **GO** to start P1 and P2.
- **NO-GO** for any production activation: nothing of V1+ is built yet.

Open owner decisions:

1. The budget for paid evaluation runs (proposed: at most $3).
2. Whether #94 and #97 stay open as drafts or are closed with their branches kept.
3. Who writes the human holdout, and who the wine expert(s) are.
4. Whether the `fallback` part is wanted at all before the R-01 review can be done.
