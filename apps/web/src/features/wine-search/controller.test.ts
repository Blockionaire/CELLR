import { describe, expect, it } from "vitest";
import type { CatalogSearchHit, CatalogSearchResponse } from "@cellr/domain";
import { createSearchController, searchSessionEvent, type SearchFailure } from "./controller";

const hit = (name: string): CatalogSearchHit => ({
  kind: "wine",
  wineId: `id-${name}`,
  recordId: null,
  producer: "Domaine Test",
  name,
  matchedAlias: null,
  type: "red",
  countryCode: "FR",
  region: null,
  source: "catalog",
  verified: true,
  match: "prefix",
  bottles: 0,
  provider: null,
  vintages: null,
});

/** A server whose answers the test releases by hand, and a clock the test moves. */
function harness(over: { cooldownMs?: number; cacheSize?: number; cacheTtlMs?: number } = {}) {
  let time = 0;
  const timers: Array<{ at: number; fn: () => void; id: number }> = [];
  let nextId = 1;
  const calls: Array<{
    query: string;
    signal: AbortSignal;
    resolve: (r: CatalogSearchResponse) => void;
    reject: (e: unknown) => void;
  }> = [];
  const controller = createSearchController({
    search: (query, signal) =>
      new Promise<CatalogSearchResponse>((resolve, reject) => {
        calls.push({ query, signal, resolve, reject });
      }),
    classify: (e) => (e as { why?: SearchFailure }).why ?? "other",
    debounceMs: 250,
    now: () => time,
    setTimer: (fn, ms) => {
      const id = nextId++;
      timers.push({ at: time + ms, fn, id });
      return id;
    },
    clearTimer: (h) => {
      const i = timers.findIndex((t) => t.id === h);
      if (i >= 0) timers.splice(i, 1);
    },
    ...over,
  });
  const advance = (ms: number) => {
    time += ms;
    for (const t of timers.filter((x) => x.at <= time)) {
      timers.splice(timers.indexOf(t), 1);
      t.fn();
    }
  };
  const settle = () => new Promise((r) => setImmediate(r));
  const ok = (names: string[], query: string): CatalogSearchResponse => ({
    query,
    results: names.map(hit),
    available: true,
  });
  return { controller, calls, advance, settle, ok };
}

describe("wine search as you type", () => {
  it("sends nothing for a query too short to be a search", () => {
    const { controller, calls, advance } = harness();
    for (const text of ["", " ", "a", " é ", "-"]) {
      controller.setInput(text);
      advance(1000);
    }
    expect(calls).toHaveLength(0);
    expect(controller.getState()).toMatchObject({ status: "idle", results: [], input: "-" });
  });

  it("waits for a pause in typing: one request for a word typed letter by letter", async () => {
    const { controller, calls, advance, settle, ok } = harness();
    for (const text of ["ma", "mar", "marg", "marga", "margau", "margaux"]) {
      controller.setInput(text);
      advance(100);
    }
    expect(calls).toHaveLength(0);
    expect(controller.getState().status).toBe("loading");
    advance(250);
    expect(calls.map((c) => c.query)).toEqual(["margaux"]);
    calls[0]!.resolve(ok(["Margaux"], "margaux"));
    await settle();
    expect(controller.getState()).toMatchObject({ status: "ready", query: "margaux" });
    expect(controller.getState().results.map((r) => r.name)).toEqual(["Margaux"]);
  });

  it("an older answer that arrives after a newer query never replaces the newer results", async () => {
    const { controller, calls, advance, settle, ok } = harness();
    controller.setInput("marg");
    advance(250);
    controller.setInput("margaux");
    advance(250);
    expect(calls.map((c) => c.query)).toEqual(["marg", "margaux"]);
    expect(calls[0]!.signal.aborted).toBe(true); // the older request was cancelled
    calls[1]!.resolve(ok(["Château Margaux"], "margaux"));
    await settle();
    calls[0]!.resolve(ok(["Marguerite", "Margot"], "marg")); // the slow, older answer
    await settle();
    expect(controller.getState().query).toBe("margaux");
    expect(controller.getState().results.map((r) => r.name)).toEqual(["Château Margaux"]);
  });

  it("an older answer arriving before the newer one is not shown either", async () => {
    const { controller, calls, advance, settle, ok } = harness();
    controller.setInput("marg");
    advance(250);
    controller.setInput("margaux");
    calls[0]!.resolve(ok(["Marguerite"], "marg")); // arrives while the person is typing on
    await settle();
    expect(controller.getState()).toMatchObject({ status: "loading", input: "margaux" });
    expect(controller.getState().results).toEqual([]);
  });

  it("what was typed is never changed by an answer, an error or a limit", async () => {
    const { controller, calls, advance, settle } = harness();
    controller.setInput("  Château  MARGAUX ");
    advance(250);
    calls[0]!.reject({ why: "other" });
    await settle();
    expect(controller.getState()).toMatchObject({ input: "  Château  MARGAUX ", status: "error" });
  });

  it("a query answered before is answered from memory, also after backspacing", async () => {
    const { controller, calls, advance, settle, ok } = harness();
    controller.setInput("marg");
    advance(250);
    calls[0]!.resolve(ok(["Margot"], "marg"));
    await settle();
    controller.setInput("marga");
    advance(250);
    calls[1]!.resolve(ok(["Margaux"], "marga"));
    await settle();
    controller.setInput("marg"); // backspace
    expect(controller.getState()).toMatchObject({ status: "ready", query: "marg" });
    expect(controller.getState().results.map((r) => r.name)).toEqual(["Margot"]);
    advance(1000);
    expect(calls).toHaveLength(2);
    // the same search in other capitals and spacing asks nothing either
    controller.setInput(" MARG ");
    advance(1000);
    expect(calls).toHaveLength(2);
  });

  it("an answer is not reused for ever: after a minute the same search asks the server again", async () => {
    const { controller, calls, advance, settle, ok } = harness({ cacheTtlMs: 60_000 });
    controller.setInput("fixture");
    advance(250);
    calls[0]!.resolve(ok(["Record of a source"], "fixture"));
    await settle();
    controller.setInput("fixtur");
    advance(250);
    calls[1]!.resolve(ok([], "fixtur"));
    await settle();
    advance(61_000); // meanwhile the source was switched off
    controller.setInput("fixture");
    expect(controller.getState().status).toBe("loading");
    advance(250);
    expect(calls.map((c) => c.query)).toEqual(["fixture", "fixtur", "fixture"]);
    calls[2]!.resolve(ok([], "fixture"));
    await settle();
    expect(controller.getState().results).toEqual([]);
  });

  it("memory is bounded", async () => {
    const { controller, calls, advance, settle, ok } = harness({ cacheSize: 2 });
    for (const q of ["aa", "bb", "cc"]) {
      controller.setInput(q);
      advance(250);
      calls.at(-1)!.resolve(ok([q], q));
      await settle();
    }
    controller.setInput("aa"); // the oldest was forgotten: asked again
    advance(250);
    expect(calls.map((c) => c.query)).toEqual(["aa", "bb", "cc", "aa"]);
  });

  it("'too many searches' stops asking until the cool-down has passed, without retrying", async () => {
    const { controller, calls, advance, settle, ok } = harness({ cooldownMs: 30_000 });
    controller.setInput("margaux");
    advance(250);
    calls[0]!.reject({ why: "rate_limited" });
    await settle();
    expect(controller.getState()).toMatchObject({ status: "limited", results: [] });
    for (const text of ["margaux 2", "margaux 20", "latour"]) {
      controller.setInput(text);
      advance(1000);
    }
    controller.retry();
    expect(calls).toHaveLength(1);
    expect(controller.getState()).toMatchObject({ status: "limited", input: "latour" });
    advance(26_000); // still inside the cool-down: nothing is asked
    expect(calls).toHaveLength(1);
    // the cool-down ends: the search asks ONCE, by itself, for what is typed by then
    advance(2_000);
    expect(calls.map((c) => c.query)).toEqual(["margaux", "latour"]);
    expect(controller.getState().status).toBe("loading");
    calls[1]!.resolve(ok(["Latour"], "latour"));
    await settle();
    expect(controller.getState()).toMatchObject({ status: "ready", query: "latour" });
  });

  it("limited again right after the cool-down: one request per cool-down, never a storm", async () => {
    const { controller, calls, advance, settle } = harness({ cooldownMs: 30_000 });
    controller.setInput("margaux");
    advance(250);
    calls[0]!.reject({ why: "rate_limited" });
    await settle();
    for (let round = 1; round <= 3; round++) {
      advance(30_000);
      expect(calls).toHaveLength(round + 1);
      calls[round]!.reject({ why: "rate_limited" });
      await settle();
      expect(controller.getState().status).toBe("limited");
    }
    expect(calls).toHaveLength(4); // 1 + one per cool-down, over a minute and a half
  });

  it("the field was emptied during the cool-down: nothing is asked when it ends, and leaving cancels it", async () => {
    const { controller, calls, advance, settle } = harness({ cooldownMs: 30_000 });
    controller.setInput("margaux");
    advance(250);
    calls[0]!.reject({ why: "rate_limited" });
    await settle();
    controller.setInput("");
    expect(controller.getState().status).toBe("idle");
    advance(60_000);
    expect(calls).toHaveLength(1);

    controller.setInput("latour"); // typed inside a fresh cool-down?  no: the cool-down has passed, so it asks
    advance(250);
    expect(calls).toHaveLength(2);
    calls[1]!.reject({ why: "rate_limited" });
    await settle();
    controller.cancel(); // the screen is left
    advance(60_000);
    expect(calls).toHaveLength(2);
  });

  it("a deployment without the search endpoint is asked once, then never again", async () => {
    const { controller, calls, advance, settle } = harness();
    controller.setInput("margaux");
    advance(250);
    calls[0]!.resolve({ query: "margaux", results: [], available: false });
    await settle();
    expect(controller.getState().status).toBe("unavailable");
    controller.setInput("latour");
    advance(1000);
    controller.retry();
    expect(calls).toHaveLength(1);
    expect(controller.getState()).toMatchObject({ status: "unavailable", input: "latour" });
  });

  it("offline: the typed text stays, and trying again asks once", async () => {
    const { controller, calls, advance, settle, ok } = harness();
    controller.setInput("margaux");
    advance(250);
    calls[0]!.reject({ why: "network" });
    await settle();
    expect(controller.getState()).toMatchObject({ status: "offline", input: "margaux" });
    advance(60_000);
    expect(calls).toHaveLength(1); // no retry on its own
    controller.retry();
    expect(calls).toHaveLength(2);
    calls[1]!.resolve(ok(["Margaux"], "margaux"));
    await settle();
    expect(controller.getState().status).toBe("ready");
  });

  it("clearing the field cancels what was pending and shows nothing", async () => {
    const { controller, calls, advance, settle, ok } = harness();
    controller.setInput("margaux");
    advance(250);
    controller.setInput("");
    expect(calls[0]!.signal.aborted).toBe(true);
    calls[0]!.resolve(ok(["Margaux"], "margaux"));
    await settle();
    expect(controller.getState()).toMatchObject({ status: "idle", results: [], query: null });
  });

  it("after the screen is left, nothing is sent and no late answer is applied", async () => {
    const { controller, calls, advance, settle, ok } = harness();
    let notified = 0;
    controller.subscribe(() => notified++);
    controller.setInput("margaux");
    advance(250);
    controller.dispose();
    const before = notified;
    expect(calls[0]!.signal.aborted).toBe(true);
    calls[0]!.resolve(ok(["Margaux"], "margaux"));
    await settle();
    controller.setInput("latour");
    advance(1000);
    controller.retry();
    expect(calls).toHaveLength(1);
    expect(notified).toBe(before);
    expect(controller.getState().results).toEqual([]);
  });

  it("leaving and coming back (a remount) cancels what was pending and keeps working", async () => {
    const { controller, calls, advance, settle, ok } = harness();
    controller.setInput("margaux");
    advance(250);
    controller.cancel(); // the screen unmounts
    expect(calls[0]!.signal.aborted).toBe(true);
    calls[0]!.resolve(ok(["Stale"], "margaux"));
    await settle();
    expect(controller.getState().results).toEqual([]);
    controller.setInput("margaux"); // mounted again with the same text
    advance(250);
    calls[1]!.resolve(ok(["Château Margaux"], "margaux"));
    await settle();
    expect(controller.getState().results.map((r) => r.name)).toEqual(["Château Margaux"]);
  });

  it("an aborted request is not an error", async () => {
    const { controller, calls, advance, settle } = harness();
    controller.setInput("margaux");
    advance(250);
    controller.setInput("margaux grand");
    calls[0]!.reject({ why: "aborted" });
    await settle();
    expect(controller.getState().status).toBe("loading");
  });

  it("never shows more rows than the server's own bound, whatever arrives", async () => {
    const { controller, calls, advance, settle, ok } = harness();
    controller.setInput("chateau");
    advance(250);
    calls[0]!.resolve(
      ok(
        Array.from({ length: 60 }, (_, i) => `W${i}`),
        "chateau",
      ),
    );
    await settle();
    expect(controller.getState().results).toHaveLength(20);
  });

  it("fast typing, remounting and backspacing stay within a handful of requests", async () => {
    const { controller, calls, advance, settle, ok } = harness();
    const typed = "chateau leoville poyferre";
    for (let i = 1; i <= typed.length; i++) {
      controller.setInput(typed.slice(0, i));
      advance(60); // faster than the debounce
    }
    advance(250);
    calls.at(-1)!.resolve(ok(["Léoville Poyferré"], typed));
    await settle();
    for (let i = typed.length - 1; i > typed.length - 6; i--) {
      controller.setInput(typed.slice(0, i));
      advance(60);
    }
    advance(250);
    expect(controller.requestCount()).toBeLessThanOrEqual(2);
  });
});

describe("the one anonymous event of a used search field", () => {
  it("counts what happened, in buckets, and holds nothing that was typed or found", async () => {
    const { controller, calls, advance, settle, ok } = harness();
    controller.setInput("Château Très Secret 1982");
    advance(250);
    advance(400); // the answer took 400 ms
    calls[0]!.resolve(ok([], "chateau tres secret 1982"));
    await settle();
    controller.setInput("margaux");
    advance(250);
    calls[1]!.resolve(ok(["Margaux"], "margaux"));
    await settle();
    const stats = controller.stats();
    expect(stats).toEqual({
      requests: 2,
      zeroResults: true,
      limited: false,
      failed: false,
      slowestMs: 400,
    });
    const event = searchSessionEvent(stats, {
      surface: "koopcheck",
      outcome: "selected",
      source: "catalog",
      rank: 2,
    });
    expect(event).toEqual({
      surface: "koopcheck",
      outcome: "selected",
      requests: 2,
      zero_results: true,
      limited: false,
      failed: false,
      slowest: "under_700ms",
      source: "catalog",
      rank: "2_3",
    });
    // nothing typed, no name, no id: only fixed words, numbers and flags
    expect(JSON.stringify(event)).not.toMatch(/secret|margaux|chateau|1982|id-/i);
    expect(Object.keys(event).length).toBeLessThanOrEqual(10);
  });

  it("a field left without a choice says so, without a source or a rank; limits and failures are flags", async () => {
    const { controller, calls, advance, settle } = harness();
    controller.setInput("margaux");
    advance(250);
    calls[0]!.reject({ why: "rate_limited" });
    await settle();
    const event = searchSessionEvent(controller.stats(), { surface: "add", outcome: "left" });
    expect(event).toMatchObject({ outcome: "left", limited: true, failed: false, requests: 1 });
    expect(event).not.toHaveProperty("source");
    expect(event).not.toHaveProperty("rank");
  });

  it("buckets: the rank and the slowest answer are never exact numbers", () => {
    const base = { requests: 999, zeroResults: false, limited: false, failed: true };
    const at = (rank: number, slowestMs: number) =>
      searchSessionEvent(
        { ...base, slowestMs },
        { surface: "scan", outcome: "selected", source: "owned", rank },
      );
    expect(at(1, 10)).toMatchObject({ rank: "1", slowest: "under_250ms", requests: 50 });
    expect(at(3, 699)).toMatchObject({ rank: "2_3", slowest: "under_700ms" });
    expect(at(8, 1499)).toMatchObject({ rank: "4_8", slowest: "under_1500ms" });
    expect(at(20, 9000)).toMatchObject({ rank: "9_plus", slowest: "over_1500ms" });
    expect(at(0, 0)).toMatchObject({ rank: "none" });
  });
});
