import { describe, expect, it, vi } from "vitest";
import { DomainError } from "@cellr/domain";
import type { Db } from "@/server/db/clients";
import { createFeedbackRepository } from "./repository";
import { createFeedbackService } from "./service";
import type { FeedbackRepository } from "./types";

vi.mock("server-only", () => ({}));

const good = {
  category: "bug" as const,
  message: "The shutter did nothing after the second photo.",
};

describe("beta feedback", () => {
  const setup = (over: Partial<FeedbackRepository> = {}, spend = vi.fn(async () => {})) => {
    const repo: FeedbackRepository = { add: vi.fn(async () => true), ...over };
    return { repo, spend, service: createFeedbackService({ repo, spend }) };
  };

  it("stores what was typed and chosen, tidied, and nothing else", async () => {
    const { repo, service } = setup();
    await expect(
      service.submit({ ...good, location: " Scan ", device: "iPhone · Safari · browser tab" }),
    ).resolves.toEqual({ ok: true });
    expect(repo.add).toHaveBeenCalledWith({
      category: "bug",
      message: good.message,
      location: "Scan",
      device: "iPhone · Safari · browser tab",
    });
  });

  it("refuses an incomplete report before spending anything", async () => {
    const { repo, spend, service } = setup();
    await expect(service.submit({ category: "bug", message: "short" })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    expect(spend).not.toHaveBeenCalled();
    expect(repo.add).not.toHaveBeenCalled();
  });

  it("its own rate limit: over it, nothing is stored", async () => {
    const spend = vi.fn(async () => {
      throw new DomainError("RATE_LIMITED", undefined, { retryable: true });
    });
    const { repo, service } = setup({}, spend);
    await expect(service.submit(good)).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(repo.add).not.toHaveBeenCalled();
  });

  it("before the database step: a plain error, never a silent success", async () => {
    const { service } = setup({ add: vi.fn(async () => false) });
    await expect(service.submit(good)).rejects.toMatchObject({ code: "INTERNAL" });
  });
});

describe("the feedback query", () => {
  function recordingDb(error: { code?: string } | null = null) {
    const inserted: unknown[] = [];
    const db = {
      from(table: string) {
        expect(table).toBe("beta_feedback");
        return {
          insert: (row: unknown) => {
            inserted.push(row);
            return Promise.resolve({ error });
          },
        };
      },
    };
    return { db: db as unknown as Db, inserted };
  }

  it("never sends a user id: the database takes it from the session", async () => {
    const { db, inserted } = recordingDb();
    await createFeedbackRepository(db).add({ ...good, location: null, device: null });
    expect(inserted).toEqual([{ ...good, location: null, device: null }]);
    expect(inserted[0]).not.toHaveProperty("user_id");
  });

  it("a missing table reads as 'not yet', any other error is an error", async () => {
    expect(
      await createFeedbackRepository(recordingDb({ code: "PGRST205" }).db).add({
        ...good,
        location: null,
        device: null,
      }),
    ).toBe(false);
    await expect(
      createFeedbackRepository(recordingDb({ code: "42501" }).db).add({
        ...good,
        location: null,
        device: null,
      }),
    ).rejects.toBeTruthy();
  });
});
