import { describe, expect, it } from "vitest";
import { completeMention, mentionBeingTyped } from "./mention-suggestions";

describe("typing a friend's name", () => {
  it("sees a name being typed at the end of the draft", () => {
    expect(mentionBeingTyped("Oysters with @an")).toBe("an");
    expect(mentionBeingTyped("@")).toBe("");
    expect(mentionBeingTyped("Dinner with @Anna.J")).toBe("anna.j");
  });
  it("does not take an e-mail address or a finished name for one", () => {
    expect(mentionBeingTyped("mail joe@exam")).toBeNull();
    expect(mentionBeingTyped("with @anna tonight")).toBeNull();
    expect(mentionBeingTyped("no name here")).toBeNull();
  });
  it("completes the name as text, and nothing else", () => {
    expect(completeMention("Oysters with @an", "anna")).toBe("Oysters with @anna ");
    expect(completeMention("@", "bram_2")).toBe("@bram_2 ");
  });
});
