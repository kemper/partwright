---
session: "01NTQB"
timestamp: "2026-06-10T19:30:00Z"
---

## Human

The placing seems strange. Once I've placed, I'd expect the "Click to place on
model" button to toggle away from "Placing..." once it's rendered — it kind of
seems frozen. Some indicator would be nice; the one in the modal is hidden below
the fold. I'm thinking a yellow toast like the "Rendering..." message — with the
timer and cancel button — so people can cancel and not wait. Any operation where
we wait to render should show it (switching to "Wrap around Z" also takes a
while). Also, on a pyramid the floating square showed perpendicular to the pointy
edges rather than lying on the flat slanted sides (it was fine on a cube).

(Clarified: on sloped/curved faces, **follow the surface** — lie flat on
whatever face you click; position sliders apply only to flat axis-aligned faces.)

## Assistant

## Key decisions

**Follow-the-surface placement (free projection).** Added a third
`EngraveProjection` variant `{ mode:'free', origin, normal }` to `engraveStamp.ts`:
it builds a tangent frame from the clicked normal (shared `tangentFrame` helper)
and projects the stamp into that plane, depth along −normal — so the stamp lies
flat on a pyramid side or a sphere. `engraveCombine` gained the `free` branch and
a pure `engraveFreeFootprint` for the outline. The modal's `placementFromHit` now
picks: a normal within ~18° of an axis → axis-aligned planar (sliders + snaps
apply); otherwise → free, positioned by the click (sliders hidden, a note +
"Sloped/curved face" readout shown). The outline overlay renders the free
footprint, foreshortened on the slope.

**Button toggle.** Clicking to place now exits place mode immediately
(`exitEngravePick()` before `commitPlacement`), so the button returns to
"📌 Click to place on model" instead of looking frozen on "Placing…".

**Progress modal + cancel for heavy carves.** Root cause of "frozen": the SDF
carve (`sdfModifierMesh`) ran synchronously on the main thread, so the UI
couldn't even paint an indicator. Made the field sweep **async + yielding +
abortable**: it `await`s the event loop every few depth-slices, checks an
`AbortSignal` (throws `SdfAbortError`), and reports progress. Threaded this
through `engraveMesh` / `voronoiLampSdfMesh` / `applyEngrave` / `applyVoronoiLamp`
and made `buildSurfaceModifier` async. A new `buildSurfaceModifierProgress` in
main.ts wraps the two heavy carves (engrave, voronoi lamp — incl. cylindrical
"wrap around Z") in the shared `startProgress` modal with a Cancel that aborts
the sweep, and supersedes an in-flight carve when a newer one starts. Light
modifiers stay inline. The preview API is now async; `runPreview` awaits it and
treats an abort as "keep the prior preview," not an error.

## Verification

Browser (pyramid): the magenta outline lies flat on a slanted face; clicking it
reads "Sloped/curved face · placed by click"; the "Rendering engraving" modal
with a progress bar + Cancel shows during the carve; the place button toggles
back. Unit: free `engraveMesh`, `engraveFreeFootprint`, and an `AbortSignal`
rejection. E2e: sloped-face free carve bakes an ofMesh wrapper. Full unit (1034)
+ engrave/voronoi/in-code e2e green; `lint:deps` acyclic.

## Follow-ups noted

On large detailed models the whole-model carve at a fixed resolution still
softens fine features and shallow text — auto-scaling resolution by model size is
a possible next step (trades triangle count / time).
