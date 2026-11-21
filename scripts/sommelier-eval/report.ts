import type { ScenarioResult, Summary } from "./score";

const pct = (a: number, b: number) => (b === 0 ? "n/a" : `${Math.round((a / b) * 100)}%`);

/** The report as Markdown: what was run, the result per category and per measure. Latency is left to the caller. */
export function formatSummary(s: Summary, describes: string): string {
  const lines = [
    `Engine: \`${s.engine}\` — ${describes}`,
    "",
    `Scenarios passed: **${s.passed} / ${s.scenarios}** (${pct(s.passed, s.scenarios)}); the engine could attempt ${s.supported}.`,
    "",
    "| Category | Scenarios | Could attempt | Passed |",
    "| --- | ---: | ---: | ---: |",
    ...Object.entries(s.byCategory).map(
      ([name, c]) =>
        `| ${name} | ${c.scenarios} | ${c.supported} | ${c.passed} (${pct(c.passed, c.scenarios)}) |`,
    ),
    "",
    "| Measure (over the scenarios it applies to and the engine could attempt) | Passed | Of | Rate |",
    "| --- | ---: | ---: | ---: |",
    ...Object.entries(s.measures)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, [a, b]]) => `| ${name} | ${a} | ${b} | ${pct(a, b)} |`),
  ];
  return lines.join("\n");
}

export function formatFailures(results: readonly ScenarioResult[], limit = 400): string {
  const lines: string[] = [];
  for (const r of results.filter((x) => !x.pass).slice(0, limit))
    lines.push(
      `${r.id} [${r.category}] ${r.checks
        .filter((c) => !c.pass)
        .map((c) => `${c.name}${c.detail ? ` (${c.detail})` : ""}`)
        .join("; ")}`,
    );
  return lines.join("\n");
}
