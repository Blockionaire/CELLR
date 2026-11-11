import { readFileSync } from "node:fs";
import type { Client } from "pg";
import { describe, expect, it } from "vitest";
import {
  assertSafeTarget,
  assertTargetIdentity,
  parseArgs,
  percentile,
  PRODUCTION_PROJECT_REFS,
  shuffled,
} from "./lib";
import { approvedTargets } from "./target";

const STAGING = "abcdefghijklmnopqrst";
const approved = { staging_project_refs: [STAGING] };
const PROD = PRODUCTION_PROJECT_REFS[0]!;

describe("where the catalog tools may connect", () => {
  it("local databases are allowed (the pilot workflow)", () => {
    expect(
      assertSafeTarget("postgresql://postgres@127.0.0.1:54997/postgres", {}, approved),
    ).toEqual({ local: true, ref: null });
    expect(assertSafeTarget("postgresql://u@localhost/db", {}, approved).local).toBe(true);
  });
  it("a remote database needs an approved staging project ref that the URL itself names", () => {
    expect(() => assertSafeTarget("postgresql://u@db.example.org/db", {}, approved)).toThrow(
      /local databases only/,
    );
    expect(
      assertSafeTarget(
        `postgresql://postgres@db.${STAGING}.supabase.co:5432/postgres`,
        { "staging-project": STAGING },
        approved,
      ),
    ).toEqual({ local: false, ref: STAGING });
    expect(
      assertSafeTarget(
        `postgresql://postgres.${STAGING}@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`,
        { "staging-project": STAGING },
        approved,
      ).ref,
    ).toBe(STAGING);
  });
  it("refuses a staging ref that is not approved, or a URL of another project", () => {
    expect(() =>
      assertSafeTarget(
        "postgresql://postgres@db.zzzzzzzzzzzzzzzzzzzz.supabase.co/postgres",
        { "staging-project": "zzzzzzzzzzzzzzzzzzzz" },
        approved,
      ),
    ).toThrow(/not an approved staging project/);
    expect(() =>
      assertSafeTarget(
        "postgresql://postgres@db.yyyyyyyyyyyyyyyyyyyy.supabase.co/postgres",
        { "staging-project": STAGING },
        approved,
      ),
    ).toThrow(/does not belong to project/);
    expect(() =>
      assertSafeTarget(
        "postgresql://postgres@staging.example.org/db",
        { "staging-project": STAGING },
        approved,
      ),
    ).toThrow(/does not belong to project/);
  });
  it("always refuses the production project, whatever the flags or the approved list say", () => {
    const evil = { staging_project_refs: [STAGING, PROD] };
    expect(() =>
      assertSafeTarget(
        `postgresql://postgres@db.${PROD}.supabase.co/postgres`,
        { "staging-project": PROD },
        evil,
      ),
    ).toThrow(/production/);
    expect(() =>
      assertSafeTarget(
        `postgresql://postgres.${PROD}@aws-0-eu-central-1.pooler.supabase.com/postgres`,
        { "staging-project": STAGING },
        evil,
      ),
    ).toThrow(/production/);
    expect(() =>
      assertSafeTarget(
        `postgresql://postgres@db.${PROD}.supabase.co/postgres`,
        { "allow-remote-staging": true },
        evil,
      ),
    ).toThrow(/production/);
  });
  it("the old --allow-remote-staging flag is refused", () => {
    expect(() =>
      assertSafeTarget(
        "postgresql://u@db.example.org/db",
        { "allow-remote-staging": true },
        approved,
      ),
    ).toThrow(/no longer accepted/);
  });
  it("the committed approved list never contains production", () => {
    for (const ref of approvedTargets().staging_project_refs)
      expect(PRODUCTION_PROJECT_REFS).not.toContain(ref);
  });
});

describe("what the target database says it is", () => {
  const says = (environment: string, project_ref: string | null = null) =>
    ({
      query: async () => ({ rows: [{ id: { environment, project_ref } }], rowCount: 1 }),
    }) as unknown as Client;
  it("refuses a database that says it is production (an unmarked one does)", async () => {
    await expect(
      assertTargetIdentity(says("production"), { local: true, ref: null }),
    ).rejects.toThrow(/production/);
    await expect(
      assertTargetIdentity(says("production", STAGING), { local: false, ref: STAGING }),
    ).rejects.toThrow(/production/);
  });
  it("accepts a local pilot database", async () => {
    await expect(assertTargetIdentity(says("pilot"), { local: true, ref: null })).resolves.toBe(
      "pilot",
    );
  });
  it("a remote database must say it is staging AND the approved project", async () => {
    await expect(
      assertTargetIdentity(says("staging", STAGING), { local: false, ref: STAGING }),
    ).resolves.toBe("staging");
    await expect(
      assertTargetIdentity(says("pilot", STAGING), { local: false, ref: STAGING }),
    ).rejects.toThrow(/not staging/);
    await expect(
      assertTargetIdentity(says("staging", "other0000000000000000"), {
        local: false,
        ref: STAGING,
      }),
    ).rejects.toThrow(/not staging project/);
  });
});

describe("imports never manage provider rights", () => {
  const source = readFileSync(new URL("./import.ts", import.meta.url), "utf8");
  it("the importer calls no provider registration or rights function and writes no provider row", () => {
    expect(source).not.toMatch(
      /catalog_provider_register|admin_catalog_provider_rights|catalog_provider_upsert/,
    );
    expect(source).not.toMatch(/(insert into|update)\s+public\.catalog_providers/i);
  });
  it("the importer does not accept a scope option", () => {
    expect(source).toMatch(/--search-scope is not an import option/);
  });
});

describe("helpers", () => {
  it("parse flags and values", () => {
    expect(parseArgs(["--db", "x", "--apply", "--limit", "5"])).toEqual({
      db: "x",
      apply: true,
      limit: "5",
    });
  });
  it("percentiles are nearest-rank", () => {
    const xs = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(xs, 50)).toBe(50);
    expect(percentile(xs, 95)).toBe(95);
    expect(percentile([7], 99)).toBe(7);
  });
  it("shuffle is deterministic per seed and keeps every item", () => {
    expect(shuffled([1, 2, 3, 4, 5], 1)).toEqual(shuffled([1, 2, 3, 4, 5], 1));
    expect([...shuffled([1, 2, 3, 4, 5], 2)].sort()).toEqual([1, 2, 3, 4, 5]);
  });
});
