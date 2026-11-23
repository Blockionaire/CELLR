# The knowledge behind the fallback — review instructions

**Who:** a wine professional. **Why:** when the AI is not available, the app's own engines answer (the `fallback`
part). It stays off in production until a professional has reviewed what they know (decision D-49). Four forms, each
generated from the current code; the words in them are the rules' outcomes, put in plain English.

| Form                     | Rows | What you see                                                                                                                                                                         |
| ------------------------ | ---: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `knowledge-serving.csv`  |   26 | A wine type and what it is like (body, tannin, sweetness, oak, age) → the temperature band, fridge time, decanting and glass the rules give                                          |
| `knowledge-windows.csv`  |   54 | A wine (type, appellation, country) → which style table it is read as, and from how many years after the harvest until how many it is good to drink; also for a bottle that cost €60 |
| `knowledge-pairings.csv` |   60 | A dish and a wine → the engine's judgement (good / acceptable / neither / poor) and its reasons for and against, drawn at random with a fixed seed                                   |
| `knowledge-fallback.csv` |   20 | The fallback's answers that disagree most with the benchmark's labels; **those labels were written by an AI and reviewed by nobody**, so judge both                                  |

Per row, fill in the `YOUR VERDICT` columns: `agree`, `disagree` or `unsure`, and why (what it should be). In the
fallback form there are two verdicts: on the fallback's choice, and on the AI-written label. Use the three words of
[criteria.md](criteria.md).

Leave a cell empty only if you did not review that row. Filled in by: ____________ Date: ________ — nothing counts
as reviewed until you have signed it.
