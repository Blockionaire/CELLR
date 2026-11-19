/**
 * Recognition evaluation (Sprint 004B): "a label is read; is it a wine nobody in CELLR has added yet?" — the scan's
 * own steps, on the pilot data, without a model:
 *
 *   resolverQuery → searchableQuery → search (here: catalog_search_pilot, the ONLY way pilot records can be searched;
 *   service role, pilot/staging databases) → resolveWine over the CELLR candidates (unchanged identity rules) →
 *   suggestRecordsForReading over the provider records.
 *
 *   pnpm --filter @cellr/catalog-tools exec tsx recognition.ts --db <url> --household <uuid>
 *     --results <benchmark-results.json> [--canonical <n>] [--out <dir>]
 *
 * Readings per covered benchmark wine (the wine and the record the coverage step found for it):
 *   clean        producer, wine name, colour and country as printed
 *   misread      the same in capitals, accents lost, one letter dropped from the longest word (an OCR slip)
 *   producer     only the producer could be read (no wine name)
 * With --canonical n, the first n covered wines are first added as CANONICAL CELLR wines (in this throwaway pilot
 * database only, by the database owner, marked as pilot seeds): then the CELLR wine must be the exact candidate and the
 * scan must offer no record for it. The tool asserts the safety rules and exits non-zero when one is broken.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import {
  normalizeText,
  resolveWine,
  resolverQuery,
  searchableQuery,
  suggestRecordsForReading,
  toSearchHit,
  WINE_TYPES,
  type CatalogSearchRow,
  type LabelFacts,
  type WineSummary,
  type WineType,
} from "@cellr/domain";
import { parseArgs, str } from "./lib";
import { connectToTarget } from "./target";

interface Covered {
  id: string;
  query: string;
  expect: { producer: string; wine: string; type: WineType; country: string | null };
  coverage: string;
  exact: Array<{
    external_id: string;
    producer: string;
    name: string;
    type: string | null;
    country: string | null;
  }>;
  target_ids: string[];
}

const READINGS = ["clean", "misread", "producer"] as const;
type Reading = (typeof READINGS)[number];

/** An OCR slip: capitals, accents lost, one letter dropped from the longest word (deterministic). */
export function misread(text: string): string {
  const words = normalizeText(text).toUpperCase().split(" ");
  let at = 0;
  words.forEach((w, i) => {
    if (w.length > words[at]!.length) at = i;
  });
  const w = words[at]!;
  if (w.length >= 5)
    words[at] = w.slice(0, Math.floor(w.length / 2)) + w.slice(Math.floor(w.length / 2) + 1);
  return words.join(" ");
}

export function readingOf(e: Covered["expect"], kind: Reading): LabelFacts {
  const name = e.wine;
  return {
    producer: kind === "misread" ? misread(e.producer) : e.producer,
    name: kind === "producer" ? null : kind === "misread" ? misread(name) : name,
    year: null,
    nonVintage: false,
    type: e.type,
    countryCode: e.country,
    region: null,
    appellation: null,
    grapes: [],
    abv: null,
    volumeMl: null,
    confidence: { producer: "high", name: kind === "producer" ? "low" : "high", year: "low" },
  };
}

const wineOfRow = (r: CatalogSearchRow): WineSummary | null =>
  r.result_kind === "wine" &&
  r.wine_id &&
  (WINE_TYPES as readonly string[]).includes(r.wine_type ?? "")
    ? {
        id: r.wine_id,
        producer: r.producer,
        name: r.name,
        type: r.wine_type as WineType,
        countryCode: r.country_code,
        region: r.region,
        ...(r.verified && r.source !== "household"
          ? { catalog: true, aliases: r.matched_alias ? [r.matched_alias] : [] }
          : {}),
      }
    : null;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const household = str(args, "household");
  const results = JSON.parse(readFileSync(str(args, "results"), "utf8")) as { entries: Covered[] };
  const covered = results.entries.filter(
    (e) => e.target_ids.length > 0 && e.exact.length > 0 && e.expect?.producer,
  );
  const seeds = Number(str(args, "canonical", "0"));
  const client = await connectToTarget(str(args, "db"), args);
  try {
    const external = new Map(
      (
        await client.query<{ id: string; external_id: string }>(
          "select id, external_id from public.catalog_external_records where provider_id = 'xwines'",
        )
      ).rows.map((r) => [r.id, r.external_id]),
    );
    // pilot seeds: a few covered wines as canonical CELLR wines (owner SQL in a pilot database only)
    const seeded = new Map<string, string>(); // benchmark id → canonical wine id
    if (seeds > 0) {
      const env = (
        await client.query<{ id: { environment: string } }>(
          "select public.catalog_target_identity() as id",
        )
      ).rows[0]!.id.environment;
      if (env !== "pilot")
        throw new Error("canonical seeds are only written in a database marked pilot");
      await client.query("reset role");
      for (const e of covered.slice(0, seeds)) {
        // the identity as the producer writes it (what a curated CELLR wine holds), not the provider's spelling
        const r = {
          producer: e.expect.producer,
          name: e.expect.wine,
          type: e.expect.type,
          country: e.expect.country,
        };
        const p = await client.query<{ id: string }>(
          `insert into public.producers (name, country_code, status, origin) values ($1, $2, 'canonical', 'verified')
           on conflict do nothing returning id`,
          [r.producer, r.country],
        );
        const producerId =
          p.rows[0]?.id ??
          (
            await client.query<{ id: string }>(
              "select id from public.producers where status = 'canonical' and normalized_name = private.normalize_text($1)",
              [r.producer],
            )
          ).rows[0]!.id;
        const w = await client.query<{ id: string }>(
          `insert into public.wines (producer_id, name, wine_type, country_code, status, origin)
           values ($1, $2, $3::public.wine_type, $4, 'canonical', 'verified') returning id`,
          [producerId, r.name, r.type ?? e.expect.type, r.country],
        );
        seeded.set(e.id, w.rows[0]!.id);
      }
      await client.query("set role service_role");
    }
    const own = (
      await client.query<{
        id: string;
        producer: string;
        name: string;
        wine_type: string;
        country_code: string | null;
        region: string | null;
      }>(
        `select w.id, p.name as producer, w.name, w.wine_type::text, w.country_code, w.region
           from public.wines w join public.producers p on p.id = w.producer_id where w.owner_household_id = $1`,
        [household],
      )
    ).rows.map((w) => ({
      id: w.id,
      producer: w.producer,
      name: w.name,
      type: w.wine_type as WineType,
      countryCode: w.country_code,
      region: w.region,
    }));

    type Row = {
      id: string;
      reading: Reading;
      status: string;
      exactWine: string | null;
      target: number | null;
      suggestions: string[];
      ms: number;
      seeded: boolean;
    };
    const rows: Row[] = [];
    const broken: string[] = [];
    for (const e of covered) {
      for (const kind of READINGS) {
        const facts = readingOf(e.expect, kind);
        const text = resolverQuery(facts);
        const q = text === null ? null : searchableQuery(text);
        const t0 = performance.now();
        const found =
          q === null
            ? []
            : (
                await client.query<CatalogSearchRow>(
                  "select * from public.catalog_search_pilot($1, $2, null, null, null, 20)",
                  [household, q],
                )
              ).rows;
        const ms = performance.now() - t0;
        const candidates = [
          ...own,
          ...found.map(wineOfRow).filter((w): w is WineSummary => w !== null),
        ];
        const outcome = resolveWine(facts, candidates);
        // evaluation only: pilot rows are mapped as they would be once their source were public
        const hits = found.map(toSearchHit);
        const records = suggestRecordsForReading(facts, hits);
        const ext = records.map((s) => external.get(s.hit.recordId!) ?? "?");
        const idx = ext.findIndex((x) => e.target_ids.includes(x));
        const exactWine =
          outcome.status === "exact_candidate" ? outcome.candidates[0]!.wine.id : null;
        const isSeed = seeded.has(e.id);
        // the safety rules, checked on every reading
        if (exactWine && !(isSeed && exactWine === seeded.get(e.id)))
          broken.push(`${e.id}/${kind}: automatic identity ${exactWine}`);
        if (records.some((s) => s.hit.type && facts.type && s.hit.type !== facts.type))
          broken.push(`${e.id}/${kind}: a record of the other colour`);
        if (records.some((s) => s.hit.kind !== "record" || s.hit.verified))
          broken.push(`${e.id}/${kind}: a suggestion that is not an unverified record`);
        if (outcome.candidates.some((c) => !candidates.some((w) => w.id === c.wine.id)))
          broken.push(`${e.id}/${kind}: a candidate from nowhere`);
        rows.push({
          id: e.id,
          reading: kind,
          status: outcome.status,
          exactWine,
          target: idx === -1 ? null : idx + 1,
          suggestions: records.map(
            (s) => `${s.hit.producer} — ${s.hit.name} [${s.reasons.join(",")}]`,
          ),
          ms: Math.round(ms * 10) / 10,
          seeded: isSeed,
        });
      }
    }
    const summarise = (list: Row[]) => ({
      readings: list.length,
      suggestion_1st: list.filter((r) => r.target === 1).length,
      suggestion_top3: list.filter((r) => r.target !== null).length,
      no_suggestion: list.filter((r) => r.suggestions.length === 0).length,
      statuses: Object.fromEntries(
        ["exact_candidate", "ambiguous", "not_found"].map((s) => [
          s,
          list.filter((r) => r.status === s).length,
        ]),
      ),
    });
    const unseeded = rows.filter((r) => !r.seeded);
    const seededRows = rows.filter((r) => r.seeded);
    const summary = {
      covered_wines: covered.length,
      by_reading: Object.fromEntries(
        READINGS.map((k) => [k, summarise(unseeded.filter((r) => r.reading === k))]),
      ),
      canonical_seeds: {
        wines: seeded.size,
        clean_exact_canonical: seededRows.filter(
          (r) => r.reading === "clean" && r.exactWine !== null,
        ).length,
        misread_exact_canonical: seededRows.filter(
          (r) => r.reading === "misread" && r.exactWine !== null,
        ).length,
      },
      wrong_automatic_identities: broken.filter((b) => b.includes("automatic")).length,
      safety_violations: broken,
    };
    console.log(JSON.stringify(summary, null, 2));
    if (typeof args.out === "string") {
      mkdirSync(args.out, { recursive: true });
      writeFileSync(
        `${args.out}/recognition-results.json`,
        JSON.stringify({ summary, readings: rows }, null, 1) + "\n",
      );
    }
    if (broken.length > 0) process.exitCode = 1;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop()!)) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
