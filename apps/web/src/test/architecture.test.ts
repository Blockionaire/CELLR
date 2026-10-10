import fs from "node:fs";
import path from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const eslint = new ESLint({ cwd: root });

/** Lint `code` as if it lived at `file`; return the rule ids that fired. */
async function violations(file: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: path.join(root, file) });
  return (result?.messages ?? [])
    .filter((m) => m.severity === 2)
    .map((m) => m.ruleId ?? "parse-error");
}

describe("layer boundaries are enforced", () => {
  it("UI cannot import server modules", async () => {
    expect(
      await violations(
        "src/ui/x.tsx",
        `import { a } from "@/server/households/service";\nexport const b = a;`,
      ),
    ).toContain("no-restricted-imports");
  });
  it("features cannot import Supabase", async () => {
    expect(
      await violations(
        "src/features/x.ts",
        `import { createClient } from "@supabase/supabase-js";\nexport const c = createClient;`,
      ),
    ).toContain("no-restricted-imports");
  });
  it("routes cannot import repositories or db clients", async () => {
    expect(
      await violations(
        "src/app/x/page.tsx",
        `import { r } from "@/server/households/repository";\nexport default r;`,
      ),
    ).toContain("no-restricted-imports");
    expect(
      await violations(
        "src/app/x/page.tsx",
        `import { d } from "@/server/db/client";\nexport default d;`,
      ),
    ).toContain("no-restricted-imports");
  });
  it("routes cannot import Supabase directly", async () => {
    expect(
      await violations(
        "src/app/api/v1/x/route.ts",
        `import { createClient } from "@supabase/supabase-js";\nexport const c = createClient;`,
      ),
    ).toContain("no-restricted-imports");
  });
  it("services cannot import Supabase or UI", async () => {
    expect(
      await violations(
        "src/server/households/service.ts",
        `import { createClient } from "@supabase/supabase-js";\nexport const c = createClient;`,
      ),
    ).toContain("no-restricted-imports");
    expect(
      await violations(
        "src/server/households/service.ts",
        `import { Button } from "@/ui/button";\nexport const b = Button;`,
      ),
    ).toContain("no-restricted-imports");
  });
  it("repositories may import Supabase", async () => {
    expect(
      await violations(
        "src/server/households/repository.ts",
        `import type { SupabaseClient } from "@supabase/supabase-js";\nexport type T = SupabaseClient;`,
      ),
    ).not.toContain("no-restricted-imports");
  });
  it("process.env is only readable in the env modules", async () => {
    expect(
      await violations("src/server/households/service.ts", `export const k = process.env.SECRET;`),
    ).toContain("no-restricted-syntax");
    expect(
      await violations("src/server/env.ts", `export const k = process.env.SECRET;`),
    ).not.toContain("no-restricted-syntax");
  });
});

describe("server modules are marked server-only", () => {
  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      return e.isDirectory() ? walk(p) : [p];
    });

  it("every non-test file under src/server imports 'server-only'", () => {
    const dir = path.join(root, "src/server");
    if (!fs.existsSync(dir)) return;
    const missing = walk(dir)
      .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
      .filter((f) => !/^\s*import\s+["']server-only["'];?\s*$/m.test(fs.readFileSync(f, "utf8")))
      .map((f) => path.relative(root, f));
    expect(missing).toEqual([]);
  });
});
