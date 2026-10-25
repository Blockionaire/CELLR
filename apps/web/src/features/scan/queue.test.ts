import { describe, expect, it, vi } from "vitest";
import type { LabelFacts, ScanResult } from "@cellr/domain";
import {
  AT_ONCE,
  BATCH_LIMIT,
  bucketOf,
  canReadAgain,
  sameWineAs,
  ScanQueue,
  summarize,
  type QueueDeps,
} from "./queue";

const facts = (over: Partial<LabelFacts> = {}): LabelFacts => ({
  producer: "Château Margaux",
  name: "Pavillon Rouge",
  year: 2015,
  nonVintage: false,
  type: "red",
  countryCode: "FR",
  region: null,
  appellation: null,
  grapes: [],
  abv: null,
  volumeMl: null,
  confidence: { producer: "high", name: "high", year: "high" },
  ...over,
});
let images = 0;
const result = (over: Partial<ScanResult> = {}): ScanResult => {
  images += 1;
  return {
    image: { id: `img-${images}`, blurColor: null, width: 600, height: 800 },
    outcome: "new",
    facts: facts(),
    matches: [],
    reason: null,
    labelCorners: null,
    ...over,
  };
};
const unread = (reason: ScanResult["reason"]) => result({ outcome: "unread", facts: null, reason });

/** A reading the test answers by hand, in any order. */
function deferred() {
  const pending: Array<{
    file: File;
    resolve: (r: ScanResult) => void;
    reject: (e: unknown) => void;
  }> = [];
  const read = vi.fn(
    (file: File) =>
      new Promise<ScanResult>((resolve, reject) => pending.push({ file, resolve, reject })),
  );
  return { read, pending };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

let files = 0;
const photo = (bytes = `photo-${++files}`) => new File([bytes], `${bytes}.jpg`);

function queue(over: Partial<QueueDeps> = {}) {
  const d = deferred();
  const revoke = vi.fn();
  let previews = 0;
  let ids = 0;
  const q = new ScanQueue({
    read: d.read,
    describe: () => "No connection",
    preview: () => `blob:${++previews}`,
    revoke,
    fingerprint: async (f) => f.text(),
    id: () => `item-${++ids}`,
    ...over,
  });
  return { q, ...d, revoke };
}

describe("the batch queue", () => {
  it("reads at most two at a time; the rest wait, and each photo is read exactly once", async () => {
    const { q, read, pending } = queue();
    await q.add([photo(), photo(), photo()]);
    expect(read).toHaveBeenCalledTimes(AT_ONCE);
    expect(q.items.map((i) => i.status)).toEqual(["reading", "reading", "waiting"]);
    pending[0]!.resolve(result());
    await flush();
    expect(read).toHaveBeenCalledTimes(3);
    pending[1]!.resolve(result());
    pending[2]!.resolve(result());
    await flush();
    expect(q.items.map((i) => i.status)).toEqual(["ready", "ready", "ready"]);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("a read photo shows its stored thumbnail: the local preview is let go", async () => {
    const { q, pending, revoke } = queue();
    await q.add([photo()]);
    expect(q.items[0]!.preview).toBe("blob:1");
    pending[0]!.resolve(result());
    await flush();
    expect(q.items[0]!.preview).toBeNull();
    expect(revoke).toHaveBeenCalledWith("blob:1");
  });

  it("a failed photo is retried only when asked, and only that one", async () => {
    const { q, read, pending } = queue();
    await q.add([photo(), photo()]);
    pending[0]!.reject(new Error("offline"));
    pending[1]!.resolve(result());
    await flush();
    expect(q.items.map((i) => i.status)).toEqual(["failed", "ready"]);
    expect(q.items[0]!.error).toBe("No connection");
    expect(read).toHaveBeenCalledTimes(2); // never retried by itself
    expect(q.retry(q.items[0]!.id)).toBe(true);
    expect(read).toHaveBeenCalledTimes(3);
    expect(read.mock.calls[2]![0]).toBe(pending[0]!.file);
    // A ready photo with a good reading is not read again.
    expect(q.retry(q.items[1]!.id)).toBe(false);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("a photo being read cannot be read a second time at once", async () => {
    const { q, read } = queue();
    await q.add([photo()]);
    expect(q.retry(q.items[0]!.id)).toBe(false);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("an item removed while it is read never comes back when the answer arrives", async () => {
    const { q, pending, revoke } = queue();
    await q.add([photo(), photo()]);
    const [first] = q.items;
    q.remove(first!.id);
    expect(revoke).toHaveBeenCalledWith(first!.preview);
    pending[0]!.resolve(result());
    await flush();
    expect(q.items.map((i) => i.id)).not.toContain(first!.id);
    expect(q.items).toHaveLength(1);
  });

  it("a late answer from an older reading never overwrites the retry's", async () => {
    const { q, pending } = queue();
    await q.add([photo()]);
    const id = q.items[0]!.id;
    pending[0]!.reject(new Error("timeout"));
    await flush();
    q.retry(id);
    const fresh = result({ outcome: "found" });
    pending[1]!.resolve(fresh);
    await flush();
    // The first request's success turns up after all: ignored.
    pending[0]!.resolve(result({ outcome: "new" }));
    await flush();
    expect(q.items[0]!.result).toBe(fresh);
    expect(q.items[0]!.run).toBe(2);
  });

  it("the scan limit or budget stops paid reading: the rest wait, unread and uncharged, until resumed", async () => {
    const { q, read, pending } = queue();
    await q.add([photo(), photo(), photo(), photo()]);
    pending[0]!.resolve(unread("budget"));
    await flush();
    expect(q.paused).toBe(true);
    expect(read).toHaveBeenCalledTimes(2);
    expect(q.items.map((i) => i.status)).toEqual(["ready", "reading", "paused", "paused"]);
    // Already on its way: it finishes normally.
    pending[1]!.resolve(result());
    await flush();
    expect(read).toHaveBeenCalledTimes(2);
    // A photo added now is not sent either.
    await q.add([photo()]);
    expect(q.items.at(-1)!.status).toBe("paused");
    expect(read).toHaveBeenCalledTimes(2);
    expect(q.resume()).toBe(3);
    expect(read).toHaveBeenCalledTimes(4);
  });

  it("an unread answer for lack of AI can be read again explicitly; a 'not a label' one cannot", async () => {
    const { q, pending } = queue();
    await q.add([photo(), photo()]);
    pending[0]!.resolve(unread("ai-down"));
    pending[1]!.resolve(unread("not-a-label"));
    await flush();
    expect(canReadAgain(q.items[0]!)).toBe(true);
    expect(canReadAgain(q.items[1]!)).toBe(false);
  });

  it("the same photo added twice is held with a warning and not read, unless the person says so", async () => {
    const { q, read } = queue();
    const same = photo("same-bytes");
    await q.add([same, new File(["same-bytes"], "copy.jpg")]);
    expect(q.items[1]).toMatchObject({ status: "held", duplicateOf: 1 });
    expect(read).toHaveBeenCalledTimes(1);
    expect(bucketOf(q.items[1]!)).toBe("attention");
    expect(q.readAnyway(q.items[1]!.id)).toBe(true);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("holds at most a batch's worth of photos; the rest are refused and said so", async () => {
    const { q } = queue();
    const many = Array.from({ length: BATCH_LIMIT + 3 }, () => photo());
    expect(await q.add(many)).toEqual({ added: BATCH_LIMIT, refused: 3 });
    expect(q.items).toHaveLength(BATCH_LIMIT);
  });

  it("an item is finished once: saving again, or retrying another, never saves it twice", async () => {
    const { q, pending } = queue();
    await q.add([photo(), photo()]);
    pending[0]!.resolve(result());
    pending[1]!.reject(new Error("x"));
    await flush();
    const [a, b] = q.items;
    expect(q.finish(a!.id, "Added 1 bottle")).toBe(true);
    expect(q.finish(a!.id, "Added 1 bottle")).toBe(false);
    q.retry(b!.id);
    expect(q.items[0]).toMatchObject({ status: "done", outcome: "Added 1 bottle", file: null });
    expect(q.retry(a!.id)).toBe(false);
    // A failed photo is never finished (it has no wine to add).
    expect(q.finish(b!.id, "x")).toBe(false);
  });

  it("a skipped photo adds nothing and is not read; skipping lets go of the photo", async () => {
    const { q, pending, read } = queue();
    await q.add([photo(), photo(), photo()]);
    expect(q.skip(q.items[2]!.id)).toBe(true);
    pending[0]!.resolve(result());
    pending[1]!.resolve(result());
    await flush();
    expect(read).toHaveBeenCalledTimes(2);
    expect(q.items[2]).toMatchObject({ status: "skipped", file: null, preview: null });
    // Not while it is being read.
    await q.add([photo()]);
    expect(q.skip(q.items[3]!.id)).toBe(false);
  });

  it("after one is handled, the next ready one follows; then the batch is summed up", async () => {
    const { q, pending } = queue();
    await q.add([photo(), photo(), photo()]);
    pending[0]!.resolve(result());
    pending[1]!.resolve(unread("not-a-label"));
    await flush();
    pending[2]!.reject(new Error("x"));
    await flush();
    const [a, b, c] = q.items;
    expect(q.nextReady(a!.id)?.id).toBe(b!.id);
    q.finish(a!.id, "Added");
    q.skip(b!.id);
    expect(q.nextReady(b!.id)).toBeUndefined();
    expect(summarize(q.items)).toMatchObject({
      total: 3,
      added: 1,
      skipped: 2,
      failed: 1,
      finished: true,
      progress: 1,
    });
    expect(c!.status).toBe("failed");
  });

  it("progress counts only photos with an answer: budget-paused photos are not progress", async () => {
    const { q, pending } = queue();
    await q.add([photo(), photo(), photo(), photo()]);
    pending[0]!.resolve(unread("budget"));
    pending[1]!.resolve(result());
    await flush();
    expect(q.items.map((i) => i.status)).toEqual(["ready", "ready", "paused", "paused"]);
    expect(summarize(q.items)).toMatchObject({ total: 4, progress: 0.5, finished: false });
    // Skipped still counts as handled, as before.
    q.skip(q.items[2]!.id);
    expect(summarize(q.items).progress).toBe(0.75);
  });

  it("a duplicate photo held aside is not progress until it is read or left out", async () => {
    const { q, pending } = queue();
    await q.add([photo("same"), new File(["same"], "copy.jpg")]);
    pending[0]!.resolve(result());
    await flush();
    expect(q.items[1]!.status).toBe("held");
    expect(summarize(q.items).progress).toBe(0.5);
    q.skip(q.items[1]!.id);
    expect(summarize(q.items).progress).toBe(1);
  });

  it("different photos of the same wine are noticed, never merged: the person decides", async () => {
    const { q, pending } = queue();
    await q.add([photo(), photo(), photo()]);
    pending[0]!.resolve(result());
    pending[1]!.resolve(result({ facts: facts({ producer: "CHATEAU MARGAUX" }) }));
    await flush();
    pending[2]!.resolve(result({ facts: facts({ year: 2016 }) }));
    await flush();
    expect(sameWineAs(q.items, q.items[1]!)).toBe(1);
    expect(sameWineAs(q.items, q.items[0]!)).toBeNull();
    // Another vintage is another wine to add.
    expect(sameWineAs(q.items, q.items[2]!)).toBeNull();
    expect(q.items.every((i) => i.status === "ready")).toBe(true);
  });

  it("a new batch only once nothing is being read; leaving lets go of every preview", async () => {
    const { q, pending, revoke } = queue();
    await q.add([photo()]);
    expect(q.clear()).toBe(false);
    pending[0]!.reject(new Error("x"));
    await flush();
    expect(q.clear()).toBe(true);
    expect(q.items).toEqual([]);
    await q.add([photo()]);
    q.dispose();
    expect(revoke).toHaveBeenCalledWith("blob:2");
  });
});
