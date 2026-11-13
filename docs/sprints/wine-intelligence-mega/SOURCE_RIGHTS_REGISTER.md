# Source rights register

One entry per external source, and one decision **per intended use**. This is an engineering record of evidence and
open questions. **It is not legal advice, and nothing in it clears a source.** The only thing that changes what people
see is a provider row in the database (`rights_status`, `search_scope`), set by the owner through
`admin_catalog_provider_rights` with evidence. No sentence here, and no model, changes that.

Status words: **verified** = evidence on file covers this use · **unverified** = not established; isolated pilot use
only · **blocked** = must not be used until a named question is answered in writing.

Evidence was read from the sources' own public pages on **2026-11-13**. Quotes are short and verbatim. "Not found"
means the page was read and does not say it. Re-read every page before any real import or enablement.

---

## 1. X-Wines

|                    |                                                                                                                                                                                                                                                                                                                |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider id        | `xwines`                                                                                                                                                                                                                                                                                                       |
| Source             | <https://github.com/rogerioxavier/X-Wines> (README, LICENSE); article <https://doi.org/10.3390/bdcc7010020>                                                                                                                                                                                                    |
| Claimed licence    | CC0 1.0 Universal (the repository's `LICENSE` file). The README itself names no licence.                                                                                                                                                                                                                       |
| What CELLR holds   | `XWines_Full_100K_wines.csv` (100,646 wines), in an isolated local evaluation folder outside Git. SHA-256 `eac2d812…4662cc`, equal to the authors' `INFO_Hashing.txt`. Retrieved 2026-11-13 from the authors' Drive folder linked in the README. Ratings, user files and label images were **not** downloaded. |
| Database state     | never registered in production. In the throwaway pilot database: `rights_status = unverified`, `search_scope = pilot`.                                                                                                                                                                                         |
| **Overall status** | **unverified — pilot only**                                                                                                                                                                                                                                                                                    |

### Evidence

| Topic                 | Quote / finding                                                                                                                                                                              | Where                |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| Licence               | The LICENSE file is "CC0 1.0 Universal".                                                                                                                                                     | repository `LICENSE` |
| Commercial use        | Waiver "for any purpose whatsoever, including without limitation commercial, advertising or promotional purposes".                                                                           | CC0 §2               |
| Database rights       | The waived rights include "database rights (such as those arising under Directive 96/9/EC…)" — the **affirmer's own**.                                                                       | CC0 §1(vi)           |
| Other people's rights | "Affirmer disclaims responsibility for clearing rights of other persons that may apply to the Work or any use thereof".                                                                      | CC0 §4(c)            |
| Warranty              | "Affirmer offers the Work as-is and makes no representations or warranties of any kind".                                                                                                     | CC0 §4(b)            |
| Origin                | "Data were collected on the open Web in 2022 and pre-processed for wider free use."                                                                                                          | README               |
| Purpose stated        | "a preprocessed, consistent, and open data alternative for general use by softwares, especially in educational processes and research".                                                      | README               |
| Citation              | "If you publish material based on X-Wines dataset obtained from this or another repository, then, in your references the paper below must be mandatorily cited."                             | README               |
| Source websites       | **Not found** in the README or LICENSE. The article page could not be opened from this environment (HTTP 403), so what it says about the websites, the method and their terms is **unread**. | —                    |
| No endorsement        | Not found (CC0 has no such clause; trademark rights are not waived, CC0 §4(a)).                                                                                                              | —                    |

### Decision per use

| Intended use                               | Status           | Why                                                                                                                                        |
| ------------------------------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Download and evaluate in isolation         | **done**         | Published for download under CC0 by its authors; held locally, checksum-verified, outside Git and outside any hosted database.             |
| Store the dataset in CELLR's production DB | **unverified**   | CC0 waives only the authors' rights. Whose data it was, and under which site terms or database right it was collected, is not established. |
| Display records to consumers               | **unverified**   | Same question. If cleared: show the citation the authors ask for.                                                                          |
| Combine / enrich with other providers      | **unverified**   | Same question.                                                                                                                             |
| Pass records to a model for inference      | **unverified**   | Not used: no X-Wines field is sent to any model anywhere in CELLR.                                                                         |
| Train or fine-tune on the dataset          | **out of scope** | Not done, not planned.                                                                                                                     |
| Keep derived fields after a withdrawal     | **unverified**   | CELLR keeps none: nothing is derived from pilot data.                                                                                      |

Fields used in the pilot: wine id, wine name, winery name, type, country code, region, grapes, ABV, "elaborate" and the
listed vintages. **Never read:** ratings, users, websites, food pairings, body, acidity, label images. A listed
vintage is the dataset's statement, not proof the producer released that year; nothing in CELLR treats it as such.

Proposed credit, **if** it is ever cleared: _"X-Wines dataset — de Azambuja, Morais & Filipe (2023), Big Data Cogn.
Comput. 7(1):20, doi:10.3390/bdcc7010020 (CC0 1.0). Names normalised and types mapped by CELLR."_

### Open questions (for the authors; draft in `emails/x-wines-authors.md`)

- X1. Which websites was the data collected from, and how?
- X2. Were those sites' terms checked, or permission obtained? Is any third-party contract or database right known to
  restrict commercial use of the identity fields?
- X3. Does CC0 cover every version (Test, Slim, Full)?
- X4. Is the "mandatory" citation a condition or a request, for an app that publishes no paper?
- X5. Is any attribute text taken verbatim from a source site?
- X6. Is there an authoritative list of source attributions, and a contact for takedown requests?

---

## 2. Liv-ex LWIN

|                    |                                                                                                                                                                                           |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider id        | `lwin`                                                                                                                                                                                    |
| Source             | <https://www.liv-ex.com/lwin/>, <https://www.liv-ex.com/lwin-creative-commons-licence/>                                                                                                   |
| Claimed licence    | "Creative Commons" on the LWIN pages; the licence page's text never names a version — "CC BY 4.0" appears only as the target of its links.                                                |
| What CELLR holds   | **Nothing.** No LWIN file was requested, downloaded or opened. The download sits behind a registration form, which was not submitted.                                                     |
| Database state     | never registered in production. Static assessment: `rights_status = blocked`, nothing may be stored or shown.                                                                             |
| Adapter            | written against an **assumed** column layout (`lwin-assumed-layout-v0`), tested only on CELLR's own fictitious fixture; `layoutVerified = false`, so the import tool refuses a real file. |
| **Overall status** | **blocked**                                                                                                                                                                               |

### Evidence

| Topic                                | Quote / finding                                                                                                                                                                                                                                                                                                                                                                | Where                                     |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| Licence                              | "It's free to download, and always will be under the Creative Commons licence."                                                                                                                                                                                                                                                                                                | `/lwin/`                                  |
| Sharing                              | "Share — copy and redistribute the material in any medium or format."                                                                                                                                                                                                                                                                                                          | `/lwin-creative-commons-licence/`         |
| Commercial use                       | "Adapt — remix, transform, and build upon the material for any purpose, even commercially."                                                                                                                                                                                                                                                                                    | same                                      |
| Attribution                          | "You must give appropriate credit, provide a link to the license, and indicate if changes were made." A Liv-ex-specific wording: **not found**.                                                                                                                                                                                                                                | same                                      |
| No endorsement                       | "…but not in any way that suggests the licensor endorses you or your use."                                                                                                                                                                                                                                                                                                     | same                                      |
| Which licence, whose, covering what  | **Not found**: the visible text names no version, no licensor and no definition of "the material".                                                                                                                                                                                                                                                                             | same                                      |
| Website terms, scope                 | "these Terms apply to any functionality or Content which is provided free of charge."                                                                                                                                                                                                                                                                                          | `/website-terms-of-use/` cl. 1.3          |
| Website terms, AI                    | "data may not be used whether directly or indirectly for the purposes of training, developing or enhancing any artificial intelligence, machine learning tool or model or algorithm."                                                                                                                                                                                          | same, cl. 11.3                            |
| Website terms, storing               | "You do not have any right to sub-license, copy, download, store, distribute, sell or otherwise make any Content, information or data available via the Site to third parties… without our prior written permission".                                                                                                                                                          | same, cl. 11.4                            |
| Membership, scope                    | The data service "may include… valuations, indices, product codes, charts"; licence "solely for your own, internal, non-commercial activities".                                                                                                                                                                                                                                | `/liv-ex-membership-terms/` cl. 9.1, 9.3  |
| Membership, AI                       | "If you require a licence to use the Liv-ex property in any artificial intelligence, machine learning tool or model or algorithm please contact your Account Manager."                                                                                                                                                                                                         | same, cl. 9.9.1                           |
| Membership, products                 | Not to "create… another product which uses any of the data made available through the Liv-ex property".                                                                                                                                                                                                                                                                        | same, cl. 9.19.4                          |
| Name and marks                       | "not to use the mark LIV-EX… or imply any association with or endorsement by Liv-ex".                                                                                                                                                                                                                                                                                          | same, cl. 37.4                            |
| Consumers                            | "we do not provide services to consumers".                                                                                                                                                                                                                                                                                                                                     | both terms, cl. 1.5                       |
| Which terms govern the LWIN download | **Not found.** Neither set of terms contains the words "Creative Commons"; the licence page refers to neither set of terms. Neither carves LWIN out.                                                                                                                                                                                                                           | all three                                 |
| Open vs paid                         | "the most comprehensive open source database available to the industry"; "our online matching tool, available exclusively to Liv-ex members".                                                                                                                                                                                                                                  | `/lwin/`, `/contact-faqs/`                |
| Code structure                       | "LWINs are unique 7, 11, 16 or 18-digit codes. The 7-digit code refers to the wine itself… The longer codes include information about the vintage, bottle and pack size." Examples: `12345672012`; `1234567201200750` ("2012, 750ml bottle size"); `123456720121200750` ("2012, 12 bottles of 750ml"); "All bottle sizes are expressed in millilitres in a five-digit format." | `/contact-faqs/` (read and checked twice) |
| Non-vintage coding                   | **Not found** on the public pages.                                                                                                                                                                                                                                                                                                                                             | —                                         |

The conflict in one line: the LWIN pages say Creative Commons, commercial adaptation allowed; the website and
membership terms say no storing, no products built on the data, no AI use, without written permission — and no page
says which governs the separately offered LWIN file. That is a contractual question only Liv-ex can answer.

### Decision per use

| Intended use                          | Status           | Why                                                                                                |
| ------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------- |
| Download and evaluate in isolation    | **blocked**      | Behind a registration form; not submitted. Which terms apply to the file is unanswered.            |
| Store in CELLR's database             | **blocked**      | Website terms 11.4 / membership 9.13 against the CC statement.                                     |
| Display records or codes to consumers | **blocked**      | Same; plus "no services to consumers" and the trademark clauses.                                   |
| Combine / enrich with other providers | **blocked**      | Membership 9.19.4.                                                                                 |
| Pass records to a model for inference | **blocked**      | Website terms 11.3 / membership 9.9.1, 9.14. No LWIN field is sent to any model anywhere in CELLR. |
| Train or fine-tune                    | **out of scope** | Not done, not planned; expressly restricted by the terms above.                                    |
| Keep derived fields after termination | **blocked**      | No licence text states it.                                                                         |

What CELLR would use if cleared: the LWIN-7 code, producer, wine, country, region, sub-region, colour, type,
designation and classification text. **Never:** prices, bids, offers, trades, indices, scores, the matching tool, the
market-data API.

Credit wording: to be given by Liv-ex. Until then no wording is proposed as theirs. Any credit will be the plain
"Bron: … · licentie …" line of `packages/domain/src/provenance.ts`, with the no-endorsement sentence, and no logo.

### Open questions (for Liv-ex; draft in `emails/liv-ex-lwin.md`)

- L1. The exact licence name and version of the LWIN database, the licensor, and what it covers (the whole file,
  including names and classification text?).
- L2. Which document governs the downloaded file: the Creative Commons licence, the website terms (11.3, 11.4) or the
  membership terms (clause 9)?
- L3. May a non-member commercial consumer app store the file in its own database and show names and codes to its
  users, with attribution?
- L4. May LWIN text be part of the context of an AI model that answers one user's question (inference, no training)?
- L5. The exact attribution wording and link Liv-ex requires; may "LWIN" and "Liv-ex" be named in the app?
- L6. Are EU and UK database rights licensed with it?
- L7. How updates may be obtained (how often, by what means, is re-registration needed)?
- L8. The file's column layout, what stands in the vintage position of a code for a wine without a single vintage,
  and how deleted or combined codes are marked.

---

## 3. CELLR's own fixtures

| Provider id    | What it is                                                                                                 | Status                                                    |
| -------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `fixture`      | `eval/catalog/fixture-xwines-layout.csv`: fictitious wines in the X-Wines column layout                    | CELLR's own; verified; test and pilot databases only      |
| `lwin_fixture` | `eval/catalog/fixture-lwin-layout.csv`: fictitious wines and invented codes in the **assumed** LWIN layout | CELLR's own; verified; proves nothing about the real file |

Neither is ever registered in production: they exist so that the import, rights, search and provenance paths can be
tested end to end without any third-party data.

---

## 4. Explicit public-enable decision list (all NO today)

| Provider | In people's search? | Needs before YES                                                                                              | Who decides |
| -------- | ------------------- | ------------------------------------------------------------------------------------------------------------- | ----------- |
| X-Wines  | **NO**              | Answers to X1, X2 (at least) in writing; this register updated; `admin_catalog_provider_rights` with evidence | the owner   |
| LWIN     | **NO**              | Answers to L1–L5 in writing; a lawfully obtained file; the adapter layout verified against it (L8)            | the owner   |

## 5. How this register was made

- The pages above were fetched and read on 2026-11-13 by a read-only research pass, and the LWIN code-structure quote
  was re-read and checked a second time. No form was submitted, no account created, no terms accepted, nobody
  contacted, no dataset other than the X-Wines wines file opened.
- Liv-ex also offers an "LWIN guide" behind a lead form. It was **not relied on** for anything in this register; the
  code structure above comes from the public FAQ page only.
- The X-Wines article (the place where the source websites would be described) could not be opened from this
  environment. That gap is a reason the status is "unverified", not a detail.
