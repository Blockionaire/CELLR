# CELLR — design overhaul plan

> Status: **built (D0–D11), D12 polish ongoing.** Direction chosen: **A + B** — one token system with two skins, light
> "Maison" (paper, burgundy) and dark "Noir" (near-black wine, brass, soft glow), following the system theme. The mockups
> were reviewed and approved before the build. Goal (from the brief): the best-looking, smoothest wine app on the market,
> at least as pleasant and usable as Oeni. Phone first, desktop second, light and dark, Dutch and English.

| Step                             | State   | Notes                                                                                                                                                               |
| -------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D0 Direction and references      | done    | Maison + Noir chosen from three mockups.                                                                                                                            |
| D1 Tokens                        | done    | `globals.css`: paper/noir surfaces, maturity colours, wine stages, glass colours, glow; contrasts computed (AA). One display font (Instrument Serif) in both skins. |
| D2 Bottle                        | done    | `BottleGlyph` is the CELLR bottle (glass, capsule, paper label typeset from the producer, or the label cut-out).                                                    |
| D3 Components                    | done    | Pill buttons/chips/toggles, sheet with grab handle, toast, empty state, nav, page header. No View Transitions yet.                                                  |
| D4 Cellar                        | done    | Stage tiles, drinking-window bar, quick type filters, sticky search, pill links. Label photos still show on tiles.                                                  |
| D5 Wine page                     | done    | Hero, key facts, drinking-window curve, grouped sections, sticky action bar.                                                                                        |
| D6 Home                          | done    | Deep-wine Tonight hero, stage cards.                                                                                                                                |
| D7 Add and scan                  | done    | Bottle choices on stages, live preview in the new-wine form, viewfinder look.                                                                                       |
| D8 Tonight and Sommelier         | done    | Hero pick, compact picks, chat bubbles, floating composer.                                                                                                          |
| D9 Insights                      | done    | Donut, drinking timeline, maturity stages, value card (the stats have totals only, so no value-over-time line).                                                     |
| D10 Places and 3D                | done    | Place cards with fill rings, round rack slots, showcase panel.                                                                                                      |
| D11 Profile, sign-in, onboarding | done    | Auth shell, grouped profile cards, wishlist/history thumbnails.                                                                                                     |
| D12 Polish                       | ongoing | Full suite green; remaining: View Transitions, swipe actions, Dutch overflow sweep on a real phone.                                                                 |

## 1. What this is based on — and what it is not

**Oeni** ([App Store](https://apps.apple.com/US/app/id6445827140)): the listing stresses a 3D cellar view, a database of
400,000+ bottles to scan or add from, monthly market prices, capital gain per bottle, spend analysis and food pairing.
**I could not look at Oeni's real screens**: the sandbox cannot reach oeni.app, the App Store pages or screenshot
galleries (blocked), and search only returns listing text. So this plan is built from (a) their public feature claims,
(b) an audit of CELLR's own screens, and (c) general best practice for premium collection apps. Before step D1 starts I
need 5–10 reference screenshots from you (Oeni and anything else you love) — see [§9](#9-decisions-i-need-from-you).

## 2. Audit of the app today

Screens captured with a realistic demo cellar (6 wines, a fridge, one opened and rated bottle), phone and desktop.

| Area              | Finding                                                                                                                                      |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Overall           | Calm cream / burgundy / serif identity, but flat: every card is the same weight, no depth, no hierarchy.                                     |
| Bottles           | Generic flat SVG glyphs everywhere. The label photo the user took is never shown on a bottle outside the 3D view.                            |
| Home              | Hero card + four text buttons + plain stat tiles. Nothing to look at, nothing that says "your cellar".                                       |
| Cellar            | Header crowded: text links, search, filter and a 4-way segmented control compete. Cards have small, truncated metadata; no drink-window cue. |
| Wine page         | One long stack of equal-weight cards; the important things (stock, drink window, rate/open) are not first.                                   |
| Add / choose wine | Text-only list. No picture of what you are selecting.                                                                                        |
| Insights          | Correct but basic charts; no consistent chart language, little interaction.                                                                  |
| Chrome            | Bottom tab bar overlaps content; sheets are plain; no page transitions; few micro-interactions.                                              |
| Strong already    | 3D rack + showcase film with the blurred still rack; label cut-out and straightening; EN/NL parity; a11y tests.                              |

## 3. Design principles

1. **The bottle is the hero.** Wherever a wine appears it appears as a _picture of a bottle_ in the right shape and
   colour, with the real label when we have it.
2. **One primary action per screen**, visually unmistakable. Everything else is secondary or lives in a menu.
3. **Depth with restraint**: a small elevation scale, soft shadows, tinted surfaces per wine type — never decoration.
4. **Numbers are typographic objects**: serif display numerals, tabular figures, units in small caps.
5. **Motion explains**: shared-element transitions (card → wine page), springy sheets, reduced-motion respected.
6. **Phone first**: thumb reach, 44px targets, sheets over pages, nothing hidden behind the tab bar.
7. **Dutch is the long language**: every layout is checked in `nl` first.

## 4. Bottle imagery — the key decision

Oeni-class apps feel rich because every wine has a bottle picture. We can't (and shouldn't) scrape Vivino or others:
their photos are copyrighted and their terms forbid it. Options:

|                                    | Source                                                                                                                                                                                                                                                                                                                                                         | Pros                                                                                                                             | Cons                                                                                                                                                                                            |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Bottle sprite (recommended)** | Our own layered SVG/canvas bottle: silhouette by bottle shape (bordeaux, burgundy, flute, …), glass colour and foil by wine type, **the user's straightened label cut-out as the label**, cylinder shading + highlight on top. Without a label photo: a typographic label from producer/name in our style (clearly generated, never a fake of the real label). | No licence, no cost, no migration, instant in lists of 100+ wines, consistent look, uses what we already store (`texture_path`). | Looks as good as the label photo; wines without a scan look "designed", not photographed.                                                                                                       |
| B. Own photo                       | The user's front photo, cut out.                                                                                                                                                                                                                                                                                                                               | Real.                                                                                                                            | Uneven quality/background; not uniform in a grid.                                                                                                                                               |
| C. Licensed catalogue              | A paid image/wine data provider.                                                                                                                                                                                                                                                                                                                               | Looks like a store.                                                                                                              | Cost, licence per use, matching errors. (TinEye WineEngine, [docs](https://help.tineye.com/article/201-what-is-wineengine), is _recognition_ against a label set you supply — not a catalogue.) |
| D. Shared community cut-outs       | A label cut-out one household made is reused for the same wine by others.                                                                                                                                                                                                                                                                                      | Gets richer with users.                                                                                                          | Privacy/copyright to settle; only after going commercial.                                                                                                                                       |
| E. AI-generated labels             | —                                                                                                                                                                                                                                                                                                                                                              | —                                                                                                                                | **No.** A made-up label for a real wine is misinformation.                                                                                                                                      |

**Plan:** A everywhere now (with B as the "photo" tab on the wine page). C/D are an optional later layer, behind the same
`<Bottle>` component, so nothing else changes when/if we add them. A later upgrade is a pre-rendered 3D still of the same
bottle for the hero (needs a small migration; not now).

## 5. Quality gates (every step)

- Screenshots, phone 390×844 and desktop 1280×800, light and dark, **en and nl**, shown to you at each checkpoint.
- `tsc`, ESLint (architecture + React-compiler rules), axe a11y in light + dark, i18n parity test.
- Targeted e2e for what the step touches. Redesign changes markup, so existing specs are updated _with_ the step;
  accessible names stay stable wherever possible. A full suite run only at the end of D3 and D12 — or when you ask.
- Perf budget: no new heavy dependency (charts stay hand-built SVG); LCP/INP checked on the cellar and wine pages.
- No schema changes unless a step says so; if one does, I give you the SQL and the app keeps working until you run it.

## 6. The steps

Each step is one checkpoint (own commit, screenshots, report in the usual 4 parts).

**D0 — Direction & references** _(needs you)_
Reference screenshots; pick a direction from two "style tiles" I build on the real home + cellar screens
(A: warm cream/burgundy "modern classic", B: dark "cellar noir" default). Output: the decided palette, type pair, radius/shadow feel.

**D1 — Design-system foundation**
Tokens: colour scales (neutral, accent, a calibrated palette per wine type), surfaces + 4-level elevation, radii, spacing,
type scale (display serif for names and figures, tabular numerals), motion tokens (springs, durations, reduced motion),
one icon style (stroke weight, size grid), refined dark mode. A dev-only `/design` page that shows every token and
component in light/dark/en/nl — the single place to review the system.

**D2 — `<Bottle>` sprite + wine-type visuals**
The component from §4-A in sizes xs → hero; shapes per bottle type; foil/glass per wine type; label slot (cut-out →
typographic fallback); skeleton; shared across every screen. Visual tests per shape × type × with/without label.

**D3 — Core components**
Buttons (clear hierarchy, press feedback), cards (tile / row / hero variants), sheets (grab handle, drag to dismiss,
snap points), segmented/chips/inputs/steppers, toasts, illustrated empty states, swipe actions on rows, collapsing large
headers, bottom bar that no longer covers content, page / shared-element transitions (View Transitions API where
available, graceful otherwise). _Full-suite checkpoint._

**D4 — Cellar** _(the most visible screen)_
Grid of bottle tiles by default (2 columns phone, 4–6 desktop), list view, sticky search + filter chips + sort sheet,
group by type / region / producer / drink window, drink-window ribbon and count badge on tiles, header reduced to one
primary action + an overflow menu (Wishlist / History / Insights move there or into a nav row). Desktop: master–detail.

**D5 — Wine & vintage page**
Hero: big bottle on a tinted backdrop, name, producer, vintage switcher. Sticky action bar (Open · Add · Rate).
Below: segmented sections — Overview, Drinking window (the chart), Notes & tasting, Value & provenance, History,
Where it is. One thing in focus at a time instead of one long stack.

**D6 — Home**
Greeting + cellar hero (bottles, value, tiny trend line), "Ready to drink" carousel of bottle tiles, Tonight call-to-action,
recent activity, quick add. Real content first, empty states beautiful.

**D7 — Add & scan flow**
Scan-first viewfinder with framing guide; result as a confirmation card showing the new wine's bottle; search results
with bottle thumbnails (type/shape sprite) and producer/region lines; quantity stepper; place picker with a mini rack
map; small success moment.

**D8 — Tonight & Sommelier**
Large pick cards with bottle, why-this-one chips, pairing; the reserved notes restyled; chat bubbles, suggestion chips,
bottle cards inside the conversation.

**D9 — Insights & charts**
One chart language (colours per type, shared tooltip, animate-in, accessible table fallback): composition donut,
stacked bars by region/country, vintage timeline, value-over-time, drink-window timeline (Gantt-style) for the cellar and
the per-bottle "at its best" curve, consumption heat/cadence. Hand-built SVG.

**D10 — Places & 3D**
Place cards with a fill ring and mini rack preview; 3D toolbar/chrome aligned with the new system; showcase UI polish.

**D11 — Profile, settings, auth, onboarding**
Warm first-run (welcome → create cellar → first bottle), settings grouped into clear sections, language and theme as
visual pickers, account/household screens.

**D12 — Polish & hardening**
Micro-interactions, loading/skeleton pass, perf and bundle check, full a11y, nl/en overflow sweep, visual baselines for the
key screens, final screenshot set. _Full-suite checkpoint._

Order of visible payoff: D0–D3 are the base (D2 already makes the cellar look different), D4–D6 are the screens users
see all day, D7–D9 the flows and "wow" charts, D10–D12 finish.

## 7. Risks

- **Scope.** The whole app is a lot of surface; the checkpoint size above keeps each step reviewable. Steps can be
  re-ordered or dropped without breaking the others after D3.
- **Test churn.** Many existing e2e specs select by visible text; they are updated step by step.
- **Sprite realism.** A 2D bottle can look cheap if rushed; D2 is reviewed on its own before anything depends on it.
- **No access to Oeni's screens** (see §1) — mitigated by the references you give in D0.

## 8. Not part of this plan (still parked)

Friends section, notifications outside the app, export completeness, offline, wine-list scanning, billing/commercial.

## 9. Decisions I need from you

1. **Bottle imagery:** go with A (sprite + your own label cut-out), keeping a paid catalogue (C) as a later option?
2. **Direction:** warm cream/burgundy (current identity, refined) or darker "cellar noir" — or I show you both in D0.
3. **References:** 5–10 screenshots of Oeni (App Store screenshots) and any other app you like, and what exactly you like in them.
4. **Pace:** run D1–D3 first without touching screens much (safe base), or start with a visible cellar redesign right after D2?
