import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../sommelier";
import { MENU_MAX_COURSES } from "../sommelier-menu";
import { menuContext } from "./menu-context";
import { MAX_COURSES } from "./parse";

const person = (text: string): ChatMessage => ({ role: "user", text });
const sommelier = (text: string): ChatMessage => ({ role: "assistant", text });
const saidOf = (r: ReturnType<typeof menuContext>) => r?.menu.courses.map((c) => c.said) ?? null;

const MENU = "Oysters to start, then roast lamb, and for dessert chocolate fondant.";
const SECOND = "Voorgerecht: carpaccio. Hoofdgerecht: zeebaars. Nagerecht: tiramisu.";

describe("the menu a conversation is about", () => {
  it("is the question itself when the question is a menu", () => {
    const r = menuContext([person(MENU)]);
    expect(r?.fromHistory).toBe(false);
    expect(saidOf(r)).toEqual(["Oysters", "roast lamb", "chocolate fondant"]);
  });

  it("is the person's earlier menu for a follow-up", () => {
    const r = menuContext([
      person(MENU),
      sommelier("The Chablis, then the Pauillac, then the tawny."),
      person("And is the Pauillac not too heavy for the lamb?"),
    ]);
    expect(r?.fromHistory).toBe(true);
    expect(saidOf(r)).toEqual(["Oysters", "roast lamb", "chocolate fondant"]);
  });

  it("survives a long conversation: twelve messages, the menu early, several follow-ups", () => {
    const messages: ChatMessage[] = [
      person(MENU),
      sommelier("Muscadet, then Rioja, then the port."),
      person("Why the Rioja and not the Barolo?"),
      sommelier("The Barolo is still very firm."),
      person("Should I decant it?"),
      sommelier("An hour is enough."),
      person("And how cold should the Muscadet be?"),
      sommelier("About 8 to 10 degrees."),
      person("Can I use the port for the cheese as well?"),
      sommelier("Yes, a tawny is lovely with hard cheese."),
      person("Thanks!"),
      person("One more: what if a guest does not drink red?"),
    ];
    expect(messages).toHaveLength(12);
    const r = menuContext(messages);
    expect(r?.fromHistory).toBe(true);
    expect(saidOf(r)).toEqual(["Oysters", "roast lamb", "chocolate fondant"]);
  });

  it("is replaced by a second menu, and the newest menu wins", () => {
    const messages = [
      person(MENU),
      sommelier("Muscadet, Rioja, tawny."),
      person(SECOND),
      sommelier("Beaujolais, Chablis, Moscato."),
      person("And with the tiramisu, could I pour something sparkling instead?"),
    ];
    const r = menuContext(messages);
    expect(r?.fromHistory).toBe(true);
    expect(saidOf(r)).toEqual(["carpaccio", "zeebaars", "tiramisu"]);
    // Asked again as the question itself, the newest is the question.
    expect(menuContext([...messages.slice(0, 2), person(SECOND)])?.fromHistory).toBe(false);
  });

  it("keeps a menu with a course word after its dish through a follow-up, in English and Dutch", () => {
    const en = menuContext([
      person("Oysters to start, then roast lamb, and chocolate fondant for dessert."),
      sommelier("Muscadet, Rioja, tawny."),
      person("And with the fondant, something lighter?"),
    ]);
    expect(en?.fromHistory).toBe(true);
    expect(saidOf(en)).toEqual(["Oysters", "roast lamb", "chocolate fondant"]);
    const nl = menuContext([
      person("Carpaccio als voorgerecht, daarna eend en chocolademousse als dessert."),
      sommelier("Beaujolais, Pinot, Moscato."),
      person("Kan de Pinot ook bij de carpaccio?"),
    ]);
    expect(saidOf(nl)).toEqual(["Carpaccio", "eend", "chocolademousse"]);
  });

  it("is none when the person spoke of another day, not a menu", () => {
    expect(
      menuContext([
        person("We're having steak tonight, then salmon tomorrow. Which wine for tonight?"),
      ]),
    ).toBeNull();
    expect(menuContext([person("Wat drink ik bij de kip en dan morgen bij de vis?")])).toBeNull();
  });

  it("is only ever what the person said, never the sommelier's own words", () => {
    expect(
      menuContext([
        person("What should I open tonight?"),
        sommelier("Oysters to start, then roast lamb, and a fondant would suit your wines."),
        person("Sounds good, which bottle first?"),
      ]),
    ).toBeNull();
  });

  it("is none when nobody said a menu", () => {
    expect(menuContext([person("What goes with roast lamb?")])).toBeNull();
    expect(
      menuContext([person("Steak tonight"), sommelier("The Malbec."), person("And tomorrow?")]),
    ).toBeNull();
    expect(menuContext([])).toBeNull();
    // A conversation that does not end with the person's question has no question to give a menu to.
    expect(menuContext([person(MENU), sommelier("Muscadet, Rioja, tawny.")])).toBeNull();
  });

  it("plans as many courses as the screen can show", () => {
    expect(MAX_COURSES).toBe(MENU_MAX_COURSES);
  });
});
