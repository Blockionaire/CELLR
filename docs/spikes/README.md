# Spikes

Throwaway experiments that back claims in [`../00-architecture-plan.md`](../00-architecture-plan.md).
They are evidence, not product code.

| File | Backs | Result |
|---|---|---|
| `rls-model.sql` | §5 household permission model | 31 assertions pass + negative control (naive policy → `42P17 infinite recursion`) |
| `rls-bench.sql` | §4.3 policy shape vs. scale | 600k bottles: per-row function ≈ 3.3 s · array-InitPlan < 1 ms |
| `ocr-lone-year/` | on-device OCR of a year printed alone (`features/scan/ocr.ts`) | SPARSE + a second look at lone digit lines: no wrong years from those lines, no names lost, ≈ +0.1 s; AUTO loses corner and column text ([README](ocr-lone-year/README.md)) |

Run both (needs Postgres 16 server binaries; no Docker, no Supabase):

```bash
docs/spikes/run-spikes.sh
```
