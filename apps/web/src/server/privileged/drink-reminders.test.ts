import { describe, expect, it } from "vitest";
import { compose } from "./drink-reminders";

describe("the reminder a phone shows", () => {
  it("names the wine and opens its page when it is one", () => {
    expect(compose("nl", [{ vintageId: "v1", kind: "peak", title: "Margaux 2015" }])).toEqual({
      title: "Margaux 2015 is nu op zijn best",
      body: "De beste jaren zijn begonnen: een mooi moment om hem te openen.",
      url: "/cellar/v1",
      tag: "drink-v1",
    });
    expect(compose("en", [{ vintageId: "v1", kind: "ending", title: "Margaux 2015" }]).title).toBe(
      "Drink Margaux 2015 soon",
    );
  });

  it("lists them and opens Home when there are more", () => {
    const m = compose("en", [
      { vintageId: "v1", kind: "peak", title: "A 2015" },
      { vintageId: "v2", kind: "ending", title: "B 2010" },
    ]);
    expect(m).toMatchObject({ title: "2 wines to open", body: "A 2015 · B 2010", url: "/" });
  });
});
