# CELLR recognition: what exists, and what is planned

This document is the permanent record of CELLR's wine-recognition strategy. It separates what is **implemented**
(Sprint G) from what is **planned** for a later sprint. Nothing under "Future Sprint" exists yet.

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

## Future Sprint — Shared Wine Intelligence & Advanced Recognition (Post-Beta)

> **Status: planned, not started.** None of the capabilities below is implemented. Do not start this sprint
> until the acceptance gate at the end is met.

### A. Different-photo recognition

Recognise the same wine from different photographs, even when the camera angle, lighting, background or image
resolution changes. Before making a paid vision call, evaluate inexpensive approaches:

- local OCR of the label text;
- barcode (EAN/UPC) identification where bottles carry one;
- visual similarity (perceptual hashing or image embeddings).

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

Build a confidence-based pipeline:

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
