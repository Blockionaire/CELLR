import { describe, expect, it, vi } from "vitest";
import { noticeKey, type NoticeWine } from "@cellr/domain";
import type { PushRepository } from "./types";
import { createPushService } from "./service";

const env = { publicKey: "pub", privateKey: "priv", subject: "mailto:a@b.c" };
const sub = {
  endpoint: "https://push.example/1",
  keys: { p256dh: "k".repeat(87), auth: "a".repeat(22) },
};
const wines: NoticeWine[] = [
  {
    vintageId: "v1",
    title: "A 2015",
    window: { from: 2000, until: 2060 },
    firstAddedAt: "2001-01-01",
  },
  {
    vintageId: "v2",
    title: "B 2020",
    window: { from: 2030, until: 2050 },
    firstAddedAt: "2021-01-01",
  },
];

function setup(over: Partial<PushRepository> = {}, withEnv = true) {
  const repo: PushRepository = {
    add: vi.fn(async () => true),
    remove: vi.fn(async () => true),
    known: vi.fn(async () => new Set<string>()),
    markKnown: vi.fn(async () => true),
    ...over,
  };
  const service = createPushService({
    repo,
    env: withEnv ? env : null,
    wines: async () => wines,
    now: () => new Date("2026-10-01"),
  });
  return { repo, service };
}

describe("reminders on a phone", () => {
  it("are offered only when the server can send them and the database step is taken", async () => {
    expect(await setup().service.status()).toEqual({ enabled: true, publicKey: "pub" });
    expect(await setup({}, false).service.status()).toEqual({ enabled: false, publicKey: null });
    expect(await setup({ known: async () => null }).service.status()).toEqual({
      enabled: false,
      publicKey: null,
    });
  });

  it("switching on marks what is already true as known, so the first reminder is real news", async () => {
    const { repo, service } = setup({ known: async () => new Set([noticeKey("v9", "peak")]) });
    await service.subscribe(sub);
    expect(repo.add).toHaveBeenCalledWith(sub);
    // v1 is at its best already; v2 is still young
    expect(repo.markKnown).toHaveBeenCalledWith([
      { vintageId: "v1", kind: "peak", title: "A 2015" },
    ]);
  });

  it("cannot be switched on without the keys or the database step", async () => {
    await expect(setup({}, false).service.subscribe(sub)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(setup({ add: async () => null }).service.subscribe(sub)).rejects.toMatchObject({
      code: "INTERNAL",
    });
  });
});
