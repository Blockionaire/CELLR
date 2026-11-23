# Review forms for people (Sommelier V1+, P8)

Forms that a wine professional or a cook fills in, in Excel or Google Sheets. Nothing here needs code. **No form
has been filled in yet, and nothing counts as reviewed or approved until a named person has signed it.** Every
verdict column is empty; nothing in them was written by an AI or by code.

| Form                                                                                                 | For                                                 | Instructions                                                                        |
| ---------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `holdout-template.csv` + `holdout-wines.csv`                                                         | Writing 40 new wine-and-food scenarios (blind test) | [English](holdout-instructions.md) · [Nederlands](holdout-instructions.nl.md)       |
| `annotation-review.csv`                                                                              | The facts under the sommelier's cards, 50 wines     | [English](annotation-instructions.md) · [Nederlands](annotation-instructions.nl.md) |
| `knowledge-serving.csv`, `knowledge-windows.csv`, `knowledge-pairings.csv`, `knowledge-fallback.csv` | The knowledge behind the fallback                   | [English](knowledge-instructions.md) · [Nederlands](knowledge-instructions.nl.md)   |
| All of them                                                                                          | What counts as an error                             | [English](criteria.md) · [Nederlands](criteria.nl.md)                               |

**Opening a form:** download the `.csv` and open it (Excel: double-click; Google Sheets: File → Import). The files
are UTF-8 with a byte-order mark, so `°C` and accents show correctly. Save your filled copy as `.xlsx` or `.csv`
**on your own computer**, with your name in the file name, and send it back to the owner (not into the repository).

**For the owner and developers:** the forms are generated from the current code
(`pnpm --filter @cellr/sommelier-eval run review-forms --write`); a test fails when a form and the code disagree or
when any verdict cell is filled in the repository. A filled form never goes into the repository.
