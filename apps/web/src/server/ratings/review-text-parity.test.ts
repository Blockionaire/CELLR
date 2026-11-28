import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REVIEW_INVISIBLE_PATTERN, REVIEW_LINK_PATTERNS } from "@cellr/domain";

/**
 * The review text rule is enforced twice (packages/domain/src/review-text.ts and the database): the patterns must be
 * the same. The newest migration that defines `private.review_text_has_link` holds each one verbatim, as a literal.
 */
const MIGRATIONS = path.resolve(import.meta.dirname, "../../../../../supabase/migrations");

function latestRuleDefinition(): string {
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const defining = files.filter((f) =>
    /function private\.review_text_has_link\(/.test(readFileSync(path.join(MIGRATIONS, f), "utf8")),
  );
  expect(defining.length).toBeGreaterThan(0);
  const sql = readFileSync(path.join(MIGRATIONS, defining.at(-1)!), "utf8");
  const start = sql.search(/function private\.review_text_has_link\(/);
  return sql.slice(start, sql.indexOf("$$;", start));
}

describe("the review text rule in the database", () => {
  const sql = latestRuleDefinition();
  it("has every pattern of the domain's rule, verbatim, matched case-insensitively", () => {
    for (const p of REVIEW_LINK_PATTERNS) expect(sql).toContain(`t ~* '${p}'`);
  });
  it("has no pattern the domain does not have", () => {
    expect(sql.match(/ ~\* '/g)).toHaveLength(REVIEW_LINK_PATTERNS.length);
  });
  it("prepares the text as the domain does: NFKC, then the same invisible characters removed", () => {
    expect(sql).toContain(
      `regexp_replace(normalize(coalesce(p, ''), nfkc), '${REVIEW_INVISIBLE_PATTERN}', '', 'g') as t`,
    );
  });
});
