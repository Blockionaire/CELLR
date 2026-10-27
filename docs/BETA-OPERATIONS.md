# CELLR private beta — operations playbook

Internal. How to run the first private beta: who to invite, what to watch, how to triage, and when to stop or
expand. The tester-facing material is `docs/BETA-TESTER-GUIDE.md` (Dutch). The pre-flight list is
`docs/BETA-CHECKLIST.md`. Metric definitions are in `docs/METRICS.md`.

## 1. Cohort and timing

- **First cohort: 5–8 trusted testers.** People who will tell you plainly what is wrong, ideally mixed:
  someone with a real cellar, someone who barely drinks wine, at least two iPhone home-screen users, and
  one pair who share a household.
- **Observation period: about one week** before inviting anyone else. Check `/admin` and the feedback inbox
  daily for the first three days, then every other day.
- **Adding a tester:** put their email (lower case) on the sign-up allowlist in the Supabase SQL editor:
  `insert into private.allowed_signups (entry) values ('name@example.com');`. Then send them the invitation
  text from the tester guide yourself. CELLR sends no invitations.

## 2. What to look at

All of this is already in the read-only admin dashboard; nothing new is collected for the beta.

| Where               | What                                                                                 | Read it as                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `/admin` (Overview) | Registered, onboarded, activated (onboarded + one bottle added), DAU/WAU             | With 5–8 people these are counts, not trends. Who signed up but never added a bottle? Ask them why.         |
| `/admin/users`      | Per person: last activity, households, bottles added                                 | Spot testers who stalled. Never treat an absence of events as "not used": Do Not Track hides client events. |
| `/admin/product`    | Sign-ups, active people, bottles added and opened per day; feature adoption          | Tonight and 3D come from first-party events and are a lower bound (DNT/GPC skip them).                      |
| `/admin/ai`         | Estimated AI spend today / this week / this month, per task and model; budget status | Estimates, not invoices. Compare with the OpenAI dashboard once in the week.                                |
| `/admin/feedback`   | Beta feedback, newest first, counts per category                                     | The main qualitative signal. Turn real problems into GitHub issues by hand, with a P-label.                 |

**AI extraction success is not recognition accuracy.** The `/admin` "AI extraction" rate only says the model
returned a well-formed answer; whether it named the right wine is not stored. Judge recognition from tester
feedback and from watching someone scan.

There are no retention, engagement, error-rate or satisfaction figures for this beta beyond what the
dashboard shows. With a handful of testers, talk to them instead of computing rates.

## 3. Triage: P0, P1, P2

| Priority | Examples                                                                                                                                                                                                        | Response                                                               |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **P0**   | A person sees another household's or person's data (cellar, photos, ratings, taste, feedback); unauthorised access; bottles lost or corrupted; AI spend not stopping at the budget; most testers cannot sign in | Stop inviting. Fix (or roll back) the same day. Tell affected testers. |
| **P1**   | A core journey is broken for a tester: signing in or onboarding, scanning (any mode), adding a bottle, opening or rating one                                                                                    | Fix before the next invitation round.                                  |
| **P2**   | Visual polish, copy inconsistencies, a confusing but workable step, slow but working screens                                                                                                                    | Collect; fix in batches.                                               |

When in doubt between two levels, pick the higher one until you understand it.

## 4. Go / no-go

**Go: invite the next group** (for example 10–15 more) only when all of these hold:

- no open P0, and no open P1 that more than one tester hit;
- `docs/BETA-CHECKLIST.md` sections 0, A and B passed on the hosted environment and at least one real
  iPhone since the last deployment;
- most of the first cohort got from the invitation to a first bottle without your help;
- AI spend for the week is inside the daily and monthly budget, and the OpenAI hard limit is set.

**No-go / pause invitations** when any P0 is open, sign-in fails for more than one person, or AI spend hits
the budget unexpectedly. Existing testers may keep using the app unless the P0 is a privacy issue: then
consider rolling back.

## 5. Deploying and rolling back

- **Deploy** by merging a reviewed PR to `main`; Vercel builds production from it. Check the Preview of the
  PR first on a phone.
- **Database migrations first.** Run a new migration in the Supabase SQL editor before (or right after)
  merging the code that uses it. CELLR keeps working without the newest step (the affected feature says so
  or is hidden), so the order is forgiving. The beta-feedback migration (`20261028000020_beta_feedback.sql`)
  only adds a table and a read-only admin function.
- **Rollback** of the app: Vercel → Deployments → the previous production deployment → _Instant Rollback_
  (or _Promote to Production_). This does not touch the database.
- **Migrations are not rolled back** in a hurry. They are additive; leave a new table in place and roll back
  the code instead. Never drop tables with tester data during the beta.
- After any rollback or hotfix, re-run checklist section B on a phone.

## 6. Feedback is not analytics

Beta feedback is an explicit message a tester chooses to send. It is stored separately from product
analytics (`beta_feedback`, not `analytics_events`):

- only the sender can add it, as themselves (their id comes from the session, never from the request);
- nobody can read it through the app, including the sender and other members of their household;
- it is shown only in `/admin/feedback`, through a service-role-only database function, after the admin
  check (`CELLR_ADMIN_USER_IDS`), and without names or ids;
- it holds only the category, the text, an optional place in the app and an optional coarse device line the
  tester saw before sending. No IP address, full user agent, URL, logs, photos or cellar data;
- it has its own rate limit (10 an hour per person), makes no AI calls, and is deleted with the account.

Do Not Track and Global Privacy Control are respected by the first-party events as before; feedback is not
affected because it is never sent in the background.

## 7. Catalogue learning

Off by default. Switch it on only after the privacy text testers receive mentions it, and after deciding opt-out
or opt-in (docs/CATALOG.md), and after checking that the `catalog-scan-reads-purge` pg_cron job exists (the query
is in docs/CATALOG.md, "Scan readings"). During the beta, review `/admin/catalog` weekly:

- **ready-for-review candidates:** check a public source and approve;
- **conflicts:** correct, merge or reject.

The admin never sees which household confirmed what. Nothing is published without your approval.
