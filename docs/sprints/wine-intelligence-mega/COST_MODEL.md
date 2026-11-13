# Cost model of the Wine Intelligence epic

What this epic adds to, and removes from, the AI bill. Every number is either read from the code or measured on the
local stack; none is a provider invoice. Prices: `apps/web/src/server/ai/pricing.ts` (`openai-2026-10-25`).

## 1. New paid model calls: none

| Flow                                   | Model calls added | How that is known                                                                                |
| -------------------------------------- | ----------------: | ------------------------------------------------------------------------------------------------ |
| Wine search (WI-02)                    |                 0 | Postgres only; e2e asserts no `ai_usage` row after a full Koopcheck by search                    |
| Scan resolver (WI-03)                  |                 0 | Same single vision call as before, or none on the text path; unit test "no extra model call"     |
| Koopcheck knowledge (WI-04)            |                 0 | Two reads; e2e asserts the model-call count and `ai_usage` are unchanged after three comparisons |
| Sources section (WI-05), admin (WI-06) |                 0 | Read-only                                                                                        |

The optional AI explanation of a verdict (brief WI-04 §4) was not built (ADR-003, decision 10).

## 2. Calls removed

| Change                             | Saves                                                 | Size, honestly                                                                                                                                                              |
| ---------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Research claim (migration `…0039`) | the second of two simultaneous first profile requests | One research call. Its hold is about USD 0.025 at the listed `gpt-6-luna` rates (two web searches at USD 0.01 each dominate). Rare today; grows with users per popular wine |
| Koopcheck reuses a shared profile  | nothing directly: Koopcheck never generated a profile | It makes the existing profile useful a second time; it does not avoid a call                                                                                                |
| Scan resolver                      | nothing in model cost                                 | It bounds database work, not model work                                                                                                                                     |

The saving from reading printed text instead of asking the vision model is Sprint S's, unchanged here. Its real size
is unknown until real labels are measured (`REAL_LABEL_VALIDATION_PENDING`); the synthetic golden set (7 of 15 texts)
is not a forecast.

## 3. Database cost added

| Flow                | Per action                                                    | Bound                                                             | Measured (local, 100k external + 10k catalogue rows)                                  |
| ------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Wine search         | 1 `catalog_search` call per pause in typing (250 ms debounce) | 600 per person per hour; 20 rows; one request in flight per field | SQL p95 98 ms at 16 clients (`SEARCH_PERFORMANCE.md`); through the app p95 105–255 ms |
| Scan resolver       | own wines + 1 producer lookup (≤ 40) + 1 search (20)          | per scan; scans are limited to 40 per person per hour             | not separately measured                                                               |
| Koopcheck knowledge | 1 wine row + ≤ 30 shared profiles of that wine                | 120 comparisons per person per hour                               | not separately measured                                                               |
| Research claim      | 1 upsert + 1 bounded delete, only before a research call      | profiles are limited to 40 per person per hour                    | not separately measured                                                               |

## 4. What bounds spending, and what does not (unchanged facts, see `SECURITY_AND_PRIVACY.md` §4)

- Per person: rate limits, which fail **closed**.
- Platform: `AI_BUDGET_DAILY_USD` / `AI_BUDGET_MONTHLY_USD`, an application-level estimate. For the five existing
  tasks it fails **open** when it cannot be checked, and is unlimited when not configured. `pnpm db:test:budget`
  shows the hold itself is race-free (20 concurrent requests, room for 7: 7 granted).
- New in WI-04: `BUDGET_MODES`. A task not listed there is refused when the budget cannot be checked **or is not
  configured**. Adding a task to `AiTask` does not compile until its mode is written down. No task uses "closed"
  today, because no new paid task exists.

**Owner action, outside this repository:** set a hard monthly spending limit at the model provider. An application
budget is an estimate and can fail open; the provider's cap is the only limit that cannot. Not done by this session
(no provider account was touched).

## 5. Not known

- The provider's actual bill for any of this.
- How often two households first-request the same vintage at once (the claim's real saving).
- The share of real labels read without the model.
