import { normalizeText, type ScanResult } from "@cellr/domain";

/**
 * THE BATCH QUEUE: photos of different wines, each read on its own (one label per photo, one paid reading per
 * photo, never one per bottle), two at a time, while the person goes on taking the next. Plain TypeScript, no
 * React, so every rule below is tested on its own (queue.test.ts):
 *
 * - An item is only ever read by one request at a time: it is marked "reading" before the request goes out,
 *   and only a "waiting" item is picked up.
 * - Every reading carries the item's run number. An answer is applied only to the same item, still reading,
 *   in the same run: a removed item never comes back, and a late answer never overwrites a newer retry.
 * - A retry is explicit (it is a paid reading) and only for the one item asked.
 * - When the scan limit or the platform budget says stop, nothing more is sent: the photos still waiting are
 *   paused (nothing was charged for them) until the person resumes.
 * - The same photo added twice is held with a warning, not read again, until the person says otherwise.
 * - Local previews are let go as soon as they are not needed (a read photo shows its stored thumbnail).
 */

/** At most this many photos are read at the same time. */
export const AT_ONCE = 2;
/** At most this many photos in one batch: well inside the hourly scan limit (40), so a batch can finish. */
export const BATCH_LIMIT = 20;

export type QueueStatus =
  | "waiting"
  | "reading"
  | "ready"
  | "failed"
  /** Not sent: the scan limit or budget stopped the batch. Resumed only when the person asks. */
  | "paused"
  /** The same photo as an earlier one: not read unless the person says so. */
  | "held"
  | "done"
  | "skipped";

export interface QueueItem {
  id: string;
  /** "Photo 3": its place in the batch, for the person. */
  n: number;
  /** Kept while it may still be read (or read again); let go once the item is handled. */
  file: File | null;
  /** A local preview, only until the stored photo can be shown instead. */
  preview: string | null;
  fingerprint: string | null;
  status: QueueStatus;
  result: ScanResult | null;
  error: string | null;
  /** What became of it: "Added 2 bottles of …", or that it went on the wish list. */
  outcome: string | null;
  /** The photo number this one is a copy of, when it is. */
  duplicateOf: number | null;
  /** How many readings were started for it; an answer from an older one is ignored. */
  run: number;
}

export interface QueueDeps {
  read: (file: File) => Promise<ScanResult>;
  describe: (error: unknown) => string;
  preview?: (file: File) => string;
  revoke?: (url: string) => void;
  fingerprint?: (file: File) => Promise<string | null>;
  id?: () => string;
}

/** The scan said "stop paying": the household's scan limit, or the platform's AI budget. */
export const stopsPaidReading = (r: ScanResult) =>
  r.outcome === "unread" && (r.reason === "limit" || r.reason === "budget");

/** A read that can be tried again by asking the model once more (a paid reading, so only when asked). */
export const canReadAgain = (item: QueueItem) =>
  item.file !== null &&
  (item.status === "failed" ||
    (item.status === "ready" &&
      item.result?.outcome === "unread" &&
      (item.result.reason === "ai-down" ||
        item.result.reason === "limit" ||
        item.result.reason === "budget")));

/** What a read photo still needs from the person before it can be added with confidence. */
export function needsAttention(item: QueueItem): boolean {
  if (item.status === "paused" || item.status === "held") return true;
  if (item.status !== "ready" || !item.result) return false;
  const r = item.result;
  if (r.outcome === "unread" || r.outcome === "choose") return true;
  return r.facts ? Object.values(r.facts.confidence).includes("low") : false;
}

export type Bucket = "processing" | "ready" | "attention" | "added" | "skipped";
export function bucketOf(item: QueueItem): Bucket {
  if (item.status === "waiting" || item.status === "reading") return "processing";
  if (item.status === "done") return "added";
  if (item.status === "skipped" || item.status === "failed") return "skipped";
  return needsAttention(item) ? "attention" : "ready";
}

export function summarize(items: readonly QueueItem[]) {
  const count: Record<Bucket, number> = {
    processing: 0,
    ready: 0,
    attention: 0,
    added: 0,
    skipped: 0,
  };
  for (const i of items) count[bucketOf(i)] += 1;
  const read = items.filter((i) => i.status !== "waiting" && i.status !== "reading").length;
  return {
    total: items.length,
    ...count,
    failed: items.filter((i) => i.status === "failed").length,
    /** Every photo has an answer and nothing is left to review: the batch can be summed up. */
    finished:
      items.length > 0 &&
      items.every((i) => i.status === "done" || i.status === "skipped" || i.status === "failed"),
    progress: items.length ? read / items.length : 0,
  };
}

/** Who the wine is, as far as the photo says: the wine it matched, else what was read (accents and case aside). */
export function wineKey(r: ScanResult | null): string | null {
  if (!r) return null;
  if (r.outcome === "found" && r.matches[0]) return `wine:${r.matches[0].wine.id}`;
  const f = r.facts;
  if (!f || (!f.producer && !f.name)) return null;
  return `read:${normalizeText(`${f.producer ?? ""} ${f.name ?? ""}`)}|${f.nonVintage ? "nv" : (f.year ?? "")}`;
}

/** An earlier photo in this batch of what reads as the same wine: more bottles of it, if the person says so. */
export function sameWineAs(items: readonly QueueItem[], item: QueueItem): number | null {
  const key = wineKey(item.result);
  if (!key) return null;
  const earlier = items.find(
    (i) => i.n < item.n && i.status !== "skipped" && wineKey(i.result) === key,
  );
  return earlier?.n ?? null;
}

/** A fingerprint of the photo's bytes, to notice the very same photo added twice. */
export async function sha256(file: File): Promise<string | null> {
  try {
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

export class ScanQueue {
  private list: QueueItem[] = [];
  private listeners = new Set<() => void>();
  private busy = 0;
  private counter = 0;
  private stopped = false;
  private disposed = false;
  private readonly deps: Required<QueueDeps>;

  constructor(deps: QueueDeps) {
    this.deps = {
      preview: (f) => URL.createObjectURL(f),
      revoke: (u) => URL.revokeObjectURL(u),
      fingerprint: sha256,
      id: () => crypto.randomUUID(),
      ...deps,
    };
  }

  /** Swapped in by the screen on every render, so the latest translations and API are used. */
  setDeps(deps: Pick<QueueDeps, "read" | "describe">) {
    this.deps.read = deps.read;
    this.deps.describe = deps.describe;
  }

  get items(): readonly QueueItem[] {
    return this.list;
  }
  /** True once the scan limit or budget stopped the batch. */
  get paused() {
    return this.stopped;
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = () => this.list;

  private emit() {
    for (const fn of this.listeners) fn();
  }
  private find(id: string) {
    return this.list.find((i) => i.id === id);
  }
  private patch(id: string, patch: Partial<QueueItem>) {
    this.list = this.list.map((i) => (i.id === id ? { ...i, ...patch } : i));
    this.emit();
  }
  private release(item: QueueItem) {
    if (item.preview) this.deps.revoke(item.preview);
  }

  /** Adds photos to the end of the batch; beyond the batch limit they are refused (and said so). */
  async add(files: readonly File[]): Promise<{ added: number; refused: number }> {
    let added = 0;
    let refused = 0;
    for (const file of files) {
      if (this.disposed) break;
      if (this.list.length >= BATCH_LIMIT) {
        refused += 1;
        continue;
      }
      const fingerprint = await this.deps.fingerprint(file);
      if (this.disposed) break;
      if (this.list.length >= BATCH_LIMIT) {
        refused += 1;
        continue;
      }
      const copy = fingerprint
        ? this.list.find((i) => i.fingerprint === fingerprint && i.status !== "skipped")
        : undefined;
      this.counter += 1;
      const item: QueueItem = {
        id: this.deps.id(),
        n: this.counter,
        file,
        preview: this.deps.preview(file),
        fingerprint,
        status: copy ? "held" : this.stopped ? "paused" : "waiting",
        result: null,
        error: null,
        outcome: null,
        duplicateOf: copy?.n ?? null,
        run: 0,
      };
      this.list = [...this.list, item];
      added += 1;
      this.emit();
      this.pump();
    }
    return { added, refused };
  }

  private pump() {
    while (!this.stopped && this.busy < AT_ONCE) {
      const next = this.list.find((i) => i.status === "waiting" && i.file);
      if (!next) return;
      this.start(next);
    }
  }

  private start(item: QueueItem) {
    const run = item.run + 1;
    const file = item.file!;
    this.busy += 1;
    this.patch(item.id, { status: "reading", error: null, run });
    const current = () => {
      const now = this.find(item.id);
      return now && now.status === "reading" && now.run === run ? now : null;
    };
    this.deps
      .read(file)
      .then((result) => {
        const now = current();
        if (!now) return; // removed, or a newer reading has taken over
        if (now.preview) this.deps.revoke(now.preview);
        this.patch(item.id, { status: "ready", result, preview: null });
        if (stopsPaidReading(result)) this.stop();
      })
      .catch((error: unknown) => {
        if (!current()) return;
        this.patch(item.id, { status: "failed", error: this.deps.describe(error) });
      })
      .finally(() => {
        this.busy -= 1;
        if (!this.disposed) this.pump();
      });
  }

  /** The limit or budget is reached: whatever has not been sent waits until the person resumes. */
  private stop() {
    this.stopped = true;
    this.list = this.list.map((i) => (i.status === "waiting" ? { ...i, status: "paused" } : i));
    this.emit();
  }

  /** Sends the paused photos after all (each is a paid reading). Returns how many. */
  resume(): number {
    this.stopped = false;
    const paused = this.list.filter((i) => i.status === "paused").length;
    this.list = this.list.map((i) => (i.status === "paused" ? { ...i, status: "waiting" } : i));
    this.emit();
    this.pump();
    return paused;
  }

  /** Reads this one item again, and only it. False when there is nothing to read again. */
  retry(id: string): boolean {
    const item = this.find(id);
    if (!item || !canReadAgain(item)) return false;
    this.stopped = false;
    // The earlier answer stays until the new one replaces it (its stored photo is the thumbnail meanwhile).
    this.patch(id, { status: "waiting", error: null });
    this.pump();
    return true;
  }

  /** A held copy is read after all: the person says it is a different bottle. */
  readAnyway(id: string): boolean {
    const item = this.find(id);
    if (!item || item.status !== "held") return false;
    this.patch(id, { status: this.stopped ? "paused" : "waiting", duplicateOf: null });
    this.pump();
    return true;
  }

  /** Takes it out of the batch. An answer still on its way is ignored when it comes. */
  remove(id: string) {
    const item = this.find(id);
    if (!item || item.status === "done") return;
    this.release(item);
    this.list = this.list.filter((i) => i.id !== id);
    this.emit();
  }

  /** Leaves this photo out: no bottles, nothing more sent. */
  skip(id: string): boolean {
    const item = this.find(id);
    if (!item || item.status === "done" || item.status === "reading") return false;
    this.release(item);
    this.patch(id, { status: "skipped", file: null, preview: null });
    return true;
  }

  /** It was added (or wished for). Only once: a second call, or one for an item not ready, does nothing. */
  finish(id: string, outcome: string): boolean {
    const item = this.find(id);
    if (!item || item.status !== "ready") return false;
    this.release(item);
    this.patch(id, { status: "done", outcome, file: null, preview: null });
    return true;
  }

  /** The next photo waiting for the person to look at it, after the one just handled. */
  nextReady(afterId?: string): QueueItem | undefined {
    const ready = this.list.filter((i) => i.status === "ready" && i.id !== afterId);
    const after = afterId ? this.find(afterId)?.n : undefined;
    return (after === undefined ? undefined : ready.find((i) => i.n > after)) ?? ready[0];
  }

  /** A new batch: only once nothing is still being read. */
  clear(): boolean {
    if (this.list.some((i) => i.status === "reading")) return false;
    this.list.forEach((i) => this.release(i));
    this.list = [];
    this.counter = 0;
    this.stopped = false;
    this.emit();
    return true;
  }

  dispose() {
    this.disposed = true;
    this.list.forEach((i) => this.release(i));
    this.listeners.clear();
  }
}
