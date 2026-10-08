# Retro — tai-chi figure defects: areola back-plug + backwards foot (PR #693, phase 4)

User reviewed the Tai Chi Master on the PR preview and found two more defects:
nipples rendering as cylinders out the back, and a raised foot bent backwards.
Both were engine bugs in `src/geometry/sdfFigure.ts`; fixed, filed #706/#707,
re-baked the 9 affected figures.

## Liked / Worked
- **Render-to-confirm BEFORE theorizing the fix, and AFTER.** A pure side view
  (`--view 0,8`) made the back-plug rod unmistakable; re-rendering the same angle
  proved it gone. The diagnosis ("deep plug, not flush coin") came straight from
  reading the geometry, not guessing.
- **A numeric vite-node probe nailed the foot bug fast.** Printing `lowerLegR` vs
  `upperLegR` headings showed the shin pointed +Y (back) while the thigh pointed
  −Y (forward) — the whole "follow shin vs follow thigh" fix fell out of three
  printed vectors, and the same probe confirmed grand-jeté/ballerina stay toe-back.
- **Scoping the rebake to actually-affected figures.** The two fixes touch only
  `buildNipples` (bare-chest figures) and the lifted-foot heading; the other 11
  entries are byte-identical. Baking just the 9 candidates and using `git status`
  as the oracle (only changed files = genuinely affected) cut a 20-min full rebake
  to ~6 min and is self-verifying.
- **"No-op on the cases that already work" again held.** Planted feet, thigh-back
  swept legs, and wide chests are all unchanged — the blast radius stayed on the
  broken cases.

## Lacked
- **The background rebake got silently killed when the container went idle.** I
  launched the 20-figure bake as a background task and reported "baking"; the user
  was away ~2h, the container reclaimed the dev server + bake mid-run (3/20 done),
  and nothing told me until they asked "did you rebake?". A long background job
  that outlives the active window is a trap in this environment — there's no
  self-wake (`send_later` unavailable), so a multi-minute bake should run in the
  foreground while the user is active, or be checked back on explicitly, not fired
  and forgotten.
- **I guessed issue numbers in code comments (#705/#706) before filing.** #705 was
  already taken; the real numbers were #706/#707, so I had to rewrite comments,
  the test name, and the prompt log. File the issue first, get the number, THEN
  reference it.

## Learned
- **A flush "coin on a curved surface" must bound BOTH faces.** Sphere ∩ a long
  coaxial cylinder is a deep plug, not a disc — the back face has to be clamped to
  a shallow slab or it tunnels through thin geometry. Same class as the iris
  flush-disc work in the prior phase; the areola had the un-bounded-back version.
- **Plantarflexion heading belongs to the THIGH, not the shin.** The shin folds
  under a flexed knee and stops being a proxy for "which way the leg swings"; the
  upper-leg bone is the right discriminator for swept-back (toe back) vs
  raised-in-front (toe forward-down).

## Longed for
- **A foreground-friendly batch-bake with per-figure retry that survives idling**,
  or at least a loud signal when a background job is reaped — the killed rebake
  cost a full round-trip with the user.
- Still: **the browser-faithful headless label/component oracle (#697)** — every
  one of these phases pays the xvfb-bake tax to learn what `model:preview` can't show.
