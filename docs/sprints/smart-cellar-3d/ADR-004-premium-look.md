# ADR-004 — The premium look: fidelity without a new renderer

Status: accepted (sprint 2B.2, 2026-11-14). Builds on ADR-002 (layout-driven renderer) and ADR-003 (bottle
showcase). Nothing here touches the database, the domain package, the production cellar screens or the existing
view under `features/cellar/three/`.

## The question

The storage view of sprints 2A and 2B.1 was correct and looked computer-made. Sprint 2B.2 asks for a view that
reads as real furniture and real glass, on a phone, without paying for it on every frame and without changing
which bottle lies where.

## What made the old picture look artificial

Found by looking at the pictures taken from `main` before any change (the "before" column of the comparison
sheets), not by reading code:

| What was seen                                                 | Why                                                                                          |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Every board the same flat brown                               | One 256 px grain picture stretched over each face's own 0..1, one colour for the whole frame |
| A compartment as bright at the back as at its front edge      | No occlusion of any kind: every surface lit by the same environment                          |
| Furniture that floats                                         | Nothing where it meets the floor or the wall                                                 |
| Bottles like polished marbles, with blank cream labels        | Glass roughness 0.05 under a strong environment, labels a flat colour                        |
| A cooler whose glass is not there and whose two zones are one | Glass at 14 % with no reflection of its own; one light colour for both zones                 |
| Wall rails that are two black lines                           | No hardware, no shadow on the wall behind                                                    |

## Decisions

### 1. One renderer, two looks: `Fidelity = "classic" | "premium"`

`buildModel(resolved, fidelity = "premium")`. `classic` builds and draws exactly what sprint 2B.1 drew (its tones,
its finishes, its geometry, its bottle glass). It is kept for two reasons only: the gallery can show before and
after from one build, and the benchmark can measure both under identical conditions. It is not a product setting.

The alternative, a second set of scene components, would have doubled what the showcase, the picking and the
disposal have to be proven for.

### 2. Shading is written into the geometry, not computed by lights

The darkness at the back of a compartment, the difference between two boards, and the colour of a cabinet's light
strips are worked out once when a place is built and stored as a colour per vertex (`shadingOf`, `shadeAt`,
`paint` in `resources.ts`). Drawing a frame costs what it cost before: the same lights, no shadow map, no extra
pass. Rejected: real-time shadows (a shadow pass over up to 1,200 instanced bottles, on a phone), screen-space
ambient occlusion (a full-screen pass and a second render target), baked lightmaps (assets to ship, per size of
place).

What is given up: the shading does not react to the camera or to a door that will one day open. It is a picture
of light, and the ADR says so.

### 3. Fine pictures, drawn once per page and shared

`textures.ts` draws seven small greyscale pictures on canvases (wood grain 1024×512, brushed metal, a fine speckle
for powder coat, lacquer, stone and plaster, a glass sheen, a soft shadow, a halo, a label print seen from afar).
They are owned by no scene: an `Owned` never holds them, closing a scene frees none of them, and their number has
a ceiling (`sharedTextureCount()`). Every colour of a material multiplies the same grey picture, so one wood
picture serves oak, walnut, mahogany, pine, ebony. No file is downloaded, and none is added to the repository.

The grain is laid by each part's own measure (4 units along the board before it repeats, 2 across) and starts at
a different place on every part, so two boards never show the same piece of wood side by side.

### 4. Finishes as data, one place

`PREMIUM_FINISH` and `lookFor(..., { fidelity })` in `palette.ts`; the bottle's glass, foil and paper in
`bottle-look.ts`, read by both the instanced bottles and the bottle on display, so the hand-over between the two
is the same numbers by construction. No template has a material of its own.

- Wood: roughness 0.5, barely mirrors the room, wears its grain as relief at the highest level.
- Blackened steel is powder-coated (metalness 0.3, roughness 0.58); stainless and brass are fully metal and
  brushed, never polished (roughness ≥ 0.34): a soft streak of the room, not a mirror.
- Glass: 34 % with two soft bands of reflection (one alpha picture), no refraction, no second pass. Bottles behind
  it stay readable and are still chosen through it.
- Bottle glass: roughness 0.10 (was 0.05), environment 1.05 (was 1.35).

### 5. At most two more draw calls for a place

A glow in front of every lit strip (one merged additive mesh, each strip in its own colour) and a soft shadow
where the furniture stands (on the floor, or on the wall behind a wall mount). Bottles on a wall get an instanced
soft shadow on that wall, one draw call per bottle shape, as the shadow under a bottle on a shelf already was.
None of these is a light or a shadow pass.

### 6. Two zones are lit apart, and that says nothing about temperature

A dual-zone cooler lights its upper zone cooler and its lower zone warmer, whatever light colour was chosen, so the
zones are two areas at a glance. This is how the zones are **lit**. The view shows no temperature, measured or
set; the small display on the cabinet is a lit bar without a number. Temperatures in CELLR are targets a person
entered, never sensor readings, and nothing in this view suggests otherwise.

### 7. Levels of detail change how fine it looks, never what is there

|                               | high | balanced | low |
| ----------------------------- | ---- | -------- | --- |
| relief (bump)                 | yes  | no       | no  |
| glow and ground shadow        | yes  | yes      | no  |
| label print on rack bottles   | yes  | yes      | no  |
| vertex shading, fine pictures | yes  | yes      | yes |

`buildModel` takes no level: spots, parts and poses are decided before a level is chosen. Tests hold that the
same bottles are on the same screen positions at all three levels and that a tap takes the tapped bottle at each.

### 8. Furnishing that is added moves nothing

The classic rack gets a recessed plinth and a slim cornice; wall rails get tie bars, wall plates and screw caps.
Both only in the premium look (`detail` in the builders), both outside every bottle's way out (checked by the
extraction plans of ADR-003, whose tests run against the premium model). No spot moved; a unit test compares
every bottle's pose in both looks, to the last digit.

### 9. The panel on a narrow screen always has a place

`InspectableStorage` used to draw no panel when the screen was narrow and the host gave no element below the
picture. Now that case is a third layout, `sheet`: the panel lies over the lower 46 % of the picture and the bottle
stands in the part above it (the existing view's own `top` frame). The state machine is untouched.

## Consequences

- Texture memory grows by the seven shared pictures, once per page (the estimate from their sizes is in the
  report's measurements).
- Geometry carries one more attribute (colour, 12 bytes a vertex) and tall panels are segmented: more triangles
  in the furniture, none in the bottles, which are the bulk of a large place.
- A place is built a little slower (the shading is computed per vertex, once).
- Measured cost and what it buys: see `SPRINT-2B2-REPORT.md`.

## Not done here, on purpose

Doors that open and shelves that slide (animation features of their own), real-time shadows, refraction,
downloaded materials or models, any change to the 14 templates' layouts, any product screen.
