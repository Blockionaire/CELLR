/**
 * THE GUARD, WINE BY WINE (S11, variant E). For every pairing scenario of a set, every wine in its cellar is put to
 * the guard (`guardPicks`) as if it had been offered, and what the guard would flag is counted against the
 * reference card's label (good, ok, poor). This is the guard's own error rate, apart from which wines a model
 * happens to pick: how many good and acceptable wines it would hold back (false blocks), and how many poor ones it
 * catches.
 *
 *   pnpm --filter @cellr/sommelier-eval run guard-study [--set main|holdout-dev|holdout-test] [--json out.json]
 *
 * On the main set (where the settings are chosen) every setting is shown. On any other set only the frozen
 * settings of GUARD_VERSION are run: an unseen set is measured, never tuned on. A set holding blind scenarios is
 * reported in totals only (which is all this prints).
 */
import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import {
  FOOD,
  GUARD_SETTINGS,
  GUARD_VERSION,
  WINE_KNOWLEDGE,
  guardPicks,
  parseFood,
  readWine,
  type GuardSettings,
} from "@cellr/domain/intelligence";
import { wineInput } from "./engines/v3";
import { buildFixture } from "./fixtures";
import { labelOf, type Label } from "./quality";
import { cardsOf, scenariosOf } from "./sets";

export interface GuardStudy {
  set: string;
  settings: GuardSettings;
  version: number;
  /** Pairing scenarios with a reference card. */
  scenarios: number;
  /** Of those, the ones whose dish the guard judged by (read with enough confidence). */
  considered: number;
  /** Every cellar wine of a considered scenario, by label: [put to the guard, flagged]. */
  byLabel: Record<Label, [number, number]>;
}

export function studyGuard(set: string, settings: GuardSettings): GuardStudy {
  const cards = cardsOf(set);
  const out: GuardStudy = {
    set,
    settings,
    version: GUARD_VERSION,
    scenarios: 0,
    considered: 0,
    byLabel: { good: [0, 0], ok: [0, 0], poor: [0, 0] },
  };
  for (const s of scenariosOf(set)) {
    if (!s.dish || !s.needs.every((n) => n === "pairing")) continue;
    const card = cards.get(s.dish);
    if (!card) continue;
    out.scenarios += 1;
    // The dish as the guard in the app reads it: the latest turn that names one.
    const food =
      [...s.turns]
        .reverse()
        .map((t) => parseFood(t.user.slice(0, 800), FOOD))
        .find((f) => f.main !== null) ?? null;
    const fixture = buildFixture(s);
    const verdict = guardPicks(
      food,
      fixture.wines.map((f) => ({
        item: f.key,
        wine: { ...readWine(wineInput(f), WINE_KNOWLEDGE), type: f.wine.type },
      })),
      settings,
    );
    if (!verdict.considered) continue;
    out.considered += 1;
    const flagged = new Set(verdict.flagged.map((x) => x.item));
    for (const f of fixture.wines) {
      const l = labelOf(card, f.key);
      out.byLabel[l][0] += 1;
      if (flagged.has(f.key)) out.byLabel[l][1] += 1;
    }
  }
  return out;
}

export function formatGuardStudy(g: GuardStudy): string {
  const pct = (a: number, b: number) => (b === 0 ? "—" : `${Math.round((100 * a) / b)}%`);
  const [goodN, goodF] = g.byLabel.good;
  const [okN, okF] = g.byLabel.ok;
  const [poorN, poorF] = g.byLabel.poor;
  const flagged = goodF + okF + poorF;
  return [
    `Set "${g.set}", guard v${g.version}, dish confidence at least ${g.settings.minConfidence}: judged ${g.considered} of ${g.scenarios} pairing scenarios.`,
    `  good wines flagged ${goodF} of ${goodN} (${pct(goodF, goodN)}); acceptable flagged ${okF} of ${okN} (${pct(okF, okN)}); poor flagged ${poorF} of ${poorN} (${pct(poorF, poorN)}).`,
    `  Of ${flagged} flagged wines, poor ${poorF} (${pct(poorF, flagged)}): the share of the guard's objections that are right.`,
  ].join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values: args } = parseArgs({
    options: { set: { type: "string", default: "main" }, json: { type: "string" } },
  });
  const settings: GuardSettings[] =
    args.set === "main"
      ? [{ minConfidence: "high" }, { minConfidence: "medium" }]
      : [GUARD_SETTINGS];
  const studies = settings.map((s) => studyGuard(args.set!, s));
  console.log(studies.map(formatGuardStudy).join("\n\n"));
  if (args.json) await writeFile(args.json, JSON.stringify(studies, null, 2) + "\n");
}
