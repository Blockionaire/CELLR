/**
 * THE REVIEW TEXT RULE: a public CELLR review holds no link and no contact address (docs/sprints/ratings/DESIGN.md §3).
 *
 * ONE rule, enforced twice with the same patterns: here (PublishReviewSchema, so the person hears it at once) and in
 * the database (`private.review_text_has_link`, migration 20261203000055_community_hardening.sql: the publish
 * function and a table check), which is what really decides. A web test checks that every pattern below appears
 * verbatim in that migration; change both together, in a new migration.
 *
 * How a text is read: Unicode NFKC first (full-width "ｗｗｗ．ｅｘａｍｐｌｅ．ｃｏｍ" becomes "www.example.com"), then every
 * pattern case-insensitively. The patterns use only syntax JavaScript and PostgreSQL read the same way (no `\b`,
 * no lookaround: an explicit "not a letter or digit" instead). A text is refused when it holds:
 *
 * 1. a scheme: `http:/`, `https:/`, `ftp:/`, `ftps:/` (spaces around the colon too);
 * 2. `www` as a word of its own;
 * 3. an e-mail address: `name@host.tld`, also written `name (at) host (dot) tld` or `name@host[.]tld`;
 * 4. a domain with a common generic ending (`.com`, `.net`, `.org`, `.wine`, `.shop`, … see GENERIC_TLDS), the dot
 *    also written `[.]`, `(.)`, `(dot)`, `[punt]` or `。`;
 * 5. a domain with a two-letter country ending (`.nl`, `.fr`, `.io`, …) after a name of at least two letters or
 *    digits, the dot also obfuscated as in 4;
 * 6. a spelled-out dot before a generic or a common country ending: `example dot com`, `example dot nl`.
 *
 * Normal wine text passes: "St. Émilion", "Ch. Margaux", "D.O.Ca.", "e.g.", "4.5 stars", "13.5% alc.", "1er Cru".
 * Known, accepted false positive: a full stop typed without the space after it, directly followed by a two-letter word
 * or a generic ending ("lovely.it is", "wine.shop"). The person is told links are not allowed and adds the space.
 */

/** Generic endings refused after any name (rule 4); every two-letter ending is covered by rule 5. */
export const GENERIC_TLDS = [
  "com",
  "net",
  "org",
  "info",
  "biz",
  "xyz",
  "online",
  "site",
  "website",
  "shop",
  "store",
  "club",
  "app",
  "dev",
  "wine",
  "vin",
  "link",
  "click",
  "icu",
  "vip",
  "tech",
  "blog",
  "email",
  "cloud",
  "mobi",
  "asia",
] as const;

/** Country endings that also count after a spelled-out " dot " (rule 6); English words such as "it", "at" do not. */
export const SPELLED_DOT_COUNTRY_TLDS = [
  "nl",
  "be",
  "de",
  "fr",
  "uk",
  "eu",
  "io",
  "co",
  "ru",
  "cn",
] as const;

// A dot, written plainly, as the ideographic full stop, or obfuscated in brackets: ".", "。", "[.]", "(dot)", "{punt}".
const DOT = String.raw`([.。]|\s*[[({<]\s*([.。]|dot|punt)\s*[)\]}>]\s*)`;
// An at sign, plainly (spaces around it too) or obfuscated in brackets: "@", " @ ", "(at)", "[@]".
const AT = String.raw`(\s*@\s*|\s*[[({<]\s*(@|at)\s*[)\]}>]\s*)`;
const END = String.raw`([^a-z0-9]|$)`;
const GENERIC = `(${GENERIC_TLDS.join("|")})`;
const SPELLED = `(${[...GENERIC_TLDS, ...SPELLED_DOT_COUNTRY_TLDS].join("|")})`;

/** The patterns, in the order of the rules above; matched case-insensitively against the NFKC text. */
export const REVIEW_LINK_PATTERNS: readonly string[] = [
  String.raw`(https?|ftps?)\s*:\s*/`,
  String.raw`(^|[^a-z0-9])www${END}`,
  String.raw`[a-z0-9._%+-]${AT}[a-z0-9-]+(${DOT}[a-z0-9-]+)*${DOT}[a-z]{2,}`,
  String.raw`[a-z0-9]${DOT}${GENERIC}${END}`,
  String.raw`[a-z0-9]{2}${DOT}[a-z]{2}${END}`,
  String.raw`[a-z0-9]\s+dot\s+${SPELLED}${END}`,
];

const COMPILED = REVIEW_LINK_PATTERNS.map((p) => new RegExp(p, "i"));

/** Whether a review text holds a link or a contact address under the rule above. */
export function reviewTextHasLink(text: string): boolean {
  const t = text.normalize("NFKC");
  return COMPILED.some((r) => r.test(t));
}
