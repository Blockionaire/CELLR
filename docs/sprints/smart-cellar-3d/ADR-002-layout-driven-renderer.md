# ADR-002 — a layout-driven 3D view beside the existing one

2026-11-14, sprint 2A. Status: accepted for the gallery; **not** in any product screen.

## The question

The existing 3D view (`apps/web/src/features/cellar/three/scene.tsx`) draws one kind of place: a grid of `rows` by
`cols` with one bottle per cell, in three looks chosen by the place's kind. Sprint 1A gave places a template, a
layout family, a meaning for the index of a spot, and a look. Fourteen templates have to be drawn, in three families
that do not share a shape, without losing what makes the existing view good on a phone and without changing what
any existing place looks like.

## Decisions

1. **A second view, not a rewrite.** The new view lives in `features/cellar/storage3d/` and the existing one is not
   touched. A place from before templates (`resolved.legacy`) is never given to the new view: `TemplateScene`
   throws on it, and whoever mounts a 3D view mounts the existing `CellarScene` for it. That is what keeps rule 5
   of the roadmap ("drawn exactly as today") true by construction instead of by imitation, and
   `three/legacy-parity.test.ts` stays the gate. The existing view is replaced only after parity and performance
   on real devices are shown (sprint 2B or later), as a decision of its own.

2. **Geometry is plain numbers first.** `families.ts` turns a layout and a template into a list of parts (boxes and
   rods with a material role) and a function from a spot to a pose. No three.js, no React: it runs in a unit test.
   Every rule about physical truth is tested there: index 2 is behind index 1, no bottle cuts into wood or into
   another bottle, a pile fills from the bottom.

3. **Three families of furniture and one neutral picture; a template is parameters.** `buildGrid` (racks, shelving,
   cabinet, coolers: nine templates as nine style records and three optional shells), `buildBins` (cube, diamond,
   crate: one function, three compartment shapes), `buildWall` (pegs, rails). `buildNeutral` is not a fourth
   family of furniture: it is what is drawn when the arrangement is not known.

4. **What an index means decides how a bottle is placed.**
   - `depth`: the index is a place. Index `i` lies `i − 1` bottle lengths behind the front.
   - `single`: one place.
   - `ordinal`: the index is a counter and NOT a place. The pile is drawn from how many bottles are in the
     compartment: the `n` bottles take the first `n` resting places of the pile, in the order of their indexes.
     Taking the bottle with index 2 out of a pile of five leaves a pile of four, with no hole in it. The picture
     never says "this bottle is the third from the left".
   - arrangement not known (`arrangementKnown === false`): no furniture of any template. A plate per compartment,
     a counter per bottle in the colour of its wine, a dot per free place, all in one plane. No depth is invented.

5. **Draw calls belong to materials, not to boards.** All parts of one material role are merged into one geometry:
   a place is at most thirteen meshes of furniture whether it has six shelves or nine hundred slats. Bottles are
   one instanced mesh per bottle shape and layer (glass, label, capsule, contact shadow), as in the existing view.

6. **Everything a place takes, it gives back.** Geometries and materials are made inside an `Owned` and released by
   its `dispose()` when the place closes or changes. The two small procedural grain pictures and the contact
   shadow are shared by every scene on the page and deliberately not owned (as the existing view keeps them).

7. **Detail steps down, truth does not.** Three levels (`high`, `balanced`, `low`) change roundness, the clear coat
   on the glass, contact shadows, rounded edges and the cap on sharpness. They never change which bottles are
   drawn, where, or whether one can be picked. The level starts from the number of bottles and the device, and
   goes one step down by itself after twenty consecutive slow frames while the picture moves. It never goes up, so
   it cannot flicker.

8. **Furniture never catches a tap.** Every structure mesh has no raycast, the glass door included. A tap reaches
   the nearest bottle on its ray, so in a deep rack it is the front one.

9. **A look is a name, not a file.** The catalogue names materials, colours, lighting and doors; `palette.ts` owns
   the numbers. Nothing is downloaded, no texture, model or shader comes from a person or from the network.

10. **The flat picture reads the same layout.** `layout-cells.ts` answers, per cell, what is known: a position, a
    row of places front to back, or a count. A count is shown as a number and a bar; no bottle is drawn at a place
    in a compartment.

## What was considered and not done

- **Extending `scene.tsx` with families.** It would put every existing place's picture at risk for templates no
  place has yet, and it couples the showcase (which assumes a grid cell) to shapes it does not know.
- **A renderer per template.** Fourteen engines for what is three shapes with different measurements.
- **Models from files (glTF).** A download per template, a pipeline for making them, and geometry that cannot be
  sized to any rows × cols. Parts made from numbers resize for free and can be tested.
- **Real transparency sorting or refraction for glass.** A pane that does not write depth, drawn after everything
  else, is correct for one pane in front of opaque things, and costs one draw call.
- **Shadows cast by lights.** A shadow map is a second pass over every bottle. Contact shadows are a picture under
  each bottle, one instanced draw call, and are dropped at the lowest level.

## Consequences

- Two 3D views exist until the existing one is retired. They share `three/layout.ts` (bottle profiles, colours)
  and `three/materials.ts` (grain pictures), so a bottle is the same bottle in both.
- Taking a bottle out to look at it (the showcase) exists only in the existing view. In the new view a tap chooses
  a bottle and marks it. Sprint 2B decides how the showcase finds a bottle's place in a pile or on a wall.
- Nothing in the app mounts the new view except the gallery (`/design/cellar-3d`), which is closed in production.
