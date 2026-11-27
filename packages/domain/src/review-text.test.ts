import { describe, expect, it } from "vitest";
import { REVIEW_LINK_PATTERNS, reviewTextHasLink } from "./review-text";
import { PublishReviewSchema } from "./wine-ratings";

// The same examples as supabase/tests/99_community_hardening.test.sql: the database applies the same rule.
const BAD = [
  "kijk op https://spam.example",
  "HTTP : // x",
  "ftp://files.example",
  "zie www.spam.example",
  "WWW spam",
  "ｗｗｗ．ｓｐａｍ．ｃｏｍ",
  "spam.com",
  "Visit SPAM.COM now",
  "wijnhandel.nl",
  "mail me: anna@example.org",
  "anna (at) example (dot) org",
  "anna[at]example[.]nl",
  "spam dot com",
  "spam DOT nl",
  "spam[.]com",
  "spam(.)io",
  "best-wine.shop",
  "x.com",
  "go to cheap.wine",
  "a@b.co",
  "spam。com",
  "foo.co.uk",
  "ｓｐａｍ．ｎｌ",
];
const GOOD = [
  "St. Émilion",
  "Ch. Margaux",
  "D.O.Ca. Rioja",
  "e.g. cherry",
  "4.5 stars",
  "13.5% alc.",
  "1er Cru, vol. 13,5%",
  "Awww. Lovely wine.",
  "A dot of cream, served at 16 degrees",
  "Ch. de Beaucastel, Dom. du Pégau",
  "N.V. Brut, A.O.C. Champagne",
  "i.e. ripe",
  "Served @ 16°C",
  "Top. Lange afdronk, o.a. kers.",
  "Rijp en lang.",
  "Côte-Rôtie 2015 — 92/100",
  "Wine. It was great",
  "St.-Julien",
  "St.Émilion",
  "Château d'Yquem 1.5L magnum",
  "Q.b.A. Mosel",
  "Napa Valley, CA. Big fruit.",
  "Grand cru. De afdronk is lang",
];

describe("the review text rule", () => {
  it.each(BAD)("refuses %s", (s) => {
    expect(reviewTextHasLink(s)).toBe(true);
  });
  it.each(GOOD)("lets normal wine text through: %s", (s) => {
    expect(reviewTextHasLink(s)).toBe(false);
  });
  it("reads the text after NFKC: full-width and decomposed letters are the plain ones", () => {
    expect(reviewTextHasLink("ｈｔｔｐｓ：／／ｘ")).toBe(true);
    // "St. E" + combining acute: composed to É, not a two-letter ending
    expect(reviewTextHasLink("St.Émilion")).toBe(false);
  });
  it("uses only syntax PostgreSQL reads the same way (no \\b, no lookaround, no flags inline)", () => {
    for (const p of REVIEW_LINK_PATTERNS) {
      expect(p).not.toMatch(/\\b|\(\?[=!<:]|\(\?[a-z]/);
      expect(p).not.toContain("'");
    }
  });
  it("is fast on long hostile input (no catastrophic backtracking)", () => {
    const inputs = [
      "a@" + "b.".repeat(740) + "!",
      "a".repeat(1400) + "@" + "b-".repeat(50),
      "x (".repeat(500),
      "aa" + " [ ".repeat(490),
    ];
    const t0 = performance.now();
    for (const s of inputs) reviewTextHasLink(s);
    expect(performance.now() - t0).toBeLessThan(500);
  });
  it("is the rule PublishReviewSchema applies", () => {
    for (const body of BAD)
      expect(PublishReviewSchema.safeParse({ body, consent: true }).success).toBe(false);
    for (const body of GOOD)
      expect(PublishReviewSchema.safeParse({ body, consent: true }).success).toBe(true);
  });
});
