import "server-only";
import type { CellarItem, GuardShadowCounts } from "@cellr/domain";
import {
  FOOD,
  GUARD_VERSION,
  WINE_KNOWLEDGE,
  guardPicks,
  parseFood,
  readWine,
} from "@cellr/domain/intelligence";

/**
 * VARIANT E IN SHADOW MODE (S11, switch `sommelier_v1_guard`, off). After V1 has answered, the guard looks at the
 * bottles it offered and says which it would hold back for a hard clash with the dish. Nothing about the answer
 * changes: what it would have done is handed back as counts (`GuardShadowCounts`), for the screen to count with
 * the answer's own analytics event.
 *
 * It runs here, in code, on what the person typed and the wines V1 already chose: no model is asked, nothing is
 * read from the database, nothing is kept.
 */
export interface GuardShadow extends GuardShadowCounts {
  /** The flagged bottles, for the benchmark. Never sent to the screen or counted anywhere. */
  flaggedIds: string[];
}

/** The latest of the person's own turns that names a dish, as the parser reads it (at most 800 characters). */
function dishOf(userTexts: readonly string[]) {
  for (let i = userTexts.length - 1; i >= 0; i -= 1) {
    const food = parseFood(userTexts[i]!.slice(0, 800), FOOD);
    if (food.main !== null) return food;
  }
  return null;
}

export function guardShadow(
  userTexts: readonly string[],
  offered: readonly CellarItem[],
): GuardShadow {
  const verdict = guardPicks(
    dishOf(userTexts),
    offered.map((item) => ({
      item,
      wine: {
        // The wine as the engines read it without a researched profile: the guard reads nothing more.
        ...readWine(
          {
            type: item.type,
            name: item.wineName,
            region: item.region,
            appellation: item.appellation ?? null,
            countryCode: item.countryCode,
            profile: null,
          },
          WINE_KNOWLEDGE,
        ),
        type: item.type,
      },
    })),
  );
  return {
    version: GUARD_VERSION,
    considered: verdict.considered,
    bottles: offered.length,
    flagged: verdict.flagged.length,
    first: verdict.flagged.some((f) => f.index === 0),
    flaggedIds: verdict.flagged.map((f) => f.item.vintageId),
  };
}

/** The counts alone, for the reply: what may leave the server. */
export const shadowCounts = ({
  version,
  considered,
  bottles,
  flagged,
  first,
}: GuardShadow): GuardShadowCounts => ({ version, considered, bottles, flagged, first });
