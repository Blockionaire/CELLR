# Sommelier V1+ — architecture proposal (S11)

S11, 2026-11-21. A proposal, not a release: nothing here is switched on, merged or deployed. The measurements it
rests on are in [`progress/S11.md`](progress/S11.md); the release steps are in [`RELEASE_PLAN.md`](RELEASE_PLAN.md).

## 1. The decision this proposal starts from

Measured twice (S9, S10; `HYBRID_EVALUATION.md` §7), on dishes the engines were not developed on:

| Unseen dishes (88 scenarios, 44 dishes)  | V1 with AI | Best engine variant |
| ---------------------------------------- | ---------- | ------------------- |
| First bottle right                       | **78%**    | 69% (D)             |
| No poor bottle offered                   | **99%**    | 86%                 |
| Useful answer                            | **92%**    | 76%                 |
| "Nothing suits" when nothing suits (14)  | 79%        | **86%** (n.s.)      |
| An invented bottle (groundedness breach) | 0          | 0                   |

**V1 with its model keeps choosing the wine.** Where the engines failed on unseen dishes it was mostly a
candidate error (the right wine was not among their picks: 56% of C's misses), which no reordering repairs.
The engines are kept for what code does reliably: facts, rules, permissions, limits.

## 2. Who decides what

```text
question ─▶ [facts]  cellar digest, refs only to real wines, reserved bottles, drinking window, the person's taste
          │           (deterministic, already V1: cellarDigest, checkSommelierAnswer)
          ▼
          [select]   V1's model chooses from the refs it was shown (unchanged prompt, unchanged model)
          ▼
          [check]    refs that are not in the cellar are dropped (unchanged)
          ▼
          [guard]    variant E: flags a pick only for a hard clash with a dish read with confidence
          │           S11: shadow (counts only)  ·  later, if earned: a caution on the card (§4)
          ▼
          [annotate] concrete, deterministic facts on the chosen bottle: drink now / keep, reserved, where it lies,
                      serving temperature and decanting (S6's serving module)   — proposed, not built
          ▼
answer    (no AI, a limit, or the model down) ─▶ [fallback] the engines' plan instead of V1's plain list
                                                              — proposed, not built (§5)
```

| Concern                         | Decided by                                                 | Why                                                                                               |
| ------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Which wine to open              | **V1's model**                                             | Generalises to unseen dishes (table above)                                                        |
| Which wines exist and may count | Code (`cellarDigest`, the answer check)                    | Groundedness 100% in every run; a model is never trusted with inventory                           |
| Who may see what                | The database (RLS, household scope)                        | Unchanged; nothing in V1+ reads another table                                                     |
| Reserved bottles, drink window  | Code (digest; annotation proposed)                         | Facts, not taste                                                                                  |
| Budget                          | Code (`BUDGET_EUROS` bands; check proposed for buying, §6) | A model's "about €20" is a claim; a band is a rule                                                |
| A hard clash                    | Code (the guard), as a flag                                | 0 good or acceptable bottles flagged in every set measured (progress/S11.md §2); it never chooses |
| A friend's taste or cellar      | Code only, never a model (§7)                              | Consent: no friend's data, name or question goes to a model                                       |

## 3. Variant E: the guard (built in S11, shadow mode)

- `packages/domain/src/pairing-engine/guard.ts` (`guardPicks`, `GUARD_VERSION` 1, frozen): flags a pick only when
  the dish was read with at least medium confidence, the wine is known beyond its colour, and the pairing engine sees
  one of its five hard clashes (tannin with fish, tannin with heat, tannin with sweet, a dry wine with a dessert, a
  sweet wine with a savoury dish). It never adds, removes, reorders or picks.
- `apps/web/src/server/sommelier/v1-guard.ts`: runs after V1 has answered, on what the person typed (with the social
  sommelier on, not on a turn that names someone) and the bottles V1 offered. No model, no database read, nothing
  kept. A failure is swallowed: the answer goes out unchanged (tested: the answer with and without the guard is
  deep-equal, with and without a model).
- Switch `sommelier_v1_guard`: named-only (`all` does not turn it on), needs nothing else, off everywhere.
- What leaves the server: `shadow: { version, considered, bottles, flagged, first }` on the reply, never stored with
  the conversation; the screen adds it to the answer's own analytics event (`guard_v`, `guard_judged`,
  `guard_bottles`, `guard_flagged`, `guard_first`), so Do Not Track and GPC apply. Never the clash: it names the
  kind of dish (`docs/METRICS.md`).

## 4. If the guard is ever made active: a caution, not a removal

Removing a flagged bottle is not safe with V1: the model's text names the wines it chose, so a card taken away
leaves a sentence recommending a bottle that is no longer shown. An active guard should therefore **add a caution to
the card** ("this red's tannin may clash with the fish") and leave V1's choice visible, or, for a first bottle,
ask the model once more with the clash stated (a second call: cost and latency to be measured first). The S11
benchmark's "with E's flags applied" numbers assume removal; they are an upper bound on what a caution changes.

Gate for any active mode (none of it is met yet): the paid shadow run on V1 with AI (§8 of progress/S11.md) shows 0
false blocks and at least one real catch on the unseen sets; a production shadow period shows the flag rate; and a
person with wine knowledge confirms the flagged pairs are poor.

## 5. Proposed next: the engines as V1's fallback, not its replacement

When V1 cannot ask its model (no key, the person's limit, the platform budget, the model down) it answers with a
plain list from Tonight. On the benchmark that list is weak, and the engines' plan is much better, at no cost
(paired by scenario, clustered by dish; progress/S11.md §4):

| Engines' plan − V1 without AI | First bottle   | No poor bottle | Useful answer  |
| ----------------------------- | -------------- | -------------- | -------------- |
| holdout-dev (22 dishes)       | +20 [+0, +38]  | +67 [+53, +79] | +58 [+41, +73] |
| holdout-test, blind (22)      | +35 [+16, +55] | +63 [+45, +78] | +53 [+38, +69] |

So the proposal is to reorder, not to choose anew: V1 with AI first; the engines only where V1 would otherwise give
its plain answer. That needs a switch of its own (not `sommelier_engine`, which puts the engines **before** the
model) and a measurement of how often the fallback happens in Production (`reason` on the answer: `ai-off`,
`ai-down`, `limit`). It is not built in S11: it is a change to what people see, and the owner decides whether it is
worth a sprint. The engines' knowledge is still unreviewed by a professional (R-01), which applies to a fallback too.

## 6. Buying Intelligence with V1

**What Production does today** (switches off): V1's model writes the buy list itself: a wine with an example
producer, a reason and "a rough price per bottle" (`BuySuggestion.price`, prompt rule "about €20"). That is a model's
claim about a product and a price, with no source. It is not an offer and is not shown as one, but it is the
closest thing to a fabricated price the product has today. Sommelier 3.0's buying advice (`sommelier_buying`) gives
styles with a curated "usually from about" instead, and needs the engines in front of the model.

Plan, each step measurable and separately switchable, V1 deciding throughout whether and what kind of wine to buy:

1. **Budget check, shadow.** Code parses V1's price text and compares it with the person's budget band; counts only
   (`buy_over_budget`). Free to build; measured on the benchmark's buying scenarios with the paid V1 run.
2. **Price from the table, not the model.** Where V1's suggestion names a style the engines know, the card shows the
   engines' "usually from about" band and its source tier; otherwise "price not known". The model's own price text
   is dropped. The producer example stays labelled as an example, never as available.
3. **The buying conversation (S4's state machine)** only after 1–2: it asks budget, channel and colour where missing.
   Its questions are deterministic; V1 still picks.
4. **Live offers**: BLOCKED until a licensed retailer source exists (R-05), then the offer validation of S4 (identity,
   vintage, size, price, currency, merchant, time seen). Never a product, a URL, a price or a stock state without it.
5. Before any of it is on for real users: the alcohol marketing and age check (R-07).

## 7. Social Sommelier with V1

The guarantee that does not change: **no friend's name, taste, cellar or question reaches a model**, and nothing
that names a friend is kept (D-14, D-29, D-39). Today, with the social switch on, a question naming a friend is
answered by the engines alone (V1's model never sees it); without an engine answer it gets the counted facts or
nothing.

That means social answers get the engines' quality, not V1's. Two ways forward, an owner decision:

- **A. Keep it as it is** (recommended for now): social questions are engine-only and the switch stays off until the
  engines' pairing knowledge is reviewed and measured good enough on its own. Nothing new leaves the server.
- **B. Two steps, model blind to the friend.** V1's model chooses candidates for the dish from the asker's own
  cellar, sent **without** any name or friend data (the dish phrase only); code then orders V1's candidates by the
  consented friend's taste and matches the consented friend's cellar locally, and the friend's part of the answer is
  worded by the screen from templates, never by the model. This relaxes D-39 (today no model sees a conversation
  with an "@" in it, not even its dish), so it needs the owner's explicit approval and new consent wording that says
  the dish of such a question may be read by a model. A friend's own data still never reaches a model; there is no
  plan, and no switch, for asking a friend to allow that.

## 8. What not to use

| Functionality                                                     | Advice                                                                                                        |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `sommelier_engine` in front of V1 (the engines answer first)      | **Do not switch on.** Measured worse than V1 with AI on unseen dishes; it also drops V1's buy list            |
| `sommelier_dish_ai`, `sommelier_second_opinion`                   | **Do not switch on.** No measurable gain over the engine alone (S10), paid calls                              |
| `sommelier_buying`, `sommelier_experiences`, `sommelier_learning` | Not on their own: they need `sommelier_engine`. Their parts are candidates for V1+ (§5–§6), rebuilt behind V1 |
| `sommelier_social`                                                | Off until §7 is decided and its consent wording is approved                                                   |
| `sommelier_v1_guard`                                              | Shadow only, and only after the owner decides to measure in Preview or Production (RELEASE_PLAN.md §3)        |
