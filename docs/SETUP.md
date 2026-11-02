# Setting up CELLR (Supabase + Vercel)

This is the one-time setup that only you can do, because it involves your accounts and your secrets.
It takes about an hour the first time. Nothing here needs to be sent to anyone: **keys go into Vercel and your
password manager, never into chat, issues or the repository.**

You need free accounts at: **Supabase**, **Vercel**, and an email sender (**Resend** is suggested below).
You do **not** need an OpenAI key yet (that's Phase 2).

---

## 1. Create the Supabase project

_Supabase → New project_

| Field                               | Value                                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------ |
| Name                                | `cellr`                                                                                    |
| Region                              | **Central EU (Frankfurt)** — closest to the Netherlands; the region can't be changed later |
| Database password                   | generate one, store it in your password manager                                            |
| **Enable Data API**                 | ✅ on (the app talks to the database through it)                                           |
| **Automatically expose new tables** | ❌ **off** — CELLR grants access explicitly, table by table                                |
| **Enable automatic RLS**            | ✅ on — a safety net: any future table is locked until a policy opens it                   |

> Why the two switches matter: with "automatically expose" on, every new table would be readable by
> anonymous visitors until someone remembers to lock it. The migrations are written to be safe either way
> (a test proves it), but turning it off removes the foot-gun.

## 2. Create the database

Two equivalent ways. **A is simplest**; B is better once you're comfortable with a terminal.

### A. Paste into the SQL Editor

_Supabase → SQL Editor → New query._ Run these files **in this order**, one at a time
(open each in GitHub, use **Copy raw file**, paste, **Run**; each should end with "Success"):

1. `supabase/migrations/20261010000001_foundation.sql`
2. `…0002_identity_households.sql`
3. `…0003_catalog.sql`
4. `…0004_cellars_bottles.sql`
5. `…0005_storage.sql`
6. `…0006_platform.sql`
7. `…0007_signup_allowlist.sql`
8. `…0008_tastings.sql` (ratings: "how was it?" — added after the first version; see "Updating the database")
9. `…0009_wishlist.sql` (the wishlist — also added later; see "Updating the database")
10. `…0010_tighten_photo_bucket.sql` (photo bucket: JPEG only, 4 MB — also added later)
11. `…0011_bottle_extras_and_insights.sql` (gift/bought, kept-for-an-occasion reminders, AI wine profiles — also added later)
12. `…0012_merge_wines.sql` (merge a wine that was entered twice — also added later)
13. `…0013_push_reminders.sql` (reminders on your phone when a wine is at its best — also added later)
14. `…0014_valuations.sql` (what a bottle is worth, with sources and history — also added later)
15. `…0015_friends.sql` (friends: account names, friend codes, requests and what you share — also added later)
16. `…0016_recommendations_and_pin.sql` (recommending a wine to a friend, and signing in with a PIN — also added later)
17. `supabase/seed/001_grapes.sql` (reference data: 160 grape varieties)

If a file fails, stop: the files are not safe to re-run. Note which file and the error text.

### B. With the Supabase CLI

```bash
pnpm install
pnpm exec supabase login
pnpm exec supabase link --project-ref <your-project-ref>   # the ref is in the project URL
pnpm exec supabase db push --include-seed                   # asks for the database password
```

### Updating the database later

New features sometimes need one more database step. They arrive as a new numbered file in
`supabase/migrations/`. Run only the files **you have not run yet**, in order, the same way as above
(SQL Editor → New query → paste → Run → "Success"). Nothing breaks while you wait: the app notices a
missing step and simply leaves that feature switched off.

| File                                            | What it switches on                                                                            |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `20261012000008_tastings.sql`                   | Ratings: stars, words and a note after you open a bottle ("How was it?")                       |
| `20261012000009_wishlist.sql`                   | The wishlist: wines you would like to buy, shared with your household                          |
| `20261013000010_tighten_photo_bucket.sql`       | Photo storage accepts only the sanitised JPEGs the app itself makes                            |
| `20261014000011_bottle_extras_and_insights.sql` | Where a bottle came from (bought / gift), a day to keep it for, and the AI wine profile        |
| `20261015000012_merge_wines.sql`                | Merging a wine that was entered twice                                                          |
| `20261018000013_push_reminders.sql`             | Reminders on your phone when a wine is at its best (also needs the keys below)                 |
| `20261019000014_valuations.sql`                 | What a bottle is worth, looked up on the web with sources, kept as a history (value over time) |
| `20261020000015_friends.sql`                    | Friends: an account name and friend code, friend requests, and sharing ratings/taste/cellar    |
| `20261021000016_recommendations_and_pin.sql`    | Recommending a wine to a friend, and signing in with a 6-digit PIN instead of an email code    |

**`20261109000032_bottle_library_repair.sql` (run it even if you ran everything else).** The bottle-library
migration `20261105000028` was changed after it had first been published, so a database that ran the first version
kept old definitions: `/admin/bottle-photos` then fails ("Something went wrong") and publishing a 2D picture is
refused. This step re-creates exactly what the current `20261105000028` defines. It changes no rows and is safe to run
more than once. Rule for the future: a migration that may have been run is never edited; changes go in a new file.

### Check it worked

Run this in the SQL Editor:

```sql
select
  (select count(*) from public.grapes)                                           as grapes,                -- 160
  (select count(*) from storage.buckets
     where id in ('bottle-images','tasting-images','user-avatars','wine-labels')) as buckets,                -- 4
  (select count(*) from pg_tables
     where schemaname = 'public' and not rowsecurity)                            as tables_without_rls,    -- 0
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r','v','m','p')
       and (has_any_column_privilege('anon', c.oid, 'select,insert,update,references')
            or has_table_privilege('anon', c.oid,
                 'select,insert,update,delete,truncate,references,trigger'))) as tables_anon_can_touch, -- 0
  (select count(*) from pg_trigger
     where tgname in ('on_auth_user_created','a_enforce_signup_allowlist')
       and not tgisinternal)                                                     as auth_triggers;         -- 2
```

(The seed file lists 161 rows but `Semillon` and `Sémillon` are the same grape once accents are ignored,
so 160 are stored.)

## 3. Configure sign-in (email code)

CELLR signs people in with a **6-digit code typed into the app**, not a magic link. (On iPhone a link tapped in
Mail opens Safari instead of the installed app, so the session lands in the wrong place.)

**Order matters: Supabase only lets you edit the email templates after custom SMTP is switched on.**

1. _Authentication → Sign In / Providers → Email_: provider **on**, **Confirm email** on,
   **Email OTP length = 6**, **expiry = 900** seconds. Leave **Allow new users to sign up** on:
   the private-beta gate (step 4) lives in the database. Don't enable other providers.
2. **Custom SMTP — do this before inviting anyone, and before editing templates.** Supabase's built-in mailer
   only delivers to your own team's addresses and allows about 2 emails per hour.
   _Resend_ (free tier): create an account → create an API key (_Sending access_), then in
   _Supabase → Authentication → Emails → SMTP Settings_ switch **Enable custom SMTP** on:

   | Field                     | Value                                                                |
   | ------------------------- | -------------------------------------------------------------------- |
   | Sender email              | an address on your verified domain, e.g. `login@mail.yourdomain.nl`  |
   | Sender name               | `CELLR`                                                              |
   | Host / Port               | `smtp.resend.com` / `465`                                            |
   | Username / Password       | `resend` / the Resend API key                                        |
   | Minimum interval per user | **30** seconds (the app's "send a new code" countdown is 30 seconds) |

   **Domain:** to email arbitrary people, add and verify a domain in Resend (_Domains → Add Domain_, a
   subdomain such as `mail.yourdomain.nl` is fine; add the DNS records exactly as shown, then _Verify_).
   **No domain yet?** Use Resend's test sender `onboarding@resend.dev` as _Sender email_: it only delivers to
   the address your Resend account was created with, which is enough to sign in yourself. Switch the field
   to your own domain later.

3. _Authentication → Emails → Templates_: edit **both** _Confirm sign up_ **and** _Magic link or OTP_
   (new users get the first, returning users the second). For each:
   - **Subject:** `Your CELLR code`
   - **Body → Source tab:** select everything, delete it, and paste the whole of `supabase/templates/otp.html`
     (it contains `{{ .Token }}`, which becomes the code). Check the **Preview** tab: it must show "CELLR",
     "Your sign-in code:" and a large number, and **no link**. If the old "Follow the link below" text is
     still there, the paste was added to the old content instead of replacing it.
   - **Save changes.**
4. _Authentication → Rate Limits_: raise **emails per hour** (e.g. 30).
5. _Authentication → URL Configuration_: set **Site URL** to your Vercel URL (step 5). Codes don't use it,
   but Supabase requires one.

## 4. Private beta: who may create an account

Anyone with your URL could otherwise create an account (and, later, spend your AI budget). The gate is a
**database trigger**, so it can't be bypassed by calling Supabase directly. Manage the list in the SQL Editor
(emails must be **lower-case**):

```sql
-- allow specific people
insert into private.allowed_signups (entry, note) values
  ('merel@example.com', 'Merel'),
  ('tom@example.com',   'Tom');

-- or a whole family domain
insert into private.allowed_signups (entry) values ('@ourfamily.nl');

-- see / remove
select * from private.allowed_signups;
delete from private.allowed_signups where entry = 'tom@example.com';
```

**An empty list means sign-up is open**, so add yourself before deploying. People who already have an account
are never locked out by changes to the list. Someone not on the list sees: _"CELLR is invite-only for now,
and this email isn't on the list yet."_ (no email is sent to them).

## 5. Deploy on Vercel

The free **Hobby** plan is meant for personal, non-commercial use, which fits a friends-and-family project.

1. _Vercel → Add New → Project →_ import `Blockionaire/cellr` (if it isn't listed: _Adjust GitHub App
   Permissions_, pick the organization, tick the repository).
2. **Root Directory must be `apps/web`**, with **"Include source files outside of the Root Directory in the Build
   Step"** on (the app uses the shared `packages/domain`). The picker on the import screen only lists folders
   that exist on the repository's default branch, so until the app is on `main` you can't pick it there:
   import with `./` (that first build fails, which is expected), then set it in _Settings → Build and
   Deployment_. `apps/web/vercel.json` already pins functions to **Frankfurt (`fra1`)**, next to the database.
3. _Project → Environment Variables_ (a separate menu item from _Settings → Environments_, which is
   something else), from _Supabase → Project Settings → API Keys_ and _Data API_:

   | Name                                   | Value                            | Environments       | Notes                                                                 |
   | -------------------------------------- | -------------------------------- | ------------------ | --------------------------------------------------------------------- |
   | `NEXT_PUBLIC_SUPABASE_URL`             | `https://<ref>.supabase.co`      | Production+Preview | public; no trailing slash                                             |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…`               | Production+Preview | public by design; protected by row-level security                     |
   | `SUPABASE_SERVICE_ROLE_KEY`            | the **secret** key `sb_secret_…` | Production+Preview | **mark as Sensitive.** Bypasses all security; only the server uses it |
   | `DESIGN_GALLERY`                       | `1`                              | **Preview only**   | Enables `/design` for reviewing the design system on your phone       |

   Set these _before_ the build you care about (`NEXT_PUBLIC_*` values are compiled in).

4. _Settings → Build and Deployment → Node.js Version_: **22.x** (the version the project is tested on).
5. _Settings → Deployment Protection_: switch **Vercel Authentication off**, otherwise your phone (and your
   guests) meet a Vercel login page instead of CELLR. Access is controlled by the sign-up allow-list.
6. Push to the branch (or merge to `main`). Preview builds appear under _Deployments_; open the URL.

## 6. First run — and installing it on your phone

1. Open the deployed URL → enter your email → type the 6-digit code.
2. Create your household, enter your name. You land on Home.
3. _Profile → Invite someone_ → send the code to a second person → they sign in, choose **Join with a code**.
4. **iPhone:** Safari → Share → **Add to Home Screen**. Open it from the icon: it runs full-screen.
   **Android:** Chrome menu → **Install app**.
5. Try airplane mode: you should get the friendly _"You're offline"_ page, not a browser error.
6. Open `/design` on a Preview deployment and look at it on your phone — **tell me what feels off**
   (fonts, spacing, colour). Those are cheap to change now and expensive later.

### Turning on label scanning (optional)

Scanning reads the front label of a bottle with an AI model and fills in the wine. It needs one setting in
Vercel (_Settings → Environment Variables_, then redeploy): `OPENAI_API_KEY`. **Put the key in Vercel only; never
paste it into a chat or a file in the repository.**

"Code default" is what the app uses when the variable is not set at all. "Suggested" is only an example
value; nothing is set for you.

| Variable                | What it does                                                                                                                                         | Code default (unset)         | Suggested        |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ---------------- |
| `OPENAI_API_KEY`        | Switches AI on. Without it, a scan still keeps the photo and you fill the wine in by hand.                                                           | _(off)_                      |                  |
| `AI_MODEL_VISION`       | Label scanning.                                                                                                                                      | `gpt-6-luna`                 |                  |
| `AI_MODEL_CHAT`         | Wine valuations with web search, and the fallback for `AI_MODEL_ADVICE`.                                                                             | `gpt-6-luna`                 |                  |
| `AI_MODEL_ADVICE`       | Sommelier, Tonight and wine profiles.                                                                                                                | the value of `AI_MODEL_CHAT` |                  |
| `AI_REASONING_EFFORT`   | Only sent to models with a documented effort (today: `gpt-6-luna`): `none`, `low` or `medium`. Valuations with web search always use at least `low`. | `none`                       |                  |
| `AI_BUDGET_DAILY_USD`   | Platform-wide AI budget per UTC day, in US dollars (an estimate; see docs/METRICS.md).                                                               | no limit                     | `5`              |
| `AI_BUDGET_MONTHLY_USD` | Platform-wide AI budget per UTC month, in US dollars.                                                                                                | no limit                     | `50`             |
| `CELLR_ADMIN_USER_IDS`  | Who may open the internal `/admin` dashboard: Supabase Auth user ids (UUIDs), comma-separated. Server only.                                          | nobody (fails closed)        | your own user id |
| `AI_BASE_URL`           | Any OpenAI-compatible endpoint.                                                                                                                      | `https://api.openai.com/v1`  |                  |

To record what every AI call costs (tokens, time, outcome) the server also needs `SUPABASE_SERVICE_ROLE_KEY`;
without it scanning works and nothing is recorded.

What is sent: only the label photo, to OpenAI, to be read; the scan screen says so. Every person may read about
40 labels per hour (the budget protects the bill); beyond that the photo is still kept and the form is shown.
Photos live in the private `bottle-images` bucket under your household's own folder; the database step that
creates it is migration 0005, which you have already run.

### What a bottle is worth (value with sources)

With `OPENAI_API_KEY` set and the database step `20261019000014_valuations.sql` run, the app looks up what one
bottle sells for today: the AI searches the web (shops, merchants, auctions) and only pages the search provider reports
as consulted count as sources (the exact page, not just the site); the price, vintage and bottle size are what the AI
read on those pages, not independently checked. Without such a page nothing is kept. Each lookup is kept, so the cellar's value can be shown over
time. A new lookup is possible at most once a month per wine (and about 30 per hour per person); one lookup costs
roughly 3 cents. The first lookup happens by itself after a wine is added; the wine page has a button for the
next one. Values from older wine profiles become the first entry of each history when the step is run.

The wine profile itself (description, taste, aromas, dishes) is written once and then stays as it is; asking again
only fills in parts an older profile did not have yet.

### Turning on reminders on your phone (optional)

Once a day the app checks every cellar and sends a notification when a wine has reached its best years, or the
last stretch of them ("drink it soon"). Each wine is told once, and only wines with a window of their own (from
the wine's AI profile, or set by you) are told about: a rough estimate never sends a reminder. It needs the database step
`20261018000013_push_reminders.sql`, `SUPABASE_SERVICE_ROLE_KEY` (already set above) and four settings in Vercel
(_Settings → Environment Variables_, Production, then redeploy). **Put them in Vercel only; never in a chat or a
file in the repository.**

1. Make a key pair on your own computer, in the project folder: `pnpm --filter @cellr/web exec web-push generate-vapid-keys`.
   It prints a _Public Key_ and a _Private Key_.
2. Add them to Vercel:

   | Variable            | Value                                                                          |
   | ------------------- | ------------------------------------------------------------------------------ |
   | `VAPID_PUBLIC_KEY`  | the Public Key                                                                 |
   | `VAPID_PRIVATE_KEY` | the Private Key (**mark as Sensitive**)                                        |
   | `VAPID_SUBJECT`     | `mailto:` + your own email address, e.g. `mailto:you@example.com`              |
   | `CRON_SECRET`       | any long random text (**mark as Sensitive**); Vercel sends it to the daily job |

3. Redeploy. The daily job is in `apps/web/vercel.json` (`/api/cron/drink-reminders`, 08:00 UTC); you can see it
   under _Settings → Cron Jobs_ in Vercel.
4. On your phone: Profile → Reminders → _Turn on for this phone_. On an iPhone this only works when CELLR is on
   the home screen (Share → Add to Home Screen) and opened from there. Each phone is switched on by itself.

Without these settings the Reminders card simply does not appear; Home still shows which wines are at their best.

### Bringing your old Wijnkelder cellar over

_Profile → Bring your cellar over_. In the old Wijnkelder app make a backup (a small `.json` file), choose it
there, read the report of what would come over, then confirm. Nothing is written before you confirm.
You get: one bottle per physical bottle (the old app kept a count), racks with the spots they were in, wines
you already drank (with the day), your tasting notes and scores (turned into half stars) and your favourites.
Whatever cannot be understood (an unknown country, an impossible year, a note about a bottle that is not in the
file) is listed, never guessed in silence. Do it once: doing it again adds everything a second time.
Run the ratings step (migration 0008, see "Updating the database") **before** you import if you want your old
scores and notes: without it the cellar still comes over, but the ratings are left out and the screen says so.

## 7. Working on it locally

```bash
pnpm install
pnpm check                      # format, lint, types, unit tests, database permission suite
pnpm db:types                   # regenerate database types after changing a migration

# Run the whole backend on your machine — no Docker, no Supabase account:
bash scripts/local-stack/up.sh  # Postgres + PostgREST + a small fake Auth, on http://localhost:54321
# in another terminal, apps/web/.env.local:
#   NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321
#   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_localstack_0000000000
#   SUPABASE_SERVICE_ROLE_KEY=sb_secret_localstack_00000000000000
pnpm dev

pnpm e2e                        # the full browser test suite against that stack (builds first: pnpm build)
```

The sign-in code in local mode is not emailed: `curl "http://localhost:54321/__test/otp?email=you@example.com"`.

## 8. If something goes wrong

| Symptom                                                 | Likely cause                                                                     |
| ------------------------------------------------------- | -------------------------------------------------------------------------------- |
| No email arrives                                        | SMTP not set up (step 3.2), or the sender domain isn't verified                  |
| Email templates can't be edited ("Set up custom SMTP")  | Switch on custom SMTP first (step 3.2), then edit the templates                  |
| The email still contains a link instead of a code       | A template still has the old text: replace its whole body (step 3.3)             |
| "invite-only" message for someone you want in           | Add them to `private.allowed_signups` (step 4), in lower-case                    |
| `permission denied for table …` in logs                 | A migration didn't run, or ran out of order — re-check step 2                    |
| Root Directory picker on Vercel shows no folders        | The app isn't on `main` yet: set `apps/web` in _Settings → Build and Deployment_ |
| Build fails: "Missing or invalid environment variables" | Step 5.3 — set them for the right environment, then redeploy                     |
| Preview shows a Vercel login page                       | Turn off _Deployment Protection → Vercel Authentication_ (step 5.5)              |
| Sign-in works, then you bounce back to the sign-in page | `NEXT_PUBLIC_SUPABASE_URL` doesn't match the project the keys belong to          |
| Codes say "invalid or expired" immediately              | The email template doesn't contain `{{ .Token }}` (step 3.3)                     |

## Security reminders

- The **publishable** key and project URL are public by design. The **secret** key (`sb_secret_…`) is not:
  it lives only in Vercel (Sensitive) and your password manager. If it ever leaks, rotate it in Supabase immediately.
- CI scans every build for server secrets in the browser bundle and every commit for leaked keys.
- Each person's data is isolated by the database itself (row-level security), proven by an automated suite
  that attacks it the way an outsider would.

### gpt-6-luna for every AI feature

From this release the code defaults are `gpt-6-luna` for everything. **A variable that is already set in Vercel
still wins**: if `AI_MODEL_VISION=gpt-4.1` or `AI_MODEL_CHAT=gpt-4.1-mini` is set there, those features keep
the old model until you change it.

| Feature                          | Variable that decides it                 | Luna                                         | Roll back to                   |
| -------------------------------- | ---------------------------------------- | -------------------------------------------- | ------------------------------ |
| Label scanning                   | `AI_MODEL_VISION`                        | remove it, or set `gpt-6-luna`               | `AI_MODEL_VISION=gpt-4.1`      |
| Valuations (web search)          | `AI_MODEL_CHAT`                          | remove it, or set `gpt-6-luna`               | `AI_MODEL_CHAT=gpt-4.1-mini`   |
| Sommelier, Tonight, wine profile | `AI_MODEL_ADVICE` (else `AI_MODEL_CHAT`) | remove both, or `AI_MODEL_ADVICE=gpt-6-luna` | `AI_MODEL_ADVICE=gpt-4.1-mini` |

Every change needs a redeploy. Rolling one feature back leaves the others on Luna.

**Preview first.** In Vercel, check _Settings → Environment Variables_ for the three model variables. For the
**Preview** environment only, remove them (or set them to `gpt-6-luna`), leave `AI_REASONING_EFFORT` unset, and
redeploy the preview. Then check, on the preview:

1. **Labels:** scan 2–3 different bottles (a classic French label, a New World label, one with a hard-to-read
   vintage). Producer, wine, vintage and region are filled in; a non-label photo still falls back to typing.
2. **Sommelier:** ask "Hoeveel flessen heb ik?" and get the counted answer.
3. **Tonight:** pick a dish; the suggestions are your own bottles.
4. **Wine profile:** generate one for a wine without a profile (one short web search, at most two searches);
   it names the grapes and how it is made when sources say so, shows the source links and what it rests on
   ("Based on pages found about this wine." or a discreet estimate note), and never opens with "unknown". An
   older profile that was not sure of itself shows "Write it again": once rewritten from research it does not
   offer that again. If the search fails, an existing profile stays as it was; a new one is written without
   search and may offer "Look it up again" a day later.
5. **Valuation:** look up a value; it shows a price with source links. Open the links and check by eye that
   each is this wine, this vintage, 75 cl (the app trusts the provider's list of pages and the AI's reading of
   them; it does not crawl the pages itself). One site reads as "One shop's asking price", several as a range
   "in shops and auctions" (or there is honestly no price).
6. **Costs:** in Supabase, `select task, model, status, tokens_in, tokens_out, web_search_calls, cost_usd_micro
from ai_usage order by at desc limit 10;` shows `gpt-6-luna…` rows, status `ok`, a cost filled in, and
   `web_search_calls` ≥ 1 on the valuation.

All good: make the same change for **Production** and redeploy. Anything wrong: roll back that one feature with
the table above.

### Internal admin dashboard (`/admin`)

Read-only overview of users, product analytics and AI costs. To open it:

1. Run `supabase/migrations/20261026000018_admin_dashboard.sql` in the Supabase SQL editor (read-only functions,
   service role only; nothing changes for app users). Until then the pages say the database step is missing.
2. Find your user id in Supabase → _Authentication → Users_ (the UUID, not your email).
3. In Vercel set `CELLR_ADMIN_USER_IDS` to that id (several: comma-separated, no spaces needed) and redeploy.
   `SUPABASE_SERVICE_ROLE_KEY` must be set too.

Anyone else (signed out, signed in without being listed, or with a malformed list) gets the normal sign-in or
"not found" page. The dashboard is not linked from the app and is marked `noindex`, `no-store`.

**Beta feedback inbox (`/admin/feedback`).** Run `supabase/migrations/20261028000020_beta_feedback.sql` in the
SQL editor (one table and one read-only, service-role-only function; nothing changes for existing data). Until
then sending from the in-app "Share feedback" form fails with a plain error (the text stays in the form) and the
inbox page says the step is missing.
The inbox shows what testers sent from Profile → Share feedback: date, category, their text and the optional
place and device line they chose to include, newest first, filterable by category. It shows no names or ids.
Why this is kept apart from product analytics, and how it is protected: `docs/BETA-OPERATIONS.md` §6.
