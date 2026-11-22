import { describe, expect, it } from "vitest";
import { runProblems } from "./staging-guard";

const ok = {
  ci: true,
  event: "workflow_dispatch",
  ref: "refs/heads/main",
  environment: "cellr-staging",
};

describe("the staging guard: who started the run, from which code, where", () => {
  it("a manual run of main in the approved environment, with the right ref typed, may go", () => {
    expect(runProblems(ok, "abcdefghijklmnopqrst", "abcdefghijklmnopqrst")).toEqual([]);
  });

  it("a mistyped ref stops the run, also outside CI", () => {
    expect(runProblems({ ci: false }, "abcdefghijklmnopqrst", "abcdefghijklmnopqrsx")).toHaveLength(
      1,
    );
  });

  it("a push, a schedule, a branch other than main or a run outside the environment stops it", () => {
    const ref = "abcdefghijklmnopqrst";
    expect(runProblems({ ...ok, event: "push" }, ref, ref).join()).toMatch(/not by hand/);
    expect(runProblems({ ...ok, event: "schedule" }, ref, ref).join()).toMatch(/not by hand/);
    expect(runProblems({ ...ok, ref: "refs/heads/feature" }, ref, ref).join()).toMatch(
      /reviewed main/,
    );
    expect(runProblems({ ...ok, environment: undefined }, ref, ref).join()).toMatch(/approval/);
  });
});
