# The facts under the cards — review instructions (50 wines)

**Who:** a wine professional. **What:** for each of 50 wines, what the app writes under the sommelier's card: whether
to drink it now or keep it (with the years and what they rest on), the serving temperature, fridge time, decanting,
glass, and how many bottles are free and where they lie. It is all computed by the app's own rules; no AI wrote it.

Open `annotation-review.csv`. Columns up to "the code's own lowest-confidence mark" are what the card says, in the
app's English words; the mark says when the code itself only applied a rule of thumb (it is not a judgement). The
day is 19 November 2026. Producers are invented; judge the wine by its appellation, type and vintage.

Fill in, per row:

| Column             | Write                                                                    |
| ------------------ | ------------------------------------------------------------------------ |
| factually right?   | `yes`, `no` or `partly` (see [criteria.md](criteria.md))                 |
| over-confident?    | `yes` when the words claim more than is known for this bottle; else `no` |
| missed nuance      | Free text, short; empty when there is none                               |
| what it should say | Your correction, in a few words; empty when it is right                  |

Leave a cell empty only if you did not review that row. Filled in by: ____________ Date: ________ — nothing counts
as reviewed until you have signed it.
