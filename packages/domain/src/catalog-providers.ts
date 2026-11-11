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
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

// ---- Shared helpers -------------------------------------------------------------------------------------------------

const clean = (v: string | undefined, max: number): string | null => {
  const t = (v ?? "")
    // eslint-disable-next-line no-control-regex -- stripping control characters is the point
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t === "" ? null : t.slice(0, max).trim();
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
  if (!/^\d{7}$/.test(id)) return { ok: false, reason: "LWIN" };
  if ((row.STATUS ?? "").trim().toLowerCase() !== "live") return { ok: false, reason: "STATUS" };
  const producer = clean([row.PRODUCER_TITLE, row.PRODUCER_NAME].filter(Boolean).join(" "), 120);
  const name = clean(row.WINE, 160) ?? producer;
  if (!producer || !name) return { ok: false, reason: "PRODUCER/WINE" };
  const colour = (row.COLOUR ?? "").trim().toLowerCase();
  const kind = (row.TYPE ?? "").trim().toLowerCase();
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

export const ADAPTERS = {
  xwines: { columns: XWINES_COLUMNS, map: fromXWinesRow },
  lwin: { columns: LWIN_COLUMNS, map: fromLwinRow },
  // the fixture uses the X-Wines layout, so the adapter path is the same one a real file takes
  fixture: { columns: XWINES_COLUMNS, map: fromXWinesRow },
} as const satisfies Record<
  ProviderId,
  { columns: readonly string[]; map: (row: Record<string, string>) => AdapterResult }
>;
