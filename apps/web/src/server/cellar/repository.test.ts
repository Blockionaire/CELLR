import { describe, expect, it } from "vitest";
import { isMissingTable } from "./repository";

describe("a database that has not had the tastings step yet", () => {
  it("is recognised from what PostgREST and Postgres say", () => {
    expect(isMissingTable({ code: "PGRST205" })).toBe(true); // "Could not find the table … in the schema cache"
    expect(isMissingTable({ code: "42P01" })).toBe(true); // "relation … does not exist"
    expect(isMissingTable({ code: "PGRST200" })).toBe(true); // no relationship to it, when joined from another query
  });
  it("is not confused with other trouble", () => {
    for (const code of ["42501", "23505", "PGRST116", "PGRST301", "", undefined])
      expect(isMissingTable({ code })).toBe(false);
  });
});

describe("a back label before the attach-if-empty step has been run", () => {
  it("is never put on unconditionally: the missing function is an error, and no bottle is written", async () => {
    const { createCellarRepository } = await import("./repository");
    for (const code of ["PGRST202", "42883"]) {
      const writes: string[] = [];
      const db = {
        rpc: async () => ({ data: null, error: { code, message: "function not found" } }),
        from: (table: string) => {
          writes.push(table);
          throw new Error(`must not touch ${table}`);
        },
      };
      const repo = createCellarRepository(
        db as unknown as Parameters<typeof createCellarRepository>[0],
      );
      await expect(repo.attachBackIfEmpty("h1", "v1", "img1")).rejects.toBeTruthy();
      expect(writes).toEqual([]);
    }
  });
});

describe("a swap before the swap step has been run", () => {
  it("is never done as two moves: the missing function is an error, and no bottle is written", async () => {
    const { createCellarRepository } = await import("./repository");
    const spot = { locationId: "u1", row: 1, col: 1 };
    for (const code of ["PGRST202", "42883"]) {
      const writes: string[] = [];
      const db = {
        rpc: async () => ({ data: null, error: { code, message: "function not found" } }),
        from: (table: string) => {
          writes.push(table);
          throw new Error(`must not touch ${table}`);
        },
      };
      const repo = createCellarRepository(
        db as unknown as Parameters<typeof createCellarRepository>[0],
      );
      await expect(
        repo.swapBottles("h1", { bottleId: "a", ...spot }, { bottleId: "b", ...spot, col: 2 }),
      ).rejects.toBeTruthy();
      expect(writes).toEqual([]);
    }
  });
});

describe("the old API's edit of a place, next to Smart Cellar templates (sprint 1C)", () => {
  type Answer = { data: unknown; error: { code: string; message?: string } | null };
  /** A PostgREST client that answers from a script and writes down every statement it was asked for. */
  function fakeDb(script: { shape?: Answer; update?: Answer; exists?: Answer }) {
    const statements: Array<{ op: string; columns?: string; values?: unknown; filters: string[] }> =
      [];
    const statement = (op: string, extra: { columns?: string; values?: unknown }) => {
      const s = { op, ...extra, filters: [] as string[] };
      statements.push(s);
      const chain = {
        eq: (c: string, v: unknown) => (s.filters.push(`${c}=${String(v)}`), chain),
        is: (c: string, v: unknown) => (s.filters.push(`${c} is ${String(v)}`), chain),
        select: (columns: string) => ((s.columns = columns), chain),
        not: () => chain,
        order: () => chain,
        // the bottles per place that follow a successful update: none here
        range: async () => ({ data: [], error: null }),
        maybeSingle: async (): Promise<Answer> => {
          if (s.op === "update") return script.update ?? { data: null, error: null };
          if (s.columns?.startsWith("template")) return script.shape ?? { data: null, error: null };
          return script.exists ?? { data: null, error: null };
        },
      };
      return chain;
    };
    const db = {
      from: () => ({
        select: (columns: string) => statement("select", { columns }),
        update: (values: unknown) => statement("update", { values }),
      }),
      // the count of bottles after a successful update
      rpc: async () => ({ data: null, error: null }),
    };
    return { db, statements };
  }
  const updated = {
    data: { id: "p", label: "Rack", kind: "rack", grid_rows: 6, grid_cols: 8 },
    error: null,
  };
  const repoOn = async (db: unknown) => {
    const { createCellarRepository } = await import("./repository");
    return createCellarRepository(db as Parameters<typeof createCellarRepository>[0]);
  };
  const attempt = async (
    db: unknown,
    patch: Parameters<Awaited<ReturnType<typeof repoOn>>["updateStorage"]>[2],
  ) => {
    const repo = await repoOn(db);
    try {
      return { result: await repo.updateStorage("h", "p", patch) };
    } catch (error) {
      return { error: error as { code: string; message: string; retryable: boolean } };
    }
  };

  it("a rename asks nothing about templates", async () => {
    const { db, statements } = fakeDb({ update: { data: null, error: null } });
    expect((await attempt(db, { label: "New name" })).result).toBeNull();
    expect(statements.map((s) => s.op)).toEqual(["update"]);
    expect(statements[0]!.filters).not.toContain("template is null");
  });

  it("a database without the Smart Cellar step: edited exactly as before (no template filter)", async () => {
    const { db, statements } = fakeDb({
      shape: { data: null, error: { code: "42703", message: "column template does not exist" } },
      update: { data: null, error: null },
    });
    await attempt(db, { rows: 6 });
    const write = statements.find((s) => s.op === "update")!;
    expect(write.filters).toEqual(["household_id=h", "id=p"]);
  });

  it("a permission error is not taken for a missing column: the edit stops there", async () => {
    const { db, statements } = fakeDb({
      shape: { data: null, error: { code: "42501", message: "permission denied" } },
    });
    expect((await attempt(db, { rows: 6 })).error?.code).toBe("FORBIDDEN");
    expect(statements.some((s) => s.op === "update")).toBe(false);
  });

  it("a place without a template: edited as before, only while it still has none", async () => {
    const { db, statements } = fakeDb({
      shape: {
        data: { template: null, kind: "rack", grid_rows: 5, grid_cols: 8, cell_capacity: 1 },
        error: null,
      },
      update: { data: null, error: null },
      exists: { data: null, error: null },
    });
    await attempt(db, { kind: "fridge", rows: 30 });
    const write = statements.find((s) => s.op === "update")!;
    expect(write.values).toEqual({ kind: "fridge", grid_rows: 30 });
    expect(write.filters).toContain("template is null");
  });

  it("a place with a template: its kind is not changed, its size stays inside the template", async () => {
    const cooler = {
      data: {
        template: "cooler_dual",
        kind: "fridge",
        grid_rows: 8,
        grid_cols: 4,
        cell_capacity: 1,
      },
      error: null,
    };
    for (const [patch, code] of [
      [{ kind: "rack" }, "CONFLICT"],
      [{ rows: 30 }, "VALIDATION"],
    ] as const) {
      const { db, statements } = fakeDb({ shape: cooler });
      expect((await attempt(db, patch)).error?.code, JSON.stringify(patch)).toBe(code);
      expect(statements.some((s) => s.op === "update")).toBe(false);
    }
    // a size it allows goes through, tied to the template it was checked against
    const { db, statements } = fakeDb({ shape: cooler, update: { data: null, error: null } });
    await attempt(db, { rows: 10 });
    expect(statements.find((s) => s.op === "update")!.filters).toContain("template=cooler_dual");
  });

  it("a template this server does not know: only a rename", async () => {
    const { db, statements } = fakeDb({
      shape: {
        data: {
          template: "hex_rack_2031",
          kind: "rack",
          grid_rows: 3,
          grid_cols: 4,
          cell_capacity: 1,
        },
        error: null,
      },
    });
    expect((await attempt(db, { cols: 5 })).error?.code).toBe("CONFLICT");
    expect(statements.some((s) => s.op === "update")).toBe(false);
  });

  it("the template changed after the check: refused as a conflict to retry, nothing written", async () => {
    const { db } = fakeDb({
      shape: {
        data: { template: null, kind: "rack", grid_rows: 5, grid_cols: 8, cell_capacity: 1 },
        error: null,
      },
      update: { data: null, error: null }, // the filter `template is null` matched nothing
      exists: { data: { id: "p" }, error: null }, // but the place is there
    });
    const { error } = await attempt(db, { rows: 6 });
    expect(error?.code).toBe("CONFLICT");
    expect(error?.retryable).toBe(true);
    // and a place that is simply gone is "not found", as before
    const gone = fakeDb({
      shape: { data: null, error: null },
    });
    expect((await attempt(gone.db, { rows: 6 })).result).toBeNull();
  });

  it("the successful edit of a place without a template answers as it always did", async () => {
    const { db } = fakeDb({
      shape: {
        data: { template: null, kind: "rack", grid_rows: 5, grid_cols: 8, cell_capacity: 1 },
        error: null,
      },
      update: updated,
    });
    expect((await attempt(db, { rows: 6 })).result).toEqual({
      id: "p",
      label: "Rack",
      kind: "rack",
      rows: 6,
      cols: 8,
      used: 0,
    });
  });
});
