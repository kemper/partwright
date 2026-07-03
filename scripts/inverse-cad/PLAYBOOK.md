# Inverse-CAD Playbook — the agent field manual

You are recreating a target STL as parametric manifold-js code. **Read this
whole file before your first edit.** It is a living document: when you hit a
new API trap or discover a tactic, append it to §7/§5 in the same session —
the next agent must not rediscover what you just learned.

## 1. The loop in 10 lines

```bash
# once per part:
node scripts/inverse-cad/turn.mjs init <partDir> <target.stl>   # layout + target profile
cat <partDir>/target-profile.json                               # bbox, volume, PCA, symmetry, genus

# every turn (edit → one command → read text):
node scripts/inverse-cad/turn.mjs <partDir> work.js --note "one hypothesis, stated"
# → gate table + localized findings + suggested probe commands + phase guidance
node scripts/inverse-cad/probe.mjs <partDir>/target.stl <subcommand> ...   # MEASURE, never estimate
# when structure is right and only numbers remain:
node scripts/inverse-cad/optimize.mjs <partDir>/target.stl work.js --write
```

The turn tool owns the `best/` pointer and enforces non-regression — you
cannot lose ground by experimenting. `state.json` + `notes.md` are the
memory; a fresh session resumes from them, so keep both truthful.

## 2. Before your first edit

1. `target-profile.json`: **bbox center is NOT the origin** — these parts sit
   Z-flat on the build plate and off-center in X/Y. Build in the target's
   absolute frame from the start (or `.translate(center)` at the end).
2. `genus` and `components`: every unit of genus is a through-hole you MUST
   model as an explicit subtraction. A missing hole is the loudest visual
   defect and the distance metrics barely see it — the topology gate does.
3. `state.json` → `strategiesTried`: never re-attempt a structure a previous
   session already exhausted.
4. `probe.mjs <stl> bands --axis z`: the shape census. High `prismaticScore`
   (≥0.8) → this part is mostly extrusions. Look at each band's `bestFit`.

## 3. Phase ladder — fix things in this order

`turn.mjs` computes your phase; fixing a later-phase symptom while an earlier
gate fails is wasted motion (the #1 observed failure mode).

| Phase | Question | Exit |
|---|---|---|
| **place** | Is the mass in the right place? | bbox size ±5%, center within 0.5mm |
| **topology** | Right holes, right piece count? | genus ==, components == |
| **silhouette** | Do the solids overlap? | volume IoU ≥ 0.90 |
| **features** | Any localized blob wrong? | no finding > 4mm³ |
| **tune** | Polish numbers | all MUST gates pass |

## 4. Strategy decision tree — run once after `init`, re-run on plateau

```
genus > 0?            → list every hole; each is an explicit subtraction, NOW.
symmetry plane?       → build half, mirror-union. Halves your parameter count.
revolveScore > 0.95?  → probe profile --axis A; trace r(h); revolve. Done deciding.
prismaticScore ≥ 0.8? → slice-and-trace along that axis (probe section --code
                        emits the snippet). Circle-fit bands → cylinders, not traces.
RANSAC census covers ≥70% of surface? → compose primitives from probed dims.
else                  → hybrid: traced silhouette body + probed primitives for
                        features + fillets last. Expect slower convergence.
```

## 5. Tactics catalog

- **5.1 Slice-and-trace** (`probe section --axis z --at H --code`, or
  `trace2code.mjs`): the workhorse. Trace at a height INSIDE the flat wall
  region (bands tell you where). DP tol 0.05, minEdge 0.15 defaults are
  right. Landed 0.07-0.25mm chamfer on every prismatic Dummy 13 part.
- **5.2 Primitive probing** (`probe fit --near x,y,z --r R`): returns
  plane/sphere/cylinder fits with rms + inlier fraction. Trust fits with
  inlierFrac > 0.9 and rms < 0.08. The Dummy 13 ankle socket came back
  `sphere r=2.896, 98.6% inliers` — subtracting exactly that took the part
  from 2/6 to 5/6 MUST gates in one edit.
- **5.3 Revolve**: `probe profile --axis z` → r(z) table. High revolveScore →
  trace the profile polyline and revolve; don't stack slices.
- **5.4 Socket/cavity pattern**: a traced outline carries its cross-section
  through the whole depth. Any cavity that is spherical (ball sockets!) will
  show as paired excess (mid-depth) + missing (near faces) findings. Fix:
  trace the SOLID outline, then subtract the probed sphere.
- **5.5 Chamfers/roundovers**: thin (≈0.3-0.5mm) excess findings hugging the
  top/bottom face edges = the target has edge chamfers your prism lacks.
  Options: intersect with a slightly-tapered extrusion (extrude scaleTop
  <1), or subtract edge wedges, or accept if gates pass.
- **5.6 Scaffold erosion**: replace traced point-dumps with primitives one
  band at a time (each swap = one turn, verified). Final code should read
  like CAD, not like a digitizer dump — but only erode AFTER gates pass.
- **5.7 Params for the optimizer**: hoist uncertain dimensions into
  `const p = api.params({ r: { type: 'number', default: 2.9, min: 2.5, max: 3.3 } })`
  and run `optimize.mjs`. It reports per-param sensitivity; a
  `structure-limited` verdict means STOP TUNING and restructure.
- **5.8 Back-face rays complete a clipped revolve profile**: on a
  Z-flat-clipped revolved part, band circle fits go freeform/rounded-rect
  once r exceeds the axis height (the section is clipped). Finish the r(y)
  trace with `probe ray --from R,<far>,<axisZ> --dir 0,1,0` at increasing
  R — each hit is a direct (y, r) profile sample. Cleaner than inverting
  clipped-circle areas. (adapter_stand, wave 1)
- **5.9 Residuals decide primitive-vs-polyline**: before modeling a
  neck/waist as cones or a fillet arc, least-squares-fit the candidate
  primitive to the band r(y) samples. If the fit residual ≫ band rms
  (0.03–0.05 vs 0.0002 on adapter_stand), no member of that primitive
  class exists — revolve the measured polyline instead of tuning. Landed
  6/6 gates in one turn.
- **5.10 Socket entry cones**: a spherical socket opening through a face
  usually carries a conical lead-in at the rim, and it need NOT be 45°.
  Section every 0.1mm near the face and take min contour-point distance to
  the socket center: a linear r(z) segment before the sphere takes over =
  a cone (ankle: r(z)=2.465−0.371z, ~20°). Subtract cone frustums extending
  past the face and into the sphere on the deep end (safe — sphere is wider
  there). (frame_ankle, wave 1)
- **5.11 Staircase chamfers fail the AREA gate, not the distance gates**: a
  stepped 2D-offset chamfer can pass every MUST (chamfer 0.006) while
  failing area ratio — a staircase carries √2× the true 45°-face area
  regardless of step count, so more steps never fixes it. Exact fix without
  loft: intersect with a cone-frustum/cylinder envelope for arc edges; per
  straight edge subtract a 45° halfspace wedge prism authored in (s,z)
  coordinates (s = distance along the outward normal), `extrude(L)`, then
  `.rotate([90,0,0]).rotate([0,0,atan2(ny,nx)deg]).translate([e1x,e1y,0])`.
  Limit each wedge's extent so chamfer runouts are respected.
- **5.12 Check whether traced cut lines pass through a feature center**:
  fitting the ankle's two mouth-cut lines at two different z showed both
  pass exactly through the probed socket center — collapsing four line
  parameters to two angles about a known point. Coincidences like this are
  design intent; test for them.
- **5.13 Snap slice-stack band edges to ledges**: scan slice areas for
  jumps to find horizontal ledges, and snap band boundaries to them — a
  band straddling a ledge loses a thin sheet that the findings report as a
  wide 0.2mm-thick missing skin. With fine uniform bands + epsilon overlap
  + ledge snapping, even "organic" hands converge (hand_grip: 6/6 MUST,
  chamfer 0.028, in 6 turns — per-finger domes were never needed).

## 6. Plateau protocol

Plateau = 3 consecutive non-improving attempts while a MUST gate fails.

1. Map the stuck gate to a diagnosis:
   - volume IoU stuck → mass misplaced: re-check bbox/translate before anything.
   - same finding location every attempt → the local surface is a different
     shape CLASS than your code (probe `fit --near` it; if it says sphere and
     you built boxes, no tuning will fix it).
   - hausdorff stuck, chamfer fine → one small feature missing entirely;
     probe a section through the max-deviation point.
   - volume ratio stuck high with good silhouette → hidden internal cavity.
2. Restructure = new attempt from the decision tree (record the failed
   strategy in `strategiesTried`), never incremental edits to the plateaued
   code.
3. Two restructures exhausted → write the verdict in `notes.md`, stop, and
   report. Knowing when to stop is a deliverable.

## 7. API traps (append-only — add yours the moment you hit it)

- `CrossSection.extrude(depth, ..., scaleTop)` — **scaleTop must be `[1, 1]`**;
  a scalar `1` silently produces a pyramid. Every emitted/authored extrude
  uses the array form.
- **Target STLs are Z-flat and off-center** — never assume a centered bbox;
  read `target-profile.json` before writing a single coordinate.
- `CrossSection.hull()` takes no arguments (union first, then hull).
- Rounded rectangles: `CrossSection.square([w-2r, h-2r], true).offset(r, 'Round', 24)`.
- `geom.fromPoints(pts)` polygons: sub-0.15mm edges trip the extrusion-width
  warning — DP-simplify then `cleanShortEdges` (slice.mjs does both).
- `stats.paramsSchema` is an **array** of `{key, type, default, min, max}`,
  not an object. Param overrides only bind when the snippet declares
  `api.params({...})` — otherwise they are SILENTLY ignored (optimize.mjs
  hard-errors on this; hand-run previews don't).
- Editing candidates with string/regex patches: **verify the anchor exists
  first** (`assert old in src`). Two no-op patches shipped as "fixes" during
  framework development; the TIE verdict caught both — trust it.
- Voxel/parity + ray tools dedupe coincident hits on shared edges — but if
  you build meshes procedurally in tests, T-junctions still corrupt
  Euler-characteristic genus (matched vertices required).
- `cs.revolve(n)` profile convention: X = radius, Y = height, and the
  height axis becomes the solid's **Z**; `rotate([-90,0,0])` remaps to +Y.
  Verify polygon winding with a shoelace check before `geom.fromPoints`.
- `turn.mjs <partDir> <candidate>` resolves the candidate path from your
  CWD, not from partDir — a bare filename gives `ENOENT ... copyfile` even
  when the file exists inside partDir. Pass an absolute or cwd-relative
  path.
- **Stacked band extrusions meeting at an exactly-computed shared plane do
  NOT weld** — float drift keeps the faces ~1e-16 apart, the union silently
  decomposes into shells, and genus/components go garbage. Always extrude
  each band a small epsilon (0.01mm) past its top. (hand_grip, wave 1 —
  this was v1's "organic parts are hard" in disguise.)
- `bootstrap.mjs`'s signature-based band merge is too coarse for organic
  parts — bands flagged STAIRCASED can hide multi-mm dome error. Regenerate
  with a forced uniform fine slice loop (0.4mm) over `slice.mjs` before
  concluding a part is "hard".
- **Multi-component targets: run `splitStl.mjs` (or read target-profile
  components) FIRST.** Tiny (<1mm) junk debris shells inside real STLs are
  common and own both the components gate and the hausdorff-max tail —
  reproduce them as internal voids at their probed centers.

## 8. Reading the feedback bundle

- **Gate table**: MUST failures are your work queue, top to bottom. SHOULD
  failures are advisory polish.
- **Findings**: `excess` = your candidate has material the target lacks
  (cut/feature missing or protrusion too big); `missing` = the reverse.
  `thin-skin` = a surface-offset class error (wrong radius/taper/chamfer —
  usually optimizer territory); `compact-feature` = a discrete feature is
  wrong/absent (structural — your territory). `relCentroid` locates it in
  the target bbox (0..1 per axis).
- **Signed skin areas**: `excessArea/missingArea` per direction tell you
  net-fat vs net-thin before any localization.
- Each finding comes with ready-to-run probe commands. Run them; don't
  eyeball the compare.png unless text and expectation disagree.

## 9. Worked example (Dummy 13 ankle, frame_ankle_2x.stl)

1. `init` → bbox 9.00×9.96×5.00 center [0,-2.02,2.5], genus 1 (the keyhole
   eye), 1 component.
2. Deterministic trace at z=1.0 (`trace2code`) → turn 0: chamfer 0.066 —
   *looks* converged, but gates say 2/6 MUST: F1 excess 10.3mm³ at rel
   [0.47,0.61,0.50] (part center), volume +6.7%.
3. `probe fit --near F1-centroid --r 2.8` → sphere r=2.896 @ [0,-0.02,2.5],
   inliers 0.986. The socket cavity: the z=1.0 trace carried the socket's
   mid-slice through the full depth (tactic 5.4 exactly).
4. Subtract the probed sphere → turn 3: 5/6 MUST, score 1.02→0.48, phase
   tune. Remaining: IoU 0.9497 vs 0.95 — the target's edge chamfers.
5. `optimize.mjs` over (socketR, socketX, socketY) → "already-optimal",
   sensitivities ≈ 0: the probe's fit was exact; no numeric tuning left.
   Next structural step would be tactic 5.5 (edge chamfers).

## 10. Session discipline

- One hypothesis per turn; `--note` is mandatory and should state it.
- Measure before modeling: any number in your code that didn't come from
  probe/profile/optimizer is a guess — guesses are for structure only.
- ~15 turns per session, then write a verdict to `notes.md` and stop; a
  fresh session resuming from state beats a stale context grinding.
- Before returning, list any new trap/tactic you discovered, ready to append
  here.
