import { describe, expect, it } from "vitest";
import {
  ASK_CODES,
  DRINK_PHASES,
  MENTION_STATUSES,
  OFFER_CHECKS,
  PAIRING_CONFIDENCE_LEVELS,
  PAIRING_CONS,
  PAIRING_OUTCOMES,
  PAIRING_PROS,
  PICK_NOTES,
  SET_ASIDE_REASONS,
  STYLE_REASONS,
} from "@cellr/domain";
import { DECANT_KINDS, GLASSES } from "@cellr/domain";
import en from "../../../messages/en.json";
import nl from "../../../messages/nl.json";

/**
 * The screen words a plan code by code. A code without a sentence would show a raw key to a person, so every
 * code the engines can produce must have its words, in both languages.
 */
const at = (messages: unknown, path: string): unknown =>
  path
    .split(".")
    .reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], messages);

const NEEDED = [
  ...PAIRING_OUTCOMES.map((c) => `outcome.${c}`),
  "outcome.noneEmpty",
  "outcome.clarify",
  ...PAIRING_CONFIDENCE_LEVELS.map((c) => `confidence.${c}`),
  ...PAIRING_PROS.map((c) => `pro.${c}`),
  ...PAIRING_CONS.map((c) => `con.${c}`),
  ...PICK_NOTES.map((c) => `note.${c}`),
  ...SET_ASIDE_REASONS.map((c) => `aside.${c}`),
  ...STYLE_REASONS.map((c) => `buy.reason.${c}`),
  ...OFFER_CHECKS.filter((c) => c !== "not-asked").map((c) => `offerCheck.${c}`),
  "offer.online-offer",
  "offer.local-availability",
  ...ASK_CODES.map((c) => `ask.${c}`),
  ...MENTION_STATUSES.map((c) => `friend.${c}`),
  ...DECANT_KINDS.map((c) => `serve.decant.${c}`),
  ...GLASSES.map((c) => `serve.glass.${c}`),
  ...DRINK_PHASES.map((c) => `keep.phase.${c}`),
  ...(["serving", "keeping", "wine-to-food", "menu", "quantity"] as const).map((c) => `kind.${c}`),
];

describe.each([
  ["English", en],
  ["Dutch", nl],
])("the plan's words in %s", (_name, messages) => {
  it.each(NEEDED)("has %s", (key) => {
    const text = at(messages, `sommelier.plan.${key}`);
    expect(typeof text, key).toBe("string");
    expect((text as string).trim().length, key).toBeGreaterThan(0);
  });
  it("never words a number as a percentage or a score", () => {
    expect(JSON.stringify(at(messages, "sommelier.plan"))).not.toMatch(/%|\bscore\b|\bpunten\b/i);
  });
});
