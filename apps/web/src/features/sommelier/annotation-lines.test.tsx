import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider, createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import {
  DRINK_PHASES,
  quantityFor,
  type BottleAnnotation,
  type QuantityAdvice,
} from "@cellr/domain";
import en from "../../../messages/en.json";
import nl from "../../../messages/nl.json";
import { annotationLines, quantityLines } from "./annotation-lines";
import { AnnotationView } from "./annotation-view";
import { QuantityView } from "./quantity-view";

// The facts under the sommelier's cards, in both languages: short, honest about estimates, never a raw key.
const t = {
  en: createTranslator({ locale: "en", messages: en, namespace: "sommelier" }),
  nl: createTranslator({ locale: "nl", messages: nl, namespace: "sommelier" }),
};
const lines = (
  a: BottleAnnotation,
  emphasis: "serving" | "keeping" | null,
  lang: "en" | "nl" = "en",
) => annotationLines(a, emphasis, t[lang] as never);

const barolo: BottleAnnotation = {
  vintageId: "v1",
  drink: { advice: "drink-now", phase: "peak", from: 2022, until: 2031, basis: "style" },
  serving: {
    tempC: { min: 17, max: 18 },
    fridgeMinutes: 0,
    decant: { kind: "air", minutes: 90 },
    glass: "large-red",
    basis: "style",
    tier: "appellation",
  },
  reserved: null,
  where: { places: ["Wine fridge"], unplaced: 0 },
};
const chablis: BottleAnnotation = {
  vintageId: "v2",
  drink: { advice: "keep", phase: "developing", from: 2024, until: 2030, basis: "own" },
  serving: {
    tempC: { min: 12, max: 13 },
    fridgeMinutes: 60,
    decant: { kind: "no", minutes: 0 },
    glass: "white",
    basis: "profile",
    tier: "exact",
  },
  reserved: { count: 2, free: 4, title: "Anniversary", on: "2026-12-12" },
  where: { places: ["Wine fridge", "Rack A"], unplaced: 1 },
};

describe("the lines under a card", () => {
  it("by default: drink and serving in one line, what the card does not say in the other", () => {
    expect(lines(barolo, null)).toEqual([
      "At its best now (est. 2022–2031) · about 17–18 °C · decant about 90 min · rule of thumb",
    ]);
    expect(lines(chablis, null)).toEqual([
      "Can be opened now, still improving (2024–2030) · 12–13 °C · from its profile",
      "4 of 6 not reserved · in Wine fridge, Rack A · 1 bottle without a place",
    ]);
    expect(lines(chablis, null, "nl")).toEqual([
      "Kan nu open, wordt nog beter (2024–2030) · 12–13 °C · uit zijn profiel",
      "4 van 6 niet gereserveerd · in Wine fridge, Rack A · 1 fles zonder plek",
    ]);
  });

  it("a serving question: the serving line first and in full", () => {
    expect(lines(barolo, "serving")).toEqual([
      "about 17–18 °C · no need to chill · decant about 90 min · large red-wine glass · rule of thumb",
      "At its best now (est. 2022–2031)",
    ]);
    expect(lines(chablis, "serving", "nl")[0]).toBe(
      "12–13 °C · ongeveer 60 min in de koelkast · decanteren hoeft niet · wittewijnglas · uit zijn profiel",
    );
  });

  it("a keeping question: the window first, with what it rests on", () => {
    expect(lines(barolo, "keeping")[0]).toBe(
      "At its best now · 2022–2031, an estimate for its style",
    );
    expect(lines(chablis, "keeping")[0]).toBe(
      "Can be opened now, still improving · 2024–2030, your own window",
    );
    expect(lines(barolo, "keeping", "nl")[0]).toBe(
      "Nu op zijn best · 2022–2031, een schatting voor zijn stijl",
    );
  });

  it("every estimate is worded as one; only what is known is stated plainly", () => {
    expect(lines(barolo, "serving")[0]).toMatch(/^about /);
    expect(lines(barolo, "serving")[0]).toMatch(/rule of thumb/);
    expect(lines(chablis, "serving")[0]).not.toMatch(/about 12|rule of thumb/);
    const fromProfile = { ...barolo, drink: { ...barolo.drink, basis: "profile" as const } };
    expect(lines(fromProfile, "keeping")[0]).toMatch(/an estimate from its profile/);
  });

  it("a wine known by its colour only: a temperature as a rule of thumb, nothing about decanting", () => {
    const colour = {
      ...barolo,
      serving: { ...barolo.serving!, decant: null, tier: "unknown" as const },
    };
    const [first] = lines(colour, "serving");
    expect(first).toMatch(/rule of thumb for its colour/);
    expect(first).not.toMatch(/decant/i);
    expect(lines(colour, "serving", "nl")[0]).toMatch(/vuistregel voor zijn kleur/);
  });

  it("too little known: says so when asked, says nothing otherwise", () => {
    const unknown: BottleAnnotation = {
      ...barolo,
      drink: { advice: "unknown", phase: "unknown", from: null, until: null, basis: "style" },
      serving: null,
      where: { places: [], unplaced: 2 },
    };
    expect(lines(unknown, null)).toEqual([]);
    expect(lines(unknown, "serving")).toEqual([
      "Too little is known about this wine to say how to serve it",
    ]);
    expect(lines(unknown, "keeping", "nl")).toEqual([
      "Te weinig bekend om te zeggen wanneer je hem drinkt",
    ]);
  });

  it("reserved: how many are free; all reserved says so", () => {
    const all = { ...barolo, reserved: { count: 3, free: 0, title: "Wedding", on: null } };
    expect(lines(all, null)[1]).toBe("all reserved (3)");
    expect(lines(all, null, "nl")[1]).toBe("alle gereserveerd (3)");
    const only = { ...barolo, reserved: { count: 1, free: 0, title: "Wedding", on: null } };
    expect(lines(only, null)[1]).toBe("reserved (the only bottle)");
    expect(lines(only, null, "nl")[1]).toBe("gereserveerd (de enige fles)");
    // The card line says what is not reserved; "free to open" is the quantity box's.
    for (const lang of ["en", "nl"] as const)
      expect(lines(chablis, null, lang).join(" ")).not.toMatch(/free to open|vrij om te openen/);
  });

  it("every advice and phase has words, in both languages, and no line is a raw key", () => {
    const advices = ["drink-now", "drink-soon", "keep", "past-window", "unknown"] as const;
    for (const lang of ["en", "nl"] as const)
      for (const advice of advices)
        for (const phase of DRINK_PHASES)
          for (const emphasis of ["serving", "keeping", null] as const) {
            const a = { ...chablis, drink: { ...chablis.drink, advice, phase } };
            for (const line of lines(a, emphasis, lang))
              expect(line).not.toMatch(/sommelier\.|annotate\./);
          }
    for (const lang of ["en", "nl"] as const)
      for (const kind of ["no", "air", "sediment", "optional"] as const)
        for (const glass of [
          "flute-or-tulip",
          "white",
          "large-white",
          "red",
          "large-red",
          "small",
        ] as const) {
          const a = {
            ...barolo,
            serving: { ...barolo.serving!, decant: { kind, minutes: 30 }, glass },
          };
          for (const line of lines(a, "serving", lang)) expect(line).not.toMatch(/annotate\./);
        }
  });

  it("stays short: at most two lines, each one readable on a phone", () => {
    for (const a of [barolo, chablis])
      for (const emphasis of ["serving", "keeping", null] as const)
        for (const lang of ["en", "nl"] as const) {
          const out = lines(a, emphasis, lang);
          expect(out.length).toBeLessThanOrEqual(2);
          for (const line of out) expect(line.length).toBeLessThanOrEqual(130);
        }
  });
});

const names = new Map([
  ["a", "Barolo 2016"],
  ["b", "Chablis 2022"],
]);
const nameOf = (id: string) => names.get(id) ?? null;
const qLines = (q: QuantityAdvice, lang: "en" | "nl" = "en") =>
  quantityLines(q, nameOf, t[lang] as never);

describe("the bottles for the guests", () => {
  it("any one of the wines: the need, then each wine against what is free to open", () => {
    const q = quantityFor(
      { guests: 8, gathering: "dinner" },
      [
        { vintageId: "a", count: 6, reserved: 2 },
        { vintageId: "b", count: 2, reserved: 0 },
      ],
      "alternatives",
    );
    expect(qLines(q)).toEqual([
      "For 8 people at dinner: about 4 bottles in all (an estimate of half a bottle each).",
      "Barolo 2016: 4 free to open, enough.",
      "Chablis 2022: 2 free to open, 2 short.",
    ]);
    expect(qLines(q, "nl")).toEqual([
      "Voor 8 personen aan tafel: ongeveer 4 flessen in totaal (een schatting van een halve fles per persoon).",
      "Barolo 2016: 4 vrij om te openen, genoeg.",
      "Chablis 2022: 2 vrij om te openen, 2 te weinig.",
    ]);
  });

  it("a menu: each wine's own share", () => {
    const q = quantityFor(
      { guests: 1, gathering: "reception" },
      [
        { vintageId: "a", count: 0, reserved: 0 },
        { vintageId: "b", count: 3, reserved: 0 },
      ],
      "sequence",
    );
    // One bottle of each wine is more than a third of a bottle each: the box says so instead of an estimate.
    expect(qLines(q)).toEqual([
      "For 1 person at a reception: one bottle of each wine, 2 in all (there will be wine left).",
      "Barolo 2016: 1 bottle needed, 0 free to open: 1 short.",
      "Chablis 2022: 1 bottle needed, 3 free to open: enough.",
    ]);
    expect(qLines(q, "nl")[0]).toBe(
      "Voor 1 persoon op een receptie: één fles van elke wijn, 2 in totaal (er blijft wijn over).",
    );
  });

  it("a menu shared by two courses: one bottle for two people, said honestly", () => {
    const q = quantityFor(
      { guests: 2, gathering: "dinner" },
      [
        { vintageId: "a", count: 3, reserved: 0 },
        { vintageId: "a", count: 3, reserved: 0 },
        { vintageId: "b", count: 3, reserved: 0 },
      ],
      "sequence",
    );
    expect(qLines(q)[0]).toBe(
      "For 2 people at dinner: one bottle of each wine, 2 in all (there will be wine left).",
    );
    expect(qLines(q)[1]).toBe("Barolo 2016: 1 bottle needed, 3 free to open: enough.");
  });

  it("a menu where whole bottles add to the estimate, and one where they do not", () => {
    const rounded = quantityFor(
      { guests: 8, gathering: "dinner" },
      [
        { vintageId: "a", count: 3, reserved: 0 },
        { vintageId: "b", count: 3, reserved: 0 },
        { vintageId: "c", count: 3, reserved: 0, small: true },
      ],
      "sequence",
    );
    expect(qLines(rounded)[0]).toBe(
      "For 8 people at dinner: 5 bottles in all, more than half a bottle each, as each wine is opened whole (there will be wine left).",
    );
    expect(qLines(rounded, "nl")[0]).toBe(
      "Voor 8 personen aan tafel: 5 flessen in totaal, meer dan een halve fles per persoon, omdat elke wijn een hele fles is (er blijft wijn over).",
    );
    const even = quantityFor(
      { guests: 12, gathering: "dinner" },
      [
        { vintageId: "a", count: 3, reserved: 0 },
        { vintageId: "b", count: 3, reserved: 0 },
      ],
      "sequence",
    );
    expect(qLines(even)[0]).toBe(
      "For 12 people at dinner: about 6 bottles in all (an estimate of half a bottle each).",
    );
  });

  it("a wine without a card is left out, not named wrongly", () => {
    const q = quantityFor(
      { guests: 12, gathering: "long-evening" },
      [{ vintageId: "zz", count: 1, reserved: 0 }],
      "alternatives",
    );
    expect(qLines(q)).toEqual([
      "For 12 people over a long evening: about 9 bottles in all (an estimate of three quarters of a bottle each).",
    ]);
  });
});

describe("the views", () => {
  const render = (node: ReactElement, lang: "en" | "nl" = "en") =>
    renderToStaticMarkup(
      <NextIntlClientProvider
        locale={lang}
        messages={lang === "en" ? en : nl}
        timeZone="Europe/Amsterdam"
      >
        {node}
      </NextIntlClientProvider>,
    );

  it("an annotation: its lines, its test id, wrapping instead of overflowing", () => {
    const html = render(<AnnotationView annotation={chablis} emphasis="serving" />);
    expect(html).toContain('data-testid="annotation"');
    expect(html).toContain('data-emphasis="serving"');
    expect(html).toContain("break-words");
    expect(html).toContain("Facts from your cellar");
    expect(html).toContain("12–13 °C");
    expect(render(<AnnotationView annotation={chablis} emphasis={null} />, "nl")).toContain(
      "4 van 6 niet gereserveerd",
    );
  });

  it("an annotation with nothing to say draws nothing", () => {
    const empty: BottleAnnotation = {
      ...barolo,
      drink: { advice: "unknown", phase: "unknown", from: null, until: null, basis: "style" },
      serving: null,
    };
    expect(render(<AnnotationView annotation={empty} emphasis={null} />)).toBe("");
  });

  it("the quantity box", () => {
    const q = quantityFor(
      { guests: 8, gathering: "dinner" },
      [{ vintageId: "a", count: 6, reserved: 0 }],
      "alternatives",
    );
    const html = render(<QuantityView quantity={q} nameOf={nameOf} />);
    expect(html).toContain('data-testid="quantity"');
    expect(html).toContain("Barolo 2016: 6 free to open, enough.");
  });
});

describe("second review: words a wine professional would not correct", () => {
  it("sediment: decanted gently off it, nothing said against air", () => {
    const old = {
      ...barolo,
      serving: { ...barolo.serving!, decant: { kind: "sediment" as const, minutes: 0 } },
    };
    expect(lines(old, "serving")[0]).toContain(
      "decant gently off the sediment shortly before serving",
    );
    expect(lines(old, "serving", "nl")[0]).toContain(
      "kort voor het serveren voorzichtig van het depot decanteren",
    );
    for (const lang of ["en", "nl"] as const)
      expect(lines(old, "serving", lang)[0]).not.toMatch(/no airing|niet beluchten/);
  });
  it("estimated years are marked as estimates in the short line too; the household's own are not", () => {
    expect(lines(barolo, null)[0]).toMatch(/^At its best now \(est\. 2022–2031\)/);
    expect(lines(barolo, null, "nl")[0]).toMatch(/^Nu op zijn best \(geschat 2022–2031\)/);
    const fromProfile = { ...barolo, drink: { ...barolo.drink, basis: "profile" as const } };
    expect(lines(fromProfile, null)[0]).toMatch(/\(est\. 2022–2031\)/);
    expect(lines(chablis, null)[0]).toMatch(/\(2024–2030\)/);
  });
  it("Dutch speaks of a drinkvenster", () => {
    const past = {
      ...barolo,
      drink: {
        ...barolo.drink,
        advice: "past-window" as const,
        phase: "past" as const,
        basis: "own" as const,
      },
    };
    expect(lines(past, "keeping", "nl")[0]).toBe(
      "Over zijn drinkvenster: drink hem snel · 2022–2031, je eigen drinkvenster",
    );
  });
});
