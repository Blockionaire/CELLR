# Setting up CELLR (Supabase + Vercel)

This is the one-time setup that only you can do, because it involves your accounts and your secrets.
It takes about 30 minutes. Nothing here needs to be sent to anyone: **keys go into Vercel and your password
manager, never into chat, issues or the repository.**

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
(open each in GitHub, copy all, paste, **Run**; each should end with "Success"):

1. `supabase/migrations/20261010000001_foundation.sql`
2. `…0002_identity_households.sql`
3. `…0003_catalog.sql`
4. `…0004_cellars_bottles.sql`
5. `…0005_storage.sql`
6. `…0006_platform.sql`
7. `…0007_signup_allowlist.sql`
8. `supabase/seed/001_grapes.sql` (reference data: 161 grape varieties)

### B. With the Supabase CLI

```bash
pnpm install
pnpm exec supabase login
pnpm exec supabase link --project-ref <your-project-ref>   # the ref is in the project URL
pnpm exec supabase db push --include-seed                   # asks for the database password
```

### Check it worked

Run this in the SQL Editor:

```sql
select
  (select count(*) from public.grapes)                                            as grapes,          -- 161
  (select count(*) from storage.buckets where id in
     ('bottle-images','tasting-images','user-avatars','wine-labels'))              as buckets,         -- 4
  (select count(*) from pg_tables where schemaname = 'public' and not rowsecurity) as tables_without_rls; -- 0
```

## 3. Configure sign-in (email code)

CELLR signs people in with a **6-digit code typed into the app**, not a magic link. (On iPhone a link tapped in
Mail opens Safari instead of the installed app, so the session lands in the wrong place.)

1. _Authentication → Sign In / Providers → Email_: provider **on**, keep **Confirm email** on.
   Set **Email OTP length = 6** and **expiry = 900** seconds.
2. _Authentication → Emails → Templates_: edit **both** _Confirm signup_ **and** _Magic Link_.
   Subject: `Your CELLR code`. Body: paste the contents of `supabase/templates/otp.html`
   (it contains `{{ .Token }}`, which becomes the code).
3. **Custom SMTP — do this before inviting anyone.** Supabase's built-in mailer allows only a couple of
   emails per hour; a family sign-up evening would hit that immediately.
   _Resend_ (free tier): create an account → add and verify your domain → create an API key, then in
   _Supabase → Project Settings → Authentication → SMTP Settings_:
   host `smtp.resend.com`, port `465`, username `resend`, password = the Resend API key,
   sender e.g. `CELLR <login@yourdomain.com>`.
   Then _Authentication → Rate Limits_ → raise **emails per hour** (e.g. 100).
4. _Authentication → URL Configuration_: set **Site URL** to your Vercel URL (step 5). Codes don't use it,
   but Supabase requires one.
5. Leave **"Allow new users to sign up" ON.** The private-beta gate below lives in the database.

## 4. Private beta: who may create an account

Anyone with your URL could otherwise create an account (and, later, spend your AI budget). The gate is a
**database trigger**, so it can't be bypassed by calling Supabase directly. Manage the list in the SQL Editor:

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

**An empty list means sign-up is open.** People who already have an account are never locked out by changes
to the list. Someone not on the list sees: _"CELLR is invite-only for now, and this email isn't on the list yet."_

## 5. Deploy on Vercel

1. _Vercel → Add New → Project →_ import `Blockionaire/CELLR`.
2. **Root Directory: `apps/web`**, and keep **"Include source files outside of the Root Directory"** switched **on**
   (the app uses the shared `packages/domain`). Framework: Next.js (auto-detected).
   `apps/web/vercel.json` already pins functions to **Frankfurt (`fra1`)**, next to the database.
3. _Settings → Environment Variables_ (Production **and** Preview), from _Supabase → Project Settings → API Keys_:

   | Name                                   | Value                            | Notes                                                                             |
   | -------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------- |
   | `NEXT_PUBLIC_SUPABASE_URL`             | `https://<ref>.supabase.co`      | public                                                                            |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…`               | public by design; protected by row-level security                                 |
   | `SUPABASE_SERVICE_ROLE_KEY`            | the **secret** key `sb_secret_…` | **mark as Sensitive.** Bypasses all security; only the server uses it             |
   | `DESIGN_GALLERY`                       | `1`                              | **Preview only.** Enables `/design` for reviewing the design system on your phone |

   Set these _before_ the first build (`NEXT_PUBLIC_*` values are compiled in).

4. Deploy. Open the URL.

## 6. First run — and installing it on your phone

1. Open the deployed URL → enter your email → type the 6-digit code.
2. Create your household, enter your name. You land on Home.
3. _Profile → Invite someone_ → send the code to a second person → they sign in, choose **Join with a code**.
4. **iPhone:** Safari → Share → **Add to Home Screen**. Open it from the icon: it runs full-screen.
   **Android:** Chrome menu → **Install app**.
5. Try airplane mode: you should get the friendly _"You're offline"_ page, not a browser error.
6. Open `/design` on a Preview deployment and look at it on your phone — **tell me what feels off**
   (fonts, spacing, colour). Those are cheap to change now and expensive later.

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

| Symptom                                                 | Likely cause                                                                      |
| ------------------------------------------------------- | --------------------------------------------------------------------------------- |
| No email arrives                                        | SMTP not set up (step 3.3), or the sender domain isn't verified                   |
| "invite-only" message for someone you want in           | Add them to `private.allowed_signups` (step 4)                                    |
| `permission denied for table …` in logs                 | A migration didn't run, or ran out of order — re-check step 2                     |
| Build fails: "Missing or invalid environment variables" | Step 5.3 — set them, then redeploy                                                |
| Sign-in works, then you bounce back to the sign-in page | `NEXT_PUBLIC_SUPABASE_URL` doesn't match the project the keys belong to           |
| Codes say "invalid or expired" immediately              | The email template still shows a link — it must contain `{{ .Token }}` (step 3.2) |

## Security reminders

- The **publishable** key and project URL are public by design. The **secret** key (`sb_secret_…`) is not:
  it lives only in Vercel (Sensitive) and your password manager. If it ever leaks, rotate it in Supabase immediately.
- CI scans every build for server secrets in the browser bundle and every commit for leaked keys.
- Each person's data is isolated by the database itself (row-level security), proven by an automated suite
  that attacks it the way an outsider would.
