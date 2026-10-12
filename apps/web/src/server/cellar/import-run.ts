import "server-only";
import { DomainError, normalizeText, type ImportOutcome, type ImportPlan } from "@cellr/domain";
import type { ActiveHousehold, CellarRepository, NewBottle } from "./types";

/** The most one import will bring in; the cellar screens are built for a few thousand bottles. */
export const MAX_IMPORT_BOTTLES = 5000;

const BOTTLE_CHUNK = 500;
/** Ids travel in the address of a request, so they go in modest batches. */
const ID_CHUNK = 100;
const PARALLEL = 6;

/** Runs `work` over `items`, a few at a time, in order of appearance. */
async function mapLimit<T>(items: readonly T[], limit: number, work: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await work(items[next++]!);
    }),
  );
}

const chunks = <T>(items: readonly T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
    items.slice(i * size, (i + 1) * size),
  );

const vintageKey = (wineKey: string, year: number | null) => `${wineKey}|${year ?? "nv"}`;
const producerKey = (producer: string, countryCode: string | null) =>
  `${normalizeText(producer)}|${countryCode ?? ""}`;

/**
 * Writes an import plan, as the signed-in person (so row-level security applies to every row). Places, wines
 * and vintages are found-or-created, so running it again never duplicates the catalogue; the bottles
 * themselves go in as one batch per 500, and if anything fails after the first of them, the bottles and
 * places this run made are taken away again, so a retry starts clean.
 */
export async function runImport(
  repo: CellarRepository,
  household: ActiveHousehold,
  userId: string,
  plan: ImportPlan,
): Promise<NonNullable<ImportOutcome["written"]>> {
  if (plan.bottles.length > MAX_IMPORT_BOTTLES)
    throw new DomainError(
      "VALIDATION",
      `That is more than we can bring in at once (${plan.bottles.length} bottles, the limit is ${MAX_IMPORT_BOTTLES}).`,
    );
  const hid = household.id;

  // ---- The catalogue first: it is harmless to keep if something later fails -----------------------------
  const producerIds = new Map<string, string>();
  const producers = new Map(
    plan.wines.map((w) => [producerKey(w.producer, w.countryCode), w] as const),
  );
  await mapLimit([...producers.entries()], PARALLEL, async ([key, w]) => {
    producerIds.set(key, await repo.findOrCreateProducer(hid, w.producer, w.countryCode));
  });

  const wineIds = new Map<string, string>();
  await mapLimit(plan.wines, PARALLEL, async (w) => {
    const wine = await repo.findOrCreateWine(
      hid,
      producerIds.get(producerKey(w.producer, w.countryCode))!,
      {
        producer: w.producer,
        name: w.name,
        type: w.type,
        ...(w.countryCode ? { countryCode: w.countryCode } : {}),
        ...(w.region ? { region: w.region } : {}),
        appellation: w.appellation,
      },
    );
    wineIds.set(w.key, wine.id);
  });

  const vintageIds = new Map<string, string>();
  const wanted = new Map<string, { wineKey: string; year: number | null }>();
  for (const b of plan.bottles) wanted.set(vintageKey(b.wineKey, b.year), b);
  for (const t of plan.tastings) wanted.set(vintageKey(t.wineKey, t.year), t);
  await mapLimit([...wanted.entries()], PARALLEL, async ([key, v]) => {
    vintageIds.set(key, await repo.findOrCreateVintage(wineIds.get(v.wineKey)!, v.year));
  });

  // ---- Places and bottles: undone again if anything goes wrong -------------------------------------------------
  const createdUnits: string[] = [];
  const createdBottles: string[] = [];
  try {
    const taken = new Set((await repo.listStorage(hid)).map((u) => u.label.toLowerCase()));
    const unitIds = new Map<string, string>();
    for (const unit of plan.units) {
      let label = unit.label.slice(0, 40);
      for (let n = 2; taken.has(label.toLowerCase()); n++) {
        const suffix = ` (${n})`;
        label = `${unit.label.slice(0, 40 - suffix.length)}${suffix}`;
      }
      taken.add(label.toLowerCase());
      const created = await repo.createStorage(hid, {
        label,
        kind: unit.kind,
        rows: unit.rows,
        cols: unit.cols,
      });
      createdUnits.push(created.id);
      unitIds.set(unit.key, created.id);
    }

    const rows: NewBottle[] = plan.bottles.map((b) => ({
      vintageId: vintageIds.get(vintageKey(b.wineKey, b.year))!,
      formatMl: b.formatMl,
      locationId: b.unitKey ? (unitIds.get(b.unitKey) ?? null) : null,
      row: b.unitKey ? b.row : null,
      col: b.unitKey ? b.col : null,
      priceCents: b.priceCents,
      currency: b.priceCents === null ? null : household.currency,
      purchasedAt: b.purchasedAt,
      purchasedFrom: b.purchasedFrom,
      notes: b.notes,
    }));
    const bottleIds: string[] = [];
    for (const batch of chunks(rows, BOTTLE_CHUNK)) {
      const ids = await repo.insertBottles(hid, batch);
      createdBottles.push(...ids);
      if (ids.length !== batch.length)
        throw new DomainError("INTERNAL", "The import came out uneven, so it was taken back.");
      bottleIds.push(...ids);
    }
    const idOf = new Map(plan.bottles.map((b, i) => [b.key, bottleIds[i]!] as const));

    // The ones that were drunk long ago: opened, on the day they were opened.
    const byDay = new Map<string | null, string[]>();
    for (const b of plan.bottles) {
      if (b.status !== "opened") continue;
      byDay.set(b.openedAt, [...(byDay.get(b.openedAt) ?? []), idOf.get(b.key)!]);
    }
    const opening = [...byDay.entries()].flatMap(([day, ids]) =>
      chunks(ids, ID_CHUNK).map((batch) => [day, batch] as const),
    );
    await mapLimit(opening, PARALLEL, async ([day, ids]) => {
      await repo.markOpened(hid, ids, day);
    });

    // ---- Stars and opinions: one statement each, so they are in completely or not at all -----------------------
    const tastingRows = plan.tastings.map((t) => ({
      householdId: hid,
      vintageId: vintageIds.get(vintageKey(t.wineKey, t.year))!,
      bottleId: t.bottleKey ? (idOf.get(t.bottleKey) ?? null) : null,
      score: t.score,
      note: t.note,
      tastedAt: t.tastedAt,
    }));
    const starred = plan.wines.filter((w) => w.favorite).map((w) => wineIds.get(w.key)!);
    await repo.addFavorites(userId, starred);
    const tastings = await repo.insertTastings(tastingRows);

    return {
      units: createdUnits.length,
      wines: plan.wines.length,
      bottles: plan.bottles.filter((b) => b.status === "in_cellar").length,
      opened: plan.bottles.filter((b) => b.status === "opened").length,
      tastings: tastings ?? 0,
      favorites: starred.length,
      tastingsSkipped: tastings === null && tastingRows.length > 0,
    };
  } catch (error) {
    // Best effort: the original error is what the person needs to hear about.
    try {
      for (const batch of chunks(createdBottles, ID_CHUNK)) await repo.deleteBottles(hid, batch);
      for (const id of createdUnits) await repo.deleteStorage(hid, id);
    } catch {
      // Nothing more to be done here.
    }
    throw error;
  }
}
