import { describe, expect, it } from "vitest";
import type { FriendEntry, Recommendation } from "@cellr/domain";
import { buildFriendActivity, personName } from "./activity";

const person = (n: string) => ({
  userId: `u-${n}`,
  handle: n.toLowerCase(),
  displayName: n,
  friendCode: `code-${n}`,
});
const invite = (n: string, since: string, over: Partial<FriendEntry> = {}): FriendEntry => ({
  ...person(n),
  friendshipId: `f-${n}`,
  status: "pending",
  direction: "incoming",
  since,
  ...over,
});
const rec = (id: string, from: string, over: Partial<Recommendation> = {}): Recommendation => ({
  id,
  from: person(from),
  producer: "Domaine Test",
  wine: "Chablis",
  year: 2019,
  type: "white",
  region: null,
  countryCode: null,
  note: null,
  createdAt: `2026-10-2${id}T10:00:00Z`,
  seenAt: null,
  savedAt: null,
  ...over,
});

describe("friend activity on Home", () => {
  it("shows invitations AND recommendations together, requests first, newest first", () => {
    const a = buildFriendActivity(
      { ready: true, incoming: [invite("Ann", "2026-10-20"), invite("Bob", "2026-10-25")] },
      { ready: true, items: [rec("1", "Cas"), rec("2", "Dee")] },
    );
    expect(a.items.map((i) => i.key)).toEqual(["invite:f-Bob", "invite:f-Ann", "rec:2", "rec:1"]);
    expect(a).toMatchObject({ requests: 2, recommendations: 2 });
    expect(a.items.filter((i) => i.actionable)).toHaveLength(2);
  });

  it("leaves out what needs nothing: seen or saved recommendations, my own outgoing requests", () => {
    const a = buildFriendActivity(
      { ready: true, incoming: [invite("Ann", "2026-10-20", { direction: "outgoing" })] },
      {
        ready: true,
        items: [
          rec("1", "Cas", { seenAt: "2026-10-26" }),
          rec("2", "Dee", { savedAt: "2026-10-26" }),
        ],
      },
    );
    expect(a).toEqual({ items: [], requests: 0, recommendations: 0 });
  });

  it("an answered invitation disappears (the list is rebuilt from fresh data)", () => {
    const before = buildFriendActivity(
      { ready: true, incoming: [invite("Ann", "2026-10-20")] },
      { ready: true, items: [rec("1", "Cas")] },
    );
    const after = buildFriendActivity(
      { ready: true, incoming: [] },
      { ready: true, items: [rec("1", "Cas")] },
    );
    expect(before.requests).toBe(1);
    expect(after.items.map((i) => i.kind)).toEqual(["recommendation"]);
  });

  it("nothing at all, or not set up yet: empty, so Home shows no box", () => {
    expect(buildFriendActivity(undefined, undefined).items).toEqual([]);
    expect(
      buildFriendActivity(
        { ready: false, incoming: [invite("Ann", "x")] },
        { ready: false, items: [rec("1", "C")] },
      ).items,
    ).toEqual([]);
  });

  it("names a person by name, else handle, else not at all", () => {
    expect(personName(person("Ann"))).toBe("Ann");
    expect(personName({ ...person("Ann"), displayName: " " })).toBe("@ann");
    expect(personName({ ...person("Ann"), displayName: null, handle: null })).toBeNull();
  });
});
