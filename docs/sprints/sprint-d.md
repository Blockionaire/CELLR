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
- **Bug (P2): "Step 1 of 2" is shown when only one step is left** (a returning person without a name or household).
- Checked, not a defect: a `next` link is lost on the way through onboarding, but a person without a household has
  no page to be sent to yet (there are no invite links; invite codes are typed).
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
- Checked, kept: "Try the camera again" is shown when the permission is _denied_. The message tells the person to
  allow the camera in their settings; after that, this button is exactly what they need.
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

| #   | Item                                                                                                                                           | Area    | Priority       |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------- | -------------- |
| 1   | Home/Tonight: a failed load shows an error with retry, not an empty cellar                                                                     | D.2     | P1             |
| 2   | ~~PIN offered after onboarding~~: kept before it (matches the brief's order; one tap to skip)                                                  | D.2     | —              |
| 3   | Validation messages translated (onboarding, new wine, bottle details, new place)                                                               | D.2/D.3 | P1             |
| 4   | Empty Cellar offers Scan as well as Add; onboarding step count and `next`                                                                      | D.2     | P2             |
| 5   | Scan review: "Search my wines" to correct a match; no dead end; denied camera                                                                  | D.3     | P1             |
| 6   | Add flow: focus goes to the field, local purchase-date max, place while loading                                                                | D.3     | P2             |
| 7   | Profile: Invite only for owners; Leave guarded for sole member/last owner; translated server conflicts; sheet close label; delete sheets reset | D.4     | P1             |
| 8   | History: confirm "Put back"; tasting delete confirm                                                                                            | D.5     | P1             |
| 9   | Friends: consent line on accept; sharing failed ≠ defaults; copy; narrow rows                                                                  | D.5     | P1/P2          |
| 10  | Insights: no empty ring; "N of M valued"                                                                                                       | D.5     | P2             |
| 11  | Shared UI i18n (button, stepper, titles, offline page); manifest colours                                                                       | D.6     | P2             |
| 12  | 3D frame spikes: measure, then remove the measured causes                                                                                      | D.1     | P1 (timeboxed) |
| 13  | Beta smoke suite (serial, phone, beta-critical journeys) + updated BETA-CHECKLIST                                                              | D.7     | P0             |

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
- **Item 4 (done):** the empty Cellar offers "Scan your first bottle" (primary) next to "Add your first bottle", like
  Home. Onboarding counts only the steps this person has, and hides the counter when there is one.
- **Item 5 (done):** the scan review can always switch to "Already in your cellar? Search your wines" (the add flow's
  own search, prefilled with the producer that was read) and back to the form. "Found" without a match no longer
  shows only the photo: it opens the form. "Your photo is already safe" is gone from the reading hint (the upload is
  still running then). A wish saved from a series says so once, not twice.
- **Item 6 (done):** the add and scan steps no longer pull focus to the heading when the step has put the cursor in
  its first field (so the phone keyboard comes up there). The purchase date `max` is the local date (new
  `todayLocal()`, also in the edit sheet). While the places load, the place grid shows two placeholders and "Not
  placed" only looks chosen when it was chosen.
- **Item 7 (done):** "Invite someone" is shown to owners only (the database already refused members). "Leave
  household" is replaced by a sentence saying what to do instead when leaving would strand the household: as its
  only member, or as its last owner while others remain (the database still refuses the latter; the e2e test now
  checks both the screen and the 409). Sheets take their close label from the translations (fixes "Close" in
  Dutch for the 12 sheets without one). The two typed delete confirmations start empty again after Cancel.
- **Item 8 (done):** "Put back" in History asks once more inline ("Yes, put it back", gone again after 4 s);
  removing a tasting asks once more ("Yes, remove it all").
- **Item 9 (done):** accepting a request says what the new friend will see and where that is changed. When the
  sharing settings can't be loaded the card says so with "Try again", instead of showing the defaults as if they
  were saved. The "not ready" copy no longer mentions a database guide. Person rows wrap their buttons under the
  name on a narrow phone.
- **Item 10 (done):** no "What you have" ring when every bottle has been opened; "3 of 12 bottles valued".
- **Item 11 (done):** the button's loading label, the stepper's buttons and the sign-in and onboarding page titles
  are translated; the offline page (static, no script) carries a Dutch line under the English one; the manifest
  splash colour is Noir's own `#0e090b`, the same as the app's dark theme-color (it was a third shade).
- **Home (small, found while testing):** "Opened lately" stays on Home when every bottle has been drunk (it was
  hidden together with the rest of the empty-cellar page).

## 4. D.1 — 3D smoothness: what was measured (timeboxed)

**How.** `e2e/perf-3d.spec.ts`, test "frame times while a bottle comes out and goes back": three bottles out and
back on the phone project, frame gaps (rAF), long main-thread tasks and canvas resizes per phase. New knobs this
sprint: `PERF_DPR=1` (phone layout, fewer pixels) and `PERF_PROFILE=file.cpuprofile` (a CPU profile of the first
extraction, for Chrome's Performance panel).

```
PERF_3D=1 PERF_DPR=1 PERF_RATE=1 PERF_PROFILE=out.cpuprofile \
  pnpm exec playwright test --config=playwright.config.ts --project=phone --workers=1 perf-3d -g "frame times"
```

**Results in this container (software WebGL, no GPU).**

| Setting              | Frames in 2 s out | Longest gap out | Frames in 1.5 s back | Long tasks back |
| -------------------- | ----------------- | --------------- | -------------------- | --------------- |
| phone, DPR 3, CPU ×4 | 2–3               | 17–1300 ms      | 4–6                  | 5–7 (≈1.4 s)    |
| phone, DPR 3, CPU ×1 | 2–3               | 17–1670 ms      | 6–7                  | 7–8 (≈1.8 s)    |
| phone, DPR 1, CPU ×1 | 2–4               | 1.1–1.8 s       | 6–9                  | 5–8 (≈1.6 s)    |
| phone, DPR 1, CPU ×4 | 3–5               | 17–1780 ms      | 6–8                  | 8–10 (≈1.9 s)   |

The CPU profile of one extraction (7.9 s sampled): **7.0 s "(program)"**: native time in the software rasteriser
and GPU synchronisation, not our code. **0.59 s `drawImage`**: the copy of the rack into the still at the tap
(it forces the GL work to finish). Everything else, React and three.js included, is under 0.1 s.

**Conclusion.**

- Frame rate does not change with pixel count or CPU speed here: software WebGL sets it. These numbers cannot
  stand for an iPhone, and **nothing here claims the 3D is smooth on iOS.**
- The app's own main-thread work on the path is small. The one measurable app cost is the still copy at the tap.
- No resize happens on the way out (0 of 6). One happens on the way back (the stage leaves full screen). That
  matches the code: the phone stage is full screen from the moment it opens.
- **No 3D code was changed.** Without a device measurement, any change would be a guess at the cost of visuals the
  user approved. All C.1 behaviour is untouched. No shader compilation on selection: `data-programs` is unchanged
  by these runs, and the C.1 tests still guard it.

**Candidates to confirm on the iPhone, most likely first:**

1. The canvas going back from full screen to the card at the end of the return. That is the one resize: the
   WebGL drawing buffer (with MSAA) is reallocated at the moment the live rack takes over.
2. The animated CSS `filter: blur(7px) brightness() saturate()` on the full-screen still (0.9 s out, 0.38 s
   back). WebKit may re-rasterise a full-screen blur every frame while WebGL also draws.
3. `backdrop-blur-xl` on the details panel over a canvas that redraws every frame.
4. The `drawImage` still copy at the tap (measured above; on a GPU it is a pipeline flush, usually a few ms).

**iPhone checklist (Mac + cable, 15 minutes).**

1. iPhone: Settings → Safari → Advanced → Web Inspector on. Mac: Safari → Develop → [iPhone] → the CELLR tab.
2. Timelines → record (JavaScript & Events, Rendering Frames, Layout & Rendering) → in CELLR: Cellar → 3D → tap
   a bottle, wait 3 s, put it back. Repeat with three different bottles.
3. In Rendering Frames, note every frame over 33 ms and what fills it: Paint/Composite (→ 2 or 3), Layout
   (→ 1), Script (→ 4 or React), and when it happens (at the tap, mid-way, at landing).
4. Same again with Settings → Accessibility → Motion → Reduce Motion on. If the stutter is gone, the CSS
   transitions (2) are the suspect.
5. Send the screenshots of the timeline, the iPhone model and the iOS version. The fix then targets the measured
   cause.
