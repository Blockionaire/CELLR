import { describe, expect, it } from "vitest";
import {
  eventsPath,
  mySharedBottlesKey,
  sharedRackBottlesKey,
  sharedRackEventsKey,
  sharedRackKey,
  sharedRackListKey,
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
