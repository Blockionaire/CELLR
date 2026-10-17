import { FIELDS, identifiedRightWine, type Field, type FieldResult } from "./score";

/** What happened to one photo. `unread` = the reader gave back nothing usable; `error` = the call failed. */
export interface PhotoOutcome {
  file: string;
  status: "read" | "unread" | "error";
  /** Why nothing was read, in the app's own words (`not-a-label`, `ai-down`, ...), or the error text. */
  reason: string | null;
  fields: FieldResult[];
  latencyMs: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
}

export interface FieldSummary {
  field: Field;
  scored: number;
  correct: number;
  /** 0 to 1, or null when no photo had this field written down. */
  accuracy: number | null;
}

export interface Failure {
  file: string;
  field: Field | "read";
  expected: string;
  got: string;
}

export interface Summary {
  photos: number;
  /** Photos where the reader gave a usable answer. */
  read: number;
  unread: number;
  errors: number;
  perField: FieldSummary[];
  /** Photos where every written-down identity field (producer, wine, vintage) was right. */
  identified: { scored: number; correct: number; rate: number | null };
  failures: Failure[];
  latency: { averageMs: number | null; p95Ms: number | null };
  tokens: { in: number; out: number; averagePerPhoto: number | null; reported: number };
}

const rate = (correct: number, scored: number) => (scored === 0 ? null : correct / scored);

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] ?? null;
}

export function summarize(outcomes: readonly PhotoOutcome[]): Summary {
  const perField: FieldSummary[] = FIELDS.map((field) => {
    const rows = outcomes.flatMap((o) => o.fields.filter((f) => f.field === field));
    const correct = rows.filter((r) => r.ok).length;
    return { field, scored: rows.length, correct, accuracy: rate(correct, rows.length) };
  });

  const identity = outcomes
    .map((o) => identifiedRightWine(o.fields))
    .filter((v): v is boolean => v !== null);
  const identifiedCorrect = identity.filter(Boolean).length;

  const failures: Failure[] = outcomes.flatMap((o) => {
    const wrong = o.fields
      .filter((f) => !f.ok)
      .map((f): Failure => ({ file: o.file, field: f.field, expected: f.expected, got: f.got }));
    if (wrong.length === 0 && o.status !== "read")
      return [
        { file: o.file, field: "read" as const, expected: "a reading", got: o.reason ?? o.status },
      ];
    return wrong;
  });

  const latencies = outcomes.map((o) => o.latencyMs).filter((v): v is number => v !== null);
  const sortedLatencies = [...latencies].sort((a, b) => a - b);
  const withTokens = outcomes.filter((o) => o.tokensIn !== null || o.tokensOut !== null);
  const tokensIn = withTokens.reduce((sum, o) => sum + (o.tokensIn ?? 0), 0);
  const tokensOut = withTokens.reduce((sum, o) => sum + (o.tokensOut ?? 0), 0);

  return {
    photos: outcomes.length,
    read: outcomes.filter((o) => o.status === "read").length,
    unread: outcomes.filter((o) => o.status === "unread").length,
    errors: outcomes.filter((o) => o.status === "error").length,
    perField,
    identified: {
      scored: identity.length,
      correct: identifiedCorrect,
      rate: rate(identifiedCorrect, identity.length),
    },
    failures,
    latency: {
      averageMs: latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : null,
      p95Ms: percentile(sortedLatencies, 0.95),
    },
    tokens: {
      in: tokensIn,
      out: tokensOut,
      averagePerPhoto: withTokens.length ? (tokensIn + tokensOut) / withTokens.length : null,
      reported: withTokens.length,
    },
  };
}

const pct = (value: number | null) =>
  value === null ? "   n/a" : `${(value * 100).toFixed(1).padStart(5)}%`;
const secs = (ms: number | null) => (ms === null ? "n/a" : `${(ms / 1000).toFixed(1)} s`);
const cut = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/** The readable version printed to the terminal. */
export function formatReport(summary: Summary, meta: { model: string; prompt: string }): string {
  const lines: string[] = [];
  lines.push(`Scan eval · ${summary.photos} photos · model ${meta.model} · prompt ${meta.prompt}`);
  lines.push("");
  lines.push("Field          Correct  Scored  Accuracy");
  lines.push("-------------  -------  ------  --------");
  for (const f of summary.perField) {
    if (f.scored === 0) continue;
    lines.push(
      `${f.field.padEnd(13)}  ${String(f.correct).padStart(7)}  ${String(f.scored).padStart(6)}  ${pct(f.accuracy)}`,
    );
  }
  const id = summary.identified;
  lines.push("-------------  -------  ------  --------");
  lines.push(
    `${"right wine".padEnd(13)}  ${String(id.correct).padStart(7)}  ${String(id.scored).padStart(6)}  ${pct(id.rate)}`,
  );
  lines.push("");
  lines.push(
    `Read: ${summary.read}/${summary.photos}` +
      (summary.unread ? ` · nothing usable: ${summary.unread}` : "") +
      (summary.errors ? ` · failed: ${summary.errors}` : ""),
  );
  lines.push(
    `Latency: average ${secs(summary.latency.averageMs)}, slowest 5% ${secs(summary.latency.p95Ms)}`,
  );
  lines.push(
    summary.tokens.reported === 0
      ? "Tokens: not reported"
      : `Tokens: ${summary.tokens.in} in, ${summary.tokens.out} out (about ${Math.round(summary.tokens.averagePerPhoto ?? 0)} per photo)`,
  );
  if (summary.failures.length > 0) {
    lines.push("");
    lines.push(`Misses (${summary.failures.length}):`);
    for (const f of summary.failures)
      lines.push(
        `  ${cut(f.file, 30).padEnd(30)}  ${f.field.padEnd(8)}  expected ${cut(f.expected, 30)}  got ${cut(f.got, 40)}`,
      );
  }
  return lines.join("\n");
}
