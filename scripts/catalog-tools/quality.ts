/**
 * Data-quality report of a provider file and of what an import made of it (Sprint 004B).
 *
 *   pnpm --filter @cellr/catalog-tools exec tsx quality.ts --file <provider file> --provider xwines
 *     [--db <url>] [--against <other file> --against-provider <id>] [--out <dir>]
 *
 * File level (the same adapter and inspection the import uses): rows, mapped records, skipped rows, duplicate ids,
 * empty fields per column, types, countries, regions, grapes, vintages and non-vintage, spelling variants of one
 * producer, producers that differ only by estate words, non-Latin scripts and accents, identical identities and
 * near-identical names of one producer. Database level (with --db; read-only, service role, pilot/staging only):
 * records by status, run history, links, overlap with CELLR wines (canonical and households' own, counted, never
 * named per household) and between providers. With --against <file> --against-provider <id> (Sprint 004C): how
 * this file's records relate to another source's file by CELLR's identity rules (`crossSourceMatches`). Nothing is
 * written.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import {
  ADAPTERS,
  csvObjects,
  decodeUtf8,
  ESTATE_WORDS,
  groupSameIdentity,
  identityRelation,
  inspectProviderFile,
  normalizeText,
  type ProviderId,
  type ProviderRecord,
} from "@cellr/domain";
import { parseArgs, str } from "./lib";
import { connectToTarget } from "./target";

const top = (m: Map<string, number>, n: number) =>
  [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n);
const bump = (m: Map<string, number>, k: string, by = 1) => m.set(k, (m.get(k) ?? 0) + by);
const core = (s: string) =>
  normalizeText(s)
    .split(" ")
    .filter((w) => w && !ESTATE_WORDS.has(w))
    .join(" ");

/** Which writing systems a text uses beyond basic Latin. */
export function scriptsOf(text: string): string[] {
  const out: string[] = [];
  if (/[À-ɏ]/.test(text)) out.push("latin-accented");
  if (/\p{Script=Cyrillic}/u.test(text)) out.push("cyrillic");
  if (/\p{Script=Greek}/u.test(text)) out.push("greek");
  if (/\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u.test(text))
    out.push("cjk");
  if (/\p{Script=Arabic}|\p{Script=Hebrew}/u.test(text)) out.push("arabic-hebrew");
  if (/\p{Script=Georgian}|\p{Script=Armenian}/u.test(text)) out.push("georgian-armenian");
  return out;
}

export function fileQuality(text: string, providerId: ProviderId) {
  const inspection = inspectProviderFile(text, providerId);
  const raw = csvObjects(text, ADAPTERS[providerId].columns);
  const records: ProviderRecord[] = inspection.records;

  const empty: Record<string, number> = {};
  for (const col of Object.keys(raw[0] ?? {}))
    empty[col] = raw.filter((r) => (r[col] ?? "").trim() === "" || r[col] === "[]").length;

  const types = new Map<string, number>();
  const countries = new Map<string, number>();
  const regions = new Set<string>();
  const grapes = new Map<string, number>();
  let listed = 0;
  let noVintage = 0;
  let nv = 0;
  let nvOnly = 0;
  let minYear = 9999;
  let maxYear = 0;
  const scripts = new Map<string, number>();
  const spellings = new Map<string, Set<string>>(); // normalised producer → spellings
  const cores = new Map<string, Set<string>>(); // producer without estate words → normalised producers
  const byProducer = new Map<string, ProviderRecord[]>();
  for (const r of records) {
    bump(types, r.wine_type ?? "(unmapped)");
    bump(countries, r.country_code ?? "(none)");
    if (r.region) regions.add(normalizeText(r.region));
    for (const g of Array.isArray(r.details.grapes) ? (r.details.grapes as string[]) : [])
      bump(grapes, g);
    listed += r.vintages.length;
    if (r.vintages.length === 0) noVintage++;
    if (r.non_vintage) nv++;
    if (r.non_vintage && r.vintages.length === 0) nvOnly++;
    for (const y of r.vintages) {
      minYear = Math.min(minYear, y);
      maxYear = Math.max(maxYear, y);
    }
    for (const s of scriptsOf(`${r.producer} ${r.name} ${r.region ?? ""}`)) bump(scripts, s);
    const np = normalizeText(r.producer);
    (spellings.get(np) ?? spellings.set(np, new Set()).get(np)!).add(r.producer);
    const c = core(r.producer);
    if (c) (cores.get(c) ?? cores.set(c, new Set()).get(c)!).add(np);
    (byProducer.get(np) ?? byProducer.set(np, []).get(np)!).push(r);
  }
  const spellingGroups = [...spellings.entries()].filter(([, s]) => s.size > 1);
  const coreGroups = [...cores.entries()].filter(([, s]) => s.size > 1);

  // identical identities (producer, name, colour, country equal after normalising) and near-identical names of one
  // producer: what a person would have to tell apart
  const facts = records.map((r) => ({ ...r, type: r.wine_type, countryCode: r.country_code }));
  const sameGroups = groupSameIdentity(facts).filter((g) => g.length > 1);
  const near = new Map<string, number>();
  const nearExamples: string[] = [];
  for (const list of byProducer.values()) {
    const l = list.slice(0, 200);
    for (let i = 0; i < l.length; i++)
      for (let j = i + 1; j < l.length; j++) {
        const a = l[i]!;
        const b = l[j]!;
        if (normalizeText(a.name) === normalizeText(b.name)) continue; // counted as identical (or a colour twin)
        const rel = identityRelation(
          { producer: a.producer, name: a.name, type: a.wine_type, countryCode: a.country_code },
          { producer: b.producer, name: b.name, type: b.wine_type, countryCode: b.country_code },
        ).relation;
        if (rel === "variant" || rel === "uncertain") {
          bump(near, rel);
          if (nearExamples.length < 15)
            nearExamples.push(`${a.producer}: "${a.name}" ~ "${b.name}" (${rel})`);
        }
      }
  }
  const colourTwins = [...byProducer.values()].reduce((n, list) => {
    const seen = new Map<string, Set<string>>();
    for (const r of list)
      (
        seen.get(normalizeText(r.name)) ??
        seen.set(normalizeText(r.name), new Set()).get(normalizeText(r.name))!
      ).add(r.wine_type ?? "-");
    return n + [...seen.values()].filter((s) => s.size > 1).length;
  }, 0);

  return {
    rows: inspection.rows,
    records: records.length,
    skipped: inspection.skipped,
    fatal: inspection.fatal,
    warnings: inspection.warnings,
    duplicate_external_ids: inspection.duplicateRows,
    folded_rows: inspection.foldedRows,
    encoding_suspect_rows: inspection.encodingRows,
    implausible_vintage_rows: inspection.implausibleVintageRows,
    unmapped_types: inspection.unmappedTypes,
    empty_fields: empty,
    unique: {
      producers_as_written: new Set(records.map((r) => r.producer)).size,
      producers_normalised: spellings.size,
      wine_names_normalised: new Set(records.map((r) => normalizeText(r.name))).size,
      identities: new Set(
        records.map(
          (r) =>
            `${normalizeText(r.producer)}|${normalizeText(r.name)}|${r.wine_type}|${r.country_code}`,
        ),
      ).size,
      countries: countries.size,
      regions: regions.size,
      grapes: grapes.size,
    },
    types: Object.fromEntries(top(types, 20)),
    countries_top: Object.fromEntries(top(countries, 15)),
    grapes_top: Object.fromEntries(top(grapes, 10)),
    vintages: {
      listed_total: listed,
      records_without_any: noVintage,
      records_marked_nv: nv,
      records_nv_only: nvOnly,
      earliest: minYear === 9999 ? null : minYear,
      latest: maxYear === 0 ? null : maxYear,
    },
    scripts: Object.fromEntries(top(scripts, 10)),
    producer_spelling_variants: {
      groups: spellingGroups.length,
      examples: spellingGroups.slice(0, 10).map(([, s]) => [...s]),
    },
    producers_differing_only_by_estate_words: {
      groups: coreGroups.length,
      examples: coreGroups.slice(0, 10).map(([, s]) => [...s]),
    },
    identical_identities: {
      groups: sameGroups.length,
      records_in_them: sameGroups.reduce((n, g) => n + g.length, 0),
      examples: sameGroups
        .slice(0, 8)
        .map((g) =>
          g.map((r) => `${r.external_id}: ${r.producer} — ${r.name} (${r.wine_type ?? "?"})`),
        ),
    },
    same_name_other_colour: colourTwins,
    near_identical_names_of_one_producer: {
      pairs: Object.fromEntries(near),
      examples: nearExamples,
    },
  };
}

/** How records of one source relate to another's, best relation per record (Sprint 004C: LWIN ↔ X-Wines). */
const CROSS_ORDER = ["same", "variant", "uncertain", "different_cuvee"] as const;
type CrossRelation = (typeof CROSS_ORDER)[number];

/**
 * For each record of `left`, the closest record of `right` by CELLR's own identity rules (`identityRelation`, the same
 * comparison the import's suggested links and the scan use: no second matching engine). Compared only within a
 * producer-word block, so a 100k file stays a matter of seconds. A report, never a link: nothing is written, and two
 * sources agreeing is not a verification — an admin still decides each link to a CELLR wine.
 * `ambiguous`: more than one record of `right` is the same wine (one of the two sources holds a duplicate).
 */
/** Producer words cut to five letters: a block for comparing, so "Inventada" and "Inventadas" still meet. */
const blockKeys = (producer: string) =>
  new Set(
    core(producer)
      .split(" ")
      .filter((x) => x.length >= 3)
      .map((x) => x.slice(0, 5)),
  );

/** At most this many records of the other source are compared per producer word (a 100k file stays seconds). */
const BLOCK_CAP = 500;

export function crossSourceMatches(
  left: readonly ProviderRecord[],
  right: readonly ProviderRecord[],
  samples = 15,
) {
  const block = new Map<string, number[]>();
  right.forEach((r, i) => {
    for (const w of blockKeys(r.producer)) block.set(w, [...(block.get(w) ?? []), i]);
  });
  const counts: Record<CrossRelation | "none", number> = {
    same: 0,
    variant: 0,
    uncertain: 0,
    different_cuvee: 0,
    none: 0,
  };
  let ambiguous = 0;
  let compared = 0;
  // records whose producer block was cut at BLOCK_CAP: their best match may lie beyond it (reported, never hidden)
  let truncated = 0;
  const examples: Record<CrossRelation, Array<{ left: string; right: string }>> = {
    same: [],
    variant: [],
    uncertain: [],
    different_cuvee: [],
  };
  const label = (r: ProviderRecord) =>
    `${r.external_id}: ${r.producer} — ${r.name} (${r.wine_type ?? "?"})`;
  for (const l of left) {
    const candidates = new Set<number>();
    let cut = false;
    for (const w of blockKeys(l.producer)) {
      const ids = block.get(w) ?? [];
      if (ids.length > BLOCK_CAP) cut = true;
      for (const i of ids.slice(0, BLOCK_CAP)) candidates.add(i);
    }
    if (cut) truncated += 1;
    let best: { rank: number; at: number } | null = null;
    let same = 0;
    for (const i of candidates) {
      const r = right[i]!;
      compared += 1;
      const rel = identityRelation(
        { producer: l.producer, name: l.name, type: l.wine_type, countryCode: l.country_code },
        { producer: r.producer, name: r.name, type: r.wine_type, countryCode: r.country_code },
      ).relation as string;
      const rank = (CROSS_ORDER as readonly string[]).indexOf(rel);
      if (rank < 0) continue;
      if (rank === 0) same += 1;
      if (!best || rank < best.rank) best = { rank, at: i };
    }
    if (same > 1) ambiguous += 1;
    if (!best) {
      counts.none += 1;
      continue;
    }
    const rel = CROSS_ORDER[best.rank]!;
    counts[rel] += 1;
    if (examples[rel].length < samples)
      examples[rel].push({ left: label(l), right: label(right[best.at]!) });
  }
  return {
    left: left.length,
    right: right.length,
    compared,
    counts,
    ambiguous,
    truncated,
    examples,
  };
}

async function dbQuality(url: string, args: Record<string, string | true>, providerId: string) {
  const client = await connectToTarget(url, args);
  const q = async (sql: string, values: unknown[] = []) => (await client.query(sql, values)).rows;
  try {
    return {
      provider:
        (
          await q(
            "select id, license, rights_status, search_scope, may_store, may_display, commercial_use from public.catalog_providers where id = $1",
            [providerId],
          )
        )[0] ?? null,
      records_by_status: await q(
        "select status, count(*)::int as n from public.catalog_external_records where provider_id = $1 group by 1 order by 1",
        [providerId],
      ),
      duplicate_provider_ids: (
        await q(
          "select count(*)::int as n from (select 1 from public.catalog_external_records group by provider_id, external_id having count(*) > 1) d",
        )
      )[0],
      runs: await q(
        `select dataset_version, pilot, rights_status, license, started_at, finished_at, counts->>'abandoned' as abandoned,
                counts->>'reason' as reason from public.catalog_import_runs where provider_id = $1 order by started_at`,
        [providerId],
      ),
      links: await q(
        "select l.state, count(*)::int as n from public.catalog_record_links l join public.catalog_external_records e on e.id = l.record_id where e.provider_id = $1 group by 1",
        [providerId],
      ),
      // the same identity as a CELLR wine: counted per kind, never named per household
      same_identity_as_cellr_wines: await q(
        `select w.status::text as kind, count(distinct e.id)::int as records
           from public.catalog_external_records e
           join public.producers p on p.normalized_name = e.normalized_producer
           join public.wines w on w.producer_id = p.id and w.normalized_name = e.normalized_name
                              and (e.wine_type is null or w.wine_type = e.wine_type)
          where e.provider_id = $1 and e.status = 'active' group by 1`,
        [providerId],
      ),
      same_identity_in_other_providers: await q(
        `select o.provider_id, count(distinct e.id)::int as records
           from public.catalog_external_records e
           join public.catalog_external_records o on o.provider_id <> e.provider_id and o.status = 'active'
                and o.normalized_producer = e.normalized_producer and o.normalized_name = e.normalized_name
                and o.wine_type is not distinct from e.wine_type
          where e.provider_id = $1 and e.status = 'active' group by 1 order by 1`,
        [providerId],
      ),
      cellr_wines_written_by_imports: (
        await q("select count(*)::int as n from public.wines where origin = 'licensed_import'")
      )[0],
      canonical_wines: (
        await q("select count(*)::int as n from public.wines where status = 'canonical'")
      )[0],
    };
  } finally {
    await client.end();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const providerId = str(args, "provider") as ProviderId;
  const text = decodeUtf8(readFileSync(str(args, "file")));
  if (text === null) throw new Error("not UTF-8");
  const t0 = performance.now();
  const file = fileQuality(text, providerId);
  // --against <file> --against-provider <id>: how this file's records relate to another source's (read-only)
  let cross: (ReturnType<typeof crossSourceMatches> & { against: string }) | null = null;
  if (typeof args.against === "string") {
    const other = decodeUtf8(readFileSync(args.against));
    if (other === null) throw new Error("--against: not UTF-8");
    const againstId = str(args, "against-provider") as ProviderId;
    cross = {
      against: againstId,
      ...crossSourceMatches(
        inspectProviderFile(text, providerId).records,
        inspectProviderFile(other, againstId).records,
      ),
    };
  }
  const report = {
    provider: providerId,
    file,
    cross_source: cross,
    database: typeof args.db === "string" ? await dbQuality(args.db, args, providerId) : null,
    seconds: Math.round((performance.now() - t0) / 100) / 10,
    peak_rss_mb: Math.round(process.resourceUsage().maxRSS / 1024),
  };
  console.log(JSON.stringify(report, null, 2));
  if (typeof args.out === "string") {
    mkdirSync(args.out, { recursive: true });
    writeFileSync(`${args.out}/quality-${providerId}.json`, JSON.stringify(report, null, 1) + "\n");
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop()!)) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
