import { z } from "zod";
import type { WineType } from "./cellar";
import type { ResolvedStorage } from "./storage-compat";
import { zoneOfRow, type StorageZone } from "./storage-config";
import {
  cellChoices,
  placementMeaning,
  placementProblem,
  sameSpot,
  type Occupant,
  type PlacementMeaning,
  type SmartSpot,
} from "./storage-placement";

/**
 * SMART PLACEMENT INTELLIGENCE (Smart Cellar 3D, sprint 5; ADR-009). Where should THIS bottle go in THIS cellar, and
 * why? Pure and deterministic: explicit input in, a ranked, explained answer out. It never writes anything.
 *
 * Two stages, never mixed:
 *   1. HARD ELIGIBILITY, which is Sprint 4's and nothing else: a candidate is a spot `cellChoices` marks free (or a
 *      compartment's next counter) AND that `placementProblem` accepts, with the same moving bottle and depth switch.
 *      No second idea of what is free, in reach, in bounds or allowed exists here.
 *   2. SOFT RANKING over those candidates, with fixed, documented weights (ADR-009 §3) and stable tie-breaks.
 *
 * Every reason is a code plus the very evidence that produced it (a count, a zone, a type). A reason is emitted only by
 * the branch that used that fact, so without the fact there is no reason. Temperatures are what someone SET, never
 * what was measured: they are described, never scored.
 */

export const ADVICE_INTENTS = ["store", "serve"] as const;
export type AdviceIntent = (typeof ADVICE_INTENTS)[number];
export const AdviceIntentSchema = z.enum(ADVICE_INTENTS);

/** Weights (ADR-009 §3). Changing one changes advice for everybody: keep the ADR in step. */
export const ADVICE_WEIGHTS = {
  purposeMatch: 40,
  purposeMismatch: -20,
  group: {
    vintage: { neighbour: 30, shelf: 20, place: 12 },
    wine: { neighbour: 18, shelf: 12, place: 8 },
    producer: { neighbour: 10, shelf: 6, place: 4 },
    type: { neighbour: 4, shelf: 3, place: 2 },
  },
  /** A free spot must beat the bottle's current spot by MORE than this to be worth a move. */
  moveMargin: 10,
} as const;

export const ADVICE_LIMITS = { recommendations: 3, alternatives: 5 } as const;

/** The bottle advice is asked for: database facts only (ids, type, year), never inferred from its name. */
export interface AdviceBottle {
  bottleId: string;
  inCellar: boolean;
  vintageId: string;
  /** Null when the catalogue row can't be read here (another household's provisional wine): then never "related". */
  wineId: string | null;
  producerId: string | null;
  type: WineType | null;
  /** Null: non-vintage, or not known. */
  year: number | null;
  /** Where it is now (null: no place). */
  current: SmartSpot | null;
  /** Where a drinking window came from, if CELLR has one. It is never used to rank (ADR-009 §1). */
  drinkWindowSource?: "estimate" | "ai" | "own" | null;
}

/** A bottle on a spot in the household, with the ids grouping compares. */
export interface AdviceOccupant {
  bottleId: string;
  locationId: string;
  row: number;
  col: number;
  index: number;
  vintageId: string;
  /**
   * Null when this person can't read the bottle's catalogue rows (RLS): the bottle still occupies its spot (eligibility
   * never depends on these), it just isn't counted as related.
   */
  wineId: string | null;
  producerId: string | null;
  type: WineType | null;
}

/** A place of the household, already resolved by `resolveStorage`, in the order the app lists places. */
export interface AdvicePlace {
  id: string;
  label: string;
  resolved: ResolvedStorage;
}

export interface AdviceInput {
  bottle: AdviceBottle;
  places: readonly AdvicePlace[];
  occupants: readonly AdviceOccupant[];
  intent: AdviceIntent;
  /** Whether a bottle may be placed past index 1 (Sprint 4: false). */
  depthEnabled: boolean;
}

export type GroupTier = "vintage" | "wine" | "producer" | "type";
export type Proximity = "neighbour" | "shelf" | "place";

/** Why a spot was chosen (each with its evidence). */
export type AdviceReason =
  | { code: "purpose_match"; purpose: "storage" | "serving"; zone: number }
  | { code: "group"; tier: GroupTier; proximity: Proximity; count: number; type?: WineType }
  | { code: "front_reachable" }
  | { code: "zone_target"; zone: number; targetTempC: number }
  | { code: "free_now" }
  | { code: "current_spot" };

/** What limits the advice (each with its evidence). */
export type AdviceCaveat =
  | { code: "purpose_mismatch"; purpose: "storage" | "serving"; zone: number }
  | { code: "zone_target"; zone: number; targetTempC: number }
  | { code: "temperature_not_measured" }
  | { code: "zone_no_target"; zone: number }
  | { code: "no_zone" }
  | { code: "compartment_counter" }
  | { code: "no_matching_zone"; purpose: "storage" | "serving" }
  | { code: "estimated_window_not_used" }
  | { code: "vintage_unknown" }
  | { code: "no_grouping_evidence" };

export type AdviceClass = "strong" | "reasonable" | "limited";

export interface AdviceSpot {
  /** The whole spot, exactly as the move API takes it. */
  spot: SmartSpot;
  placeLabel: string;
  meaning: Exclude<PlacementMeaning, "unknown">;
  zone: (StorageZone & { number: number }) | null;
  reasons: AdviceReason[];
  caveats: AdviceCaveat[];
  suitability: AdviceClass;
  /** Live: a placement through the Sprint 4 API is allowed here now. Always true for a recommendation. */
  actionable: true;
  /** For ordering and debugging only; never shown as a percentage. */
  score: number;
  /** Other free spots that are exactly as suitable (same place, same reasons, same score). */
  equivalent: number;
  rank: number;
}

export interface AdviceExcluded {
  /** Spots someone else's bottle is on. */
  occupied: number;
  /** Spots past index 1 while depth placement is off. */
  depthOff: number;
  /** Depth: free, but behind a bottle at the front. */
  behind: number;
  /** Compartments with no free counter. */
  fullCompartments: number;
  /** Places whose arrangement CELLR doesn't know (never advised on). */
  unknownPlaces: number;
}

export interface AdviceResult {
  status: "ok" | "not_in_cellar" | "no_places" | "no_eligible";
  intent: AdviceIntent;
  /**
   * The bottle's own spot, when no free spot beats it by a clear margin (no move is advised). `stayKind` says how
   * that may be worded: "suitable" only when the spot itself has positive evidence and no conflict; otherwise
   * "nothing_better" (nothing free is clearly better than where it is: no claim that where it is, is good).
   */
  stay: AdviceSpot | null;
  stayKind: "suitable" | "nothing_better" | null;
  recommendations: AdviceSpot[];
  alternatives: AdviceSpot[];
  /** How many free spots exist in all (every one of them may be chosen by hand). */
  eligible: number;
  excluded: AdviceExcluded;
  caveats: AdviceCaveat[];
}

// ---- Engine ---------------------------------------------------------------------------------------------------------

type Candidate = Omit<AdviceSpot, "rank" | "equivalent" | "actionable"> & {
  placeOrder: number;
  signature: string;
  /** Sprint 4's own check of this exact spot (placementProblem), run for every spot that is returned. */
  allowed?: () => boolean;
};

const TIERS: readonly GroupTier[] = ["vintage", "wine", "producer", "type"];

/** Whether an occupant shares `tier` with the bottle, exclusively (a same-vintage bottle is not also "same wine"). */
function sharesTier(tier: GroupTier, b: AdviceBottle, o: AdviceOccupant): boolean {
  switch (tier) {
    case "vintage":
      return o.vintageId === b.vintageId;
    case "wine":
      return b.wineId !== null && o.wineId === b.wineId && o.vintageId !== b.vintageId;
    case "producer":
      return b.producerId !== null && o.producerId === b.producerId && o.wineId !== b.wineId;
    case "type":
      return b.type !== null && o.type === b.type && o.producerId !== b.producerId;
  }
}

/**
 * Per place, once: for each tier, how many related bottles are in each cell and on each shelf, and in all. A spot's
 * grouping then looks at nine cells and one shelf, never at every bottle again (O(bottles + spots), not their product).
 */
interface GroupIndex {
  cells: Record<GroupTier, Map<string, number>>;
  shelves: Record<GroupTier, Map<number, number>>;
  total: Record<GroupTier, number>;
}

function groupIndex(bottle: AdviceBottle, inPlace: readonly AdviceOccupant[]): GroupIndex {
  const index: GroupIndex = {
    cells: { vintage: new Map(), wine: new Map(), producer: new Map(), type: new Map() },
    shelves: { vintage: new Map(), wine: new Map(), producer: new Map(), type: new Map() },
    total: { vintage: 0, wine: 0, producer: 0, type: 0 },
  };
  for (const o of inPlace) {
    if (o.bottleId === bottle.bottleId) continue;
    for (const tier of TIERS) {
      if (!sharesTier(tier, bottle, o)) continue;
      const cell = `${o.row}:${o.col}`;
      index.cells[tier].set(cell, (index.cells[tier].get(cell) ?? 0) + 1);
      index.shelves[tier].set(o.row, (index.shelves[tier].get(o.row) ?? 0) + 1);
      index.total[tier]++;
    }
  }
  return index;
}

/** The strongest grouping a spot offers: first by points, then the more specific tier. Null: no evidence. */
function bestGroup(
  bottle: AdviceBottle,
  index: GroupIndex,
  row: number,
  col: number,
): Extract<AdviceReason, { code: "group" }> | null {
  let best: Extract<AdviceReason, { code: "group" }> | null = null;
  let bestPoints = 0;
  for (const tier of TIERS) {
    if (index.total[tier] === 0) continue;
    let neighbour = 0;
    for (let r = row - 1; r <= row + 1; r++)
      for (let c = col - 1; c <= col + 1; c++) neighbour += index.cells[tier].get(`${r}:${c}`) ?? 0;
    const shelf = index.shelves[tier].get(row) ?? 0;
    const [proximity, count]: [Proximity, number] =
      neighbour > 0
        ? ["neighbour", neighbour]
        : shelf > 0
          ? ["shelf", shelf]
          : ["place", index.total[tier]];
    const points = ADVICE_WEIGHTS.group[tier][proximity];
    if (points > bestPoints) {
      bestPoints = points;
      best = {
        code: "group",
        tier,
        proximity,
        count,
        ...(tier === "type" && bottle.type !== null ? { type: bottle.type } : {}),
      };
    }
  }
  return best;
}

const groupPoints = (g: Extract<AdviceReason, { code: "group" }> | null) =>
  g ? ADVICE_WEIGHTS.group[g.tier][g.proximity] : 0;

/** Scores one spot (free or the bottle's own) with every reason and caveat the input supports. */
function judgeSpot(
  input: AdviceInput,
  place: AdvicePlace,
  placeOrder: number,
  groups: GroupIndex,
  spot: SmartSpot,
  meaning: Exclude<PlacementMeaning, "unknown">,
  isCurrent: boolean,
): Candidate {
  const { bottle, intent } = input;
  const zones = place.resolved.structure.zones;
  const zoneRaw = zoneOfRow(zones, spot.row);
  const zone = zoneRaw ? { ...zoneRaw, number: zones.indexOf(zoneRaw) + 1 } : null;
  const reasons: AdviceReason[] = [];
  const caveats: AdviceCaveat[] = [];
  let score = 0;

  // A. declared purpose against the person's intent
  const wanted = intent === "store" ? "storage" : "serving";
  if (zone) {
    if (zone.purpose === wanted) {
      score += ADVICE_WEIGHTS.purposeMatch;
      reasons.push({ code: "purpose_match", purpose: zone.purpose, zone: zone.number });
    } else {
      score += ADVICE_WEIGHTS.purposeMismatch;
      caveats.push({ code: "purpose_mismatch", purpose: zone.purpose, zone: zone.number });
    }
    // B. a target temperature is described, never scored: it is a setting, not a reading. Listed with the reasons only
    // where the zone is the one chosen for; in a zone for the other purpose it is just a fact about that zone.
    if (zone.targetTempC !== null) {
      const target = {
        code: "zone_target",
        zone: zone.number,
        targetTempC: zone.targetTempC,
      } as const;
      if (zone.purpose === wanted) reasons.push(target);
      else caveats.push(target);
      caveats.push({ code: "temperature_not_measured" });
    } else caveats.push({ code: "zone_no_target", zone: zone.number });
  } else caveats.push({ code: "no_zone" });

  // C. grouping, by stable ids, the strongest only
  const group = bestGroup(bottle, groups, spot.row, spot.col);
  score += groupPoints(group);
  if (group) reasons.push(group);
  else caveats.push({ code: "no_grouping_evidence" });

  // D. reach, only where the model knows it: the front of a depth cell
  if (meaning === "depth" && spot.index === 1) reasons.push({ code: "front_reachable" });
  if (meaning === "ordinal") caveats.push({ code: "compartment_counter" });

  reasons.push(isCurrent ? { code: "current_spot" } : { code: "free_now" });

  const strongGroup =
    group !== null &&
    (group.tier === "vintage" || group.tier === "wine") &&
    group.proximity !== "place";
  const matched = reasons.some((r) => r.code === "purpose_match");
  const mismatched = caveats.some((c) => c.code === "purpose_mismatch");
  const suitability: AdviceClass =
    !mismatched && (matched || strongGroup)
      ? "strong"
      : score > 0 || group
        ? "reasonable"
        : "limited";

  const signature = [
    place.id,
    score,
    zone?.number ?? 0,
    ...reasons.map((r) => (r.code === "group" ? `${r.tier}:${r.proximity}:${r.count}` : r.code)),
  ].join("|");
  return {
    spot,
    placeLabel: place.label,
    meaning,
    zone,
    reasons,
    caveats,
    suitability,
    score,
    placeOrder,
    signature,
  };
}

/** How many related bottles the spot's grouping reason counts (0: none): more company first, at the same score. */
const groupCount = (c: Candidate) => {
  const g = c.reasons.find((r) => r.code === "group");
  return g && g.code === "group" ? g.count : 0;
};

const compareCandidates = (a: Candidate, b: Candidate) =>
  b.score - a.score ||
  groupCount(b) - groupCount(a) ||
  a.placeOrder - b.placeOrder ||
  a.spot.row - b.spot.row ||
  a.spot.col - b.spot.col ||
  a.spot.index - b.spot.index;

const finish = (c: Candidate, rank: number, equivalent: number): AdviceSpot => ({
  spot: c.spot,
  placeLabel: c.placeLabel,
  meaning: c.meaning,
  zone: c.zone,
  reasons: c.reasons,
  caveats: c.caveats,
  suitability: c.suitability,
  actionable: true,
  score: c.score,
  equivalent,
  rank,
});

/** Where this bottle could go, ranked and explained. Same input, same answer. */
export function adviseStorage(input: AdviceInput): AdviceResult {
  const { bottle, places, intent, depthEnabled } = input;
  const excluded: AdviceExcluded = {
    occupied: 0,
    depthOff: 0,
    behind: 0,
    fullCompartments: 0,
    unknownPlaces: 0,
  };
  const empty = (status: AdviceResult["status"], caveats: AdviceCaveat[] = []): AdviceResult => ({
    status,
    intent,
    stay: null,
    stayKind: null,
    recommendations: [],
    alternatives: [],
    eligible: 0,
    excluded,
    caveats,
  });
  if (!bottle.inCellar) return empty("not_in_cellar");
  if (places.length === 0) return empty("no_places");

  // occupants by place, once (a place id the household doesn't have is simply never looked at)
  const byPlace = new Map<string, AdviceOccupant[]>();
  for (const o of input.occupants) {
    const list = byPlace.get(o.locationId);
    if (list) list.push(o);
    else byPlace.set(o.locationId, [o]);
  }

  const candidates: Candidate[] = [];
  let current: Candidate | null = null;
  places.forEach((place, placeOrder) => {
    const meaning = placementMeaning(place.resolved);
    if (meaning === "unknown") {
      excluded.unknownPlaces++;
      return;
    }
    const inPlace = byPlace.get(place.id) ?? [];
    const groups = groupIndex(bottle, inPlace);
    const occupants: Occupant[] = inPlace.map((o) => ({
      bottleId: o.bottleId,
      row: o.row,
      col: o.col,
      index: o.index,
    }));
    const options = { movingId: bottle.bottleId, depthEnabled };
    for (const cell of cellChoices(place.resolved, occupants, options)) {
      const targets =
        meaning === "ordinal"
          ? cell.next
            ? // the bottle's own compartment, at its own counter, is where it is: not a destination
              bottle.current && sameSpot(bottle.current, { locationId: place.id, ...cell.next })
              ? []
              : [cell.next]
            : // no next counter: full, or (while depth is off) holding a bottle already
              cell.free > 0
              ? (excluded.depthOff++, [])
              : (excluded.fullCompartments++, [])
          : cell.spots.flatMap((s) => {
              if (s.state === "free") return [s.address];
              if (s.state === "taken") excluded.occupied++;
              else if (s.state === "depth_off") excluded.depthOff++;
              else if (s.state === "behind") excluded.behind++;
              else if (s.state === "current")
                current = judgeSpot(
                  input,
                  place,
                  placeOrder,
                  groups,
                  { locationId: place.id, ...s.address },
                  meaning,
                  true,
                );
              return [];
            });
      for (const address of targets) {
        const candidate = judgeSpot(
          input,
          place,
          placeOrder,
          groups,
          { locationId: place.id, ...address },
          meaning,
          false,
        );
        // Sprint 4's own check, once more, with the same options: nothing it refuses is ever returned. Run when the
        // spot is about to be returned (below), not for every free spot: it reads every bottle of the place each time.
        candidate.allowed = () =>
          placementProblem(place.resolved, occupants, address, options) === null;
        candidates.push(candidate);
      }
    }
    // a bottle in a compartment: its own spot is its current one (ordinal cells list no spots)
    if (
      meaning === "ordinal" &&
      bottle.current &&
      bottle.current.locationId === place.id &&
      inPlace.some((o) => o.bottleId === bottle.bottleId)
    )
      current = judgeSpot(input, place, placeOrder, groups, bottle.current, meaning, true);
  });

  // result-level caveats, each from a fact
  const caveats: AdviceCaveat[] = [];
  const wanted = intent === "store" ? "storage" : "serving";
  if (
    !places.some(
      (p) =>
        placementMeaning(p.resolved) !== "unknown" &&
        p.resolved.structure.zones.some((z) => z.purpose === wanted),
    )
  )
    caveats.push({ code: "no_matching_zone", purpose: wanted });
  if (bottle.drinkWindowSource === "estimate" || bottle.drinkWindowSource === "ai")
    caveats.push({ code: "estimated_window_not_used" });
  if (bottle.year === null) caveats.push({ code: "vintage_unknown" });

  candidates.sort(compareCandidates);
  // distinct options first; spots exactly as good as a chosen one are counted with it, not listed again
  const picked: Candidate[] = [];
  const equivalents = new Map<string, number>();
  const pickedSignatures = new Set<string>();
  for (const c of candidates) {
    if (pickedSignatures.has(c.signature)) {
      equivalents.set(c.signature, (equivalents.get(c.signature) ?? 0) + 1);
      continue;
    }
    if (picked.length >= ADVICE_LIMITS.recommendations + ADVICE_LIMITS.alternatives) continue;
    // Sprint 4's check, for each spot that is returned (a refused one is skipped, never returned)
    if (c.allowed && !c.allowed()) continue;
    picked.push(c);
    pickedSignatures.add(c.signature);
  }
  const ranked = picked.map((c, i) => finish(c, i + 1, equivalents.get(c.signature) ?? 0));

  const here = current as Candidate | null;
  // the best spot that passed Sprint 4's check (the one that would actually be advised)
  const best = picked[0];
  const stay =
    here && (!best || best.score <= here.score + ADVICE_WEIGHTS.moveMargin)
      ? finish(here, 0, 0)
      : null;
  const stayKind: AdviceResult["stayKind"] = !stay
    ? null
    : stay.suitability !== "limited" && !stay.caveats.some((c) => c.code === "purpose_mismatch")
      ? "suitable"
      : "nothing_better";

  return {
    status: picked.length === 0 && !stay ? "no_eligible" : "ok",
    intent,
    stay,
    stayKind,
    recommendations: ranked.slice(0, ADVICE_LIMITS.recommendations),
    alternatives: ranked.slice(ADVICE_LIMITS.recommendations),
    eligible: candidates.length,
    excluded,
    caveats,
  };
}

/**
 * GET /api/v1/smart-cellar/bottles/:id/recommendations?intent=store|serve. The engine's answer, plus whether this
 * deployment lets the person act on it (the Sprint 4 placement gate and write target; advice itself writes nothing).
 */
export interface SmartAdviceView extends AdviceResult {
  bottleId: string;
  canPlace: boolean;
}
