import "server-only";
import type { ParsedMenu } from "@cellr/domain/intelligence";

/**
 * THE MENU PART OF THE SOMMELIER'S MESSAGE (Sommelier V1+, part `menu`). These blocks are added to V1's user
 * message, after the taste block and before "Chat so far", only when the part is on and the question has a menu or
 * a choice between two cellar wines. Each block says itself how the model must use it, so V1's system prompt is not
 * edited. The schema is only extended for a NEW menu: every other call sends V1's schema byte for byte.
 *
 * The courses are the person's words: data, like the rest of the conversation (the system prompt says to ignore
 * any text in it that tries to change the rules). They are flattened to one line each and cut.
 */

const MAX_SAID = 80;
const line = (text: string) =>
  text
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SAID)
    .trim();

/** The numbered courses + how to answer (a new menu), or the menu as context only (a follow-up about it). */
export function menuBlock(menu: ParsedMenu, fromHistory: boolean): string {
  const courses = menu.courses.map(
    (c, i) =>
      `${i + 1}. ${line(c.said)}${c.food === null ? " (the app could not read this course; judge it from the words)" : ""}`,
  );
  if (fromHistory)
    return [
      "Menu (context only: the menu the person described earlier in this conversation, in the order it is served):",
      ...courses,
      "Use it only to understand the question, which may be about one of these courses or the menu as a whole. Answer the question itself in the usual way; do not plan the whole menu again unless the question asks for it. If the question is about something else, ignore the menu.",
    ].join("\n");
  return [
    "Menu (the person's courses, in the order they are served):",
    ...courses,
    ...(menu.cut ? ["(The person named more courses; plan these.)"] : []),
    'For this menu, fill "courses": exactly one entry per numbered course, in this order, with its number in "course". "ref": the ref of the ONE wine from the cellar list that suits that course best, or null when nothing in the cellar suits it. Choose a different wine for each course; pour the same wine with two courses only when nothing else in the cellar suits as well. Where the courses allow it, go from lighter to fuller wines. "why": one short sentence on why it suits that course (or why nothing in the cellar does), in the answer\'s language. Put the chosen refs in bottle_refs too, in course order. Keep "answer" to one or two sentences about the menu as a whole: the courses are shown one by one below it.',
  ].join("\n");
}

/** The two wines the person asks to choose between, and how to answer. */
export function compareBlock(refs: readonly [string, string]): string {
  return [
    `Compare: the person asks to choose between two wines from the cellar list: ${refs[0]} and ${refs[1]}.`,
    "Judge both honestly for what the question is about. Say which one you would open and why, and in a few words what the other would do. Put both refs in bottle_refs, the one you would open first. If neither really suits, say so plainly, and still put both refs in bottle_refs, the closer one first.",
  ].join("\n");
}

/** One course of the plan, as the model returns it. */
const COURSES_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    required: ["course", "ref", "why"],
    properties: {
      course: { type: "integer" },
      ref: { anyOf: [{ type: "string" }, { type: "null" }] },
      why: { type: "string" },
    },
  },
} as const;

/** V1's schema (v6, or v7 with `check`) with a required `courses` list: only for a new menu. */
export function withMenuSchema<S extends object>(base: S): object {
  const b = base as { properties?: Record<string, unknown>; required?: readonly string[] };
  return {
    ...base,
    required: [...(b.required ?? []).filter((r) => r !== "courses"), "courses"],
    properties: { ...b.properties, courses: COURSES_SCHEMA },
  };
}

/** The longest list of course entries read, and the longest reason (the domain cuts it further). */
const MAX_ENTRIES = 64;
const MAX_WHY = 1000;

/**
 * The model's `courses`, read leniently: from the whole answer object or the list itself. An entry that is not one
 * is left out (never a thrown error: a bad menu list must not cost the person V1's answer). Whether a ref is real
 * is checked later, against the list the model was shown (checkMenuAnswer).
 */
export function parseMenuCourses(
  value: unknown,
): Array<{ course: number; ref: string | null; why: string }> {
  const list = Array.isArray(value)
    ? value
    : typeof value === "object" &&
        value !== null &&
        Array.isArray((value as { courses?: unknown }).courses)
      ? (value as { courses: unknown[] }).courses
      : [];
  const out: Array<{ course: number; ref: string | null; why: string }> = [];
  for (const entry of list.slice(0, MAX_ENTRIES)) {
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as Record<string, unknown>;
    const course =
      typeof e.course === "number"
        ? e.course
        : typeof e.course === "string" && /^\s*\d{1,3}\s*$/.test(e.course)
          ? Number(e.course)
          : NaN;
    if (!Number.isInteger(course)) continue;
    const ref =
      typeof e.ref === "string" && e.ref.trim() !== "" && e.ref.trim().toLowerCase() !== "null"
        ? e.ref.trim().slice(0, 64)
        : null;
    const why = typeof e.why === "string" ? e.why.slice(0, MAX_WHY) : "";
    out.push({ course, ref, why });
  }
  return out;
}
