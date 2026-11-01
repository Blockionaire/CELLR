# CELLR recognition: what exists, and what is planned

This document is the permanent record of CELLR's wine-recognition strategy. It separates what is **implemented**
(Sprint G: identical-photo recognition; Sprint H: shared wine profiles; Sprints I/J: the catalogue and its learning;
Sprint S: database-first recognition of new photos) from what is **planned**. Under "Future Sprint", only what is
marked as done exists. Backlog: GitHub issue #32.

---

## Implemented — Sprint G: recognition cache (identical photos only)

**What it does.** When a household scans a photo that is _byte-for-byte identical, after CELLR's processing_ to
a photo it already confirmed, CELLR recognises it without calling the vision model. It suggests the confirmed
wine and year through the normal scan review, and the person confirms it as usual.

**How it works**

- The server computes a SHA-256 fingerprint of the processed JPEG (the exact bytes it stores, with metadata
  removed). It keeps the fingerprint on the household's own `bottle_images` row.
- What a photo _is_ comes only from the household's confirmations: the bottles that use the photo, and their
  vintage. `public.recall_confirmed_scan` (security invoker, so the caller's RLS applies) derives this on every
  lookup, and never copies or caches it elsewhere.
- Order in `server/scans/service.ts`:
  1. prepare (validate, clean, fingerprint);
  2. look up;
  3. store the photo;
  4. on a hit, answer from the confirmation;
  5. only on a miss, spend the scan budget and ask the model.
- Measured per scan in `bottle_images.cache_result` (`hit` / `miss`). Shown on `/admin/ai` as hits, misses, hit
  rate and vision calls avoided.

**Guarantees**

- **Unconfirmed readings are never remembered.** No bottle uses the photo, so the lookup finds nothing.
- **Corrections apply immediately.** Changing a bottle's wine or year, merging wines, replacing the photo, or
  removing the bottle as a mistake changes or ends the recall immediately.
- **Disagreement is not trusted.** If confirmations disagree, or the wine is gone, the scan goes to the model as
  before.
- **Household-private.** Another household never sees or benefits from it, even with the identical photo.
  Deleting the household deletes it.
- **Fails safe.** If the cache is unavailable (migration not run, database error), scanning works exactly as
  before.
- **No new data leaves the household.** No new AI calls, no new analytics events, and nothing global.

**Limits (by design)**

- **Identical images only.** A second photo of the same bottle, even moments later, has a different fingerprint
  and is read by the model. The cache helps mainly with:
  - the same photo re-uploaded (from the library, a retried batch, a second device);
  - re-scans of a photo that was kept.
- **The expected saving is modest.** It equals the share of scans that are exact repeats. Measure it on
  `/admin/ai` during the beta before drawing conclusions.
- **Only wine and year are recalled.** Grapes, alcohol and appellation (which the model would read) are not
  repeated, and the label corners are never reused.

---

## Implemented — Sprint H: shared wine profile cache (research once, reuse)

**Label recognition and profile research are different steps.**

- **Recognition (Sprint G)** answers _which wine is in this photo?_ It caches only identical photos, privately per
  household.
- **Profile research (Sprint H)** answers _what is this wine like?_ (style, grapes, tasting, drinking window, food).
  It happens after the wine is known, in the paid `wine_insight` research call.

Sprint H reuses researched profiles across households. It does not recognise anything new.

**What it does.** Before CELLR pays for a wine profile, it looks for a shared profile of the same vintage in the
same language. If a good one exists, the household gets it immediately:

- no `wine_insight` call;
- no budget spent;
- no `ai_usage` row.

Otherwise CELLR researches as before, saves the household's own profile, and offers it as the shared profile when
it qualifies.

**When a shared profile is reused (all must hold)**

- **Identity.** The wine is a **canonical** wine of a **canonical** producer: curated with the service role and
  read-only for people. Its vintage row (`wine_id`, `year`) is the same for every household. A household's own
  provisional wine never shares, even with an identical name. There is no fuzzy matching, so similar names,
  another cuvée or a reserve bottling never match.
- **Same vintage, same language.** Non-vintage is its own row. A drinking window is never reused for another year.
- **Quality, checked in code when publishing and again when reading.**
  - the current profile version, from research that really ran (`researched`);
  - evidence `exact_wine` with at least one source the search really consulted;
  - confidence `high` (after `checkInsight` caps it by the evidence);
  - no value;
  - nothing that contradicts the catalogue (country, or a window starting before the harvest).
- **The database checks it a third time.** Its constraints refuse anything weaker.

**Still researched with AI**

- a household's own wines (always private, as before);
- a shareable wine without a shared profile in that language;
- a shared profile of an older version, or one that no longer passes the checks;
- whenever the shared cache is unavailable (migration not run, database error).

A profile that does not qualify stays private, and the next household researches again.

**Privacy**

- **Public facts only.** A shareable wine is researched from public facts: what the household paid is no longer
  in that prompt.
- **Nothing household-specific is stored.** The shared row has no household, person, price, photo, fingerprint,
  note, rating or valuation.
- **Who can write.** Only the server (service role) writes, through `publish_shared_wine_profile`. People can
  read shared profiles, never write them.
- **Private profiles stay private.** `vintage_insights` is unchanged in that respect.
- **Deleting a household** removes its private profile, not the shared knowledge.

**Freshness**

- A trusted, complete, researched profile stays reusable; it is never regenerated because it is old.
- It is replaced only by a validated profile of a newer version. The database never lets an older or equal
  version replace it, and two households publishing at once leave one row.
- Profiles older than 12 months are counted for review on `/admin/ai`; nothing spends credits to refresh them.
- Market values stay separate (valuations, at most once a month per household) and are never shared.

**Limits**

- **Hits only happen for catalogue wines.** Today the canonical catalogue is curated by hand, and most wines
  people add are their own provisional wines, so the hit rate starts near zero. It grows only as the canonical
  catalogue grows (see B below).
- **Two simultaneous first requests** for the same uncached wine may both pay for research (seconds apart). Only
  one result is shared.

**Monitoring.** `/admin/ai` → Shared wine profiles shows:

- research calls avoided (hits) and made;
- hits and misses;
- the hit rate over catalogue wines;
- the number of shared profiles and how many are due for review.

---

## Implemented — Sprint I: catalogue activation (curated identities that people can find)

Sprint H could only help catalogue wines, and the catalogue was empty. Sprint I makes the existing canonical
catalogue usable. Details and the operator guide are in `docs/CATALOG.md`.

- **Filling it.** The owner fills it with `catalog_import`: a reviewed JSON list run in the SQL editor.
  - dry run first;
  - idempotent;
  - an https source is required for each wine;
  - conflicts and ambiguity are reported and never overwritten;
  - only the service role can run it.
- **Scanning finds it deterministically** (no AI call). Only an exact identity is "found": producer plus name or
  verified alias, with no contradiction in colour or country. Similar names become a choice. The person always
  confirms.
- **Typing a wine** uses the one exact catalogue wine instead of making a private duplicate. The household's own
  same-named wine always wins.
- **Missing years.** A year the catalogue does not list yet is added safely (`catalog_vintage`) when someone adds a
  bottle. People keep no other write access to the catalogue.
- **Shared profiles.** Once households pick catalogue wines, Sprint H's shared profiles apply, unchanged (same
  quality bar, same vintage, same language).

Still **not** done:

- promotion of household wines;
- relinking existing bottles;
- third-party catalogue imports;
- any learning from scans.

## Implemented — Sprint J: catalogue learning with owner approval

Confirmed household wines become **candidates** for the canonical catalogue; the owner reviews and publishes them
at `/admin/catalog` (details: `docs/CATALOG.md`, "Catalogue learning").

- **Collection:** off by default; opt-out or opt-in is the owner's switch. It is recorded only when bottles are
  added, by the household that owns the wine.
- **Counting:** per independent household, so bottles, scans and members never inflate it. Label confirmations
  and typed wines are kept apart. Removed, renamed or declined evidence stops counting, and deletion cascades.
- **Grouping:** strict (producer, name, colour, country). Rival colours or countries and disagreeing appellations
  are conflicts.
- **States:** collecting, review_ready (5), conflict, approved, rejected, merged.
- **Automation:** an advisory verdict only. **Automatic publication is off.**
- **Publishing:** through `catalog_import`. It needs a verified public source, never relinks household wines,
  and lets Sprint H's shared profiles apply.
- **Cost:** no AI calls. Everything is deterministic database and domain work.

Still not done:

- automatic publication;
- learning from different photos;
- independent external verification beyond the owner's sources.

## Implemented — Sprint S: database-first recognition (new photos of known catalogue wines)

**What it does.** A _new_ photo of a wine in the canonical catalogue (another angle, another bottle, another day)
is recognised from its **printed label text**, without the vision model, when that text names exactly one catalogue
wine. The person confirms it in the normal scan review. Everything else goes to the vision model exactly as before.

**Order in `server/scans/service.ts`**

1. prepare (validate, clean, fingerprint);
2. identical-photo cache (Sprint G);
3. **label text** (only on a cache miss, only when the phone sent text): look the printed phrases up, decide in code;
4. store the photo (with what happened, see Monitoring);
5. on a text match: answer with the existing wine record, its 2D artwork, no budget spent, no `ai_usage` row;
6. otherwise: spend the scan budget and ask the model, as before.

**On the phone (OCR).** `features/scan/ocr.ts` runs tesseract.js (WebAssembly, in a Web Worker; English LSTM model)
on a 1280 px copy of the photo. No paid OCR API; only the text is sent, next to the photo the app already uploads.

- Loaded lazily: the scan screen warms it in the background; nothing on "save data" connections or without
  WebAssembly. The files are self-hosted under `/ocr/<version>/` (copied from `node_modules` by
  `apps/web/scripts/ocr-assets.mjs` before `dev`/`build`), cached immutably; the model is kept in IndexedDB.
  The `/ocr/*` files carry their own worker CSP (`script-src 'self' 'wasm-unsafe-eval'`); the pages' nonce CSP is
  unchanged.
- **First use vs warm** (measured in Chromium with iPhone 13 emulation on a fast CPU, localhost; not a phone):
  - transfer on first use ≈ 4.0 MB compressed: core `.wasm` 1.06 MB (2.86 MB if the host does not compress `.wasm`),
    model 2.95 MB, worker and glue ≈ 58 KB; the main-thread code is a separate ≈ 6 KB chunk. At 10 Mbit/s that is
    ≈ 3–5 s of download (arithmetic, not measured). Until it has loaded, scans go to the model as before;
  - reader start: 0.44–0.53 s with an empty cache (excluding network), 0.21–0.24 s warm (model from IndexedDB);
  - one read of a 1280 px label: 0.4–0.8 s warm; 0.85–1.5 s in the e2e runs (parallel load, includes the wait).
- Bounded: a photo waits at most 2.5 s for text, and at most 0.3 s for a reader that is still loading. A read that
  runs out of time, or a load that fails (or takes over 30 s), turns the reader off for the rest of the visit. Reads
  are queued one at a time (a batch reads two photos at once); a photo still queued when its budget ends goes on
  without text. In all of these cases the photo is sent without text at once.
- **Mobile Safari** (checked against the code and the engines' documented support, **not on a physical iPhone or in
  WebKit**, which this environment does not have):
  - Safari 16.4+: SIMD core (`tesseract-core-simd-lstm`), chosen by the same `WebAssembly.validate` probe as
    wasm-feature-detect; older WebAssembly: the plain LSTM core;
  - classic same-origin worker (`workerBlobURL: false`), `importScripts`, `fetch`: all supported;
  - the photo is decoded with `createImageBitmap` without options (the prepared photo is already upright), or an
    `<img>` where `createImageBitmap` is missing;
  - IndexedDB unavailable (private browsing): tesseract.js fetches the model again instead (HTTP-cached);
  - a Safari without `'wasm-unsafe-eval'` CSP support, or one that cannot compile the core: the load fails, the
    reader is off for the visit, and every scan goes to the model exactly as before.

  Per-device OCR timings appear on `/admin/ai` once beta phones use it.

**Lookup.** `public.find_wines_by_label_text(household, phrases)` (migration `20261108000031`) takes at most 400
normalised phrases (every 1–8 word run of each line, shortest lines first) and returns at most 40 wines: those of a
printed producer (catalogue, or the household's own), the household's own wines whose name is printed, and the
household's own wines verifiably linked (`wine_links`) to a found catalogue wine. Indexed equality lookups; the
catalogue and the household's wines are never loaded whole. Another household's wines are never returned (the
function checks membership). The text is not stored anywhere.

**When the model is skipped (all must hold; `packages/domain/src/label-text.ts`)**

- exactly **one catalogue wine** whose producer is printed and whose name or a **verified alias** is printed **as a
  line of its own** (only estate words, a year or single stray characters may stand next to it), so "Pavillon Rouge
  du Château Margaux" is never "Château Margaux";
- no other catalogue wine is printed as fully (two colours, two countries, a wine and its reserve: not resolved);
- nothing on the label contradicts it: a colour word it cannot be ("Blanc" on a red; "Blanc de Blancs" on a
  sparkling wine is fine), a country it is not from, or a **qualifier** not in its own name (Réserve, Riserva,
  Vieilles Vignes, Grand Cru, Spätlese …; Bordeaux classification statements such as "Grand Cru Classé" excepted);
- no household wine rivals it: an own wine with the same identity, or one that `matchLabel` would call a strong
  match, sends the photo to the model (and so to the person's choice). An own wine **linked** to the catalogue wine
  is the one proposed, so household priority and existing links are kept; nothing is relinked.

Fuzzy scores, similar names and incomplete text never match. A household's own (unlinked) wine is never matched by
text alone: it is not a verified identity.

**Vintage.** Taken only when exactly one plausible year is printed (not a founding year such as "Depuis 1855", not
part of the wine's name, not in the future). Otherwise it stays **unknown** (never "non-vintage"); the review says
so and the person chooses it. A read year has `medium` confidence; the person confirms or changes it.

**Review and 2D artwork.** The review shows the existing wine's canonical data ("Recognised from the printed label
text, without AI") and its published 2D bottle picture (`wine_bottle_art_for`, including verified inheritance for a
linked household wine); without one, the drawn bottle as before. Bottles are only saved when the person confirms.

**Learning (Sprint Q).** A text match of a catalogue wine is noted as a catalogue proposal (same consent, TTL,
deduplication and independence rules) with `source = 'text'` on `catalog_scan_reads` and every resulting
`catalog_scan_signals` row. A vintage corrected after a text match is a **text** scan signal, never counted as the
vision model's misread nor as catalogue evidence; a catalogue correction after a text match is marked "via label
text" for the reviewer and deduplicated apart. Nothing changes a catalogue wine. A linked household wine proposes
nothing about the catalogue.

**Monitoring (`/admin/ai` → Database-first recognition).** Per scan photo (household-private, on `bottle_images`):
`text_result` (hit / miss / no_text), the proposed wine and year (hits), the phone's OCR time and the lookup time.
`admin_recognition_paths` (service role) aggregates counts and timings only: photo-cache hits, text attempts and
hits, the share read by the model, OCR and lookup timings (p50/p90), the measured latency and average known cost of
vision label reads in the same period, vision calls avoided and the estimated saving (avoided × that measured
cost), and what people did with text matches, derived from their bottles now: saved as proposed, year filled in,
year corrected, saved as another wine (rejected), not saved. The scan analytics event says which path answered.

**Limits**

- **Real-photo accuracy is unmeasured.** The tests use rendered labels; curved, glossy, script-font or handwritten
  labels will often give no usable text, and then the model reads them (safe, but no saving). Measure the text hit
  rate and the rejection rate on `/admin/ai` during the beta before drawing conclusions.
- **iPhone timings are unmeasured** in this environment (no WebKit, no device). The first use on a phone downloads
  ≈ 4 MB; until the reader is loaded, scans go to the model.
- **English model only**; accents are ignored by the matching, so French, Italian and Spanish names still match.
- **Catalogue wines only**: hits grow with the catalogue (Sprints I/J/R).
- When OCR text is read but not conclusive, the photo waited for it (≤ 2.5 s) before the model call; this is shown
  as "Phone OCR, not matched".
- **The phone reads before the identical-photo cache is checked.** The cache lives on the server and is keyed by the
  SHA-256 of the server-cleaned photo, so the phone cannot know a photo is an exact repeat before it uploads it.
  Checking first would need a new pre-check endpoint and an extra round trip on every scan (cache misses are the
  large majority), or a second upload; neither was added. The cost on a cache hit is the OCR time (bounded by 2.5 s;
  ≈ 1 s in the e2e run). It is measured: `/admin/ai` shows the average OCR time spent before photo-cache hits
  ("… before a photo-cache hit (not needed)"). Within a batch, an identical photo is already held on the phone and
  not sent.
- **No straightened label after a text match.** The label outline (`labelCorners`) comes from the vision model,
  which a text match does not call, so no label texture is made for that photo. The existing fallback applies:
  - with published 2D artwork (the catalogue's or inherited), the artwork is shown, unchanged;
  - otherwise the wine's page shows the drawn bottle with the whole photo as a print beside it, cellar cards show
    the drawn bottle, and the 3D bottle wears the whole photo instead of just the label;
  - the person can frame the label at any time on the wine's page ("Show us where the label is"), as before.

  An outline guessed from the OCR text boxes was considered and not built: label edges are not text edges (margins,
  artwork, curvature), and a wrong crop would look worse than this fallback. A curated catalogue label image as the
  texture would be the reliable route; not in this sprint.

---

## Next focused sprint — reuse stable wine facts across vintages

A shared profile is per vintage, so the 2020 vintage of a catalogue wine is still researched in full even when the
2019 profile exists. Much of a profile does not change between vintages:

- the producer's background;
- winemaking and élevage;
- the usual grapes;
- the style;
- typical pairings.

Other parts are vintage-specific and must never be carried over:

- the drinking window;
- the vintage's character and weather;
- alcohol;
- scores;
- prices.

The next sprint should:

- split a profile into stable wine-level facts and vintage-specific claims;
- reuse only the stable part for another vintage of the same catalogue wine;
- research just the vintage-specific part, more cheaply;
- keep Sprint H's quality bar for both parts.

Not started.

---

## Future Sprint — Shared Wine Intelligence & Advanced Recognition (Post-Beta)

> **Status: planned, not started.** None of the capabilities below is implemented. Do not start this sprint
> until the acceptance gate at the end is met.

### A. Different-photo recognition

Recognise the same wine from different photographs, even when the camera angle, lighting, background or image
resolution changes. Before making a paid vision call, evaluate inexpensive approaches:

- local OCR of the label text — **done for catalogue wines (Sprint S)**;
- barcode (EAN/UPC) identification where bottles carry one — not started;
- visual similarity (perceptual hashing or image embeddings) — not started, and never on its own a verdict.

Each is a signal to check, not a verdict.

### B. Shared wine knowledge base

Develop a curated, reusable catalogue of confirmed wine identities, with trustworthy provenance:

- producers;
- cuvées;
- vintages;
- aliases.

Build on the existing canonical/provisional catalogue (`wines`, `producers`, `wine_vintages`, `wine_aliases`).
Recognition knowledge should improve as CELLR grows, without exposing anything household-specific or personal.

### C. Evidence-based learning

Design a verification process in which independent confirmations and corrections from different users improve
recognition quality:

- **No single confirmation decides.** One incorrect confirmation must never pollute the shared catalogue; promote
  only on independent agreement, with thresholds and review.
- **Real-world cases.** Support corrections, conflicting identities, duplicate identities (merge and split), and
  full auditability (who or what evidence changed a record, and when).
- **Separation.** Household-private data (Sprint G) stays separate from shared knowledge. Moving anything across
  is an explicit, governed step, never automatic.

### D. Intelligent recognition routing

Steps 1–4 exist for catalogue wines (Sprint G cache → Sprint S label text → vision model), with step 5 through Sprint
Q's correction signals. Barcode and household-wide (non-catalogue) text recognition do not. The pipeline:

1. Check cheap and reliable signals first: the identical-photo cache (Sprint G), barcode and local OCR.
2. Query the shared canonical knowledge base.
3. Return confident matches as suggestions for the person to confirm.
4. Use the existing vision model when confidence is insufficient.
5. Collect validated outcomes (confirmations and corrections) to improve future recognition.

**Never prioritise cost savings over correct identification.** A cheaper but wrong answer is worse than a paid
correct one.

### E. Privacy and data governance

Explicitly evaluate, before building:

- permissions, and consent where it is needed;
- data ownership;
- retention;
- account deletion;
- export rights;
- licensing of any third-party catalogue data.

Private photos and cellar data are never globally available by default. Any shared signal must be derived,
minimal and non-identifying, for example "label text X was confirmed as wine Y by N independent households",
never the photo or the cellar.

### F. Performance and financial optimisation

Benchmark on real beta scan datasets:

- recognition accuracy;
- false-positive rate;
- cache and lookup hit rates;
- latency;
- AI cost per scan.

For each optimisation, measure whether it meaningfully reduces AI calls _without_ reducing recognition
reliability, and keep only those that do.

### Future Sprint acceptance gate

Start this broader implementation only when all of these hold:

- Sprint G has been completed and validated (merged, migration applied, hit rate observed on `/admin/ai`).
- The first private beta has produced useful real-world scan results.
- Current recognition accuracy and AI usage are measurable (see `docs/METRICS.md`, `docs/SCAN-EVAL.md`).
- The benefits and risks of advanced matching (privacy, false positives, cost) have been evaluated and written
  down.
