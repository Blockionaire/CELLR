import { sameSpot, type SmartBottleSpot, type SmartSpot } from "@cellr/domain";

/**
 * What an authoritative read says about a placement whose answer was lost (a network failure or a 5xx). Pure: the
 * read itself (GET /smart-cellar/bottles/:id, from the database, never from a cache) is done by the caller.
 *
 *   done       the bottle is where the request asked (for a take-off: in the cellar, without a place). It may have
 *              been this request or another person: so it is reported, but never with an Undo.
 *   unchanged  it is still exactly where the request saw it: the request did not apply. Trying again is safe.
 *   elsewhere  it is in the cellar, somewhere neither seen nor asked for (`now` null: it has no place now). Someone
 *              else moved it; nothing is claimed, and the screen takes this as the new source.
 *   gone       it is no longer in the cellar.
 *   unknown    the read did not answer: the outcome is not known, and is said so.
 */
export type Verdict =
  | { kind: "done"; now: SmartSpot | null }
  | { kind: "unchanged" }
  | { kind: "elsewhere"; now: SmartSpot | null }
  | { kind: "gone" }
  | { kind: "unknown" };

/** A read that answered, or one that did not. */
export type BottleRead = { ok: true; bottle: SmartBottleSpot } | { ok: false };

/**
 * One bottle moved from `from` to `to` (null: no place; a take-off is `to` null). `counters`: the target is a
 * compartment whose counter the server chose, so only the compartment has to match.
 */
export function judgeMove(
  read: BottleRead,
  from: SmartSpot | null,
  to: SmartSpot | null,
  { counters = false }: { counters?: boolean } = {},
): Verdict {
  if (!read.ok) return { kind: "unknown" };
  const { inCellar, spot } = read.bottle;
  if (!inCellar) return { kind: "gone" };
  const atTarget =
    to === null
      ? spot === null
      : spot !== null &&
        (counters
          ? spot.locationId === to.locationId && spot.row === to.row && spot.col === to.col
          : sameSpot(spot, to));
  if (atTarget) return { kind: "done", now: spot };
  if (sameSpot(spot, from)) return { kind: "unchanged" };
  return { kind: "elsewhere", now: spot };
}

/**
 * Two bottles swapped: `self` from `a` to `b`, `other` from `b` to `a`. Done only when BOTH are on each other's
 * spot; unchanged only when both are still where they were seen; anything else is someone else's doing.
 */
export function judgeSwap(
  self: BottleRead,
  other: BottleRead,
  a: SmartSpot,
  b: SmartSpot,
): Verdict {
  if (!self.ok || !other.ok) return { kind: "unknown" };
  if (!self.bottle.inCellar || !other.bottle.inCellar) return { kind: "gone" };
  const s = self.bottle.spot;
  const o = other.bottle.spot;
  if (sameSpot(s, b) && sameSpot(o, a)) return { kind: "done", now: s };
  if (sameSpot(s, a) && sameSpot(o, b)) return { kind: "unchanged" };
  return { kind: "elsewhere", now: s };
}
