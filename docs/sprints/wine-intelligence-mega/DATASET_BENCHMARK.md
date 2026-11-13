# Dataset and identity benchmark (WI-01)

Run: 2026-11-13, `bash scripts/catalog-tools/pilot.sh <XWines_Full_100K_wines.csv>`, on a throwaway local Postgres 16
that was marked `pilot` and deleted afterwards. Raw output: [`results/`](results/). Nothing here ran against a hosted
database, and no result describes what people see in the app: **no provider is in people's search.**

## 1. What was measured, with what

| Thing             | Value                                                                                                                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Dataset           | X-Wines `XWines_Full_100K_wines.csv`, version "X-Wines 1.0 (2023-01)", SHA-256 `eac2d812b5eb94264f3c4ee1764ccdacf764cdf1c2599c26e3832ed91a4662cc` (equal to the authors' `INFO_Hashing.txt`), retrieved 2026-11-13 |
| Records           | 100,646 rows → 100,646 records (0 skipped, 0 invalid, 0 repeated ids, 0 mis-decoded rows, 0 unmapped types, 0 implausible vintages)                                                                                |
| Rights status     | `unverified`, scope `pilot` (see `SOURCE_RIGHTS_REGISTER.md`). Pilot use only.                                                                                                                                     |
| Query set         | `eval/catalog/benchmark.json` version 2: **247 entries** (§2)                                                                                                                                                      |
| Identity pairs    | `eval/catalog/identity-pairs.json`: **61 hand-labelled pairs** (§6)                                                                                                                                                |
| Search under test | `public.catalog_search_pilot` (the same implementation as people's search, plus pilot-scope providers; service role, pilot database only)                                                                          |

## 2. The query set

| Kind         | Entries | What it is                                                                                                          | Expected                                             |
| ------------ | ------: | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| positive     |     189 | a query a person might type and the wine meant. b001–b127 are Sprint 004A's, unchanged; 62 are new                  | the covered record in the top 8                      |
| perturbation |      32 | every 9th original entry, misspelt mechanically: an OCR confusion (o→0, l→1…), a dropped letter, a hyphenated break | the **base entry's** record                          |
| filter       |       6 | a query with a colour or country filter                                                                             | no returned row contradicts the filter               |
| generic      |       4 | "chateau", "domaine", "bodega", "reserva"                                                                           | bounded, quick                                       |
| adversarial  |      16 | SQL fragments, LIKE wildcards, a regex, 200 letters, full-width letters, control characters, an instruction, HTML   | no error, never more than the limit, data stays data |

New positives by segment: Portugal 6, Germany/Austria 6, New World 14, Champagne 6, France 7, Italy 3, Spain 3,
supermarket 4, Dutch 2, uncommon 1, near twins 10. They were written from general wine knowledge **before** the
provider's file was consulted, and none was removed afterwards. Where a real brand is named it is a search target,
not a statement about that producer.

**Who is the oracle.** Whether the provider "covers" a wine is decided from the provider's own file by `classify` in
`scripts/catalog-tools/benchmark.ts` (letter-pair similarity of names, TypeScript). The search ranks with `pg_trgm` in
SQL. They share no code, so the search never grades itself. The oracle is still a heuristic: §5 lists where it is
wrong. Perturbations inherit their base entry's target, so their expected answer does not depend on any matcher.

## 3. Coverage (X-Wines, 189 positive entries)

| Segment        |   Wines |  exact | ambiguous | partial | producer only | missing |
| -------------- | ------: | -----: | --------: | ------: | ------------: | ------: |
| fr             |      28 |     10 |         0 |      11 |             7 |       0 |
| it             |      16 |     10 |         1 |       1 |             1 |       3 |
| es             |      18 |      7 |         0 |       6 |             2 |       3 |
| pt             |       6 |      3 |         0 |       2 |             0 |       1 |
| de-at          |       6 |      6 |         0 |       0 |             0 |       0 |
| new-world      |      14 |     10 |         0 |       4 |             0 |       0 |
| sparkling      |      12 |      1 |         0 |       8 |             3 |       0 |
| champagne      |       6 |      1 |         0 |       4 |             1 |       0 |
| rose           |       3 |      1 |         0 |       1 |             1 |       0 |
| nl-supermarket |      26 |     19 |         0 |       5 |             0 |       2 |
| nl-wine        |       4 |      0 |         0 |       1 |             2 |       1 |
| eu-specialist  |      14 |      7 |         0 |       5 |             0 |       2 |
| similar        |      10 |      6 |         0 |       2 |             1 |       1 |
| variant        |      15 |      5 |         0 |       5 |             2 |       3 |
| uncommon       |       1 |      0 |         0 |       0 |             1 |       0 |
| near-twin      |      10 |      3 |         0 |       6 |             1 |       0 |
| **all**        | **189** | **89** |     **1** |  **61** |        **22** |  **16** |

The 127 original entries classify exactly as in Sprint 004A (56 / 1 / 38 / 17 / 15). What the table says about
X-Wines: strong on New World and supermarket wines and on German and Austrian estates; weak on Dutch wine (0 exact of 4) and on Champagne and sparkling wine by their usual names (2 exact of 18: it files "Brut (Carte Jaune) Champagne",
not "Brut Carte Jaune"). It is one provider measured on one author's list: an indication, not a completeness claim.

## 4. Search quality

| Set                                     | Queries | With a covered record | top-1 | top-3 | top-8 | not in top 8 |
| --------------------------------------- | ------: | --------------------: | ----: | ----: | ----: | -----------: |
| Sprint 004A's 127, **as reported then** |     127 |                    95 |    77 |    84 |    92 |            3 |
| The same 127, **this run**              |     127 |                    95 |    77 |    84 |    92 |            3 |
| New positives                           |      62 |                    56 |    52 |    55 |    55 |            1 |
| All positives                           |     189 |                   151 |   129 |   139 |   147 |            4 |
| Perturbations                           |      32 |                    20 |    16 |    16 |    17 |            3 |

| Safety measure                                                   |                                               Result |
| ---------------------------------------------------------------- | ---------------------------------------------------: |
| Provider results marked verified                                 |                                                **0** |
| Near twins where the sibling was offered before the wine         |                                          **0 of 10** |
| Rows contradicting a filter                                      |                                                **0** |
| Errors (any entry, including adversarial)                        |                                                **0** |
| Answers longer than the limit                                    |                                                **0** |
| Queries whose top 8 holds the same producer, name and type twice |                                                **0** |
| Automatic identity assertions                                    | **0**: the search asserts none; it offers candidates |

No regression on the 004A queries, and the brief's "at least 92 of 95 in the top 8" holds on the matched set. The new
positives rank better than the old ones (52 of 56 first) because several old entries are deliberately awkward.

"Top-1 is another wine than the one meant" happened for 22 of 151 covered positives. That is the ambiguity rate of
short queries, not a wrong-identity rate: every such result is an unverified offer the person chooses from, and §5
shows each one.

Adversarial strings: 5 of 16 are "not a search" after normalisation (only symbols or emoji), so they never reach the
database; the other 11 are searched as plain letters (`'; drop table wines; --` is searched as `drop table wines`
and finds nothing; full-width `ＣＨＡＴＥＡＵ ｍａｒｇａｕｘ` finds Château Margaux).

## 5. Every miss, explained

**A. The query names a family; the provider lists several of its wines** (the right one is on the list, not first).
Not a defect: nothing tells which sibling is meant, and the person picks.

| Id         | Query                               | First offered                                   | The record meant, at rank |
| ---------- | ----------------------------------- | ----------------------------------------------- | ------------------------: |
| b007, b122 | yquem                               | "Y", "Sauternes" (the same estate)              |                         3 |
| b017       | guigal cotes du rhone               | Côtes-du-Rhône Rosé                             |                         2 |
| b021       | william fevre chablis               | Chablis (the plain one)                         |                         4 |
| b026, b116 | veuve clicquot brut / veuve cliquot | Brut Rosé, Sec…                                 |                      4, 8 |
| b047       | mionetto prosecco brut              | Prestige Collection Brut                        |                         3 |
| b058, b061 | tommasi / bertani amarone           | another Amarone of the producer                 |                         2 |
| b103       | fx pichler gruner veltliner smaragd | "M", Loibner Loibenberg                         |                         5 |
| b105       | domane wachau federspiel terrassen  | Riesling Federspiel Terrassen                   |                         4 |
| b107       | niepoort redoma                     | Redoma Rosé                                     |                         2 |
| b118, b218 | marquis / marqu1s de riscal         | other Riscal wines (a misspelt producer: fuzzy) |                         5 |
| b127       | gruner veltliner bründlmayer        | another Grüner Veltliner of the estate          |                         4 |
| b143       | catena malbec                       | Catena Alta — Malbec                            |                         2 |
| b156       | taittinger comtes de champagne      | Comtes de Champagne Rosé                        |                         2 |

**B. Two producers share a surname** — b134 "jj prum wehlener sonnenuhr spatlese": S.A. Prüm's wine of the same name
is offered first, Joh. Jos. Prüm's second. "jj" matches neither "Joh. Jos." nor "S.A."; both are fuzzy and
unverified. This is the case the confirmation step exists for.

**C. More siblings than the list is long** — b151 "trapiche malbec": the provider has more than eight Trapiche wines
with "Malbec" in the name; "Vineyards Malbec" is not among the first eight. A real limit of an eight-row list for a
generic name. Mitigation in the product: the list shows the producer's wines and the person adds a word; the API
allows up to 20 rows.

**D. The oracle picked the wrong record; the search was right** (counted as misses above, to keep the numbers honest):

| Id         | Query                                     | Oracle's target                                       | What the search offered first                                      |
| ---------- | ----------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------ |
| b071       | anna de codorniu                          | Codorníu — Cava Brut Blanc de Blancs                  | Anna de Codorniu — Brut (the provider files the brand as producer) |
| b083, b121 | casillero del diablo (cabernet sauvignon) | Concha y Toro — Cabernet Sauvignon                    | Casillero del Diablo — Cabernet Sauvignon (Reserva)                |
| b009       | cheval blanc                              | Château Cheval Blanc — Le Petit Cheval Bordeaux Blanc | the provider has no "Château Cheval Blanc" record by that name     |

**E. Two errors in one query** — b219 "maruis de riscal", b220 "gruner veltliner bründ1mayer", b221 "…bründmayer":
the base queries were already a misspelling or a word-order variant, and the mechanical perturbation hit the only
word that names the producer. The search then offers other producers' wines of that name — all fuzzy, all unverified.
Typo tolerance is deliberately bounded (trigram word similarity 0.6, see the 004A report): loosening it made "chateau
margau" match 15,505 rows. A person corrects the word; no identity is asserted.

**Not covered by this provider** (no record to find): of the new positives, b128 Esporão Reserva (missing); b158
Cristal, b164 Château Talbot, b177 Apostelhoeve Cuvée XII, b179 Château Musar, b187 Veuve Clicquot Rosé (producer
present, this wine not).

## 6. Identity pairs: is it the same wine?

`identityRelation` (`packages/domain/src/catalog-identity.ts`) is checked against **61 pairs** labelled by hand from
the names alone (`eval/catalog/identity-pairs.json`): 6 same, 7 variant, 7 uncertain, 24 different cuvée, 4 different
type or country, 7 different producer, 6 different wine (two of them injection-shaped names).

| Measure                                                                    |      Result |
| -------------------------------------------------------------------------- | ----------: |
| Pairs classified as labelled (both orders)                                 | **61 / 61** |
| Pairs labelled different or uncertain that were called "same" or "variant" |       **0** |

How it got there, honestly: the first 45 pairs passed 43 at the first run (two slipped-letter pairs needed an
edit-distance rule). An independent review then found wines the first version wrongly called the same or a spelling
of each other — names differing only in signs ("Auslese \*" / "\*\*"), a third wine named after the estate, "Clos de
Vougeot" / "Vougeot", lettered cuvées, "Domaine Leroy" / "Maison Leroy". Sixteen such pairs were added with their
labels written first, the rules were rewritten to err towards "different", and all 61 then passed at the first run.
The labels were never changed to fit the code.

Covered: grand vin against second and third wine, Crianza / Reserva / Gran Reserva, non-vintage against a vintage
cuvée, producers sharing a surname or differing in an initial, accents and punctuation, a generic "Château" alone,
single letters and numbers, stars and plus signs, classification statements, the same words in another colour or
country.

## 7. Import evidence

| Check                                                                      | Result                                                                                    |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| An unmarked database (= production) refuses every tool                     | refused: "the target database says it is production"                                      |
| A non-pilot import of an unverified provider                               | refused by the database                                                                   |
| X-Wines run 1                                                              | 100,646 inserted, 0 invalid, 77 s                                                         |
| X-Wines run 2 (same file)                                                  | **0 inserted, 0 updated, 100,646 unchanged**, 0 withdrawn, 62 s                           |
| Rows sharing a (provider, external id)                                     | **0**                                                                                     |
| Same identity under two ids inside the file (reported, not merged)         | 171 pairs                                                                                 |
| CELLR wines written by any import                                          | **0**                                                                                     |
| Links verified by any import                                               | **0**                                                                                     |
| LWIN-layout fixture (fictitious), run 1 / run 2                            | 7 inserted, 5 skipped (2 deleted or combined, 2 not seven digits, 1 spirit) / 7 unchanged |
| The same file offered as real LWIN data                                    | refused before anything was read: layout never verified against a real file               |
| Another file in the LWIN layout offered under the fixture provider's name  | refused: only the fixture's own SHA-256 is accepted by an unverified layout               |
| A header-only file, `--limit` with withdrawal, a file a hundredth the size | all refused; afterwards 100,646 active, 0 withdrawn, 0 open runs                          |
| Records of the real `lwin` provider                                        | **0**                                                                                     |
| People's search for "muga reserva" in the pilot database                   | **0** provider rows (pilot search: 20)                                                    |

## 8. Limits of this benchmark

- One provider, one author's query list, one reviewer. Coverage numbers indicate; they do not prove.
- The oracle is heuristic (§5 D). A hand-verified target per entry would be better and is listed as follow-up.
- Vintages are not part of any measure: a search result is a wine, never a vintage.
- The pilot database holds no canonical wines, so link suggestions were not exercised at 100k scale; their rules are
  pinned by `supabase/tests/99_wi01_provider_lifecycle.test.sql` instead.
- Nothing here is a statement about recognition from photos (`REAL_LABEL_VALIDATION_PENDING`).
