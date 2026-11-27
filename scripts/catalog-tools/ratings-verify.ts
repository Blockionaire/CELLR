/**
 * READ-ONLY verification of a provider's imported ratings (docs/sprints/ratings/DESIGN.md), for a database that already
 * holds them: no import, no raw file, nothing written. Two commands:
 *
 *   tsx ratings-verify.ts totals --db-totals <file> --aggregate <file>
 *     The database totals (staging-pilot.sh writes them) against the aggregation report of the same file. Exit 1 on
 *     any difference or a missing number.
 *
 *   tsx ratings-verify.ts db --db <url> --staging-project <ref> --provider xwines --user <uuid>
 *       [--expect-units N --expect-ratings N --expect-nv N --expect-wines N] [--expect-scope pilot]
 *       [--expect-unchanged-repeat] [--out <file>]
 *     Everything inside one READ ONLY transaction that is rolled back: totals, run status, vintages and months,
 *     privacy (no rater ids anywhere), rights, the pilot separation (a person sees nothing, the pilot read sees the
 *     sample) and docs/sprints/ratings/verify-api-closed.sql. Connects only to an approved staging project or a
 *     local database, never production (target.ts). Exit 1 when a check fails.
 *
 * The judging is pure (`compareTotals`, `judgeRatings`), so the exact checks are tested without a database.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs, str } from "./lib";
import { connectToTarget } from "./target";

export type Check = { name: string; ok: boolean; detail: string };

const num = (v: unknown): number | null => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

/** staging-pilot.sh's ratings-db-totals.json against ratings.ts aggregate's report: a list of problems, empty = equal. */
export function compareTotals(
  db: Record<string, unknown>,
  aggregate: Record<string, unknown>,
): string[] {
  const out: string[] = [];
  const pairs: [string, unknown, unknown][] = [
    ["units", db.units, aggregate.units],
    ["units_nv", db.units_nv, aggregate.units_nv],
    ["ratings", db.ratings, aggregate.ratings_kept],
  ];
  if ("records_rated" in db || "wines_rated" in aggregate)
    pairs.push(["records_rated", db.records_rated, aggregate.wines_rated]);
  for (const [name, a, b] of pairs) {
    const x = num(a);
    const y = num(b);
    if (x === null || y === null)
      out.push(`${name}: missing or not a number (database ${a}, file ${b})`);
    else if (x !== y) out.push(`${name}: database ${x}, file ${y}`);
  }
  if (db.distribution_adds_up !== true) out.push("distribution_adds_up is not true");
  return out;
}

/** What the database says, as gathered by `gather` (or a test). */
export interface RatingsFacts {
  provider: {
    rights_status: string;
    search_scope: string;
    commercial_use: boolean;
    may_display_ratings: boolean;
  } | null;
  totals: {
    units: number;
    units_nv: number;
    ratings: number;
    records_rated: number;
    distribution_adds_up: boolean;
    sum_adds_up: boolean;
    year_min: number | null;
    year_max: number | null;
    months_ok: boolean;
    on_foreign_or_inactive_record: number;
    from_unknown_or_open_run: number;
    /** Rows whose data changed after the previous complete run finished (null with fewer than two complete runs). */
    changed_since_previous_run: number | null;
  };
  runs: {
    finished: boolean;
    abandoned: boolean;
    pilot: boolean;
    units: number | null;
    ratings: number | null;
    removed: number | null;
  }[];
  runKeys: string[];
  raterColumns: string[];
  separation: { sample: number; personSees: number; personPages: number; pilotSees: number };
  apiClosed: { check: string; ok: boolean }[];
  currentYear: number;
}

export interface RatingsExpectation {
  units?: number | undefined;
  ratings?: number | undefined;
  nv?: number | undefined;
  wines?: number | undefined;
  /** The scope the provider must have: "pilot" on staging until the owner decides otherwise. */
  scope?: string | undefined;
  /** The last complete run repeated the one before it with the same file: it may have changed no row's data. */
  unchangedRepeat?: boolean | undefined;
}

/** Keys a run may hold in file_counts and counts: counts only (and an abandon reason). */
export const RUN_KEYS = [
  "rows",
  "invalid",
  "unknown_wine",
  "repeated_dropped",
  "withdrawn_record_units",
  "units",
  "ratings",
  "removed",
  "abandoned",
  "reason",
];

/** The checks, from the facts. Pure. */
export function judgeRatings(f: RatingsFacts, e: RatingsExpectation = {}): Check[] {
  const c: Check[] = [];
  const add = (name: string, ok: boolean, detail: string) => c.push({ name, ok, detail });
  const t = f.totals;
  const want = (label: string, got: number, expected: number | undefined) =>
    expected === undefined || got === expected ? "" : `; ${label} ${got}, expected ${expected}`;

  // totals: as expected, and equal to what the last complete run declared and the database accepted
  const done = f.runs.filter((r) => r.finished && !r.abandoned);
  const last = done.at(-1);
  const off =
    want("units", t.units, e.units) +
    want("ratings", t.ratings, e.ratings) +
    want("NV units", t.units_nv, e.nv) +
    want("wines", t.records_rated, e.wines);
  add(
    "totals: as expected",
    t.units > 0 && off === "",
    `${t.units} units (${t.units_nv} NV), ${t.ratings} ratings, ${t.records_rated} wines${off}`,
  );
  add(
    "totals: equal to the last complete run",
    !!last && last.units === t.units && last.ratings === t.ratings,
    last ? `run declared ${last.units} units, ${last.ratings} ratings` : "no complete run",
  );
  add(
    "totals: every distribution adds up to its count, every sum to its distribution",
    t.distribution_adds_up && t.sum_adds_up,
    `counts ${t.distribution_adds_up}, sums ${t.sum_adds_up}`,
  );

  // runs
  const open = f.runs.filter((r) => !r.finished).length;
  add(
    "runs: none open, at least one complete",
    open === 0 && done.length > 0,
    `${f.runs.length} runs: ${done.length} complete, ${f.runs.filter((r) => r.abandoned).length} abandoned, ${open} open`,
  );
  add(
    "runs: every one a pilot run (staging)",
    f.runs.every((r) => r.pilot),
    `${f.runs.filter((r) => !r.pilot).length} not pilot`,
  );
  add(
    "runs: every aggregate from a complete run",
    t.from_unknown_or_open_run === 0,
    `${t.from_unknown_or_open_run} from another run`,
  );
  add(
    "runs: a repeated complete run removed nothing",
    done.slice(1).every((r) => r.removed === 0),
    done.map((r) => `removed ${r.removed}`).join(", ") || "none",
  );

  if (e.unchangedRepeat)
    add(
      "runs: the repeated run changed no row's data (idempotent)",
      t.changed_since_previous_run === 0,
      t.changed_since_previous_run === null
        ? "fewer than two complete runs"
        : `${t.changed_since_previous_run} rows changed`,
    );

  // vintages and months
  add(
    "vintages: NV is its own vintage; years are real years",
    t.year_min !== null && t.year_max !== null && t.year_min >= 1800 && t.year_max <= f.currentYear,
    `years ${t.year_min}–${t.year_max}, NV ${t.units_nv}`,
  );
  add(
    "vintages: only on active records of this provider",
    t.on_foreign_or_inactive_record === 0,
    `${t.on_foreign_or_inactive_record} elsewhere`,
  );
  add("months: first of the month, first not after last", t.months_ok, String(t.months_ok));

  // privacy
  const extra = f.runKeys.filter((k) => !RUN_KEYS.includes(k));
  add(
    "privacy: runs hold counts only",
    extra.length === 0,
    extra.length ? `unexpected keys ${extra.join(", ")}` : f.runKeys.join(", "),
  );
  add(
    "privacy: no rater or user column on the external rating tables",
    f.raterColumns.length === 0,
    f.raterColumns.join(", ") || "none",
  );

  // rights
  const p = f.provider;
  add("rights: the provider is registered", p !== null, p ? "yes" : "no");
  if (p) {
    add(
      "rights: not public without verified commercial rights",
      p.search_scope !== "public" || (p.rights_status === "verified" && p.commercial_use),
      `${p.rights_status}, scope ${p.search_scope}, commercial ${p.commercial_use}`,
    );
    add(
      "rights: ratings shown only where the source may be shown",
      p.may_display_ratings || t.units === 0 || p.search_scope !== "public",
      `may_display_ratings ${p.may_display_ratings}`,
    );
    if (e.scope !== undefined)
      add(`rights: scope is ${e.scope}`, p.search_scope === e.scope, p.search_scope);
  }

  // pilot separation
  const s = f.separation;
  const pilotOnly = p?.search_scope !== "public";
  add(
    "separation: a person sees no rating and no record page of a pilot source",
    s.sample > 0 && (!pilotOnly || (s.personSees === 0 && s.personPages === 0)),
    `of ${s.sample} records: ratings ${s.personSees}, pages ${s.personPages}`,
  );
  add(
    "separation: the pilot read sees the sample",
    s.sample > 0 && s.pilotSees === s.sample,
    `${s.pilotSees} of ${s.sample}`,
  );

  // the API check (verify-api-closed.sql), row by row
  for (const r of f.apiClosed) add(`api: ${r.check}`, r.ok, String(r.ok));
  if (f.apiClosed.length === 0) add("api: verify-api-closed.sql ran", false, "no rows");
  return c;
}

const SAMPLE = 300;

async function gather(
  url: string,
  args: ReturnType<typeof parseArgs>,
  provider: string,
  user: string,
): Promise<RatingsFacts> {
  if (!/^[0-9a-f-]{36}$/i.test(user)) throw new Error("--user must be a uuid");
  const client = await connectToTarget(url, args);
  const q = async <T>(sql: string, values: unknown[] = []) =>
    (await client.query<T & object>(sql, values)).rows;
  try {
    await client.query("begin transaction read only");
    const [provRow] = await q<{ v: RatingsFacts["provider"] }>(
      `select (select json_build_object('rights_status', rights_status, 'search_scope', search_scope,
                'commercial_use', commercial_use, 'may_display_ratings', may_display_ratings)
                 from public.catalog_providers where id = $1) as v`,
      [provider],
    );
    const [tot] = await q<{ v: RatingsFacts["totals"] }>(
      `with a as (select * from public.catalog_rating_aggregates where provider_id = $1)
       select json_build_object(
         'units', (select count(*) from a), 'units_nv', (select count(*) from a where vintage_year is null),
         'ratings', coalesce((select sum(rating_count) from a), 0), 'records_rated', (select count(distinct record_id) from a),
         'distribution_adds_up', coalesce((select bool_and((select sum(x) from unnest(distribution) x) = rating_count) from a), true),
         'sum_adds_up', coalesce((select bool_and((select sum(x * i) from unnest(distribution) with ordinality u(x, i)) = rating_sum_half) from a), true),
         'year_min', (select min(vintage_year) from a), 'year_max', (select max(vintage_year) from a),
         'months_ok', coalesce((select bool_and((first_rated_month is null or extract(day from first_rated_month) = 1)
                                 and (last_rated_month is null or extract(day from last_rated_month) = 1)
                                 and (first_rated_month is null or last_rated_month is null or first_rated_month <= last_rated_month)) from a), true),
         'on_foreign_or_inactive_record', (select count(*) from a left join public.catalog_external_records e on e.id = a.record_id
                                            where e.id is null or e.provider_id <> $1 or e.status <> 'active'),
         'from_unknown_or_open_run', (select count(*) from a left join public.catalog_rating_runs r on r.id = a.last_run_id
                                       where r.id is null or r.finished_at is null or coalesce((r.counts->>'abandoned')::boolean, false)),
         'changed_since_previous_run', (with done as (select finished_at from public.catalog_rating_runs
                                                       where provider_id = $1 and finished_at is not null and not (counts ? 'abandoned')
                                                       order by finished_at desc offset 1 limit 1)
                                        select count(*) from a, done where a.updated_at > done.finished_at)
       ) as v`,
      [provider],
    );
    const runs = await q<{
      finished: boolean;
      abandoned: boolean;
      pilot: boolean;
      units: number | null;
      ratings: number | null;
      removed: number | null;
    }>(
      `select finished_at is not null as finished, coalesce((counts->>'abandoned')::boolean, false) as abandoned, pilot,
              (counts->>'units')::int as units, (counts->>'ratings')::bigint::float8 as ratings, (counts->>'removed')::int as removed
         from public.catalog_rating_runs where provider_id = $1 order by started_at`,
      [provider],
    );
    const keys = await q<{ k: string }>(
      `select distinct k from public.catalog_rating_runs r,
              lateral (select jsonb_object_keys(r.file_counts) k union select jsonb_object_keys(r.counts)) x
        where r.provider_id = $1 order by 1`,
      [provider],
    );
    const cols = await q<{ c: string }>(
      `select table_schema || '.' || table_name || '.' || column_name as c from information_schema.columns
        where table_schema in ('public', 'private') and table_name like 'catalog_rating%'
          and column_name ~* '(rater|user|uid|email)' order by 1`,
    );
    // the separation, as a person (the JSON claims PostgREST sets) and as the pilot read (service role)
    const ids = (
      await q<{ id: string }>(
        `select id from public.catalog_external_records where provider_id = $1 and status = 'active'
        order by md5(id::text || 'ratings-verify') limit ${SAMPLE}`,
        [provider],
      )
    ).map((r) => r.id);
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: user, role: "authenticated" }),
    ]);
    await client.query("set local role authenticated");
    const [person] = await q<{ sees: number; pages: number }>(
      `select count(*) filter (where public.catalog_record_ratings(x) is not null)::int as sees,
              count(*) filter (where public.catalog_record_page(x) is not null)::int as pages
         from unnest($1::uuid[]) x`,
      [ids],
    );
    await client.query("set local role service_role");
    const [pilot] = await q<{ sees: number }>(
      `select count(*) filter (where jsonb_array_length(public.catalog_record_ratings_pilot(x)->'vintages') > 0)::int as sees
         from unnest($1::uuid[]) x`,
      [ids],
    );
    await client.query("reset role");
    const sql = readFileSync(
      new URL("../../docs/sprints/ratings/verify-api-closed.sql", import.meta.url),
      "utf8",
    )
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("--"))
      .join("\n")
      .trim()
      .replace(/;\s*$/, "");
    const api = await q<{ check: string; ok: boolean }>(sql);
    const [year] = await q<{ y: number }>("select extract(year from now())::int as y");
    return {
      provider: provRow!.v,
      totals: tot!.v,
      runs: runs.map((r) => ({ ...r, ratings: r.ratings === null ? null : Number(r.ratings) })),
      runKeys: keys.map((k) => k.k),
      raterColumns: cols.map((x) => x.c),
      separation: {
        sample: ids.length,
        personSees: person!.sees,
        personPages: person!.pages,
        pilotSees: pilot!.sees,
      },
      apiClosed: api,
      currentYear: year!.y,
    };
  } finally {
    await client.query("rollback").catch(() => undefined);
    await client.end();
  }
}

const optNum = (v: string | true | undefined) => {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new Error(`not a count: ${String(v)}`);
  return n;
};

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  if (cmd === "totals") {
    const read = (k: string) =>
      JSON.parse(readFileSync(str(args, k), "utf8")) as Record<string, unknown>;
    const problems = compareTotals(read("db-totals"), read("aggregate"));
    console.log(
      problems.length === 0
        ? "totals: database = file"
        : `totals: DIFFERENT\n  ${problems.join("\n  ")}`,
    );
    if (problems.length > 0) process.exitCode = 1;
    return;
  }
  if (cmd !== "db") throw new Error("usage: ratings-verify.ts totals|db …");
  const facts = await gather(
    str(args, "db"),
    args,
    str(args, "provider", "xwines"),
    str(args, "user"),
  );
  const checks = judgeRatings(facts, {
    units: optNum(args["expect-units"]),
    ratings: optNum(args["expect-ratings"]),
    nv: optNum(args["expect-nv"]),
    wines: optNum(args["expect-wines"]),
    scope: typeof args["expect-scope"] === "string" ? args["expect-scope"] : undefined,
    unchangedRepeat: args["expect-unchanged-repeat"] === true,
  });
  const report = { ok: checks.every((x) => x.ok), checks };
  if (typeof args.out === "string") writeFileSync(args.out, JSON.stringify(report, null, 2) + "\n");
  for (const x of checks) console.log(`${x.ok ? "  ok  " : "  FAIL"} ${x.name}: ${x.detail}`);
  console.log(`ratings verify: ${report.ok ? "PASS" : "FAIL"} (${checks.length} checks)`);
  if (!report.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop()!)) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
