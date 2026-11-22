import { describe, expect, it } from "vitest";
import type { Client } from "pg";
import {
  assertClientLimit,
  closeAll,
  openClients,
  poolerOf,
  transactionPoolerUrl,
  transactionPreamble,
} from "./pool";

const ref = "konxmgdjdewpknfqvsuq";
const session = `postgresql://postgres.${ref}:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`;

/** A stand-in client that records whether it was closed. */
function fake(log: string[], name: string, endFails = false): Client {
  return {
    end: async () => {
      log.push(`end ${name}`);
      if (endFails) throw new Error("already gone");
    },
  } as unknown as Client;
}

describe("the load test's connections (staging run 45039275216: EMAXCONNSESSION at 16 clients)", () => {
  it("a failure while opening closes every client opened so far, and says how many", async () => {
    const log: string[] = [];
    let n = 0;
    const open = async () => {
      n += 1;
      if (n === 16) throw new Error("EMAXCONNSESSION: max clients reached in session mode");
      return fake(log, `c${n}`);
    };
    await expect(openClients(16, open)).rejects.toThrow(
      /could not open client 16 of 16: EMAXCONNSESSION.*\(all 15 closed\)/,
    );
    expect(log).toHaveLength(15);
    expect(new Set(log).size).toBe(15);
  });

  it("all clients open: they are returned, and closeAll closes them even if one is already gone", async () => {
    const log: string[] = [];
    let n = 0;
    const clients = await openClients(3, async () => fake(log, `c${++n}`, n === 2));
    expect(clients).toHaveLength(3);
    await expect(closeAll(clients)).resolves.toBeUndefined();
    expect(log).toEqual(["end c1", "end c2", "end c3"]);
  });

  it("clients are opened one at a time (never more half-open than one)", async () => {
    let open = 0;
    let most = 0;
    await openClients(5, async () => {
      open += 1;
      most = Math.max(most, open);
      await new Promise((r) => setTimeout(r, 1));
      open -= 1;
      return fake([], "c");
    });
    expect(most).toBe(1);
  });
});

describe("a configuration the target cannot serve is refused before anything is opened", () => {
  it("a session pooler needs its limit, and more clients than that are refused, never reduced", () => {
    expect(() => assertClientLimit(8, null, "session")).toThrow(/pass --max-clients/);
    expect(() => assertClientLimit(16, 15, "session")).toThrow(
      /concurrency 16 needs 16 clients, but the target allows 15 \(session pooler\): use --pooler transaction/,
    );
    expect(() => assertClientLimit(15, 15, "session")).not.toThrow();
    expect(() => assertClientLimit(8, 15, "session")).not.toThrow();
  });
  it("a local database or a transaction pooler has no session-slot limit; nonsense is refused", () => {
    expect(() => assertClientLimit(16, null, null)).not.toThrow();
    expect(() => assertClientLimit(16, null, "transaction")).not.toThrow();
    expect(() => assertClientLimit(0, null, null)).toThrow(/at least 1/);
    expect(() => assertClientLimit(2.5, null, null)).toThrow(/whole number/);
    expect(() => assertClientLimit(4, 0, null)).toThrow(/--max-clients/);
  });
});

describe("the transaction-pooler route", () => {
  it("is the same Supabase pooler on port 6543, and only for a Supabase pooler", () => {
    expect(poolerOf(session)).toBe("session");
    const tx = transactionPoolerUrl(session);
    expect(new URL(tx).port).toBe("6543");
    expect(new URL(tx).hostname).toBe(new URL(session).hostname);
    expect(new URL(tx).username).toBe(`postgres.${ref}`);
    expect(poolerOf(tx)).toBe("transaction");
    expect(poolerOf("postgresql://postgres@127.0.0.1:54997/postgres")).toBeNull();
    expect(() => transactionPoolerUrl("postgresql://postgres@127.0.0.1:5432/postgres")).toThrow(
      /Supabase pooler URL/,
    );
  });
  it("sets the role per transaction only; a person's claims only for a real uuid", () => {
    expect(transactionPreamble("pilot", "ignored")).toBe("begin; set local role service_role");
    const p = transactionPreamble("public", "bbbbbbbb-0000-0000-0000-000000000001");
    expect(p).toMatch(
      /^begin; set local role authenticated; select set_config\('request\.jwt\.claims'/,
    );
    expect(p).toMatch(
      /, true\), set_config\('request\.jwt\.claim\.sub', 'bbbbbbbb-0000-0000-0000-000000000001', true\)$/,
    );
    expect(() => transactionPreamble("public", "x'; drop table wines; --")).toThrow(/uuid/);
  });
});
