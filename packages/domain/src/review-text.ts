/**
 * THE REVIEW TEXT RULE: a public CELLR review holds no link and no contact address (docs/sprints/ratings/DESIGN.md §3).
 *
 * ONE rule, enforced twice with the same patterns: here (PublishReviewSchema, so the person hears it at once) and in
 * the database (`private.review_text_has_link`, migration 20261204000056_community_hardening.sql: the publish
 * function and a table check), which is what really decides. A web test checks that the invisible-character pattern
 * and every rule pattern below appear verbatim in that migration; change both together, in a new migration.
 *
 * How a text is read: Unicode NFKC first (full-width "ｗｗｗ．ｅｘａｍｐｌｅ．ｃｏｍ" becomes "www.example.com"), then the
 * invisible format characters (soft hyphen, zero-width spaces and joiners, direction marks, word joiner, BOM) are
 * removed, so "example\u200b.com" is "example.com"; then every pattern, case-insensitively. The patterns use only
 * syntax JavaScript and PostgreSQL read the same way (no `\b`, no lookaround: an explicit "not a letter or digit"
 * instead). A dot is ".", "。" or "·", or obfuscated in brackets: "[.]", "(dot)", "{punt}". A text is refused when it
 * holds:
 *
 * 1. a scheme: `http:/`, `https:/`, `ftp:/`, `ftps:/` (spaces around the colon too);
 * 2. `www` as a word of its own;
 * 3. an e-mail address: `name@host.tld`, also written `name (at) host (dot) tld` or `name@host[.]tld`;
 * 4. a domain with a common generic ending (`.com`, `.net`, `.org`, `.wine`, `.top`, … see GENERIC_TLDS);
 * 5. the same with a space before the dot: `example .com`, `example . com` (a sentence never has a space before its
 *    full stop, so "It was fun. Top wine" is not refused);
 * 6. a domain with a two-letter country ending (`.nl`, `.fr`, `.io`, …) after a name of at least two letters or
 *    digits;
 * 7. a spelled-out dot before a generic or a common country ending: `example dot com`, `wijnhuis punt nl`;
 * 8. any domain-like name followed by a slash, whatever its length: `t.me/x`, `t.co/x`.
 *
 * Normal wine text passes: "St. Émilion", "Ch. Margaux", "D.O.Ca.", "e.g.", "4.5 stars", "13.5% alc.", "1er Cru".
 * Known, accepted false positive: a full stop typed without the space after it, directly followed by a two-letter word
 * or a generic ending ("Ch.de Beaucastel", "Dom.du Pégau", "St.Jo", "Rhône.Vin de pays"). The message tells the
 * person to put a space after the full stop.
 */

/** Generic endings refused after any name (rules 4, 5); every two-letter ending is covered by rule 6. */
export const GENERIC_TLDS = [
  "com",
  "net",
  "org",
  "info",
  "biz",
  "xyz",
  "top",
  "online",
  "site",
  "website",
  "space",
  "shop",
  "store",
  "club",
  "app",
  "dev",
  "wine",
  "vin",
  "link",
  "click",
  "live",
  "life",
  "fun",
  "work",
  "buzz",
  "rest",
  "bond",
  "cfd",
  "sbs",
  "cyou",
  "quest",
  "lol",
  "monster",
  "icu",
  "vip",
  "tech",
  "blog",
  "email",
  "cloud",
  "mobi",
  "asia",
] as const;

/** Country endings that also count after a spelled-out dot (rule 7); English words such as "it", "at" do not. */
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

/** Invisible format characters removed before matching (after NFKC). */
export const REVIEW_INVISIBLE_PATTERN = String.raw`[\u00ad\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]`;

// A dot, written plainly (".", "。", "·") or obfuscated in brackets: "[.]", "(dot)", "{punt}".
const DOT = String.raw`([.。·]|\s*[[({<]\s*([.。·]|dot|punt)\s*[)\]}>]\s*)`;
// An at sign, plainly (spaces around it too) or obfuscated in brackets: "@", " @ ", "(at)", "[@]".
const AT = String.raw`(\s*@\s*|\s*[[({<]\s*(@|at)\s*[)\]}>]\s*)`;
const END = String.raw`([^a-z0-9]|$)`;
const GENERIC = `(${GENERIC_TLDS.join("|")})`;
const SPELLED = `(${[...GENERIC_TLDS, ...SPELLED_DOT_COUNTRY_TLDS].join("|")})`;

/** The patterns, in the order of the rules above; matched case-insensitively against the prepared text. */
export const REVIEW_LINK_PATTERNS: readonly string[] = [
  String.raw`(https?|ftps?)\s*:\s*/`,
  String.raw`(^|[^a-z0-9])www${END}`,
  String.raw`[a-z0-9._%+-]${AT}[a-z0-9-]+(${DOT}[a-z0-9-]+)*${DOT}[a-z]{2,}`,
  String.raw`[a-z0-9]${DOT}${GENERIC}${END}`,
  String.raw`[a-z0-9]\s+[.。·]\s*${GENERIC}${END}`,
  String.raw`[a-z0-9]{2}${DOT}[a-z]{2}${END}`,
  String.raw`[a-z0-9]\s+(dot|punt)\s+${SPELLED}${END}`,
  String.raw`[a-z0-9]${DOT}[a-z]{2,}\s*/`,
];

const INVISIBLE = new RegExp(REVIEW_INVISIBLE_PATTERN, "g");
const COMPILED = REVIEW_LINK_PATTERNS.map((p) => new RegExp(p, "i"));

/** Whether a review text holds a link or a contact address under the rule above. */
export function reviewTextHasLink(text: string): boolean {
  const t = text.normalize("NFKC").replace(INVISIBLE, "");
  return COMPILED.some((r) => r.test(t));
}

/** What a person is told when the rule refuses their text (also a known message, translated on screen). */
export const REVIEW_LINK_MESSAGE =
  "Links, web or e-mail addresses are not allowed. If you meant an abbreviation, put a space after the full stop.";
