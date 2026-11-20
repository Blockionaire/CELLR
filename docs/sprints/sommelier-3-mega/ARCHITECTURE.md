# Sommelier 3.0 — architecture

Status: **S0, independently reviewed: approved with changes.** The review's twelve findings and what each changed
are in [`progress/S0.md`](progress/S0.md); this file already includes them. Decisions and the alternatives that were
rejected are in [`DECISIONS.md`](DECISIONS.md); this file says what is built where.

## 1. What exists on `main` (07bc80c), and what it cannot do

| Area               | Where                                                                                                   | What it does                                                                                                                                                                               | Limit that matters here                                                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Food understanding | `packages/domain/src/sommelier.ts` (`detectIntent`, `DISH_WORDS`)                                       | 46 dish categories, about 190 English and Dutch keywords; the first keyword found wins                                                                                                     | A dish is one category. Sauce, technique, heat and acidity are invisible ("sea bass with lemon butter" is "white-fish"; "coq au vin" is "chicken") |
| Pairing            | `packages/domain/src/pairing.ts` (`DISHES`, `wineProfile`, `scorePairing`)                              | A dish has a target for body, tannin, acidity and sweetness and a weight per colour; a wine gets a profile from its colour and a regional nudge; closeness is a 0–98 score                 | No "nothing suits" outcome; no clash rules; the wine's own researched structure is not used                                                        |
| Tonight            | `packages/domain/src/tonight.ts`, `apps/web/src/server/cellar/service.ts` (`buildTonight`)              | Pairing score plus drink phase, favourite, rating and occasion; three picks; taste only breaks exact ties                                                                                  | Always returns picks                                                                                                                               |
| Sommelier V1       | `apps/web/src/server/sommelier/service.ts`, `ai/prompts/sommelier.ts`, `packages/domain/sommelier.ts`   | Counted facts for questions about the cellar; otherwise one model call that sees up to 120 wines and returns words, bottle refs, a verdict and "buy" suggestions; refs are checked in code | The verdict and the wines to buy are the model's (free text with a model-made price); without AI the answer is the Tonight ranking with no verdict |
| Conversation       | `server/sommelier/conversation.ts`, migration 0046                                                      | One kept conversation per person, 7 days, replay by question id, thumbs per answer                                                                                                         | No structured state: budget and dish live only in the words                                                                                        |
| Taste              | `packages/domain/src/taste.ts`, `taste-context.ts`, `server/taste/service.ts`                           | Stated preferences and patterns from the person's own ratings (only from trustworthy profiles)                                                                                             | One person only                                                                                                                                    |
| Wine knowledge     | `vintage_insights.output`, `shared_wine_profiles` (`InsightOutputSchema` in `packages/domain/insights`) | Per vintage: structure 1–5, flavours, window, serving, decanting, grapes, with `evidence` and `confidence`                                                                                 | Read by the wine page and taste; not by pairing                                                                                                    |
| Friends            | migration `…0015_friends.sql`, `server/friends`                                                         | Accepted friendships; `sharing_settings` (ratings and taste default to friends, cellar to none); `friend_access`, `friend_taste`, `friend_cellar` (SECURITY DEFINER, checked per call)     | No consent for use by another person's AI; `friend_taste` exposes favourite wine names; no "block"                                                 |
| Buying             | `BuySuggestion` in the V1 answer; Koopcheck (`purchase-check.ts`) judges one wine against the cellar    | —                                                                                                                                                                                          | No retailer, offer or price data anywhere; no provider adapter                                                                                     |
| AI                 | `server/ai` (OpenAI-compatible, strict JSON, budget holds, `ai_usage`)                                  | Tasks `sommelier_chat`, `wine_insight`, …; platform-wide daily and monthly budget; per-user rate limits                                                                                    | —                                                                                                                                                  |
| Gates              | `CELLR_FEATURES` (`packages/domain/features.ts`), architecture registry (`server/system/registry.ts`)   | Fail-closed switches; every new table, route, server directory and switch must be registered (`registry.test.ts`)                                                                          | `all` switches every feature on                                                                                                                    |

## 2. The idea

**The engine decides; the model words.** Today the model is shown the cellar and asked to judge. In 3.0 the
judgement (what the dish is, which wines suit it, how sure we are, whether to buy, what to ask next) is computed by
deterministic code from structured knowledge. A model is used for two things only, both optional: understanding a
dish description the food engine could not read, and wording an explanation of a plan that is already fixed. The
same question therefore has an honest, complete answer with no AI at all, and an AI answer cannot recommend a wine
that the engine did not select.

**Which question goes where** (with `sommelier_engine` on):

| Question                                         | Decided by                                   | Model may                                                                 |
| ------------------------------------------------ | -------------------------------------------- | ------------------------------------------------------------------------- |
| About the cellar itself (how many, where, which) | Counted facts (V1, unchanged)                | Word the counted facts (V1, unchanged)                                    |
| A dish, a meal, a menu                           | Food engine + pairing engine                 | Word the fixed plan                                                       |
| Buying, gifts, follow-ups on either              | Conversation state + style ranking           | Word the fixed plan                                                       |
| With a friend mentioned                          | The above, with the permitted friend context | **Nothing: a social answer is worded by templates only** (D-14)           |
| An occasion without a dish ("something festive") | Tonight's occasion ranking (V1 logic)        | Word the fixed plan                                                       |
| Anything else (general wine talk)                | —                                            | Answer as V1 does, with `verdict` and `buy` removed from its answer shape |

**What "checked" means for a worded plan.** The model returns text only. The text is rejected, and the template
wording used instead, when it contains a currency amount, a URL, or a producer or wine name that is not one of the
plan's bottles or styles. Bottles, verdict, constraints, styles and the next question are never read from the model.

```
question, recent turns, mentions
        │
        ▼
 1 UNDERSTAND   food engine → FoodProfile        conversation state (intent, budget, channel, …)
        │        (deterministic; optional model interpretation for an unread dish, S7)
        ▼
 2 GATHER       cellar + reservations │ wine facts with evidence tier │ taste │ friends (permission per request)
        ▼
 3 ASSESS       pairing engine: each wine × the dish → fit, clashes, reasons, confidence
        ▼
 4 DECIDE       verdict (good / acceptable / none) · bottles · constraints · buying styles · next question
        ▼
 5 WORD         template sentences (always) │ model explanation of the fixed plan (optional, checked)
        ▼
 6 RECORD       kept conversation (V1 rules) · usage · analytics · outcomes (S7)
```

## 3. Components and boundaries

Pure logic lives in `packages/domain` (no I/O, testable without a database). Everything that reads or writes lives
in `apps/web/src/server`, behind the existing layering (routes → services → repositories; service role only in
`server/privileged`).

| Component                | Path                                                   | Phase | Depends on                 | Owns                                                                                                                                                                                              |
| ------------------------ | ------------------------------------------------------ | ----- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Food knowledge           | `packages/domain/src/food/`                            | S1    | —                          | Ingredients, techniques, sauces, dish templates (English and Dutch), with provenance and review status                                                                                            |
| Food parser              | `packages/domain/src/food/parse.ts`                    | S1    | food knowledge             | `parseFood(text)` → `FoodProfile` (structure, parts recognised, what was not understood, confidence)                                                                                              |
| Wine profile             | `packages/domain/src/pairing-engine/wine-profile.ts`   | S2/S3 | `insights`, `drink-window` | `WineFacts` → structure with an **evidence tier** per wine: exact, appellation, estimate, unknown                                                                                                 |
| Pairing engine           | `packages/domain/src/pairing-engine/`                  | S2    | food, wine profile         | `assess(food, wine)`, `rank`, `verdict`; reasons and clashes as codes                                                                                                                             |
| Conversation state       | `packages/domain/src/buying/state.ts`                  | S4    | food parser                | `foldTurns(turns)` → intent, dish, budget, channel, wine type, guests, recipient; `nextQuestion(state)`                                                                                           |
| Style catalogue          | `packages/domain/src/buying/styles.ts`                 | S4    | pairing engine             | Wine styles one can buy, with structure and a typical price band (a band, never a quote)                                                                                                          |
| Buying recommendation    | `packages/domain/src/buying/recommend.ts`              | S4    | styles, pairing, taste     | Styles ranked for the dish, the budget, the taste and the gaps in the cellar                                                                                                                      |
| Offers                   | `packages/domain/src/buying/offers.ts`                 | S4    | —                          | The `OfferProvider` interface; `validateOffer` (identity, vintage, size, price, currency, merchant, URL, age); the four claim levels. No provider exists, so no server directory is added for one |
| Mentions and group taste | `packages/domain/src/social.ts`                        | S5    | taste-context              | Mention tokens; combining several people's tastes so that nobody's stated dislike is overridden                                                                                                   |
| Friend context           | `apps/web/src/server/friends/` (extended)              | S5    | a new database function    | Resolves `@handle` to an accepted friend's id; reads what that friend allows a friend's sommelier to use (§5)                                                                                     |
| Wine facts for a cellar  | `apps/web/src/server/sommelier/` (repository)          | S3    | `vintage_insights`         | One read of the household's own profiles for the wines in play (RLS: the household's rows only)                                                                                                   |
| Experiences              | `packages/domain/src/experiences/`                     | S6    | pairing engine             | Wine-to-food, comparing two wines, serving and decanting, a menu with one wine per course, guests and quantities                                                                                  |
| Orchestrator             | `apps/web/src/server/sommelier/intelligence.ts`        | S3    | all of the above           | The six steps of §2; returns the V1 answer shape (V1's `source` and `basic` values) plus a versioned `plan`                                                                                       |
| Screens                  | `apps/web/src/features/sommelier/`, `features/tonight` | S3–S6 | the answer's `plan`        | The three outcomes, reasons, constraints, the next question as quick replies, style cards, the mention picker, the consent setting; English and Dutch template wording                            |
| Plan cache               | `apps/web/src/server/sommelier/` (in-request only)     | S7    | —                          | Deterministic work is memoised per request; nothing derived from a person or a friend is cached across requests                                                                                   |
| Outcomes and analytics   | `apps/web/src/server/sommelier/` + a migration         | S7    | —                          | The five separate signals; routing and cost measures                                                                                                                                              |
| Benchmark                | `scripts/sommelier-eval/`                              | S0    | the engines                | Scenarios, reference dish cards, engine adapters (`v1-basic`, later `v3`), scoring                                                                                                                |

**Server-only knowledge.** The food knowledge and the style catalogue are data tables of some size. They are
exported from a second entry of the domain package (`@cellr/domain/intelligence`), which only server code imports;
the client imports types and small constants from `@cellr/domain` as today (D-03). This is enforced, not assumed:
the client's ESLint rules forbid the path, `architecture.test.ts` has a case for it, and a domain test checks that
the main entry does not reach the food data.

**V1 stays.** With the switches off, `createSommelierService` behaves exactly as today: same prompt, same answers,
same tests. The orchestrator is wired in `server/services.ts` only when a switch is on, and falls back to V1's basic
answer if anything in the new path throws.

## 4. Data flow and sources of truth

| Fact                        | Source of truth                                                                                                                           | Never                                                                              |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Which bottles exist         | `cellar()` of the request's household (RLS)                                                                                               | A model's memory of an earlier turn                                                |
| What a dish is              | The food engine's `FoodProfile`; an optional model reading is mapped onto the same closed vocabulary and marked as such                   | Free text from a model used as a fact                                              |
| A wine's structure          | **Exact:** the vintage's profile when it was researched, its evidence is `exact_wine`, its confidence is high and it names a source (the  | A regional estimate reported as the wine's own property                            |
|                             | rule `shareableInsight` already applies). **Appellation:** a profile with `producer` or `appellation_rules` evidence, or the engine's own |                                                                                    |
|                             | appellation and grape rules. **Estimate:** colour and regional style. **Unknown:** colour only                                            |                                                                                    |
| The verdict and the bottles | The pairing engine                                                                                                                        | The model                                                                          |
| What to buy                 | The style catalogue, ranked by the engine. Level "style" unless a provider's offer passed validation                                      | A model-written product, price, shop or link                                       |
| An offer                    | A registered provider, validated per offer, with the time it was observed                                                                 | Anything older than the freshness limit; anything from a source that is not listed |
| Who a mention is            | `my_friends()` of the asking person, matched on handle, accepted only                                                                     | A name the model inferred                                                          |
| What a friend shares        | One database function, called in the same request, that checks friendship, sharing and the AI consent and returns numbers and fixed words | A cached copy from an earlier request; free text written by the friend             |
| The state of a conversation | The answer returns a compact, versioned `state` (dish, budget, channel, the question that was asked, mentions). The screen sends it back  | Server-side memory; assistant text sent back by a client used as a fact            |
|                             | with the next question; the server validates it, treats it as a hint, and re-checks every id against the cellar and the friends (D-12)    |                                                                                    |

## 5. Database and migrations

Nothing in S0–S4 needs a migration. Planned, each as a **new** forward-only migration with a version after
`20261124000047` (PR #88's `system_health`, which must be released first; see `RISK_REGISTER.md` R-03):

| Phase | Migration (working name)   | What                                                                                                                                                                                                                                                                                                                                                                                    |
| ----- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S5    | `…_social_sommelier.sql`   | An explicit consent, off by default ("my friends' sommelier may use my taste"); one SECURITY DEFINER function that returns, for an accepted friend who consented, **closed words and numbers only**: preferred colours, the four structure preferences, and which of a fixed list of styles they rate highly. No wine names, notes, regions as free text, favourites or cellar contents |
| S7    | `…_sommelier_outcomes.sql` | Pairing outcomes (bottle opened, dish, enjoyed or not) as their own table, apart from answer feedback; which engine answered, on feedback                                                                                                                                                                                                                                               |

Until a migration says otherwise, a kept message uses one of V1's six question kinds (the `question_kind` checks of
0046 are on two tables); new kinds of question are mapped onto them. Code that needs a function that is not there
yet fails closed: no friend context, and the answer says so.

No migration is applied anywhere but local test databases. Release order and owner approvals: `RELEASE_PLAN.md`.

## 6. Switches

New entries of `CELLR_FEATURES`, all off unless named (fail closed, as today):

| Switch                  | Turns on                                                                                   | Phase |
| ----------------------- | ------------------------------------------------------------------------------------------ | ----- |
| `sommelier_engine`      | Food engine, pairing engine and wine evidence in the sommelier and in Tonight's basic path | S3    |
| `sommelier_buying`      | Structured buying conversations and style recommendations (needs `sommelier_engine`)       | S4    |
| `sommelier_social`      | `@friend` mentions and group advice (needs `sommelier_engine` and the S5 migration)        | S5    |
| `sommelier_experiences` | Wine-to-food, compare, serving, menus (needs `sommelier_engine`)                           | S6    |

| `sommelier_learning` | Saying what came of a bottle an answer offered (needs `sommelier_engine` and the S7 migration) | S7 |

Without `sommelier_engine` the other four do nothing (tested for each alone).

**`all` does not switch these on** (D-19, decided in S3 after this section was first written): each must be
named. The owner still confirms what `CELLR_FEATURES` holds in Production and Preview before a switch is named
there (R-02).

## 7. Cost and routing

| Question                                     | Path                                                                                   | Model calls |
| -------------------------------------------- | -------------------------------------------------------------------------------------- | ----------- |
| About the cellar itself (how many, where)    | Counted facts (unchanged)                                                              | 0 or 1 (V1) |
| A dish the food engine reads with confidence | Engine decides; template wording; model wording only if AI is on and the budget allows | 0 or 1      |
| A dish it cannot read                        | One small interpretation call onto the closed vocabulary, then as above (S7)           | 1 or 2      |
| Buying, follow-ups                           | State and policy in code; style ranking in code                                        | 0 or 1      |

The wording call sees the plan and at most eight wines instead of the cellar's 120-line digest. Two AI tasks are
added, each listed explicitly in the budget modes (`server/ai/budget.ts` closes any task it does not know):
`sommelier_wording` and `food_interpretation`. V1's `sommelier_chat` stays for V1, so their costs can be told apart
in `ai_usage`. One question spends from the chat rate limit once, whichever path it takes; reading a friend's
context has its own limit. Measured numbers are in `COST_REPORT.md`; nothing here is an estimate presented as a
measurement.

## 8. What is deliberately not built

- No transactions, baskets or affiliate links. A retailer is, at most, a link the person follows.
- No scraping. A provider is an API or a feed with terms that allow this use, approved by the owner.
- No training on conversations or feedback.
- No server-side memory of a conversation's state beyond what V1 already keeps (the last messages, 7 days).
