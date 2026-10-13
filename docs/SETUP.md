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
13. `supabase/seed/001_grapes.sql` (reference data: 160 grape varieties)

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

| File                                      | What it switches on                                                      |
| ----------------------------------------- | ------------------------------------------------------------------------ |
| `20261012000008_tastings.sql`             | Ratings: stars, words and a note after you open a bottle ("How was it?") |
| `20261012000009_wishlist.sql`             | The wishlist: wines you would like to buy, shared with your household    |
| `20261013000010_tighten_photo_bucket.sql` | Photo storage accepts only the sanitised JPEGs the app itself makes      |

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

| Variable          | What it does                                                                                           | Default                     |
| ----------------- | ------------------------------------------------------------------------------------------------------ | --------------------------- |
| `OPENAI_API_KEY`  | Switches reading labels on. Without it, a scan still keeps the photo and you fill the wine in by hand. | _(off)_                     |
| `AI_MODEL_VISION` | The model that reads pictures.                                                                         | `gpt-4.1`                   |
| `AI_BASE_URL`     | Any OpenAI-compatible endpoint.                                                                        | `https://api.openai.com/v1` |

To record what every AI call costs (tokens, time, outcome) the server also needs `SUPABASE_SERVICE_ROLE_KEY`;
without it scanning works and nothing is recorded.

What is sent: only the label photo, to OpenAI, to be read; the scan screen says so. Every person may read about
40 labels per hour (the budget protects the bill); beyond that the photo is still kept and the form is shown.
Photos live in the private `bottle-images` bucket under your household's own folder; the database step that
creates it is migration 0005, which you have already run.

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
