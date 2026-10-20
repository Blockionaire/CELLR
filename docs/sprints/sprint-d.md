# Sprint D — Premium experience & beta readiness

Living document: kept up to date during the sprint so another session can pick it up.

- **Branch:** `claude/blissful-mendel-fu02oz` (the session's working branch, restarted from `main` at `73fa8b1`;
  the brief suggested `feature/sprint-d-beta-readiness`, the session may only push to its own branch)
- **PR:** _opened at the end of the sprint_
- **Started from:** `main` @ `73fa8b1` (Sprint C.1 merged)

## 0. Starting baseline

- **Checks on `main`:**
  - format, lint, typecheck and unit tests pass;
  - CI runs these plus the two database jobs and the secret/dependency scans;
  - CI skips the e2e job on pull requests (`.github/workflows/ci.yml`: `if: github.event_name != 'pull_request'`); it only runs on pushes to main, nightly and manually.
- **Full local e2e (Sprint C.1, same machine):**
  - 478 tests, `fullyParallel`, 2 projects (phone, desktop), default timeouts (30 s per test, 5 s per expect).
  - It does not finish in 60 min on this 4-CPU container, because the 3D specs are slow on software WebGL.
  - Four non-3D specs (`detail`, `cleanup`, `racks`, `tastings`) fail under parallel load. On `main` they fail the same way, and they pass when run serially.
  - The API answers in 150–420 ms when called directly. The failures are client actions that wait more than 5 s while the CPU is saturated, so this is a load problem, not a functional one. It is tracked under D.7.
- **Real device:** the 3D experience is approved on a physical iPhone, with occasional stutter during extraction and return (D.1).

## 1. Audit (code reading + screenshots of the first-run and main journeys)

Legend:
- **✓ works:** an existing strength.
- **Bug:** a confirmed defect, traced in code.
- **Risk:** depends on the device.
- **Idea:** an optional refinement.

### 1.1 Sign-in & onboarding
- ✓ Server-driven routing (`nextOnboardingStep`): existing users are never sent through onboarding again.
- ✓ Join by invite code works.
- ✓ Emails are one-time codes; there is no password.
- **Considered, kept: the PIN offer comes before onboarding** (`sign-in-form.tsx`). The brief's first-run order is sign-in → PIN → household, and the offer is skipped with one tap ("Not now"), so it stays where it is.
- **Bug (P1): validation errors are hard-coded English zod messages.** Examples:
  - "Give your household a name.";
  - an empty display name shows zod's default text ("Too small: expected string…").
  - Affected: onboarding, new-wine form, bottle details, new-place sheet.
- **Bug (P2): "Step 1 of 2" is shown when only one step is left** (a returning person without a name or household). A `next` deep link is also lost after onboarding.
- **Risk:** on a small phone with the keyboard up, the vertically centred auth screen may push its submit button under the keyboard.

### 1.2 Home with an empty cellar
- ✓ Home offers "Scan your first bottle" and "Add a bottle".
- ✓ No storage unit is needed: "Not placed" works, and a new place can be made inline.
- **Bug (P1): a failed Home query is shown as an empty cellar.** `app/(app)/page.tsx` catches every error and substitutes zeros. A user with 200 bottles would be told "Your cellar starts here". Tonight does the same.
- **Bug (P2): the empty Cellar screen offers only "Add your first bottle"** — no Scan.
- **Bug (P2):** when every bottle has been opened, "Opened lately" is hidden on Home.

### 1.3 Manual add
- ✓ Two or three screens.
- ✓ NV/year chips, a quantity stepper and a "not enough room" warning.
- ✓ "Add another" remembers the place.
- **Bug (P2):** heading focus on each step steals `autoFocus` from the search/producer/year field. On a phone the keyboard does not come up where it should.
- **Bug (P2):** the purchase date `max` is the UTC date, so between 00:00 and 02:00 in the Netherlands today's date is rejected.
- **Bug (P2):** while the places are loading, "Not placed" looks selected, but saving then places the bottles in the first unit with room.
- **Idea:** the Back button sits top-right instead of top-left.

### 1.4 Scan
- ✓ The photo is kept and reused for the bottle.
- ✓ "Try again" reuses the same file, and each failure gives its own reason.
- ✓ Privacy note.
- ✓ Series mode.
- **Bug (P1): a wrong match can only be corrected by typing a "new" wine.** There is no search among your own wines, so a typo creates a duplicate.
- **Bug (P1, defensive): dead end.** If "found" arrives with no matches, the review shows only the photo.
- **Bug (P2):** "Try the camera again" is shown when the permission is *denied*, where it can never work.
- **Bug (P2):** "Your photo is already safe" is shown before the upload has finished.
- **Bug (P2):** saving to the wishlist in a series shows two toasts.
- **Idea:** mark fields prefilled from the label ("read from the label — check it").

### 1.5 Profile & household
- ✓ Every owner action is also checked on the server and by RLS.
- ✓ Deletes require typing the name or email.
- ✓ Switching household reloads, so no stale data survives.
- **Bug (P1): members see "Invite someone"**, which can only fail (FORBIDDEN).
- **Bug (P1): the only member can "Leave"** and strand the household with nobody in it. The copy says "until someone invites you again", but nobody can.
- **Bug (P1): the last owner with other members gets an English server error** with no way forward. Server messages are passed through untranslated.
- **Bug (P2):** sheets read "Close" in Dutch, because the default `closeLabel` is English. 12 sheets are affected.
- **Bug (P2):** delete sheets remember the typed confirmation after Cancel.
- **Idea:** keep household settings directly under the household.

### 1.6 Insights
- ✓ `null` is used consistently for "no data".
- ✓ Uncertain drinking windows are kept out of the timeline.
- **Bug (P2):** "What you have" draws an empty ring when every bottle has been opened.
- **Bug (P2):** "N bottles valued" does not say "of M".

### 1.7 History & tastings
- ✓ A chronological history with gifts, removals and openings, and a "Put back" action.
- **Bug (P1): "Put back" in History restores without a place and clears the opened date**, with no confirmation and no undo. One stray tap loses data.
- **Bug (P1): deleting a tasting** (stars, words and note) takes one tap and has no undo.

### 1.8 Friends & sharing
- ✓ Exact handle or code lookup only, so there is no people directory.
- ✓ Unfriending and withdrawing a request ask for confirmation.
- **Bug (P1, consent): accepting a request does not say what the new friend will see.** Ratings and notes are shared by default.
- **Bug (P2):** when the sharing settings fail to load, the defaults are shown as if they were saved.
- **Bug (P2):** "not ready" copy talks about a database setup guide.
- **Bug (P2):** incoming-request rows squeeze the name to nothing at 375 px.

### 1.9 Shell, consistency, accessibility, PWA
- ✓ Safe areas are handled on the shell, nav and fixed bars.
- ✓ Sheets use the native `<dialog>` (focus trap, Escape, scroll lock).
- ✓ Toasts sit in the top layer.
- ✓ Reduced motion is respected everywhere.
- ✓ en and nl have identical key sets (1089 each).
- **Bug (P2): English strings in shared UI:**
  - `aria-label="Loading"` on the button;
  - "One fewer" / "One more" on the stepper;
  - the sign-in and onboarding page titles;
  - the offline page is English only.
- **Bug (P2):** the manifest splash colour is dark for everyone (`#141211`), while the light theme uses `#f6f1e9`.
- **Bug (P2):** while offline, mutations pause silently (TanStack Query `networkMode: "online"`): the button spins with no message.
- **Idea:** heading sizes and top padding differ between screens (PageHeader 2.75rem; Home 2.1; Cellar 2.25; History 2.5). A 36 px chip or `sm` button is under 44 px.

### 1.10 3D (D.1)
- ✓ Sprint C.1 fixes are approved on the device.
- Candidate frame-spike sources, to be measured:
  - the canvas resizes to full screen at the start of extraction and return (WebGL buffers are reallocated);
  - `backdrop-filter` blur on the details panel, over a canvas that redraws every frame;
  - the CSS blur/scale transition on a full-screen still;
  - React commits in the middle of the animation (the still swap, the panel mount);
  - the `drawImage` read-back at the tap.

## 2. Plan (priority order from the brief)

| # | Item | Area | Priority |
|---|---|---|---|
| 1 | Home/Tonight: a failed load shows an error with retry, not an empty cellar | D.2 | P1 |
| 2 | ~~PIN offered after onboarding~~: kept before it (matches the brief's order; one tap to skip) | D.2 | — |
| 3 | Validation messages translated (onboarding, new wine, bottle details, new place) | D.2/D.3 | P1 |
| 4 | Empty Cellar offers Scan as well as Add; onboarding step count and `next` | D.2 | P2 |
| 5 | Scan review: "Search my wines" to correct a match; no dead end; denied camera | D.3 | P1 |
| 6 | Add flow: focus goes to the field, local purchase-date max, place while loading | D.3 | P2 |
| 7 | Profile: Invite only for owners; Leave guarded for sole member/last owner; translated server conflicts; sheet close label; delete sheets reset | D.4 | P1 |
| 8 | History: confirm "Put back"; tasting delete confirm | D.5 | P1 |
| 9 | Friends: consent line on accept; sharing failed ≠ defaults; copy; narrow rows | D.5 | P1/P2 |
| 10 | Insights: no empty ring; "N of M valued" | D.5 | P2 |
| 11 | Shared UI i18n (button, stepper, titles, offline page); manifest colours | D.6 | P2 |
| 12 | 3D frame spikes: measure, then remove the measured causes | D.1 | P1 (timeboxed) |
| 13 | Beta smoke suite (serial, phone, beta-critical journeys) + updated BETA-CHECKLIST | D.7 | P0 |

**Out of scope / deferred:**
- an ownership hand-over feature;
- deep links from Insights stages to filtered cellar views;
- unifying heading sizes and radii across all screens;
- offline queuing UX;
- landscape notch insets;
- iOS keyboard handling via `visualViewport`;
- persisting a scan series across tabs.

## 3. Progress log

- **Item 1 (done):** Home and Tonight no longer swallow a failed cellar read. The error page (with "Try again") now also
  renders inside the app shell (`app/(app)/error.tsx`), so the navigation stays. Reminders may still fail quietly:
  they are an extra, not the cellar.
- **Item 3 (done):** one table of the English sentences a person can meet (`src/lib/known-messages.ts`, 60 keys) with
  `errors.known.*` in en and nl. `errorMessage()` translates a known server sentence; the new `checkMessage()` replaces
  the 15 places that showed a raw zod message (unknown ones fall back to the translated "doesn't look right", never
  zod's English). A unit test scans `src/server` and `packages/domain` so a new sentence cannot slip in untranslated.
  The empty display name now has its own sentence ("Give yourself a name.").
