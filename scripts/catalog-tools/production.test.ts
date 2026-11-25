import { describe, expect, it } from "vitest";
import { PRODUCTION_PROJECT_REFS } from "./lib";
import { connectToProduction, productionProblems, PRODUCTION_ENVIRONMENT } from "./production";

const PROD = PRODUCTION_PROJECT_REFS[0]!;
const URL_OK = `postgresql://postgres.${PROD}:x@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`;
const RUN = {
  ci: true,
  event: "workflow_dispatch",
  ref: "refs/heads/main",
  environment: PRODUCTION_ENVIRONMENT,
};
const ARGS = { production: PROD, confirm: PROD };

describe("the production route", () => {
  it("goes only with everything in place", () => {
    expect(productionProblems(URL_OK, ARGS, RUN)).toEqual([]);
    expect(
      productionProblems(`postgresql://postgres:x@db.${PROD}.supabase.co:5432/postgres`, ARGS, RUN),
    ).toEqual([]);
  });
  it.each([
    [
      "another project named",
      { ...ARGS, production: "konxmgdjdewpknfqvsuq", confirm: "konxmgdjdewpknfqvsuq" },
      RUN,
      URL_OK,
    ],
    ["no confirmation", { production: PROD }, RUN, URL_OK],
    ["a wrong confirmation", { ...ARGS, confirm: "x" }, RUN, URL_OK],
    ["a pilot run", { ...ARGS, pilot: true as const }, RUN, URL_OK],
    [
      "staging and production together",
      { ...ARGS, "staging-project": "konxmgdjdewpknfqvsuq" },
      RUN,
      URL_OK,
    ],
    ["a laptop", ARGS, { ...RUN, ci: false }, URL_OK],
    ["a push", ARGS, { ...RUN, event: "push" }, URL_OK],
    ["another branch", ARGS, { ...RUN, ref: "refs/heads/feature" }, URL_OK],
    ["the staging environment", ARGS, { ...RUN, environment: "cellr-staging" }, URL_OK],
    ["no environment", ARGS, { ...RUN, environment: undefined }, URL_OK],
    [
      "a URL of another project",
      ARGS,
      RUN,
      "postgresql://postgres.konxmgdjdewpknfqvsuq:x@aws-0-eu-central-1.pooler.supabase.com:5432/postgres",
    ],
    ["a local database", ARGS, RUN, "postgresql://postgres@127.0.0.1:5432/postgres"],
    ["a URL that only mentions the ref", ARGS, RUN, `postgresql://u:x@evil.example/${PROD}`],
    ["a host override in the query", ARGS, RUN, `${URL_OK}?host=evil.example`],
    ["a user override in the query", ARGS, RUN, `${URL_OK}?user=postgres`],
    ["the transaction pooler", ARGS, RUN, URL_OK.replace(":5432", ":6543")],
  ])("refuses %s", (_, args, run, url) => {
    expect(productionProblems(url, args as never, run).length).toBeGreaterThan(0);
  });
  it("refuses before connecting", async () => {
    await expect(connectToProduction(URL_OK, ARGS, { ...RUN, ci: false })).rejects.toThrow(
      /refusing production/,
    );
  });
});

describe("the URL from the environment", () => {
  it("resolves env:NAME and leaves anything else as given", async () => {
    const { resolveDbUrl } = await import("./production");
    process.env.CELLR_TEST_DB = "postgresql://x@127.0.0.1/db";
    expect(resolveDbUrl("env:CELLR_TEST_DB")).toBe("postgresql://x@127.0.0.1/db");
    expect(resolveDbUrl("env:CELLR_NOT_SET")).toBe("");
    expect(resolveDbUrl("postgresql://y@127.0.0.1/db")).toBe("postgresql://y@127.0.0.1/db");
  });
});

describe("the backup statement", () => {
  it("must be today or yesterday", async () => {
    const { backupProblem } = await import("./production-preflight");
    const today = new Date("2026-12-02T15:00:00Z");
    expect(backupProblem("2026-12-02", today)).toBeNull();
    expect(backupProblem("2026-12-01", today)).toBeNull();
    expect(backupProblem("2026-11-30", today)).not.toBeNull();
    expect(backupProblem("2026-12-03", today)).not.toBeNull();
    expect(backupProblem("yesterday", today)).not.toBeNull();
  });
});
