/**
 * Provider ratings → aggregates per exact record and vintage (docs/sprints/ratings/DESIGN.md).
 *
 *   tsx ratings.ts aggregate --file XWines_Full_21M_ratings.csv --sha256 <expected> --units units.jsonl
 *     [--wines XWines_Full_100K_wines.csv] [--partitions 64] [--tmp <dir>] [--out report.json]
 *   tsx ratings.ts import --db <url> --provider xwines --units units.jsonl --report report.json
 *     --dataset-version "X-Wines 1.0 (2023-01)" --source-url https://… --retrieved-at 2026-11-25
 *     [--apply] [--pilot] [--remove-missing] [--staging-project <ref>] [--out import.json]
 *
 * aggregate (no database): streams the file twice with bounded memory.
 *   1. The checksum, before a line is interpreted; a file that is not the expected one is refused.
 *   2. Every line is checked (domain parseRatingRow); invalid lines are counted by reason, never used. Rating ids must
 *      strictly increase (true of the real file): a repeated or out-of-order id is refused, so a duplicated line can
 *      never count twice. Valid lines are spilled to N partition files by wine id, with the rater replaced by a keyed
 *      hash (a random key that exists only in this process): no rater id is ever written to disk.
 *   3. Each partition is aggregated in memory on its own (one rating per rater per unit, the latest) and appended to
 *      the units file (aggregates only). The partition files are deleted at the end, also after a failure.
 *   The report holds counts only: rows, invalid by reason, repeated ratings dropped, units, ratings kept, NV units,
 *   peak memory. Nothing in it names a wine.
 * import: sends the units in batches through catalog_rating_import under one rating run. The run declares the
 *   report's totals at its start; the database refuses to finish it unless the stored aggregates add up exactly.
 *   Dry run unless --apply. Targets: a local database, or the approved staging project (target.ts); production is
 *   always refused by these tools (a production import is the separate, reviewed route, docs/sprints/ratings/).
 */
import { createHash, createHmac, randomBytes } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  type WriteStream,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import {
  aggregateUnit,
  parseRatingRow,
  RATING_METHOD,
  unitPayload,
  XWINES_RATINGS_HEADER,
  type RatingRowProblem,
  type UnitRating,
} from "@cellr/domain";
import { parseArgs, str, type Args } from "./lib";
import { connectForImport } from "./production";

const BATCH = 1000;
/** At most this many ratings in one partition (the real file: 356,324 at 64 partitions). */
const MAX_PARTITION = 3_000_000;

export interface AggregateReport {
  file: string;
  sha256: string;
  method: string;
  rows: number;
  invalid: Partial<Record<RatingRowProblem, number>>;
  invalid_total: number;
  /** Valid ratings whose wine id the wines file does not hold (only with --wines); not aggregated. */
  unknown_wine: number;
  repeated_dropped: number;
  units: number;
  units_nv: number;
  ratings_kept: number;
  wines_rated: number;
  partitions: number;
  largest_partition: number;
  /** The units file this report describes (import checks it). */
  units_sha256: string;
  seconds: number;
  peak_rss_mb: number;
}

async function fileSha256(path: string): Promise<string> {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(path)) h.update(chunk as Buffer);
  return h.digest("hex");
}

/** A partition for a wine id: stable, spread evenly. */
const partitionOf = (wineId: string, n: number) => Number(BigInt(wineId) % BigInt(n));

async function readWineIds(path: string): Promise<Set<string>> {
  const ids = new Set<string>();
  const rl = createInterface({
    input: createReadStream(path, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  let header = true;
  for await (const line of rl) {
    if (header) {
      header = false;
      if (!line.startsWith("WineID,")) throw new Error("the wines file does not start with WineID");
      continue;
    }
    const id = line.slice(0, line.indexOf(","));
    if (/^[0-9]{1,12}$/.test(id)) ids.add(id);
  }
  return ids;
}

export async function aggregate(args: Args): Promise<AggregateReport> {
  const started = performance.now();
  const file = str(args, "file");
  const unitsPath = str(args, "units");
  const parts = Number(str(args, "partitions", "64"));
  if (!Number.isInteger(parts) || parts < 1 || parts > 4096)
    throw new Error("--partitions must be 1..4096");

  const hash = await fileSha256(file);
  const expected = str(args, "sha256");
  if (hash !== expected)
    throw new Error(`checksum mismatch: expected ${expected}, file is ${hash}: nothing read`);
  const wines = typeof args.wines === "string" ? await readWineIds(args.wines) : null;

  // the partition files hold a keyed hash of the rater, never the id; the key lives only in this process
  const key = randomBytes(32);
  const rater = (id: string) =>
    createHmac("sha256", key).update(id).digest("base64url").slice(0, 16);
  const dir = mkdtempSync(
    join(typeof args.tmp === "string" ? args.tmp : tmpdir(), "cellr-ratings-"),
  );
  try {
    // a write error (a full disk) fails the run through `failed`, so the finally below still removes every file
    let failed: Error | null = null;
    const outs: WriteStream[] = Array.from({ length: parts }, (_, i) =>
      createWriteStream(join(dir, `p${i}`), { mode: 0o600 }).on("error", (e) => (failed ??= e)),
    );
    const sizes = Array.from({ length: parts }, () => 0);
    const invalid: Partial<Record<RatingRowProblem, number>> = {};
    let rows = 0;
    let unknownWine = 0;
    let lastId = 0;
    const rl = createInterface({
      input: createReadStream(file, { encoding: "utf8" }),
      crlfDelay: Infinity,
    });
    let header = true;
    for await (const line of rl) {
      if (header) {
        header = false;
        if (line.replace(/^\uFEFF/, "") !== XWINES_RATINGS_HEADER.join(","))
          throw new Error(
            "the ratings file's header is not the verified X-Wines layout: nothing aggregated",
          );
        continue;
      }
      if (line === "") continue;
      rows++;
      const p = parseRatingRow(line.split(","));
      if (!p.ok) {
        invalid[p.problem] = (invalid[p.problem] ?? 0) + 1;
        continue;
      }
      if (p.row.ratingId <= lastId)
        throw new Error(
          `rating ids do not strictly increase at line ${rows + 1}: a repeated or reordered file is refused`,
        );
      lastId = p.row.ratingId;
      if (wines && !wines.has(p.row.wineId)) {
        unknownWine++;
        continue;
      }
      const i = partitionOf(p.row.wineId, parts);
      // the memory of step 3 is one partition's ratings: bounded here, never silently exceeded
      if (++sizes[i]! > MAX_PARTITION)
        throw new Error(`a partition exceeds ${MAX_PARTITION} ratings: use more --partitions`);
      if (failed) throw failed;
      const ok = outs[i]!.write(
        `${p.row.wineId},${p.row.vintage ?? ""},${rater(p.row.raterId)},${p.row.half},${p.row.ratedAt},${p.row.ratingId}\n`,
      );
      if (!ok)
        await new Promise((res, rej) => {
          outs[i]!.once("drain", () => res(null));
          outs[i]!.once("error", rej);
        });
    }
    if (failed) throw failed;
    await Promise.all(
      outs.map(
        (o) => new Promise((res, rej) => o.end((e?: Error | null) => (e ? rej(e) : res(null)))),
      ),
    );

    const units = createWriteStream(unitsPath, { mode: 0o600 }).on("error", (e) => (failed ??= e));
    let nUnits = 0;
    let nNv = 0;
    let kept = 0;
    let repeated = 0;
    const winesRated = new Set<string>();
    for (let i = 0; i < parts; i++) {
      const byUnit = new Map<string, UnitRating[]>();
      const pr = createInterface({
        input: createReadStream(join(dir, `p${i}`), { encoding: "utf8" }),
        crlfDelay: Infinity,
      });
      for await (const line of pr) {
        if (line === "") continue;
        const [w, v, who, half, at, id] = line.split(",") as [
          string,
          string,
          string,
          string,
          string,
          string,
        ];
        const k = `${w},${v}`;
        let list = byUnit.get(k);
        if (!list) byUnit.set(k, (list = []));
        list.push({ rater: who, half: Number(half), ratedAt: at, ratingId: Number(id) });
      }
      rmSync(join(dir, `p${i}`));
      // units in a stable order (wine id, then year, NV last), so the same file always gives the same units file
      const keys = [...byUnit.keys()].sort((a, b) => {
        const [wa, va] = a.split(",");
        const [wb, vb] = b.split(",");
        if (wa !== wb) return Number(wa) - Number(wb);
        if (va === vb) return 0;
        if (va === "") return 1;
        if (vb === "") return -1;
        return Number(va) - Number(vb);
      });
      for (const k of keys) {
        const [w, v] = k.split(",") as [string, string];
        const agg = aggregateUnit(byUnit.get(k)!);
        nUnits++;
        if (v === "") nNv++;
        kept += agg.count;
        repeated += agg.repeated;
        winesRated.add(w);
        const ok = units.write(
          JSON.stringify(unitPayload(w, v === "" ? null : Number(v), agg)) + "\n",
        );
        if (!ok) await new Promise((res) => units.once("drain", () => res(null)));
      }
    }
    await new Promise((res, rej) => units.end((e?: Error | null) => (e ? rej(e) : res(null))));
    const invalidTotal = Object.values(invalid).reduce((a, b) => a + (b ?? 0), 0);
    return {
      file: file.split("/").pop()!,
      sha256: hash,
      method: RATING_METHOD,
      rows,
      invalid,
      invalid_total: invalidTotal,
      unknown_wine: unknownWine,
      repeated_dropped: repeated,
      units: nUnits,
      units_nv: nNv,
      ratings_kept: kept,
      wines_rated: winesRated.size,
      partitions: parts,
      largest_partition: Math.max(...sizes),
      units_sha256: await fileSha256(unitsPath),
      seconds: Math.round((performance.now() - started) / 100) / 10,
      peak_rss_mb: Math.round(process.resourceUsage().maxRSS / 1024),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function importUnits(args: Args) {
  const started = performance.now();
  const provider = str(args, "provider");
  const report = JSON.parse(readFileSync(str(args, "report"), "utf8")) as AggregateReport;
  if (report.method !== RATING_METHOD)
    throw new Error(`the report was made with ${report.method}, not ${RATING_METHOD}`);
  if (report.unknown_wine > 0 && args["allow-unknown"] !== true)
    throw new Error(
      `${report.unknown_wine} ratings name a wine the wines file does not hold: refused`,
    );
  const retrievedAt = str(args, "retrieved-at");
  if (Number.isNaN(Date.parse(retrievedAt))) throw new Error("--retrieved-at must be a date");
  const apply = args.apply === true;
  const unitsPath = str(args, "units");
  // the units file must be the one this report describes
  if (report.units_sha256 !== (await fileSha256(unitsPath)))
    throw new Error("the units file is not the one the report was made with: nothing imported");
  const client = await connectForImport(str(args, "db"), args);
  type Totals = {
    inserted: number;
    updated: number;
    unchanged: number;
    invalid: number;
    no_record: number;
    withdrawn_record: number;
    withdrawn_ratings: number;
  };
  const problems: unknown[] = [];
  // one pass over the units file, streamed: at most one batch is held at a time
  const pass = async (write: boolean, run: string | null): Promise<Totals & { sent: number }> => {
    const t: Totals = {
      inserted: 0,
      updated: 0,
      unchanged: 0,
      invalid: 0,
      no_record: 0,
      withdrawn_record: 0,
      withdrawn_ratings: 0,
    };
    let sent = 0;
    const send = async (batch: string[]) => {
      const j = (
        await client.query<{ j: Record<string, number> & { problems: unknown[] } }>(
          "select public.catalog_rating_import($1, $2, $3::jsonb, $4) as j",
          [provider, run, `[${batch.join(",")}]`, write],
        )
      ).rows[0]!.j;
      sent += batch.length;
      for (const k of Object.keys(t) as Array<keyof Totals>) t[k] += Number(j[k] ?? 0);
      if (problems.length < 20) problems.push(...j.problems.slice(0, 20 - problems.length));
    };
    let batch: string[] = [];
    const rl = createInterface({
      input: createReadStream(unitsPath, { encoding: "utf8" }),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      if (line === "") continue;
      batch.push(line);
      if (batch.length === BATCH) {
        await send(batch);
        batch = [];
      }
    }
    if (batch.length > 0) await send(batch);
    if (sent !== report.units)
      throw new Error(`the units file holds ${sent} units, the report ${report.units}`);
    return { ...t, sent };
  };
  try {
    // always a dry run first: nothing is written unless every unit is valid and has a record; units of withdrawn
    // records are left out of the totals the run declares
    const dry = await pass(false, null);
    let run: string | null = null;
    let applied: (Totals & { sent: number }) | null = null;
    let finish: unknown = null;
    const expectedUnits = report.units - dry.withdrawn_record;
    const expectedRatings = report.ratings_kept - dry.withdrawn_ratings;
    if (apply) {
      if (dry.invalid > 0 || dry.no_record > 0)
        throw new Error(
          `the dry run found ${dry.invalid} invalid and ${dry.no_record} unknown-record units: nothing written`,
        );
      run = (
        await client.query<{ id: string }>(
          "select public.catalog_rating_run_start($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10) as id",
          [
            provider,
            str(args, "dataset-version"),
            args["source-url"] ?? null,
            report.sha256,
            retrievedAt,
            report.method,
            expectedUnits,
            expectedRatings,
            JSON.stringify({
              rows: report.rows,
              invalid: report.invalid_total,
              repeated_dropped: report.repeated_dropped,
              unknown_wine: report.unknown_wine,
              withdrawn_record_units: dry.withdrawn_record,
            }),
            args.pilot === true,
          ],
        )
      ).rows[0]!.id;
      try {
        applied = await pass(true, run);
        // the database finishes the run only when what it stored adds up to what was declared
        finish = (
          await client.query("select public.catalog_rating_run_finish($1, $2) as j", [
            run,
            args["remove-missing"] === true,
          ])
        ).rows[0]!.j;
      } catch (e) {
        await client
          .query("select public.catalog_rating_run_abandon($1, $2)", [
            run,
            `import failed: ${e instanceof Error ? e.message : "error"}`.slice(0, 300),
          ])
          .catch(() => {});
        throw e;
      }
    }
    const t = applied ?? dry;
    return {
      provider,
      applied: apply,
      pilot: args.pilot === true,
      run,
      units: t.sent,
      ratings: report.ratings_kept,
      declared: { units: expectedUnits, ratings: expectedRatings },
      inserted: t.inserted,
      updated: t.updated,
      unchanged: t.unchanged,
      invalid: t.invalid,
      no_record: t.no_record,
      withdrawn_record: t.withdrawn_record,
      problems,
      finish,
      seconds: Math.round((performance.now() - started) / 100) / 10,
      peak_rss_mb: Math.round(process.resourceUsage().maxRSS / 1024),
    };
  } finally {
    await client.end();
  }
}

async function main() {
  const [mode, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  const result =
    mode === "aggregate"
      ? await aggregate(args)
      : mode === "import"
        ? await importUnits(args)
        : null;
  if (result === null) throw new Error("usage: ratings.ts aggregate|import …");
  console.log(JSON.stringify(result, null, 2));
  if (typeof args.out === "string") writeFileSync(args.out, JSON.stringify(result, null, 2) + "\n");
}

if (process.argv[1]?.endsWith("ratings.ts"))
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
