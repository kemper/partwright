---
session: "gf44vx"
timestamp: "2026-06-09T10:46:00Z"
model: claude-opus-4-8
---

## Human

Can we update the starter examples so that it rotates across a set of models
rather than having multiple in one. I also would like the use of the label
function with colorization where possible.

## Assistant

## Key decisions

**What "multiple in one" was.** The manifold-js starter was a single file
(`examples/basic_shapes.js`) that unioned four unrelated demos — a boolean
widget, a hull-rounded box, a twist column, a revolve vase — onto one tray and
returned them as one solid. That single file was the only example consumed by
the app: the whole `examples/*.{js,scad}` glob existed just to grab
`basic_shapes` for `defaultCode`; everything else loaded but went unused. The
ask was to replace that one crammed model with a *set* of standalone models the
editor cycles through, and to color them in-code via `api.label`.

**New starter set lives in `examples/starters/*.js`.** Five small,
instant-rendering, single-subject models — `rocket`, `snowman`, `twisted_vase`,
`mushroom` (toadstool), `robot` — each a single printable solid whose every part
is wrapped in `api.label(shape, name, { color })` so it renders and exports
self-colored with **no paint step**. Each was verified with
`npm run model:preview`: all report `isManifold: true` and `componentCount: 1`
(parts overlap ≥0.5 mm so the unions weld), and I eyeballed the 4-view PNGs to
fix proportions and a couple of buried details (snowman button floating outside
the belly; robot eyes recessed inside the head so no color showed — pushed them
proud of the −Y face). A new folder + eager glob keeps the rotation set
explicit and self-documenting rather than overloading the legacy example glob.

**Rotation via a persisted index, not random.** Added module-level
`STARTER_JS_CODES` (the starters glob, sorted by path for a stable order) and
`nextManifoldStarter()`, which returns `codes[idx % n]` and advances a
`localStorage` counter (`partwright:starter-rotation`). Persisting across loads
means each fresh session/part opens on a different demo and the cycle survives
reloads; storage failures (private mode) degrade to no-rotation, and an empty
folder falls back to a tiny inline stub. Chose deterministic rotation over
`shuffle` so the sequence is predictable and every model is shown before
repeating.

**Seed sites + the expendable-starter check.** Replaced every place that seeded
the fixed `defaultCode` — `resetEditorToStarter`, the language-switch ternary,
`initEditor`, and the six fresh-session fallbacks (landing, ideas, share/stale
URL, catalog-load failure) — with the rotation. The fallbacks went through a new
`seedManifoldStarter()` (`setValue` + `runCode`) which also fixes a latent
editor/geometry mismatch: they used to `runCode(defaultCode)` without
`setValue`, relying on the editor already holding it. Crucially, `isStarterCode`
(which marks a part "expendable" so an import can overwrite it without losing
work) now recognizes any member of `STARTER_JS_CODES`, not just `defaultCode` —
otherwise a rotated starter would look like real work and block the
import-as-new-session path.

**Kept the old machinery as a fallback, didn't delete it.** `basic_shapes.js`,
the example globs, and `defaultCode` stay: `defaultCode` is still referenced by
`nextManifoldStarter`'s empty-set fallback and by `isStarterCode` (back-compat
recognition of older saved drafts that hold the basic_shapes starter). This
avoids both a dead-code lint hit and a back-compat break, while the user-visible
behavior is fully the rotating set.

**Test fix.** `session-modal.spec.ts` asserted the fresh starter contained
`CrossSection` (true only of the old tray). Re-anchored it to `api.label`, which
is the stable invariant across every rotating starter and also documents the
self-coloring requirement. Verified in a real browser: across five reloads the
editor cycled robot → snowman → toadstool → rocket → vase (all distinct), and
the robot rendered fully self-colored in the live viewport (cyan eyes, dark
mouth, orange ear, red antenna bulb) with the 3D-printable pill green.
