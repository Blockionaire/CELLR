// Human-readable files next to the manifest. SUMMARY.md holds no object paths, ids or keys and may be shared;
// VERIFICATION.md names the objects that failed, so it stays with the backup.
import { formatBytes } from "./log";
import type { Manifest } from "./manifest";

const table = (rows: string[][]) =>
  rows
    .map((r, i) => `| ${r.join(" | ")} |${i === 0 ? `\n|${r.map(() => " --- ").join("|")}|` : ""}`)
    .join("\n");

export function renderSummary(m: Manifest): string {
  const v = m.verification;
  return [
    `# Storage backup ${m.backupId}: ${v.status}`,
    "",
    "Non-sensitive summary: counts only, no object paths, keys or credentials.",
    "",
    table([
      ["", ""],
      ["Project", m.source.projectRef],
      ["Started (UTC)", m.startedAt],
      ["Finished (UTC)", m.finishedAt],
      ["Buckets", String(m.totals.buckets)],
      ["Objects listed", String(m.totals.objects)],
      ["Objects downloaded", String(m.totals.objectsDownloaded)],
      [
        "Bytes downloaded",
        `${m.totals.bytesDownloaded} (${formatBytes(m.totals.bytesDownloaded)})`,
      ],
      [
        "Local integrity (SHA-256 re-read)",
        `${v.localIntegrity.passed}/${v.localIntegrity.checked} passed`,
      ],
      [
        "Remote content equivalence (MD5 ETag)",
        `${v.remoteContentEquivalence.md5Matched} matched, ${v.remoteContentEquivalence.md5Unavailable} unavailable, ${v.remoteContentEquivalence.md5Mismatched} mismatched`,
      ],
      ["Errors", String(m.errors.length)],
      ["Requests / retries", `${m.requests.total} / ${m.requests.retries}`],
    ]),
    "",
    table([
      ["Bucket", "Public", "Objects", "Bytes"],
      ...m.buckets.map((b) => [
        b.id,
        b.public ? "yes" : "no",
        String(b.objectCount),
        String(b.bytes),
      ]),
    ]),
    "",
    v.reasons.length ? `## Why it failed\n\n${v.reasons.map((r) => `- ${r}`).join("\n")}\n` : "",
    v.warnings.length ? `## Warnings\n\n${v.warnings.map((r) => `- ${r}`).join("\n")}\n` : "",
    "Not included: the database. See RESTORE.md and docs/BACKUP-RECOVERY.md.",
    "",
  ].join("\n");
}

export function renderVerification(m: Manifest): string {
  const v = m.verification;
  const c = m.consistency;
  const list = (title: string, items: string[]) =>
    items.length
      ? `### ${title} (${items.length})\n\n${items.map((i) => `- \`${i}\``).join("\n")}\n`
      : "";
  return [
    `# Verification report: ${v.status}`,
    "",
    `Backup ${m.backupId}, project ${m.source.projectRef}. Inventories at ${m.inventory.firstAt} and ${m.inventory.secondAt ?? "(not taken)"}.`,
    "",
    "## What was checked",
    "",
    "1. Every listed object was downloaded; its byte count matched Content-Length and the listed size.",
    `2. MD5 of the bytes against the server's ETag (policy: ${m.options.md5Policy}).`,
    "3. A second, complete inventory after the downloads: nothing created, deleted or changed.",
    "4. Every file re-read from disk: SHA-256 and size as recorded.",
    "",
    "## Result",
    "",
    `- Local integrity: ${v.localIntegrity.passed}/${v.localIntegrity.checked} files passed, ${v.localIntegrity.failed} failed.`,
    `- Remote content equivalence: ${v.remoteContentEquivalence.md5Matched} proven by MD5, ${v.remoteContentEquivalence.md5Unavailable} without an MD5 ETag (local integrity only), ${v.remoteContentEquivalence.md5Mismatched} mismatched, ${v.remoteContentEquivalence.notChecked} not checked.`,
    "",
    v.reasons.length
      ? `## Reasons for FAILED\n\n${v.reasons.map((r) => `- ${r}`).join("\n")}\n`
      : "No reason to fail.\n",
    v.warnings.length ? `## Warnings\n\n${v.warnings.map((r) => `- ${r}`).join("\n")}\n` : "",
    m.errors.length
      ? `## Errors\n\n${m.errors.map((e) => `- \`${e.bucket}/${e.key}\` (${e.kind}): ${e.message}`).join("\n")}\n`
      : "",
    list("Created during the backup (not in it)", c.created),
    list("Deleted during the backup", c.deleted),
    list("Changed during the backup", c.changed),
    "## Limitations",
    "",
    ...m.limitations.map((l) => `- ${l}`),
    "",
  ].join("\n");
}

export function renderRestoreGuide(m: Manifest): string {
  return `# Restoring backup ${m.backupId}

Status of this backup: **${m.verification.status}**. Source project: \`${m.source.projectRef}\`.
The full procedure, the database part and the GO/NO-GO list are in \`docs/BACKUP-RECOVERY.md\` in the CELLR repository.

## 1. Check the backup (read-only, offline)

\`\`\`bash
pnpm storage-backup verify "<this folder>"
\`\`\`

Without the repository: \`sha256sum -c SHA256SUMS\` (Linux/macOS, from this folder), or in PowerShell
\`Get-FileHash -Algorithm SHA256 <file>\` for single files. The manifest (\`manifest.json\`) maps every file to its exact
bucket and object key; the file names under \`objects/\` are encoded and are not the keys.

## 2. Restore into an isolated project (never production)

The tool refuses production (\`${m.source.projectRef}\`) and the source project. A dry run is the default and writes nothing:

\`\`\`bash
pnpm storage-backup restore "<this folder>" --url https://<test-ref>.supabase.co --project-ref <test-ref>
\`\`\`

Then, with the plan checked, the same command with \`--execute\`. Objects that already exist are never overwritten
(see \`--fill-missing\` and \`--overwrite\` in docs/BACKUP-RECOVERY.md). Every restored object is downloaded again and
its SHA-256 compared. A restore that stopped halfway is resumed by running the same command again.

## 3. The database is separate

This folder holds Storage files only. Restore the database first (Supabase dashboard → Database → Backups, into a new
project, or a logical dump), then the files: the database brings the \`storage.objects\` rows, this backup brings the
bytes. \`--fill-missing\` writes files for rows that exist without a file.
`;
}
