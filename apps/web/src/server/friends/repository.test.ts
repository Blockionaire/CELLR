import { describe, expect, it } from "vitest";
import type { Db } from "@/server/db/clients";
import { createFriendsRepository } from "./repository";

/**
 * THE FRIENDS' SOMMELIER CONSENTS WHEN THE DATABASE IS ONE STEP BEHIND. Migration 0048 creates the table with
 * the taste consent; 0050 adds the cellar consent. With 0048 applied and 0050 not, the taste consent must keep
 * working and be shown as it is: a switch that shows "off" while the database holds "on" cannot be turned off.
 */
type Answer = { data: unknown; error: { code: string } | null };

/** A database that answers a `select` on sommelier_sharing by the columns asked for. */
function fakeDb(answer: (columns: string) => Answer) {
  const asked: string[] = [];
  const db = {
    from: (table: string) => ({
      select: (columns: string) => {
        asked.push(`${table}: ${columns}`);
        return { eq: () => ({ maybeSingle: async () => answer(columns) }) };
      },
    }),
  } as unknown as Db;
  return { db, asked };
}

describe("reading the friends' sommelier consents", () => {
  it("both, when both columns are there", async () => {
    const { db } = fakeDb(() => ({
      data: { taste_for_friends: true, cellar_for_friends: false },
      error: null,
    }));
    expect(await createFriendsRepository(db).sommelierSharing("u")).toEqual({
      tasteForFriends: true,
      cellarForFriends: false,
    });
  });

  it.each(["42703", "PGRST204"])(
    "the cellar column missing (%s): the taste consent is read as it is, the cellar one is not available",
    async (code) => {
      const { db, asked } = fakeDb((columns) =>
        columns.includes("cellar_for_friends")
          ? { data: null, error: { code } }
          : { data: { taste_for_friends: true }, error: null },
      );
      expect(await createFriendsRepository(db).sommelierSharing("u")).toEqual({
        tasteForFriends: true,
        cellarForFriends: null,
      });
      expect(asked).toEqual([
        "sommelier_sharing: taste_for_friends, cellar_for_friends",
        "sommelier_sharing: taste_for_friends",
      ]);
    },
  );

  it("no row yet, with the cellar column missing: both are no, and the cellar one is not available", async () => {
    const { db } = fakeDb((columns) =>
      columns.includes("cellar_for_friends")
        ? { data: null, error: { code: "42703" } }
        : { data: null, error: null },
    );
    expect(await createFriendsRepository(db).sommelierSharing("u")).toEqual({
      tasteForFriends: false,
      cellarForFriends: null,
    });
  });

  it.each(["42P01", "PGRST205"])(
    "the table missing (%s): no friends' sommelier at all",
    async (code) => {
      const { db } = fakeDb(() => ({ data: null, error: { code } }));
      expect(await createFriendsRepository(db).sommelierSharing("u")).toBeNull();
    },
  );

  it("any other failure is a failure, not a quiet no", async () => {
    const { db } = fakeDb(() => ({ data: null, error: { code: "57014" } }));
    await expect(createFriendsRepository(db).sommelierSharing("u")).rejects.toThrow();
  });
});
