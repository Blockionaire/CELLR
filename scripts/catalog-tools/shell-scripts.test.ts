import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The shell scripts read their JSON results with `j FILE EXPR`, which runs `console.log(EXPR)` in node: EXPR must be
 * an expression. A statement there (staging run 46012494694: `const a = …` inside console.log) is a syntax error that
 * only shows at the end of a long run, so every call is parsed here.
 */
const dir = new URL("./", import.meta.url);
const scripts = readdirSync(dir).filter((f) => f.endsWith(".sh"));

/** The second argument of each `j "…" "…"` call, with shell variables replaced by a placeholder. */
function calls(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(/(?:^|[\s{;(])j "[^"]*" "((?:[^"\\]|\\.)*)"/gm))
    out.push(m[1]!.replace(/\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/g, "x").replace(/\\"/g, '"'));
  return out;
}

describe("the shell scripts' JSON checks", () => {
  it("finds the scripts that use them", () => {
    const using = scripts.filter((f) => calls(readFileSync(new URL(f, dir), "utf8")).length > 0);
    expect(using).toContain("staging-pilot.sh");
    expect(using).toContain("production-run.sh");
  });

  for (const file of scripts)
    it(`${file}: every j call passes an expression`, () => {
      for (const expr of calls(readFileSync(new URL(file, dir), "utf8")))
        expect(() => new Function("r", "require", `return (${expr});`), expr).not.toThrow();
    });

  it("would have caught the statement of run 46012494694", () => {
    const [bad] = calls(
      `  j "$OUT/t.json" "const a=require('$OUT/a.json');process.exit(r.units===a.units?0:1)"`,
    );
    expect(() => new Function("r", "require", `return (${bad});`)).toThrow(SyntaxError);
  });
});
