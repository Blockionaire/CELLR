# Metrics, AI costs and the AI budget

Internal reference for what the numbers mean. Counted by `public.platform_metrics()` (service role only) and
derived in `packages/domain/src/metrics.ts`.

## Activity and users

**Activity** is what people did in the database: AI calls (except ones the budget blocked), bottles added and
opened, tastings, joining a household, signing in (`auth.users.last_sign_in_at`), plus the optional
first-party events. Someone with do-not-track is never counted as inactive: their database activity counts
on its own.

| Metric                 | Definition                                                                                                     |
| ---------------------- | -------------------------------------------------------------------------------------------------------------- |
| Registered             | Accounts (`profiles`).                                                                                         |
| New (7d / 30d)         | Accounts created in the last 7 / 30 days.                                                                      |
| DAU / WAU / MAU        | Distinct people with any activity in the last 1 / 7 / 30 days (rolling, UTC).                                  |
| Onboarded              | Has a display name and belongs to a household (the app's own onboarding rule).                                 |
| Activated              | Onboarded and has added at least one bottle. Rate = activated ÷ registered.                                    |
| 7-day retention        | Cohort: signed up 7–14 days ago. Retained: active again 7–14 days after signing up.                            |
| AI extraction (30d)    | AI label-extraction calls that returned valid structured output ÷ calls that reached the provider (see below). |
| Feature adoption (30d) | Distinct people per feature; also as a share of MAU.                                                           |

**AI extraction success is not scan success.** It counts whether the provider call for a label photo returned
output that passed its schema (`ai_usage.status = 'ok'` vs `error` / `timeout` / `invalid_output`). A valid answer
can still say "this is not a label" or name a wine the person then corrects; whether a scan actually recognised
the right wine is not stored on the server, so it is not measured here. Calls the budget blocked are excluded.

Rates are `null` ("insufficient data") when there is nothing to divide by. First bottle added, account
created and onboarding completed are taken from the database, not from client events.

**Client events** (`analytics_events`, first-party, skipped under Do Not Track / GPC): scans, bottles,
ratings, Sommelier questions, Tonight recommendations (now their own event, never also counted as a
Sommelier question), 3D cellar opened (once per opening) and imports. They add detail; they are never the
only source for a headline number.

**Beta feedback is not a metric.** What testers send from Profile → Share feedback lives in its own table
(`beta_feedback`), never in `analytics_events`, and is never counted or joined into these numbers. It is an
explicit message, readable only in `/admin/feedback` (see `docs/BETA-OPERATIONS.md` §6).

## AI cost (estimate)

- **Unit:** US dollars, stored as micro-USD (`ai_usage.cost_usd_micro`, 1 USD = 1 000 000).
- **How:** the usage the provider reported for the call (all attempts, including a repair) times the
  versioned price list in `apps/web/src/server/ai/pricing.ts` (`pricing_version` on every row).
  - Cached input is priced at the cached rate.
  - Web search adds its per-call fee. For mini models it also adds the fixed search-content tokens; this
    errs high.
  - The model is the one the provider says answered.
- **Unknown stays unknown:** no usage reported (timeout, dropped connection, error answer) or a model without
  a price gives `NULL`, never 0. Rows from before this change keep `NULL`; the legacy `cost_micro` column is
  always 0 and is not used.
- **Confirmed 0:** only a call the budget blocked before anything was sent (`status = 'budget_exhausted'`).
- **Not the bill:** this is an estimate for watching spend per user, household, task, model and day. The
  provider's invoice is the truth.
- **New prices or models:** add a new `PRICING_VERSION` and entry; recorded rows are never repriced.

## Platform AI budget

Optional server environment variables, plain dollars: `AI_BUDGET_DAILY_USD` and `AI_BUDGET_MONTHLY_USD`.
Unset, empty or invalid means no limit of that kind. Calendar day and month are counted in UTC.

- Before every AI call, a deliberately high estimate is **held** with `public.ai_budget_hold`. Holds are
  serialised by an advisory lock, so simultaneous calls cannot both take the last room
  (`scripts/db-budget-concurrency.sh` checks this with 20 parallel sessions).
- **Spent** = recorded costs since the start of the UTC day / month. A call whose cost is unknown counts with
  its hold. Every call still in flight counts too.
- The hold is released only after the call's usage row has been durably written. If that write fails (or
  the process dies first), the hold is kept and keeps counting as spent for its UTC day and month: spending
  that was never accounted for is not forgotten. Holds from earlier months are cleared.
- Over budget: the call is not made. The feature takes its existing plain, no-AI path (the Sommelier says
  its limit is reached; scans fall back to typing the wine in). Everything else in the cellar keeps working.
- If the budget cannot be checked (no service role, migration not applied, database error), the call goes
  ahead and the error is logged. A broken guard does not switch AI off for everyone.

**Limitations.**

- This is an application-level guard, not a provider spending cap. Set a hard limit in the OpenAI
  dashboard as well.
- Estimates can be wrong in either direction for a single call.
- Usage from outside this app is not seen.
- An unreleased hold counts its (deliberately high) estimate, not the real cost, so after failed writes the
  budget errs on the careful side until the day / month rolls over.
- A usage report missing its input or output token count is treated as unknown (NULL cost, counted with its
  hold), never as zero. A missing cached-token count only means nothing is priced as cached (errs high).
- Per-user rate limits are unchanged and still apply first.

## Admin dashboard (`/admin`)

Read-only, for allowlisted admins (`CELLR_ADMIN_USER_IDS`). It shows the figures above from
`platform_metrics()`, plus `admin_*` functions (20261026000018_admin_dashboard.sql, service role only):

- **Users**: a paginated directory (25 per page, newest first) with signup date, last known activity (latest
  database action, first-party event or sign-in), onboarding/activation, households and bottles added. A user page
  shows counts only: no notes, messages, AI conversations, emails or tokens.
- **Product analytics**: per UTC day for 7, 30 or 90 days: sign-ups, active people (same activity as DAU), scans
  and AI extraction outcomes, Sommelier, wine profiles, valuations (all from `ai_usage`, calls blocked by the
  budget excluded), Tonight and 3D cellar (first-party events: a lower bound under Do Not Track / GPC), and
  bottles added. Engagement figures count uses, not people; adoption counts people.
- **AI & costs**: estimated spend (sum of `cost_usd_micro`) today, last 7 days, this month and per day; calls
  with unknown cost (`cost_usd_micro` NULL) shown apart with the amount the budget held for them; outcomes (rates
  over calls that reached the provider), tokens, web searches and their per-call fees ($10 / 1 000; search
  content tokens are inside input tokens and cannot be separated), average latency of successful calls; by task
  and by model. The legacy `cost_micro` is never read.
- **Recognition cache** (on the AI & costs page, 20261029000021_recognition_cache.sql): scans answered from an
  earlier confirmed identical photo (hits = vision calls avoided), scans that were not (misses), and the hit rate
  over scans that looked. Counted per scan photo in `bottle_images.cache_result`, never in `ai_usage` (a hit is
  not an AI call), and with no fingerprint, photo or person in the figures.
- **Shared wine profiles** (AI & costs page, 20261030000022_shared_wine_profiles.sql): profiles reused from the
  shared cache (hits = paid `wine_insight` research calls avoided), catalogue wines researched after looking
  (misses), the hit rate over those, the actual `wine_insight` calls, the number of shared profiles and those older
  than 12 months (for review only). Counted per household profile in `vintage_insights.cache_result`, never in
  `ai_usage`; the figures name no household.
- **Wine catalogue** (AI & costs page, 20261031000023_catalog_activation.sql): canonical producers, wines,
  aliases and vintages; bottles added in the window on catalogue wines vs the households' own wines (the share is
  the practical "found in the catalogue" rate: scans and typed wines both end in a bottle); own wines created.
  Counts only, nothing per person.
- **Platform budget**: recorded usage (cost, or hold when unknown) plus outstanding holds, against
  `AI_BUDGET_DAILY_USD` / `AI_BUDGET_MONTHLY_USD`. A hold is deleted when its usage is recorded, so nothing is
  counted twice (apart from the instant between the two writes). It is an application guard, not a provider cap.
