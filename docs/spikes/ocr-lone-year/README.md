# On-device OCR: a vintage printed alone on its line

**Question.** The phone reads label text with tesseract.js 7 (LSTM only) in `PSM.SPARSE_TEXT` on a 1280 px copy
(`apps/web/src/features/scan/ocr.ts`); the server takes a vintage only when exactly one plausible year is printed
(`vintageFromLabel`). In the Sprint S end-to-end test a lone `2019` was read correctly for only 86 of 120 photo sizes,
sometimes as another year (`2018`, `2016`, `2009`). A wrong year is worse than none: it is proposed with "medium"
confidence. Is there a better way to read it, without losing names, within `OCR.readBudgetMs`?

**Answer.** Keep `SPARSE_TEXT` and take a **second look** at each lone digit line: read the line again in
`PSM.SINGLE_BLOCK` together with its neighbours, and add what that reads as extra lines. Readings that agree give the
year; a garbled first reading (`20119`, `20H`) is fixed; readings that disagree (`2018` and `2019`) give **no year**.
That disagreement rule is `vintageFromLabel`'s existing rule ("exactly one distinct year"), so the second look cannot
turn one year into another. On every set it removed the wrong years that came from a lone digit line, lost no names,
and costs about 100–150 ms per photo on a desktop CPU, only when such a line is there. `PSM.AUTO` is **not** an
option: it reads the test's label perfectly, but on labels with text in corners or columns it loses most names and
years.

Everything here is rendered labels in Chromium (no real photos were available: the repository is public and
real-photo sets are kept out of it, see `docs/SCAN-EVAL.md`). Desktop CPU, not a phone.

## Evaluation set

`run.mts` renders each label in the page, encodes it as a camera JPEG, runs the app's photo path (`preparePhoto`'s
1600 px JPEG at 85 %, then the reader's 1280 px copy) and reads it. Identity and year are scored with the domain's
own `recognizeLabelText` and `vintageFromLabel`, with the true wine as the only candidate.

| Set            | What                                                                                                                                                                                                                                                                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **render**     | 200 photographed labels: 12 wines (French, German, Spanish, Italian, Portuguese, US, South African, Austrian names), 10 fonts (DejaVu Sans/Serif, Liberation Sans/Serif, FreeSans/FreeSerif, Caladea, Bitstream Charter, Inter, Carlito; bold, italic, letter-spacing), year alone in the middle / on top / small / big, with a word ("Millésime 2019"), or none; rotation ±4°, bottle curvature, blur, noise, uneven light, crest and vineyard drawings, JPEG 80–92 %, photos 1000–4032 px. |
| **hard**       | 120 renders like the above with scattered layouts: the year alone in a top corner, or producer and name left with year and appellation right.                                                                                                                                                                                                         |
| **e2e**        | The end-to-end test's own label (`labelPhoto` in `apps/web/e2e/sprint-s.spec.ts`: SVG through sharp, DejaVu Sans), photos 1100–1400 × 1500–1560; also in Inter, FreeSans and Liberation Serif.                                                                                                                                                       |
| **e2e exact**  | The test exactly: its random syllable names, its five lines, every size the old `uniqueSize()` could give (1100–1169 × 1500–1509), 280 photos.                                                                                                                                                                                                        |

"=" is the same as SPARSE. (In the e2e sets identity is 58 % for every strategy: the evaluation's longer wine names
overflow the test's 760 px card. The e2e exact set uses the test's own short names.)

Rates: _year correct_ over labels that print a year; _wrong_ over all labels (a year proposed that is not the
printed one). _Identity_ is `recognizeLabelText` returning the wine. Times are one `recognize` per strategy
(variants) or the whole `readLabelText` (app: decode, 1280 px copy, reads).

## Strategies compared

| Set (n)          | Strategy                                                  | Identity | Year correct | Wrong | ms p50 / p90 |
| ---------------- | --------------------------------------------------------- | -------: | -----------: | ----: | -----------: |
| e2e "2019" (60)  | SPARSE (today)                                            |       = |        81.7 % | 5.0 % |    211 / 243 |
|                  | AUTO (PSM 3)                                              |       = |       100.0 % | 0.0 % |    213 / 244 |
|                  | SINGLE_BLOCK (PSM 6)                                      |       = |        95.0 % | 1.7 % |    210 / 256 |
|                  | SPARSE + the line alone again (PSM 6 or 7, ≤ 1.5 line heights around it), add | = | 88.3–90.0 % | 3.3–5.0 % | 269–275 / 311–324 |
|                  | SPARSE + the line alone again, digits only, replace       |       = |        86.7 % | 3.3 % |    289 / 342 |
|                  | SPARSE + whole photo again in AUTO, add digit lines       |       = |        95.0 % | 0.0 % |    429 / 480 |
|                  | **SPARSE + line with neighbours in PSM 6, add digit lines** |     = |    **95.0 %** | **0.0 %** | **306 / 350** |
| render (200)     | SPARSE                                                    |   87.0 % |        93.2 % | 0.0 % |    242 / 320 |
|                  | AUTO                                                      |   88.5 % |        91.5 % | 0.0 % |    243 / 316 |
|                  | SPARSE + whole photo in AUTO                              |   87.0 % |        93.8 % | 0.0 % |    462 / 616 |
|                  | **SPARSE + line with neighbours in PSM 6**                |   87.0 % |    **96.0 %** | 0.0 % |    379 / 543 |
| hard (120)       | SPARSE                                                    |   81.7 % |        92.5 % | 0.8 % |    247 / 326 |
|                  | AUTO                                                      | **50.8 %** |    **45.8 %** | 0.0 % |    237 / 290 |

- **AUTO** finds the layout first. A year alone in a corner was dropped in 55 of 61 labels; two columns were merged
  into one line ("Les Terrasses Saint-Emilion"), so the name was no longer on a line of its own and the wine was
  found in 10 of 59 labels instead of 44. Not usable as the reader's mode.
- **Re-reading the line on its own** (any mode, with or without a digit whitelist, any padding up to 1.5 line
  heights) repeats the first mistake: same pixels, same size estimate. Replacing the first reading with it also
  made new wrong years (`19817` → `1987`, `1995` → `19395`).
- **With its neighbours** (three line heights above and below, eight to either side) the lettering's size is judged
  from several lines, as AUTO does, and the reading matches AUTO's on the test's label at half the extra time of a
  whole second read.
- Over all runs, when the two readings of a line disagreed, the second look was right 60 times and the first once
  (that once, the second read `2090`, which `vintageFromLabel` drops as a future year). "Second look wins" would
  turn most "no year" cases into the right year (e2e exact: 272 of 280 instead of 247); it was not taken because it
  could, rarely, turn a right year into a wrong one, and the person fills an unknown year in anyway.

## The production module (`ocr.ts` as changed), against SPARSE alone

| Set (n)                       | Identity  | Year correct       | Wrong             | ms p50 / p90 (app: whole read) |
| ----------------------------- | --------- | ------------------ | ----------------- | ------------------------------ |
| e2e exact (280)               | 100 % = | 73.6 % → **88.2 %** | 8.9 % → **0.0 %** | 190 / 225 → 290 / 333          |
| e2e "2019" (120)              | =         | 78.3 % → **92.5 %** | 5.8 % → **0.0 %** | 211 / 278 → 327 / 383          |
| e2e Inter (60)                | =         | 83.3 % → 90.0 %    | 1.7 % → 0.0 %     | 210 / 249 → 312 / 371          |
| render (200)                  | 90.0 % =  | 94.4 % → 95.6 %    | 1.0 % → 0.5 %     | 249 / 311 → 398 / 578 (p99 769) |
| hard (120)                    | 70.8 % =  | 86.7 % → 87.5 %    | 1.7 % → 1.7 %     | 252 / 316 → 360 / 467          |

- **Names**: identical on every set (the second look only adds digit lines).
- **Wrong years left** (render 1, hard 2): a year alone in a corner with nothing around it, where the block read has
  no neighbours to learn from and reads the same (`1998` for `1995`). Not fixed by any strategy tried.
- **When it runs**: 146 of 200 render labels and 105 of 120 hard ones (every label with a lone year line); 2 of 34
  labels with "Millésime 2019" and none of the labels without a year (fine print such as "750 ml" is not one word).
- **Time**: about +100 ms (p50) to +270 ms (p90) per photo here. On a phone a read takes 0.4–0.8 s
  (RECOGNITION-ROADMAP), so the second look adds roughly 0.2–0.5 s; it is skipped when the budget left is shorter
  than the first read took, and a second look that still runs out of time ends the read like any slow read.

## The end-to-end test

The old test photo was 1500 px tall, so the reader resized it to 1280 px, and the label was centred on a width that
changed with every run: each run read slightly different pixels. That is why the same label passed or failed by
size. `labelPhoto` now draws the label at a fixed place and `uniqueSize()` stays under 1280 px, so nothing is
resized: e2e exact with that geometry read the year right 280 of 280 times, before and after the change.

A new test pins the safety rule. At 1177 × 1505 (resized, odd width) the test's label is read `2018` in SPARSE every
time (40 of 40 with random names, in the full Chromium and in the CI headless shell); the second look reads `2019`;
the wine is proposed with no year. With the previous `ocr.ts` the same test fails with `text_year: 2018`.

## Reproduce

```bash
pnpm install && node apps/web/scripts/ocr-assets.mjs
scripts/scan-eval/node_modules/.bin/tsx docs/spikes/ocr-lone-year/run.mts 200 sparse,auto,app
FAMILY=e2e E2E_EXACT=1 E2E_YEAR=2019 scripts/scan-eval/node_modules/.bin/tsx docs/spikes/ocr-lone-year/run.mts 280 sparse,app
LAYOUTS=corner,columns OFFSET=2000 scripts/scan-eval/node_modules/.bin/tsx docs/spikes/ocr-lone-year/run.mts 120 sparse,auto,append-crop6-p3-x8
```

Variants: `sparse`, `auto`, `block`, `sparse+line`, `sparse+digits`, `append-full3`, `append-crop<psm>-p<pad>-x<pad>`,
`app`. Results go to `test-results/ocr-lone-year/` (ignored by Git). Set `PLAYWRIGHT_CHROMIUM_PATH` where Playwright's
own browser is not installed.
