# System Intelligence epic — Architecture & Health Control Center

An admin-only control center under `/admin/system` that shows how CELLR is built, how healthy it is, and what
breaks when something fails. Four sprints, each its own pull request to `main`.

| Sprint | Scope                                                                 | Status                                       |
| ------ | --------------------------------------------------------------------- | -------------------------------------------- |
| 1      | Architecture Control Center: register, map, tracing, automated checks | tested, preview-deployed; GO, awaiting merge |
| 2      | Live monitoring engine: healthchecks, history, heartbeat              | not started (waits for sprint 1 to merge)    |
| 3      | Incident & intelligence engine: detection, dedup, alerting, impact    | not started                                  |
| 4      | Hardening & release candidate                                         | not started                                  |

Status words used in every report: **implemented** (code on the branch) · **tested** (automated tests pass) ·
**deployed** (running on a hosted environment) · **operationally verified** (observed working there).

## Documents

- [SPRINT-1-PLAN.md](SPRINT-1-PLAN.md) — starting point, scope, checkpoints, risks
- [ADR-001-architecture-registry.md](ADR-001-architecture-registry.md) — register, evidence checks, separation
- [SPRINT-1-REPORT.md](SPRINT-1-REPORT.md) — what was built, evidence, open points, go/no-go
- [REGISTRY-GUIDE.md](REGISTRY-GUIDE.md) — how to keep the register true when the code changes

## Rules for this epic

No production changes, deployments, migrations on a hosted project or credential changes without explicit
approval. Existing migrations are immutable (`docs/MIGRATIONS.md`). No PR is merged without the owner's approval.
