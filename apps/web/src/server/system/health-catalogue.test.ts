import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { PROBE_ID, type RepositoryInventory } from "@cellr/domain";
import { AI_TASKS, EXPECTED_BUCKETS, EXPECTED_CRON_JOBS, PROBES } from "../health/catalogue";
import { ARCHITECTURE_REGISTRY as REG } from "./registry";

vi.mock("server-only", () => ({}));

/**
 * The health monitor's catalogue (server/health/catalogue.ts) against the architecture register and the repository
 * (System Intelligence sprint 2). A red test means the monitor would measure something that is not there, speak for
 * a component that does not exist, or leave a bucket, job or AI task unchecked.
 */
const committed = JSON.parse(
  readFileSync(path.join(import.meta.dirname, "inventory.generated.json"), "utf8"),
) as RepositoryInventory;
const SERVER = path.resolve(import.meta.dirname, "..");
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory()
      ? files(p)
      : /\.ts$/.test(f) && !/\.test\.ts$/.test(f)
        ? [p]
        : [];
  });

describe("the health catalogue", () => {
  it("has unique, well-formed probe ids", () => {
    const ids = PROBES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(PROBE_ID);
  });

  it("speaks only for components the register has, and every probe says what it does not prove", () => {
    const known = new Set(REG.components.map((c) => c.id));
    for (const p of PROBES) {
      expect(p.components.length, p.id).toBeGreaterThan(0);
      for (const c of p.components) expect(known.has(c), `${p.id} → ${c}`).toBe(true);
      expect(p.doesNotProve.length, p.id).toBeGreaterThan(20);
    }
  });

  it("checks exactly the buckets the migrations create", () => {
    expect([...EXPECTED_BUCKETS].sort()).toEqual(committed.buckets);
  });

  it("checks exactly the pg_cron jobs the migrations schedule", () => {
    expect(EXPECTED_CRON_JOBS.map((j) => j.name).sort()).toEqual(
      committed.cronJobs.map((j) => j.name),
    );
  });

  it("has a probe for every AI task the server records", () => {
    const recorded = new Set<string>();
    for (const f of files(SERVER))
      for (const m of readFileSync(f, "utf8").matchAll(/\btask: "([a-z_]+)"/g)) recorded.add(m[1]!);
    expect(AI_TASKS.map((t) => t.task).sort()).toEqual([...recorded].sort());
  });

  it("the monitor itself is in the register, owns its routes and is no longer planned", () => {
    const monitor = REG.components.find((c) => c.id === "health-monitor");
    expect(monitor?.status).toBe("implemented");
    expect(monitor?.routes).toEqual(["/api/cron/health", "/api/health", "/api/health/ready"]);
    expect(REG.components.some((c) => c.id === "plan-health-monitor")).toBe(false);
  });
});
