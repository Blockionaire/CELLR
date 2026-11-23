/**
 * Sommelier V1+ release configuration (docs/sprints/sommelier-3-mega/SOMMELIER_CLOSEOUT.md §4.2, decision D-52).
 *
 * V1's model keeps choosing the wine. Each part adds something around that choice and can be switched on alone, in
 * any combination:
 *   check       the answer text and the buying claims are checked (P3)
 *   annotate    facts on V1's cards: drink now / keep, serving, reserved, where it lies (P4)
 *   quantities  bottles needed for a number of guests (P5)
 *   menu        a menu planned course by course, and comparisons (P6)
 *   fallback    the engines' plan when V1 has no model; built, not activated without a review (P7, D-49)
 *
 * Read from one environment variable, CELLR_SOMMELIER, as a comma list. Empty or unset means none: V1 exactly as it
 * was. It is deliberately not part of CELLR_FEATURES, so `all` there never turns any of it on, and it has no `all` of
 * its own: every part is named. An unknown name is ignored and reported, never guessed.
 */
export const SOMMELIER_PARTS = ["check", "annotate", "quantities", "menu", "fallback"] as const;

export type SommelierPart = (typeof SOMMELIER_PARTS)[number];

export interface SommelierParts {
  /** The parts switched on. Empty: V1 unchanged. */
  readonly on: ReadonlySet<SommelierPart>;
  /** Names that are not a part (a typo, or `all`): ignored. Reported so a deployment can be corrected. */
  readonly unknown: readonly string[];
}

const KNOWN: ReadonlySet<string> = new Set(SOMMELIER_PARTS);

export const NO_SOMMELIER_PARTS: SommelierParts = Object.freeze({
  on: new Set<SommelierPart>(),
  unknown: [],
});

/** Case and spaces are ignored; duplicates count once; anything beyond 200 characters is not read. */
export function parseSommelierParts(raw: string | null | undefined): SommelierParts {
  if (!raw || raw.trim() === "") return NO_SOMMELIER_PARTS;
  const names = [
    ...new Set(
      raw
        .slice(0, 200)
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  const on = new Set<SommelierPart>();
  const unknown: string[] = [];
  for (const name of names) {
    if (KNOWN.has(name)) on.add(name as SommelierPart);
    else unknown.push(name.slice(0, 40));
  }
  return Object.freeze({ on, unknown: Object.freeze(unknown) });
}

/** Whether one part is on. */
export function hasSommelierPart(parts: SommelierParts, part: SommelierPart): boolean {
  return parts.on.has(part);
}
