import { describe, expect, it } from "vitest";
import { dueNotices, noticeKey, type NoticeWine } from "./drink-notices";

// Window 2020–2040: best years from 2025 (25%), last stretch from 2034 (70%).
const wine = (over: Partial<NoticeWine> = {}): NoticeWine => ({
  vintageId: "v1",
  title: "Margaux 2015",
  window: { from: 2020, until: 2040 },
  firstAddedAt: "2021-03-01T00:00:00Z",
  ...over,
});
const on = (iso: string) => new Date(iso);
const kinds = (r: { announce: { kind: string }[] }) => r.announce.map((n) => n.kind);

describe("which drinking reminders are due", () => {
  it("nothing before its best years", () => {
    const r = dueNotices([wine()], new Set(), on("2024-06-01"));
    expect(r).toEqual({ announce: [], quiet: [] });
  });

  it("tells once when it reaches its best years", () => {
    const r = dueNotices([wine()], new Set(), on("2025-02-01"));
    expect(kinds(r)).toEqual(["peak"]);
    const again = dueNotices([wine()], new Set([noticeKey("v1", "peak")]), on("2025-03-01"));
    expect(again).toEqual({ announce: [], quiet: [] });
  });

  it("in its last stretch tells only that, and marks the best years as known", () => {
    const r = dueNotices([wine()], new Set(), on("2034-02-01"));
    expect(kinds(r)).toEqual(["ending"]);
    expect(r.quiet.map((n) => n.kind)).toEqual(["peak"]);
  });

  it("a moment long past is old news: a whole cellar brought in at once does not flood the phone", () => {
    const r = dueNotices([wine()], new Set(), on("2027-06-01"));
    expect(r.announce).toEqual([]);
    expect(r.quiet.map((n) => n.kind)).toEqual(["peak"]);
  });

  it("a bottle bought when it was already at its best is not news", () => {
    const r = dueNotices(
      [wine({ firstAddedAt: "2026-01-01T00:00:00Z" })],
      new Set(),
      on("2026-02-01"),
    );
    expect(r.announce).toEqual([]);
    expect(r.quiet.map((n) => n.kind)).toEqual(["peak"]);
  });

  it("switching reminders on only marks what is already true", () => {
    const r = dueNotices([wine()], new Set(), on("2030-01-01"), true);
    expect(r.announce).toEqual([]);
    expect(r.quiet.map((n) => n.kind)).toEqual(["peak"]);
  });

  it("a wine without a window (non-vintage) never reminds", () => {
    expect(dueNotices([wine({ window: null })], new Set(), on("2030-01-01"))).toEqual({
      announce: [],
      quiet: [],
    });
  });
});
