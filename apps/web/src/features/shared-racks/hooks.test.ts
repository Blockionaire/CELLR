import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
  eventsPath,
  forgetSharedRack,
  mySharedBottlesKey,
  sharedRackBottlesKey,
  sharedRackEventsKey,
  sharedRackKey,
  sharedRackInvitationsKey,
  sharedRackListKey,
  sharedRackMembersKey,
  sharedRacksKey,
} from "./hooks";

describe("shared rack queries", () => {
  it("everything lives under one key, so one refresh reads all of it again", () => {
    for (const key of [
      sharedRackListKey,
      mySharedBottlesKey,
      sharedRackKey("r1"),
      sharedRackBottlesKey("r1"),
      sharedRackEventsKey("r1", { owner: "u" }),
    ])
      expect(key.slice(0, sharedRacksKey.length)).toEqual([...sharedRacksKey]);
  });

  it("one rack's cache is never another's, and a filtered history is its own", () => {
    expect(sharedRackBottlesKey("r1")).not.toEqual(sharedRackBottlesKey("r2"));
    expect(sharedRackEventsKey("r1", {})).not.toEqual(
      sharedRackEventsKey("r1", { placement: "p" }),
    );
  });

  it("asks for a page of history with only the filters that are set", () => {
    expect(eventsPath("r1", {}, null)).toBe("/shared-racks/r1/events?limit=30");
    expect(eventsPath("r1", { owner: "o", actor: "a", placement: "p" }, 120, 10)).toBe(
      "/shared-racks/r1/events?limit=10&before=120&owner=o&actor=a&placement=p",
    );
    expect(eventsPath("r1", { owner: undefined }, null)).toBe("/shared-racks/r1/events?limit=30");
  });
});

describe("a rack that is no longer mine to see", () => {
  it("leaves the cache at once, all of it, and nothing of another rack or of my own bottles goes with it", async () => {
    const client = new QueryClient();
    const held = [
      sharedRackKey("gone"),
      sharedRackBottlesKey("gone"),
      sharedRackMembersKey("gone"),
      sharedRackInvitationsKey("gone"),
      sharedRackEventsKey("gone", {}),
      sharedRackEventsKey("gone", { placement: "p" }),
    ];
    for (const key of held) client.setQueryData(key, { secret: "Ann's bottle" });
    client.setQueryData(sharedRackBottlesKey("kept"), { bottles: [] });
    client.setQueryData(mySharedBottlesKey, { bottles: [] });
    client.setQueryData(sharedRackListKey, { racks: [] });

    await forgetSharedRack(client, "gone");

    for (const key of held) expect(client.getQueryCache().find({ queryKey: key })).toBeUndefined();
    expect(client.getQueryData(sharedRackBottlesKey("kept"))).toEqual({ bottles: [] });
    expect(client.getQueryData(mySharedBottlesKey)).toEqual({ bottles: [] });
    // the list of my racks still names it: it is to be read again
    expect(client.getQueryState(sharedRackListKey)?.isInvalidated).toBe(true);
  });

  it("my own cellar refreshes my shared bottles by this same key (features/cellar/hooks.ts names it literally)", () => {
    expect([...mySharedBottlesKey]).toEqual(["shared-racks", "my-bottles"]);
  });
});
