# Recorded audit reports

Real `pnpm audit --prod --json` output, kept so the gate's tests (`../check-audit.test.sh`) run on the format pnpm
really writes without asking the registry: CI must not turn red because an advisory was published or withdrawn today.

| File                             | Recorded                 | Contents                                                                                                                |
| -------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `lodash-4.17.20.pnpm-audit.json` | 2026-11-18, pnpm 10.28.0 | A project with only `lodash@4.17.20`: 2 high (GHSA-35jh-r3h4-6jhm, GHSA-r5fr-rjxr-66jc), 2 moderate, all via `.>lodash` |

`bash scripts/audit/check-audit.test.sh --registry` (by hand) compares the recording with what the live registry
reports. If they differ, or after a pnpm upgrade, record it again outside the repository and replace the file:

```bash
mkdir -p /tmp/audit-probe && cd /tmp/audit-probe && printf '{"name":"audit-probe","private":true,"dependencies":{"lodash":"4.17.20"}}\n' > package.json && pnpm install --lockfile-only --ignore-workspace && pnpm audit --prod --json > lodash-4.17.20.pnpm-audit.json
```

Then update the table above and the expected advisory ids in `check-audit.test.sh` (part 2) if they changed.
