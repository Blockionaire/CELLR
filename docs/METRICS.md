# Metrics, AI costs and the AI budget

Internal reference for what the numbers mean. Counted by `public.platform_metrics()` (service role only) and
derived in `packages/domain/src/metrics.ts`.

## Activity and users

**Activity** is what people did in the database: AI calls (except ones the budget blocked), bottles added and
opened, tastings, joining a household, signing in (`auth.users.last_sign_in_at`), plus the optional
first-party events. Someone with do-not-track is never counted as inactive: their database activity counts
on its own.

| Metric                 | Definition                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------- |
| Registered             | Accounts (`profiles`).                                                              |
| New (7d / 30d)         | Accounts created in the last 7 / 30 days.                                           |
| DAU / WAU / MAU        | Distinct people with any activity in the last 1 / 7 / 30 days (rolling, UTC).       |
| Onboarded              | Has a display name and belongs to a household (the app's own onboarding rule).      |
| Activated              | Onboarded and has added at least one bottle. Rate = activated ÷ registered.         |
| 7-day retention        | Cohort: signed up 7–14 days ago. Retained: active again 7–14 days after signing up. |
| Scan success (30d)     | AI label reads that came back usable ÷ reads that reached the provider.             |
| Feature adoption (30d) | Distinct people per feature; also as a share of MAU.                                |

Rates are `null` ("insufficient data") when there is nothing to divide by. First bottle added, account
created and onboarding completed are taken from the database, not from client events.

**Client events** (`analytics_events`, first-party, skipped under Do Not Track / GPC): scans, bottles,
ratings, Sommelier questions, Tonight recommendations (now their own event, never also counted as a
Sommelier question), 3D cellar opened (once per opening) and imports. They add detail; they are never the
only source for a headline number.

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
- When the usage is recorded the hold is released. A hold that is never released stops counting after
  15 minutes.
- Over budget: the call is not made. The feature takes its existing plain, no-AI path (the Sommelier says
  its limit is reached; scans fall back to typing the wine in). Everything else in the cellar keeps working.
- If the budget cannot be checked (no service role, migration not applied, database error), the call goes
  ahead and the error is logged. A broken guard does not switch AI off for everyone.

**Limitations.**

- This is an application-level guard, not a provider spending cap. Set a hard limit in the OpenAI
  dashboard as well.
- Estimates can be wrong in either direction for a single call.
- Usage from outside this app is not seen.
- A call that runs longer than 15 minutes can let its hold expire before it is recorded.
- Per-user rate limits are unchanged and still apply first.
