# E-mail to the X-Wines authors: final, ready to send (Sprint 004C)

**NOT SENT.** Only the owner sends this, after reading it. Nothing in it claims a permission CELLR has. It replaces the draft in `docs/sprints/wine-intelligence-mega/emails/x-wines-authors.md`. The questions match `SOURCE_RIGHTS_REGISTER.md` X1–X6.

**Voor verzending (eigenaar):**

1. Vul `[Naam]` en `[e-mailadres]` in. Die staan bewust niet in de repository.
2. Neem het adres over uit de correspondentieregel van het artikel (<https://doi.org/10.3390/bdcc7010020>, "Correspondence:"). Een adres uit een ander document of uit dit repo hoort niet in het To-veld.
3. CC aan het tweede auteursadres uit het artikel is optioneel.
4. Verstuur vanaf het zakelijke adres van JP Digital Ventures.
5. Leg datum en antwoord vast in `SOURCE_RIGHTS_REGISTER.md` §1.

---

**To:** [corresponding author, from the article]
**Subject:** X-Wines dataset: the origin of the wine data, before any use in a product

Dear Dr. de Azambuja, dear co-authors,

I am the founder of JP Digital Ventures, a small company in the Netherlands. We build CELLR, a wine-cellar app in which private wine drinkers record the bottles they own. CELLR is a commercial product.

Thank you for publishing X-Wines. We have evaluated the wines file (`XWines_Full_100K_wines.csv`, X-Wines 1.0) on our own machines only. We used it as a reference list of wine identities. It is very useful, and we cite your article wherever we describe that evaluation. Nothing from it is shown to our users today.

Before we consider any use in the app, I want to understand where the data comes from. Your CC0 dedication covers your own rights, but it says (section 4(c)) that it does not clear rights other people may hold.

What we would use, if we use it at all:

- **Identity and a few descriptive fields only:** wine name, winery, type, country, region, grapes, listed vintages, alcohol percentage and the blend/varietal indication. We would never use ratings, users or label images.
- **Shown as a suggestion, never as fact.** When a user scans a label of a wine our own catalogue does not know, the app may say "Could be this wine". Right there it shows a credit citing your article, the CC0 dedication with a link, that the entry is not verified by us, and that you are not affiliated with CELLR and do not endorse it. The user checks and corrects the details before anything is saved.
- **The source stays traceable.** Every entry keeps the X-Wines id and dataset version, and we can withdraw an entry or the whole source at once.

My questions:

1. From which websites were the wine attributes collected, and by what method?
2. Did you check those sites' terms of use, or obtain permission? Are you aware of any contract or database right (for example the EU sui generis database right) that would restrict commercial reuse of the identity fields?
3. Does the CC0 dedication apply to every version of the dataset (Test, Slim, Full)?
4. Is citing your article a condition of use, or a request? We are happy to cite it on the app's sources page either way, and I would like to word it as you prefer.
5. Is any attribute text copied verbatim from a source site, rather than normalised by you?
6. Do you keep a list of source attributions, and is there a contact for correction or removal requests that we should pass on to our users?

I understand if some of this cannot be answered. Whatever you can share will help us decide responsibly, and we will not use the data in the app until we are confident that we may.

Thank you, and kind regards,

[Name]
Founder, JP Digital Ventures · CELLR
[e-mail address]
