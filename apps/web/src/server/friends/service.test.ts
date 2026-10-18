import { describe, expect, it, vi } from "vitest";
import type { FriendEntry } from "@cellr/domain";
import type { FriendsRepository } from "./types";
import { createFriendsService } from "./service";

const entry = (over: Partial<FriendEntry>): FriendEntry => ({
  friendshipId: "f1",
  userId: "u2",
  handle: "anna",
  displayName: "Anna",
  friendCode: "ABCD2345",
  status: "accepted",
  direction: "outgoing",
  since: "2026-10-01",
  ...over,
});

function setup(over: Partial<FriendsRepository> = {}) {
  const repo: FriendsRepository = {
    me: vi.fn(async () => ({ handle: "joost", friendCode: "WXYZ6789" })),
    setHandle: vi.fn(async () => true),
    list: vi.fn(async () => [
      entry({}),
      entry({ friendshipId: "f2", userId: "u3", status: "pending", direction: "incoming" }),
      entry({ friendshipId: "f3", userId: "u4", status: "pending", direction: "outgoing" }),
    ]),
    find: vi.fn(async () => null),
    send: vi.fn(async () => "sent" as const),
    respond: vi.fn(async () => true),
    remove: vi.fn(async () => true),
    sharing: vi.fn(async () => ({
      modes: { ratings: "friends" as const, taste: "friends" as const, cellar: "none" as const },
      picks: { ratings: [], taste: [], cellar: [] },
    })),
    saveSharing: vi.fn(async () => {}),
    access: vi.fn(async () => ({ ratings: true, taste: false, cellar: true })),
    ratings: vi.fn(async () => []),
    taste: vi.fn(async () => null),
    cellar: vi.fn(async () => []),
    racks: vi.fn(async () => null),
    ...over,
  };
  const notify = vi.fn(async () => {});
  return { repo, notify, service: createFriendsService({ repo, userId: "u1", notify }) };
}

describe("friends service", () => {
  it("splits friends from requests both ways", async () => {
    const view = await setup().service.overview();
    expect(view.ready).toBe(true);
    expect(view.friends.map((f) => f.userId)).toEqual(["u2"]);
    expect(view.incoming.map((f) => f.userId)).toEqual(["u3"]);
    expect(view.outgoing.map((f) => f.userId)).toEqual(["u4"]);
  });

  it("is not ready before the database step", async () => {
    const { service } = setup({ me: async () => null, list: async () => null });
    expect((await service.overview()).ready).toBe(false);
    await expect(service.setHandle("joost")).rejects.toMatchObject({ code: "INTERNAL" });
  });

  it("a taken name is a conflict", async () => {
    const { service } = setup({ setHandle: async () => false });
    await expect(service.setHandle("anna")).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("tells the other person about a new request, and about an answer", async () => {
    const { service, notify } = setup();
    await service.request("u9");
    expect(notify).toHaveBeenCalledWith({ kind: "request", from: "u1", to: "u9" });
    await service.respond("f2", true);
    expect(notify).toHaveBeenLastCalledWith({ kind: "accepted", from: "u1", to: "u3" });
  });

  it("a failing notification does not fail the request", async () => {
    const { repo } = setup();
    const service = createFriendsService({
      repo,
      userId: "u1",
      notify: async () => {
        throw new Error("push down");
      },
    });
    await expect(service.request("u9")).resolves.toEqual({ result: "sent" });
  });

  it("only answers requests sent to me", async () => {
    const { service, repo } = setup();
    await expect(service.respond("f3", true)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(repo.respond).not.toHaveBeenCalled();
  });

  it("only friends can be chosen", async () => {
    const { service, repo } = setup();
    await service.saveSharing({
      modes: { ratings: "friends", taste: "friends", cellar: "chosen" },
      picks: { ratings: [], taste: [], cellar: ["u2", "u3", "u4"] },
    });
    expect(repo.saveSharing).toHaveBeenCalledWith("u1", {
      modes: { ratings: "friends", taste: "friends", cellar: "chosen" },
      picks: { ratings: [], taste: [], cellar: ["u2"] },
    });
  });

  it("shows a friend only what they share, and nothing to a non-friend", async () => {
    const { service, repo } = setup();
    const view = await service.friend("u2");
    expect(view.ratings).toEqual([]);
    expect(view.taste).toBeNull();
    expect(view.cellar).toEqual({ wines: [], racks: [] });
    expect(repo.taste).not.toHaveBeenCalled();
    await expect(service.friend("u3")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
