import { describe, expect, it } from "vitest";
import { checkOffer, selectOffers, type OfferQuery, type RetailOffer } from "./offers";

const NOW = new Date("2026-11-19T18:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

const offer = (o: Partial<RetailOffer> = {}): RetailOffer => ({
  id: "o-1",
  producer: "Domaine Exemple",
  name: "Chablis",
  year: 2022,
  sizeMl: 750,
  priceCents: 2300,
  currency: "EUR",
  merchant: "Voorbeeld Wijnhandel",
  url: "https://www.example.nl/wijn/chablis-2022",
  observedAt: hoursAgo(3),
  kind: "online",
  ...o,
});
const query = (q: Partial<OfferQuery> = {}): OfferQuery => ({
  text: "Chablis",
  year: null,
  sizeMl: 750,
  maxCents: 3000,
  currency: "EUR",
  channel: null,
  ...q,
});
const POLICY = { maxAgeHours: { online: 24, local: 6 }, allowedHosts: ["example.nl"] };
const defects = (o: Partial<RetailOffer>, q: Partial<OfferQuery> = {}) =>
  checkOffer(offer(o), query(q), NOW, POLICY);

describe("an offer is shown only when every check passes", () => {
  it("passes a sound online offer", () => {
    expect(defects({})).toEqual([]);
  });
  it.each([
    ["another wine", { name: "Barolo" }, {}, "identity-mismatch"],
    [
      "a wine that only shares a word",
      { name: "Petit Chablis" },
      { text: "Chablis Premier Cru" },
      "identity-mismatch",
    ],
    ["another vintage than asked", { year: 2018 }, { year: 2022 }, "wrong-vintage"],
    ["no vintage where one was asked", { year: null }, { year: 2022 }, "wrong-vintage"],
    ["a half bottle", { sizeMl: 375 }, {}, "wrong-size"],
    ["a magnum", { sizeMl: 1500 }, {}, "wrong-size"],
    ["no price", { priceCents: null }, {}, "no-price"],
    ["a zero price", { priceCents: 0 }, {}, "no-price"],
    ["a fractional price", { priceCents: 19.99 }, {}, "no-price"],
    ["another currency", { currency: "USD" }, {}, "wrong-currency"],
    ["over the budget", { priceCents: 3001 }, {}, "over-budget"],
    ["no merchant", { merchant: "  " }, {}, "no-merchant"],
    ["no link", { url: "" }, {}, "no-url"],
    ["a link that is not one", { url: "example.nl/wijn" }, {}, "no-url"],
    ["a plain http link", { url: "http://www.example.nl/wijn/1" }, {}, "insecure-url"],
    ["a javascript link", { url: "javascript:alert(1)" }, {}, "no-url"],
    ["a link with credentials", { url: "https://user:pw@www.example.nl/x" }, {}, "insecure-url"],
    ["a price seen two days ago", { observedAt: hoursAgo(49) }, {}, "stale"],
    ["no timestamp", { observedAt: "" }, {}, "stale"],
    ["a timestamp from the future", { observedAt: hoursAgo(-5) }, {}, "stale"],
    ["sold out", { inStock: false }, {}, "out-of-stock"],
    [
      "a local listing no store confirmed",
      { kind: "local" as const, store: { name: "Winkel", verified: false } },
      {},
      "unverified-store",
    ],
    ["a local listing with no store", { kind: "local" as const }, {}, "unverified-store"],
    [
      "a store offer when online was asked",
      { kind: "local" as const, store: { name: "W", verified: true }, inStock: true },
      { channel: "online" as const },
      "wrong-channel",
    ],
    ["an online offer when pickup was asked", {}, { channel: "pickup" as const }, "wrong-channel"],
  ])("rejects %s", (_name, o, q, defect) => {
    expect(defects(o, q)).toContain(defect);
  });
  it("store stock goes stale sooner than a web listing", () => {
    const local = {
      kind: "local" as const,
      store: { name: "Winkel", verified: true },
      inStock: true,
    };
    expect(defects({ ...local, observedAt: hoursAgo(5) })).toEqual([]);
    expect(defects({ ...local, observedAt: hoursAgo(8) })).toContain("stale");
    expect(defects({ observedAt: hoursAgo(8) })).toEqual([]);
  });
  it("holds a provider to its own merchants' hosts", () => {
    const policy = { maxAgeHours: { online: 24, local: 6 }, allowedHosts: ["example.nl"] };
    expect(checkOffer(offer(), query(), NOW, policy)).toEqual([]);
    expect(checkOffer(offer({ url: "https://evil.test/chablis" }), query(), NOW, policy)).toContain(
      "foreign-url",
    );
    expect(
      checkOffer(offer({ url: "https://example.nl.evil.test/x" }), query(), NOW, policy),
    ).toContain("foreign-url");
  });
  it("shows nothing when the provider names no merchants' hosts", () => {
    expect(checkOffer(offer(), query(), NOW)).toContain("foreign-url");
    expect(checkOffer(offer(), query(), NOW, { ...POLICY, allowedHosts: [""] })).toContain(
      "foreign-url",
    );
  });
  it.each([
    ["a port", { url: "https://www.example.nl:8443/wijn" }, "insecure-url"],
    ["a look-alike host", { url: "https://www.exarnple.nl/wijn" }, "foreign-url"],
    ["a time without its zone", { observedAt: "2026-11-19T16:00:00" }, "stale"],
    ["a time that is not ISO", { observedAt: "Nov 19, 2026 16:00 UTC" }, "stale"],
    ["an absurd price", { priceCents: 1e15 }, "no-price"],
    [
      "a wine whose producer, not its name, matches",
      { producer: "Chablis Frères", name: "Mâcon" },
      "identity-mismatch",
    ],
    [
      "a store listing with no word on stock",
      { kind: "local" as const, store: { name: "W", verified: true } },
      "unverified-store",
    ],
  ])("rejects %s", (_name, o, defect) => {
    expect(defects(o)).toContain(defect);
  });
  it("matches hosts as hosts are: case and a trailing dot do not matter", () => {
    const policy = { ...POLICY, allowedHosts: ["Example.NL."] };
    expect(checkOffer(offer({ url: "https://WWW.EXAMPLE.NL/wijn" }), query(), NOW, policy)).toEqual(
      [],
    );
  });
  it("a query for nothing matches nothing", () => {
    expect(defects({}, { text: "  " })).toContain("identity-mismatch");
  });
  it("a hole in the data is a defect, never a guess", () => {
    // A zero year, an empty name: nothing is filled in on the offer's behalf.
    expect(defects({ producer: "", name: "" })).toContain("identity-mismatch");
  });
});

describe("selecting offers", () => {
  it("shows the sound ones cheapest first, at the level each proves, and records why the rest were dropped", () => {
    const { shown, rejected } = selectOffers(
      [
        offer({ id: "dear", priceCents: 2900 }),
        offer({ id: "stale", observedAt: hoursAgo(80) }),
        offer({ id: "cheap", priceCents: 1900 }),
        offer({
          id: "store",
          kind: "local",
          store: { name: "Winkel", verified: true },
          inStock: true,
          priceCents: 2100,
        }),
        offer({ id: "half", sizeMl: 375, priceCents: 1200 }),
      ],
      query(),
      NOW,
      POLICY,
    );
    expect(shown.map((s) => [s.offer.id, s.level])).toEqual([
      ["cheap", "online-offer"],
      ["store", "local-availability"],
      ["dear", "online-offer"],
    ]);
    expect(rejected).toEqual([
      { id: "stale", defects: ["stale"] },
      { id: "half", defects: ["wrong-size"] },
    ]);
  });
  it("shows nothing when nothing is sound", () => {
    expect(selectOffers([offer({ priceCents: null })], query(), NOW, POLICY).shown).toEqual([]);
    expect(selectOffers([], query(), NOW, POLICY).shown).toEqual([]);
  });
});
