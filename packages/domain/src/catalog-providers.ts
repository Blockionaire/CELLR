import type { WineType } from "./cellar";

/**
 * EXTERNAL WINE DATA PROVIDERS (Sprint 004A). Every provider's file is turned into the same record shape before it
 * reaches the database (`public.catalog_external_import`), so CELLR depends on no provider's format, ids or
 * vocabulary. An adapter maps only what the provider states: a type or country it cannot map is left empty, never
 * guessed; ratings, prices and reviews are never carried over.
 */

/** The provider-independent record the import function accepts (snake_case: it is sent to SQL as-is). */
export interface ProviderRecord {
  external_id: string;
  producer: string;
  name: string;
  wine_type: WineType | null;
  country_code: string | null;
  region: string | null;
  appellation: string | null;
  /** Vintages the provider lists; empty when it lists none (which does not mean non-vintage). */
  vintages: number[];
  non_vintage: boolean;
  /** Identity extras only (grapes, alcohol, the provider's own codes). */
  details: Record<string, string | number | boolean | string[]>;
  /** The provider's own page for this record, when it has one (https only). */
  source_url: string | null;
  /**
   * What CELLR changed compared with the provider's record, in plain words. Licences such as CC BY 4.0 require
   * changes to be indicated (section 3(a)(1)(B)); every adapter records them, whatever the licence.
   */
  modifications: string[];
}

export const RIGHTS_STATUSES = ["unverified", "verified", "blocked"] as const;
/** unverified: not yet established (pilot use only); verified: confirmed, with evidence; blocked: never import. */
export type RightsStatus = (typeof RIGHTS_STATUSES)[number];
export const SEARCH_SCOPES = ["off", "pilot", "public"] as const;
export type SearchScope = (typeof SEARCH_SCOPES)[number];

/** What a provider's licence allows, as recorded in `catalog_providers`. */
export interface ProviderInfo {
  id: string;
  name: string;
  license: string;
  license_url: string | null;
  attribution: string | null;
  homepage: string | null;
  /** The full legal notice, shown behind "more" wherever records are shown. */
  legal_notice: string | null;
  /** How CELLR changes this provider's records, in one sentence (shown with the attribution). */
  modification_notice: string | null;
  may_store: boolean;
  may_display: boolean;
  commercial_use: boolean;
  rights_status: RightsStatus;
  /** Where and how the rights were established (or why they are not): a blocker is written here, not assumed away. */
  rights_evidence: string | null;
  rights_verified_at: string | null;
  rights_verified_by: string | null;
  /** Always "off" here: showing a provider's records to people is the owner's explicit decision. */
  search_scope: SearchScope;
  notes: string | null;
}

export type AdapterResult = { ok: true; record: ProviderRecord } | { ok: false; reason: string };

/**
 * The providers evaluated in Sprint 004A (docs/sprints/sprint-004a/REPORT.md). Licence facts are from the providers'
 * own pages and files as read on 2026-11-11; `may_*` reflect what is known to be allowed, not what is hoped.
 */
export const PROVIDERS = {
  xwines: {
    id: "xwines",
    name: "X-Wines dataset",
    license: "CC0-1.0",
    license_url: "https://creativecommons.org/publicdomain/zero/1.0/",
    attribution:
      "X-Wines dataset — de Azambuja, Morais & Filipe (2023), Big Data Cogn. Comput. 7(1):20, doi:10.3390/bdcc7010020 (CC0 1.0)",
    homepage: "https://github.com/rogerioxavier/X-Wines",
    legal_notice:
      "X-Wines is dedicated to the public domain under CC0 1.0 by its authors. Its authors state that the data was collected on the open Web in 2022 and accept no responsibility for its accuracy. CELLR is not affiliated with or endorsed by the X-Wines authors.",
    modification_notice:
      "Names normalised and types mapped to CELLR's wine types by CELLR; ratings and other fields omitted.",
    may_store: true,
    may_display: true,
    commercial_use: true,
    rights_status: "unverified",
    rights_evidence:
      "LICENSE file (CC0 1.0) in github.com/rogerioxavier/X-Wines @5e43c7f; README usage policy. BLOCKER: CC0 only waives the authors' own rights. The data was 'collected on the open Web' from sources the authors do not itemise; third-party rights (e.g. an EU sui generis database right of the site it came from) are not cleared by CC0 (CC0 section 4(3)). Production use needs the source established.",
    rights_verified_at: null,
    rights_verified_by: null,
    search_scope: "off",
    notes: "Pilot only until the provenance blocker is resolved.",
  },
  lwin: {
    id: "lwin",
    name: "Liv-ex LWIN",
    license: "CC-BY-4.0",
    license_url: "https://www.liv-ex.com/lwin-creative-commons-licence/",
    attribution:
      "LWIN — Liv-ex Wine Identification Number, © Liv-ex, CC BY 4.0 (exact wording to be confirmed with Liv-ex)",
    homepage: "https://www.liv-ex.com/lwin/",
    legal_notice: null,
    modification_notice: null,
    // CC BY on the LWIN page, but the website terms (clause 11.4) and the membership terms (9.3, 9.13) restrict
    // storing and commercial use of Liv-ex data without written permission: blocked until Liv-ex confirms in writing.
    may_store: false,
    may_display: false,
    commercial_use: false,
    rights_status: "blocked",
    rights_evidence:
      "BLOCKER: liv-ex.com/lwin-creative-commons-licence (CC BY, commercial adaptation allowed) conflicts with liv-ex.com/website-terms-of-use 11.3-11.4 and liv-ex.com/liv-ex-membership-terms 9.3, 9.13, 9.14 (internal non-commercial use; no storing without written permission; no AI training). No LWIN-specific licence text was found. Written confirmation from Liv-ex (data@liv-ex.com) is required.",
    rights_verified_at: null,
    rights_verified_by: null,
    search_scope: "off",
    notes: "Download requires registration (HubSpot form); not downloaded in Sprint 004A.",
  },
  fixture: {
    id: "fixture",
    name: "CELLR test fixture",
    license: "CC0-1.0",
    license_url: null,
    attribution: "CELLR test fixture (not real data)",
    homepage: null,
    legal_notice: "Test data written by CELLR. Not a wine catalogue.",
    modification_notice: null,
    may_store: true,
    may_display: true,
    commercial_use: true,
    rights_status: "verified",
    rights_evidence:
      "Written by CELLR for tests (eval/catalog/fixture-xwines-layout.csv); no third-party data.",
    rights_verified_at: "2026-11-11",
    rights_verified_by: "Sprint 004A",
    search_scope: "off",
    notes: "Hand-written records for tests and the adapter pilot.",
  },
  lwin_fixture: {
    id: "lwin_fixture",
    name: "CELLR LWIN-layout test fixture",
    license: "CC0-1.0",
    license_url: null,
    attribution: "CELLR test fixture (not real data, not LWIN data)",
    homepage: null,
    legal_notice:
      "Fictitious records written by CELLR in the column layout CELLR ASSUMES the LWIN file has. Not Liv-ex data; the codes are invented.",
    modification_notice: null,
    may_store: true,
    may_display: true,
    commercial_use: true,
    rights_status: "verified",
    rights_evidence:
      "Written by CELLR for tests (eval/catalog/fixture-lwin-layout.csv); no third-party data, no real LWIN codes.",
    rights_verified_at: "2026-11-13",
    rights_verified_by: "WI-01",
    search_scope: "off",
    notes:
      "Exercises the LWIN adapter end to end without any Liv-ex data. Says nothing about the real file's layout.",
  },
} as const satisfies Record<string, ProviderInfo>;
export type ProviderId = keyof typeof PROVIDERS;

// ---- CSV ------------------------------------------------------------------------------------------------------------

/** RFC 4180 CSV: quoted fields, doubled quotes, commas and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  // A quote that is never closed swallows every following line into one field: the rest of the file would be
  // silently missing, so this is an unreadable file, not a short one.
  if (quoted) throw new Error("a quoted field is never closed");
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || (r[0] ?? "") !== "");
}

/** CSV rows as objects keyed by the header; refuses a file whose header lacks a required column. */
export function csvObjects(text: string, required: readonly string[]): Record<string, string>[] {
  const [header, ...rows] = parseCsv(text);
  if (!header) throw new Error("empty file");
  const missing = required.filter((c) => !header.includes(c));
  if (missing.length > 0) throw new Error(`missing columns: ${missing.join(", ")}`);
  // A column named twice would let one silently overwrite the other.
  const twice = header.find((h, i) => header.indexOf(h) !== i);
  if (twice !== undefined) throw new Error(`column ${JSON.stringify(twice)} occurs twice`);
  // A row with more or fewer fields than the header (an unquoted comma in a name, a cut-off line) would put values
  // under the wrong columns: a winery id as the producer. Never mapped; the whole file is refused.
  const ragged = rows.findIndex((r) => r.length !== header.length);
  if (ragged !== -1)
    throw new Error(
      `row ${ragged + 2} has ${rows[ragged]!.length} fields, the header has ${header.length}`,
    );
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

// ---- Shared helpers -------------------------------------------------------------------------------------------------

/** What exports write when a value is missing: never a name. */
const PLACEHOLDER = /^(null|nan|n\/a|#n\/a|none|undefined|-+|\?+)$/i;

const clean = (v: string | undefined, max: number): string | null => {
  const t = (v ?? "")
    // invisible direction and joining marks: they change how a name is shown, never what it is
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, "")
    // eslint-disable-next-line no-control-regex -- stripping control characters is the point
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t === "" || PLACEHOLDER.test(t) ? null : t.slice(0, max).trim();
};

/** The list inside a Python-style list literal: "['Merlot', 'Syrah']" → ["Merlot", "Syrah"]. */
export function pythonList(text: string): string[] {
  const inner = text.trim().replace(/^\[/, "").replace(/\]$/, "");
  if (inner.trim() === "") return [];
  const out: string[] = [];
  const re = /'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|([^,\s][^,]*)/g;
  for (const m of inner.matchAll(re)) out.push((m[1] ?? m[2] ?? m[3] ?? "").trim());
  return out.filter((s) => s !== "");
}

// ---- X-Wines -------------------------------------------------------------------------------------------------------

export const XWINES_COLUMNS = [
  "WineID",
  "WineName",
  "Type",
  "Elaborate",
  "Grapes",
  "ABV",
  "Code",
  "RegionName",
  "WineryName",
  "Vintages",
] as const;

const XWINES_TYPES: Record<string, WineType> = {
  red: "red",
  white: "white",
  rosé: "rose",
  rose: "rose",
  sparkling: "sparkling",
  dessert: "dessert",
  "dessert/port": "fortified",
};

/** Fields of the X-Wines file CELLR does not keep (identity only). */
const XWINES_OMITTED = "food pairings, body, acidity, website and ratings omitted";

/** One row of XWines_*_wines.csv. Ratings live in another file and are never read. */
export function fromXWinesRow(row: Record<string, string>): AdapterResult {
  const id = (row.WineID ?? "").trim();
  if (!/^\d{1,12}$/.test(id)) return { ok: false, reason: "WineID" };
  const producer = clean(row.WineryName, 120);
  const name = clean(row.WineName, 160);
  if (!producer || !name) return { ok: false, reason: "WineryName/WineName" };
  const code = (row.Code ?? "").trim().toUpperCase();
  const listed = pythonList(row.Vintages ?? "");
  const years = listed
    .filter((v) => /^\d{4}$/.test(v))
    .map(Number)
    .filter((y) => y >= 1800 && y <= 2100);
  const abv = Number(row.ABV);
  const details: ProviderRecord["details"] = {};
  const grapes = pythonList(row.Grapes ?? "").slice(0, 12);
  if (grapes.length > 0) details.grapes = grapes;
  if (Number.isFinite(abv) && abv > 0 && abv < 25) details.abv = abv;
  const elaborate = clean(row.Elaborate, 60);
  if (elaborate) details.elaborate = elaborate;
  const rawType = (row.Type ?? "").trim();
  const type = XWINES_TYPES[rawType.toLowerCase()] ?? null;
  const modifications = [XWINES_OMITTED];
  if (producer !== (row.WineryName ?? "") || name !== (row.WineName ?? ""))
    modifications.push("whitespace normalised");
  if (type && rawType.toLowerCase() !== type)
    modifications.push(`type "${rawType}" mapped to ${type}`.slice(0, 80));
  if (!type && rawType) modifications.push("type not mapped");
  if (listed.length !== years.length + (listed.some((v) => v.toUpperCase() === "N.V.") ? 1 : 0))
    modifications.push("implausible vintages dropped");
  return {
    ok: true,
    record: {
      external_id: id,
      producer,
      name,
      wine_type: type,
      country_code: /^[A-Z]{2}$/.test(code) ? code : null,
      region: clean(row.RegionName, 120),
      appellation: null,
      vintages: [...new Set(years)].sort((a, b) => a - b),
      non_vintage: listed.some((v) => v.toUpperCase() === "N.V."),
      details,
      source_url: null,
      modifications,
    },
  };
}

// ---- Liv-ex LWIN ----------------------------------------------------------------------------------------------------

/**
 * The LWIN download's columns AS ASSUMED: Liv-ex's pages do not list them and the file could not be downloaded
 * without registering. The adapter refuses any file without these columns, so a different layout fails loudly
 * instead of importing wrong identities. Verify against a real file before use (REPORT.md, open questions).
 */
export const LWIN_COLUMNS = [
  "LWIN",
  "STATUS",
  "PRODUCER_TITLE",
  "PRODUCER_NAME",
  "WINE",
  "COUNTRY",
  "REGION",
  "SUB_REGION",
  "COLOUR",
  "TYPE",
  "DESIGNATION",
  "CLASSIFICATION",
] as const;

/** Country names as LWIN-style files spell them → ISO 3166 codes (only the ones CELLR knows how to show). */
const COUNTRY_CODES: Record<string, string> = {
  france: "FR",
  italy: "IT",
  spain: "ES",
  portugal: "PT",
  germany: "DE",
  austria: "AT",
  hungary: "HU",
  greece: "GR",
  switzerland: "CH",
  "united states": "US",
  usa: "US",
  australia: "AU",
  "new zealand": "NZ",
  "south africa": "ZA",
  chile: "CL",
  argentina: "AR",
  "united kingdom": "GB",
  england: "GB",
  netherlands: "NL",
  lebanon: "LB",
  israel: "IL",
  canada: "CA",
  slovenia: "SI",
  croatia: "HR",
  georgia: "GE",
  romania: "RO",
  uruguay: "UY",
  brazil: "BR",
};

export function countryCodeOf(name: string | undefined): string | null {
  return COUNTRY_CODES[(name ?? "").trim().toLowerCase()] ?? null;
}

/** One row of the LWIN database file (wine level: LWIN-7). Deleted or combined codes are not imported. */
export function fromLwinRow(row: Record<string, string>): AdapterResult {
  const id = (row.LWIN ?? "").trim();
  if (!/^\d{7}$/.test(id) || /^0+$/.test(id)) return { ok: false, reason: "LWIN" };
  if ((row.STATUS ?? "").trim().toLowerCase() !== "live") return { ok: false, reason: "STATUS" };
  // each part is cleaned on its own, so a placeholder ("NULL") in one never becomes part of a name ("Chateau NULL"),
  // and a title alone ("Chateau") is not a producer
  const producerName = clean(row.PRODUCER_NAME, 120);
  if (!producerName) return { ok: false, reason: "PRODUCER/WINE" };
  const producer = clean(
    [clean(row.PRODUCER_TITLE, 40), producerName].filter(Boolean).join(" "),
    120,
  );
  const name = clean(row.WINE, 160) ?? producer;
  if (!producer || !name) return { ok: false, reason: "PRODUCER/WINE" };
  const colour = (row.COLOUR ?? "").trim().toLowerCase();
  const kind = (row.TYPE ?? "").trim().toLowerCase();
  // LWIN also numbers spirits and other drinks: CELLR's catalogue is wine only.
  if (
    /spirit|whisk|beer|sake|cider|liqueur|cognac|armagnac|brandy|calvados|grappa|rum|gin|vodka|tequila|mezcal/.test(
      kind,
    )
  )
    return { ok: false, reason: "TYPE (not wine)" };
  const type: WineType | null = kind.includes("fortified")
    ? "fortified"
    : kind.includes("sparkling") || kind.includes("champagne")
      ? "sparkling"
      : colour === "red"
        ? "red"
        : colour === "white"
          ? "white"
          : colour === "rose" || colour === "rosé"
            ? "rose"
            : null;
  const details: ProviderRecord["details"] = { lwin7: id };
  const classification = clean(row.CLASSIFICATION, 120);
  if (classification) details.classification = classification;
  return {
    ok: true,
    record: {
      external_id: id,
      producer,
      name,
      wine_type: type,
      country_code: countryCodeOf(row.COUNTRY),
      region: clean(row.SUB_REGION, 120) ?? clean(row.REGION, 120),
      appellation: clean(row.DESIGNATION, 160),
      vintages: [],
      non_vintage: false,
      details,
      source_url: null,
      modifications: ["producer title and name joined", ...(type ? [] : ["type not mapped"])],
    },
  };
}

export interface ProviderAdapter {
  /** The file layout this adapter reads. A file with another header is refused, never mapped by guessing. */
  schema: string;
  /**
   * Whether that layout was checked against the provider's real, lawfully obtained file. False = written from an
   * assumption: usable with synthetic fixtures only, and a real import stays blocked until someone verified it.
   */
  layoutVerified: boolean;
  columns: readonly string[];
  map: (row: Record<string, string>) => AdapterResult;
  /**
   * For an adapter whose layout is not verified: the SHA-256 of the one file it may read, CELLR's own fixture. Any
   * other file is refused, whatever provider it is offered for.
   */
  fixtureSha256?: string;
}

export const ADAPTERS = {
  xwines: {
    schema: "xwines-wines-csv-v1",
    layoutVerified: true,
    columns: XWINES_COLUMNS,
    map: fromXWinesRow,
  },
  lwin: {
    schema: "lwin-assumed-layout-v0",
    layoutVerified: false,
    columns: LWIN_COLUMNS,
    map: fromLwinRow,
  },
  // the fixture uses the X-Wines layout, so the adapter path is the same one a real file takes
  fixture: {
    schema: "xwines-wines-csv-v1",
    layoutVerified: true,
    columns: XWINES_COLUMNS,
    map: fromXWinesRow,
  },
  // fictitious records in the ASSUMED LWIN layout: tests the adapter, proves nothing about the real file
  lwin_fixture: {
    schema: "lwin-assumed-layout-v0",
    layoutVerified: false,
    columns: LWIN_COLUMNS,
    map: fromLwinRow,
    // eval/catalog/fixture-lwin-layout.csv (pinned by scripts/catalog-tools/eval.test.ts)
    fixtureSha256: "160b1934a2bbb2a98aa58a68dd637a0bb2a699d949eadbf35910fc4264369505",
  },
} as const satisfies Record<ProviderId, ProviderAdapter>;

// ---- Looking at a file before anything is imported ----------------------------------------------------------------

export interface FileInspection {
  schema: string;
  layoutVerified: boolean;
  /** Data rows in the file (the header not counted). */
  rows: number;
  /** The rows the adapter could map. */
  records: ProviderRecord[];
  /** Rows it could not map, by reason. */
  skipped: Record<string, number>;
  /** External ids that occur more than once (the first 20) and how many rows that concerns. */
  duplicateIds: string[];
  duplicateRows: number;
  /** Provider type values CELLR has no type for, with their counts (left empty, never guessed). */
  unmappedTypes: Record<string, number>;
  /** Rows with a vintage CELLR dropped as implausible. */
  implausibleVintageRows: number;
  /** Rows containing the replacement character or a classic mis-decoding ("Ã©"): the file was not read as UTF-8. */
  encodingRows: number;
  /** Why this file must not be imported as it is. Empty = it may be. */
  fatal: string[];
  warnings: string[];
}

/** UTF-8 that was read as Latin-1 or Windows-1252: "Ã©" for "é", "Ã‚" for "Â", "â€™" for "’". A heuristic. */
const MOJIBAKE =
  /Ã[\u0080-\u009f\u00a1-\u00bf\u0152\u0153\u0160\u0161\u0178\u017d\u017e\u02c6\u02dc\u2013-\u203a]|Â[\u00a1-\u00bf]|â€[\u0090-\u009f\u0153\u02dc\u2018-\u201e\u2122]/;
const REPLACEMENT = /\uFFFD/;

/** Bytes as UTF-8 text, or null when they are not valid UTF-8 (a Latin-1 or UTF-16 export). */
export function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/**
 * Everything worth knowing about a provider file before a single record is written: does it have the layout the
 * adapter was written for, is it comma-separated UTF-8, are its ids unique, what could not be mapped. A file with a
 * fatal problem is not imported at all (half a file with silently overwritten duplicates is worse than none).
 */
export function inspectProviderFile(text: string, providerId: ProviderId): FileInspection {
  const adapter: ProviderAdapter = ADAPTERS[providerId];
  const out: FileInspection = {
    schema: adapter.schema,
    layoutVerified: adapter.layoutVerified,
    rows: 0,
    records: [],
    skipped: {},
    duplicateIds: [],
    duplicateRows: 0,
    unmappedTypes: {},
    implausibleVintageRows: 0,
    encodingRows: 0,
    fatal: [],
    warnings: [],
  };
  let rows: Record<string, string>[];
  try {
    rows = csvObjects(text, adapter.columns);
  } catch (e) {
    const header =
      (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).split(/\r?\n/, 1)[0] ?? "";
    const other = [";", "\t", "|"].find((d) => {
      const cols = header.split(d).map((c) => c.trim().replace(/^"|"$/g, ""));
      return adapter.columns.every((c) => cols.includes(c));
    });
    out.fatal.push(
      other
        ? `the file is separated by ${JSON.stringify(other)}, not by commas`
        : `not the ${adapter.schema} layout: ${e instanceof Error ? e.message : "unreadable"}`,
    );
    return out;
  }
  out.rows = rows.length;
  // A file with a header and nothing else is a failed export, not an empty catalogue: importing it as a full file
  // would withdraw every record of the provider.
  if (rows.length === 0) {
    out.fatal.push("the file holds no rows");
    return out;
  }
  let replaced = 0;
  const seen = new Map<string, number>();
  for (const row of rows) {
    const values = Object.values(row);
    if (values.some((v) => REPLACEMENT.test(v))) replaced++;
    else if (values.some((v) => MOJIBAKE.test(v))) out.encodingRows++;
    const r = adapter.map(row);
    if (!r.ok) {
      out.skipped[r.reason] = (out.skipped[r.reason] ?? 0) + 1;
      continue;
    }
    const n = (seen.get(r.record.external_id) ?? 0) + 1;
    seen.set(r.record.external_id, n);
    if (n > 1) {
      out.duplicateRows++;
      if (n === 2 && out.duplicateIds.length < 20) out.duplicateIds.push(r.record.external_id);
      continue; // the first row of an id stands; a second one is never allowed to overwrite it silently
    }
    if (r.record.modifications.includes("type not mapped")) {
      const raw = (row.Type ?? row.TYPE ?? row.COLOUR ?? "").trim() || "(empty)";
      out.unmappedTypes[raw] = (out.unmappedTypes[raw] ?? 0) + 1;
    }
    if (r.record.modifications.includes("implausible vintages dropped"))
      out.implausibleVintageRows++;
    out.records.push(r.record);
  }
  if (out.duplicateRows > 0)
    out.fatal.push(
      `${out.duplicateRows} row(s) repeat an external id (${out.duplicateIds.slice(0, 5).join(", ")}…): ids must be unique`,
    );
  // The replacement character is proof the text was decoded wrongly. The "Ã©" patterns are a heuristic (a name may
  // legitimately hold such a pair), so they are fatal only when they are common, as they are in a mis-decoded file.
  const suspicious = out.encodingRows;
  out.encodingRows += replaced;
  if (replaced > 0 || (suspicious >= 3 && suspicious / out.rows > 0.005))
    out.fatal.push(`${out.encodingRows} row(s) are not valid UTF-8 text (mis-decoded characters)`);
  else if (suspicious > 0)
    out.warnings.push(`${suspicious} row(s) look mis-decoded ("Ã©"): check them`);
  if (out.rows > 0 && out.records.length === 0) out.fatal.push("no row could be mapped");
  const skippedTotal = Object.values(out.skipped).reduce((a, b) => a + b, 0);
  if (out.rows >= 50 && skippedTotal / out.rows > 0.2)
    out.fatal.push(
      `${skippedTotal} of ${out.rows} rows could not be mapped: this is probably not the ${adapter.schema} layout`,
    );
  else if (skippedTotal > 0) out.warnings.push(`${skippedTotal} row(s) skipped`);
  if (!adapter.layoutVerified)
    out.warnings.push(
      `the ${adapter.schema} layout is an assumption, not verified against the provider's real file`,
    );
  const unmapped = Object.values(out.unmappedTypes).reduce((a, b) => a + b, 0);
  if (unmapped > 0)
    out.warnings.push(`${unmapped} record(s) have a type CELLR does not map (left empty)`);
  return out;
}

/**
 * Why this file may not be imported for this provider, or null when it may. Two gates: the file itself (layout,
 * separator, encoding, unique ids, no ragged rows), and the adapter: one written from an assumed layout reads exactly
 * one file, CELLR's own fixture, recognised by its SHA-256 — not by the name of the provider it is offered for. A
 * real LWIN file therefore cannot be imported under any provider until the layout was verified against it and
 * `layoutVerified` was changed in a reviewed commit. (Whether the provider's RIGHTS allow an import is a third,
 * separate gate, in the database.)
 */
export function importBlocker(
  providerId: ProviderId,
  inspection: FileInspection,
  fileSha256: string,
): string | null {
  if (inspection.fatal.length > 0) return inspection.fatal[0]!;
  const adapter: ProviderAdapter = ADAPTERS[providerId];
  if (!adapter.layoutVerified && (!adapter.fixtureSha256 || adapter.fixtureSha256 !== fileSha256))
    return `the ${inspection.schema} layout was never verified against a real ${PROVIDERS[providerId].name} file: a real import stays blocked until it is`;
  return null;
}
