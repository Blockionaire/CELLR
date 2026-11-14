# ADR-003 — taking a bottle out to look at it, in the layout-driven view

2026-11-14, sprint 2B.1. Status: accepted for the gallery; **not** in any product screen.

## The question

The existing 3D view takes a bottle out of its rack, stands it up and shows its label (`three/showcase.tsx`). It
knows one geometry: a grid cell, one bottle deep, out along its own axis. The new view (ADR-002) draws fourteen
templates in three families, bottles behind bottles, piles whose order is an illustration, places whose arrangement
is not known, and doors. "Slide it out and stand it up" is true for some of those, impossible for others, and for
a pile it would claim something the data does not say.

## Decisions

1. **What may happen is a state machine, and nothing else decides it.** `showcase-machine.ts`: `idle → extracting →
inspecting → returning → idle`, with `dismiss` allowed on the way out, `open` of the same bottle allowed on the
   way home, `cancel` from anywhere, and everything else refused. Plain data and one pure function: no clock, no
   three.js, no React. The animation reports "arrived" and "returned" with the number of the inspection it belongs
   to, so a movement that was interrupted cannot finish a later one.

2. **How a bottle leaves is decided from what is physically in the way, before anything moves.**
   `showcase-plan.ts` works out the way a bottle would really go (out of its cell along its own axis; up off its
   pegs or over its rail's tip and away from the wall) and CHECKS it against every part of the furniture and every
   other bottle, with the same collision arithmetic the placement tests use. Only a path that touches nothing is
   shown as an extraction (`physical`). Otherwise the bottle is not drawn out at all: an **inspection transition**
   that claims no path.
   - `lift`: the bottle is in plain sight (a pile). It rises out of the picture of its place.
   - `emerge`: it is not in plain sight, or it is not a bottle on a known spot (behind another bottle, behind a
     closed door, held by a shelf's lip, a counter in a place whose arrangement is not known). It fades up.
     The reason is carried with the plan and said to the person in words ("Shown without drawing it out: another
     bottle lies in front of it").

3. **The address is carried, never computed.** A plan holds the bottle's `(row, col, index)` exactly as stored and
   its drawn pose exactly as placed. Index 2 goes out as index 2 and comes back as index 2. Nothing in the
   showcase writes anything.

4. **A pile is not a set of positions.** No bottle of a bin gets a path, whichever index it has. Looking at a
   bottle is not taking it out of the place: occupancy does not change, so the pile it returns to is the pile it
   left, bottle for bottle. The panel says "in compartment 1·2. Where in the compartment it lies is not recorded",
   and the flat picture marks the compartment, never a place in it.

5. **The movement is one function of one number.** `showcase-film.ts`: `progress` 0 = in its place, 1 = on
   display. At 0 the film's matrix IS the storage view's own matrix for that bottle, bit for bit (tested for every
   bottle of every template), so the hand-over at either end cannot jump; going home is the same film backwards.
   The physical phases are the existing view's (`showcasePhases`): slide, rise, glide.

6. **The place steps back as a picture.** Once a drawn-out bottle is clear of the furniture (at once, for an
   inspection transition), the place is rendered one last time without the bottle and copied to a 2D canvas behind
   the 3D one. Until the bottle is back, a frame draws the bottle and nothing else. The storage camera is locked
   meanwhile, so picture and live place are the same to the pixel when they swap; when the view changes size the
   picture is simply taken again at the new size. This is the existing view's idea, without its bookkeeping for a
   view that changes shape under the still.

7. **One bottle kit per scene, warmed up.** The geometries and materials of the bottle on display are made once
   (a shape's geometry the first time that shape is looked at) and reused by every inspection; only a label's
   picture is made per inspection and released with it. Its shaders, and the fonts labels are set in, are prepared
   while nothing is happening.

   **The studio lights are in the scene only while the place is a picture.** The existing view keeps them in the
   scene always, dark, so that taking a bottle out never changes the number of lights and with it every shader.
   Measured here, that makes turning the place 17 to 20 % slower under software rendering: a light costs every
   pixel of every material that is drawn. In this view the place is not drawn while a bottle is on display, so the
   lights can join exactly then: the place's shaders never see them, and the bottle's are prepared for both sets of
   lights. A place with no bottle out draws exactly as it did before there was a showcase.

8. **The bottle that is out is the chosen bottle.** Taking it out chooses it; it stays chosen when it is back; the
   flat picture marks the same spot throughout. While one is out, another cannot be chosen: a tap on another
   bottle, like a tap beside the bottle, puts the one that is out back.

9. **Detail does not change under a bottle that is out.** The automatic step-down of detail (ADR-002, 7) waits
   until the bottle is home: the place it comes back to must be the place it left.

## What was considered and not done

- **Reusing `three/showcase.tsx`.** It reads a slot from `rows × cols`, slides along z by a fixed length and hands
  off to `rackMatrix`. Its phases, its bottle look, its label textures and its still-picture idea are reused; the
  component is not, and it is not changed.
- **Animating a physical extraction for every bottle** (through the bottle in front, through a door, out of the
  middle of a pile). It would look fine and be false.
- **Letting a pile settle** when a bottle leaves it, and putting the bottle back on top. It is how a pile behaves,
  and it would make the returned picture differ from the one left. It needs an order of its own for "who is on
  top", which is view state the model does not have. Left for a later sprint, as a deliberate design.
- **Opening a door, sliding a cooler's shelf out.** Each is an animation and an interaction of its own. Until they
  exist a bottle behind a closed door or a shelf's lip is shown, not drawn out.
- **A second canvas for the bottle.** One WebGL context, one scene: the bottle is drawn in the storage view's own
  canvas, in front of a picture of the place.
- **Filling the phone's screen with the bottle.** The picture keeps its size and the bottle gets all of it; the
  panel goes below the picture. A view that grows at the moment of a tap changes the camera's shape under the
  place, which is what the existing view's still bookkeeping exists for. To be decided when the view enters the
  app.

## Consequences

- `TemplateScene` takes an optional `inspection`. Without it, it is the 2A view: a tap chooses. With it, the view
  shows the bottle of the given state out of its place; it still decides nothing.
- `InspectableStorage` is the piece a screen mounts: the view, the picture behind it, the panel, the keys and the
  focus. The gallery is its only user.
- The legacy view and its showcase are untouched, and remain the only showcase in the product.
