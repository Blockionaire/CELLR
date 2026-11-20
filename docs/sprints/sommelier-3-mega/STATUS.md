# Sommelier 3.0 — status (resume from here)

A new session reads this file first, then `git log --oneline -15`, the open pull requests and the newest CI runs, and
continues at **Next action**. Scope: [`MASTER_BRIEF.md`](MASTER_BRIEF.md). Design: [`ARCHITECTURE.md`](ARCHITECTURE.md).
The end state of S0–S8 is in [`FINAL_REPORT.md`](FINAL_REPORT.md); S9 is in [`progress/S9.md`](progress/S9.md);
what exists against the brief is in [`PRODUCT_STATUS.md`](PRODUCT_STATUS.md); what the owner has to decide, and
the GO / NO-GO, is in [`RELEASE_PLAN.md`](RELEASE_PLAN.md).

## Resume block

```text
UPDATED:        2026-11-20 (S0–S9 written; everything is in open pull requests; nothing is merged or released)
PHASE:          S9 — quality and product completion
TRACKING ISSUE: #89
MAIN:           6ab4350 (#88 system monitoring and #92 3D sprint 4 merged). main holds migration 20261124000047,
                and Production records 0001–0047 (read-only check, 2026-11-20, after the owner applied 0047).
                This work's migrations: 0048, 0049, 0050; all unapplied, all later than 0047.
SWITCHES:       sommelier_engine, sommelier_buying, sommelier_social, sommelier_experiences, sommelier_learning.
                None is turned on by `all`; each must be named in CELLR_FEATURES; the last four need the first.
                Nothing is on anywhere.
AI:             The comparison with V1's AI was run on 2026-11-20 with the owner's approval ($0.10 of $2;
                gpt-6-luna, reasoning none, as Production). Result: 3.0 is NOT shown to be better; the model
                generalises better to unseen dishes (AI_COMPARISON.md §8–§9). The key lives in the cloud
                environment's secret store (api.openai.com), never in the repository.
RETAILER:       no source. Live offers are built, validated and off (`offers: null`); buying advice is styles.
QUALITY:        main set 170 / 246; blind holdout 19 / 43; unseen dishes understood 72% (progress/S9.md §2).
PRODUCTION:     not touched. No merge, deploy, db push, setting or production write by the agent.
WORKTREES:      /home/user/CELLR (S7 branch), /home/user/CELLR-s3 (S9 branch). Ephemeral: only what is pushed lasts.
```

## Pull requests (a stack: review and merge top to bottom)

| Phase   | Branch                               | Base                                 | Pull request                                         |
| ------- | ------------------------------------ | ------------------------------------ | ---------------------------------------------------- |
| S0      | `claude/sommelier-3-s0-foundation`   | `main`                               | [#90](https://github.com/Blockionaire/CELLR/pull/90) |
| S1 + S2 | `claude/sommelier-3-s2-food-pairing` | `claude/sommelier-3-s0-foundation`   | [#91](https://github.com/Blockionaire/CELLR/pull/91) |
| S3 + S4 | `claude/sommelier-3-s3-wine`         | `claude/sommelier-3-s2-food-pairing` | [#93](https://github.com/Blockionaire/CELLR/pull/93) |
| S5      | `claude/sommelier-3-s5-social`       | `claude/sommelier-3-s3-wine`         | [#94](https://github.com/Blockionaire/CELLR/pull/94) |
| S6      | `claude/sommelier-3-s6-experiences`  | `claude/sommelier-3-s5-social`       | [#95](https://github.com/Blockionaire/CELLR/pull/95) |
| S7      | `claude/sommelier-3-s7-learning`     | `claude/sommelier-3-s6-experiences`  | [#97](https://github.com/Blockionaire/CELLR/pull/97) |
| S8      | `claude/sommelier-3-s8-release`      | `claude/sommelier-3-s7-learning`     | [#98](https://github.com/Blockionaire/CELLR/pull/98) |
| S9      | `claude/sommelier-3-s9-quality`      | `claude/sommelier-3-s8-release`      | S9_PR_LINK                                           |

`claude/sommelier-3-s1-food` holds early work-in-progress checkpoints only. It is not a pull request branch and
can be deleted once the stack is merged.

When a lower pull request changes after review, the change is merged into each branch above it (D-28): no branch
with an open pull request is rebased or force-pushed.

## Done

Each phase's record is `progress/S<n>.md`: scope, choices, test commands and their actual results, the independent
review's findings and what was done about each, limitations.

- **S0**: design, benchmark of 246 scenarios, observed baseline of V1 without AI (13 / 246).
- **S1**: food engine; 331 ingredients, 31 techniques, 82 sauces, 360 dish templates (English and Dutch).
- **S2**: pairing engine; 566 wine style rules; three honest outcomes. Engines alone: 79 / 246.
- **S3 + S4**: the engines in the app (a plan, no model call), buying advice as styles with a conversation that
  keeps its state, offer validation with no source connected. In the app: 131 / 246.
- **S5**: friends named in a question, with their own consent (off by default); migration 0048 (draft).
- **S6**: serving, keeping, wine-to-food, menus, quantities; the plan in a real browser (phone and desktop, WCAG
  2.1 AA by axe). 140 / 246.
- **S7**: what came of a bottle, apart from the thumb; the admin's report; migration 0049 (draft).
- **S8**: final review, classification of what is open, `FINAL_REPORT.md`, `RELEASE_PLAN.md`.
- **S9**: the 106 failures sorted and a blind second opinion on the disagreements; engine recalibrated (main set
  140 → 170; unseen dishes 34 → 38 of 88); a blind holdout; a friend's cellar and presents not already owned
  (migration 0050, draft); friends kept across follow-ups; the comparison with V1's AI (run: 3.0 not shown to be better);
  the brief against what exists; GO / NO-GO.

## Next action

Nothing for the agent without the owner. The owner's decisions, in order, are in `RELEASE_PLAN.md`; the first
one that unblocks more work is S10 as advised in `progress/S9.md` §10 (a model reads the dish the parser cannot).
A session that resumes: read the pull requests' review comments and CI, fix what is asked on the branch it
belongs to, rebase the branches above it, and update the phase's `progress` file.
