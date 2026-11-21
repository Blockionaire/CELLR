import type { Scenario } from "./types";
import { ADVANCED_SCENARIOS } from "./scenarios-advanced";
import { PAIRING_SCENARIOS } from "./scenarios-pairing";

/** Every scenario of the benchmark. New ones are added to the two files; an id is never reused or renumbered. */
export const SCENARIOS: readonly Scenario[] = [...PAIRING_SCENARIOS, ...ADVANCED_SCENARIOS];
