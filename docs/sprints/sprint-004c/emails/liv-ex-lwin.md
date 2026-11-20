# E-mail to Liv-ex about LWIN: final, ready to send (Sprint 004C)

**NOT SENT.** Only the owner sends this, after reading it. Nothing in it claims a permission CELLR has. It replaces the draft in `docs/sprints/wine-intelligence-mega/emails/liv-ex-lwin.md`. The questions match `SOURCE_RIGHTS_REGISTER.md` L1–L8, and questions 8–10 match the real-file checklist in `docs/sprints/sprint-004c/LWIN.md` §5.

**Voor verzending (eigenaar):**

1. Vul `[Naam]` en `[e-mailadres]` in.
2. Controleer het adres op <https://www.liv-ex.com/lwin/>. Het rechtenregister noemt `data@liv-ex.com`; stuur alleen daarheen als de LWIN-pagina dat adres (nog) noemt.
3. Download niets vóór het antwoord.
4. Leg datum en antwoord vast in `SOURCE_RIGHTS_REGISTER.md` §2.

---

**To:** [the LWIN / data contact on liv-ex.com/lwin]
**Subject:** LWIN database: licence scope for use in a consumer wine-cellar app

Dear Liv-ex team,

I am the founder of JP Digital Ventures, a small company in the Netherlands. We build CELLR, a wine-cellar app for private wine drinkers. People record the bottles they own and get help finding and understanding their wines. CELLR is a commercial product: it may charge its users a subscription.

I would like to use the LWIN database as a reference catalogue of wine identities, and I want to be certain we do so within your terms **before** we download anything. Your LWIN pages describe the database as free to download under a Creative Commons licence. However, your website terms of use (clauses 11.3 and 11.4) and your membership terms (clause 9) restrict storing, redistributing and AI-related use of Liv-ex data. I could not find which of these governs the LWIN download, so I would be grateful if you could confirm the following in writing.

**What we would use:** the LWIN-7 code and the descriptive text of each entry: producer, wine, country, region, sub-region, colour, type, designation and classification. Vintages, bottle sizes and pack sizes would be kept only as they appear in the code.

**What we would not use:** prices, bids, offers, trades, indices or scores; your matching tool; any market-data API.

**How it would be shown:** as a suggestion. When a user scans a label our own catalogue does not know, the app may say "Could be this wine". It credits LWIN and Liv-ex and states that the entry is not verified by us and that Liv-ex does not endorse CELLR. The user confirms or corrects the details before anything is saved.

Questions:

1. Which licence, exactly (name and version), applies to the downloadable LWIN database? Who is the licensor, and does the licence cover the whole file, including the descriptive text?
2. For that file, does the Creative Commons licence prevail over the website terms (11.3, 11.4) and the membership terms (clause 9)? We are not a Liv-ex member.
3. May we store the file in our own application database, and show LWIN codes and the descriptive text to our consumer users, with attribution, in a commercial product?
4. May we combine LWIN entries with our own catalogue and with other licensed sources, indicating our changes (for example normalised spelling)?
5. May LWIN text be included as context when an AI model answers an individual user's question about their own wine? This would be inference only: we do not train or fine-tune any model on LWIN data.
6. What attribution wording and link do you require? May we name "LWIN" and "Liv-ex" in that credit, together with a statement that Liv-ex is not affiliated with CELLR and does not endorse it?
7. How may we obtain updates (frequency, method, and whether each download needs a new registration)?
8. Is there documentation of the file's columns, its encoding and its separator?
9. Could you confirm how the longer codes are built? Our understanding is: LWIN-11 is LWIN-7 plus a four-digit vintage, with `1000` for a wine without a single vintage; LWIN-16 is LWIN-11 plus a five-digit bottle size in millilitres (`00750`); LWIN-18 is LWIN-11 plus a two-digit pack size and then the bottle size. Is that right?
10. How are deleted, merged or replaced codes marked in the file, and does a merged code point to the code that replaces it?

If any of these uses is not permitted under the open licence, I would appreciate knowing whether a separate agreement is possible, and on what terms.

Thank you for your time.

Kind regards,

[Name]
Founder, JP Digital Ventures · CELLR
[e-mail address]
