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
- **5.13a Hand/organic recipe transfer: only the ledge list is
  pose-specific**: the converged hand generator (fine 0.4mm Z bands + eps
  overlap + per-band socket fill + exact sphere subtract + sliver drop)
  transfers verbatim between hand poses; re-measure ONLY (a) the ledge
  z-list via a 0.05mm slice-area scan — a true ledge is one giant Δ at a
  single step; a run of consistent small Δs is dome curvature, do NOT snap
  to those — and (b) whether debris voids are needed (read target-profile
  `components` first). (hand_open_left: 6/6 MUST at chamfer 0.024, ONE
  authored turn. Wrist socket confirmed r=2.900 @ [0,0,0] on a third part.)
- **5.14 Mirror-variant parts: verify, then flip the sibling's converged
  candidate**: when a target is the mirror of an already-converged part,
  check bbox extents, `splitStl` debris centers, and the socket probe for
  exact x-negation; if they match, append `solid.mirror([1,0,0])` as the
  LAST op on the sibling's best candidate. `.mirror()` handles triangle
  winding itself — no polygon rewinding — and origin-centered features map
  to themselves. (hand_grip_right: 6/6 MUST in 2 turns vs 6 from scratch;
  hand_open_right and hand_fist_right each in ONE turn.)
- **5.14a Sibling feature subtractions ride the final mirror**: leave ALL
  the sibling's interior subtractions (debris voids, socket, dimples) in
  its own coordinates and mirror the assembled solid LAST — the mirror
  maps every feature, so no per-feature negation is needed and none can be
  forgotten. (hand_fist_right: zero coordinate edits.)
- **5.15 Locate hausdorff-max explicitly**: when hausdorff is stuck but
  chamfer is tiny, sample both meshes (`samplePoints` +
  `buildTriBvh`/`closestPointOnMesh`) and print the argmax points WITH
  coordinates. Residual distances matching `(depth−r)/√2` is the signature
  of a flat-floored truncated cone vs your full cone. (frame_thigh)
- **5.16 Chamfers on tilted faces recede FULL (z−z0) in plan**, not
  (z−z0)/√2, when the target chamfered perpendicular to the face — and the
  chamfer plane can clip past the segment boundary into the neighbor.
  Model by intersecting with a chamfer-profile prism extruded along the
  face direction (profile in (face-normal-distance, z)). (frame_thigh)
- **5.17 Prisms-along-different-axes decomposition**: a cavity that looks
  sculpted may be exactly (vertical plan prism) ∩ (horizontal profile
  prism) — check z-sections for y-invariance and y-sections for
  z-invariance before reaching for spheres. (frame_thigh's knee C-clip:
  a Y-prism XZ profile straight from one raw slice + one subtracted
  vertical cylinder.)
- **5.18 Sibling-part transfer: verify each borrowed number by chord math
  before reuse**: when a target is a sibling of a converged part, read the
  sibling's notes.md FIRST and test each shared feature against the new
  bootstrap traces analytically — a vertical spool r2.5 grooved to r1.5
  predicts section half-chords sqrt(r²−y²) at every traced y; if 3+ chords
  match to 0.01mm the whole feature spec transfers verbatim. Budget probes
  only for the genuinely new features. (frame_shin: 6/6 MUST at chamfer
  0.0003 in ONE authored attempt; frame_forearm repeated it — 3 probes +
  1 turn, chamfer 0.0005.) **Dummy 13 limb archetype** (transferred
  verbatim shin↔forearm): ball r3 at ymin+3 / D-neck r1.5 flat z1.2 /
  oct(2.5) 5×5 shaft / window slab z 1.0..4.1 from shaft-face −5 / spool
  r2.5 at ymax−2.5 with r1.0→0.5 dimples. For remaining limb parts, check
  ball/spool anchor positions from bbox extents first. **Neck variant**
  (frame_neck, 1 turn, chamfer 0.0004): two balls r=3.000 at y=0/y=10, mid
  SPHERE r=2.45 at [0,5,0] (not a spool), neck cylinder r=1.5 with NO
  chordal flat (the limb D-flat does not transfer — ray it), octagonal
  Y-prism shaft y 3..7, clipped z≥−2.5. Ball-centers-at-z=0 vs
  bbox-center-0.25 confirmed a second time.
- **5.18a Shortened/lengthened sibling: one plan section replaces a probe
  campaign**: when the hypothesis is "same part, different shaft length",
  a single `probe section --axis z --at <mid>` yields every feature
  y-extent in one trace — diff against the sibling's numbers to find the
  single shift constant, then verify the sibling's tilted-face chamfer by
  running the SAME section height on the sibling's own target.stl and
  checking pointwise equality under the shift. (frame_upper_arm: chamfer
  0.0017, one authored attempt, zero fit probes.)
- **5.18b Mixed hub parts are module compositions — diff the bootstrap
  trace against each converged module's outline constants before
  probing**: frame_chest's spine and neck blocks reproduced hip_shoulder's
  outline NUMERICALLY in the raw bootstrap trace (corner-line endpoints,
  mouth slope 0.6682, arc r4.5), and its struts reproduced hips' r1.5
  flat-at-z=−1.3 archetype. Testing traced coordinates for equality
  against sibling constants replaced an entire probe campaign; only the
  socket radii and genuinely new members needed measurement. (frame_chest:
  6/6+2/2 at chamfer 0.0067 in ONE authored attempt.) Strut signature: a
  "wall" whose traced x shifts with z as x = c + sqrt(r²−z²) is a Y-axis
  cylinder of radius r about z=0.
- **5.19 Anti-rotation/clearance flats show as a section bbox-min that
  beats the circle fit**: a band fitting `circle r1.5 rms 0.018` whose
  section bbox z-min sits at 1.2 instead of the circle's 1.0 is a chordal
  flat — author it IN the profile (circle ∩ halfplane, a D-prism), don't
  subtract it later. (frame_shin neck)
- **5.19a Localize a fabricated genus handle by binary-searching partial
  band stacks**: when a slice-stack reads one genus high, don't guess from
  slice hole censuses (transient pocket holes are usually innocent).
  Build the candidate STL headlessly (`runPreview` → `writeBinaryStl`),
  confirm per-shell genus via weld+components, then rebuild the stack as
  bands 0..K and bisect for the K where χ flips. The handle is where an
  upper slab bridges two contact patches over a void escape path.
  (hand_fist_left: band 16 of 21.)
- **5.19b Halve band pitch where contours morph fast instead of
  plugging**: a staircase handle means the pitch under-samples the contour
  morph (a saddle completes inside one band). Fix with finer bands over
  just that z-range (0.2mm over the fist's knuckles — 7 extra bands);
  plugs or bridge cuts kept missing the ring or adding a second handle.
  Verify genus headlessly per-shell before spending a turn.
- **5.19c Probe your own candidate, not just the target**: export the
  candidate mesh to STL (`runPreview` → write binary STL from
  `render.positions/triVerts`) and turn probe rays / far-point scans on
  it. A 2-turn-stuck hausdorff was located in one call. `sliceOverlay.mjs
  target.stl cand.stl --slices z:…` is the most readable structure check.
  (knee_elbow)
- **5.19d Double-sided socket = hourglass revolve**: a joint socket open
  through BOTH faces reads as counterbore + two 45° entry cones meeting at
  a narrow waist. Ray-cast r(z) from the cavity center at fine z steps;
  slopes of exactly 1.0 are design intent (45°), the flat minimum is the
  waist. (Two-sided cousin of §5.10.)
- **5.19e Chamfer corner pairs: miter with hull, don't per-edge-subtract**:
  where two chamfered edges of a concave notch meet, the target keeps a
  sharp miter. Per-edge wedges extended past the apex carve interior
  material; the exact cut is {s1<ins}∩{s2<ins}, built as `Manifold.hull`
  of the dilated notch polygon just below z=0 and the exact polygon at
  z=leg. (knee_elbow. Also: §5.12 confirmed three MORE times there — test
  every straight cut near a socket against its center.)
- **5.19f Mid-height side bosses hide from BOTH band traces and near-face
  sections**: a boss spanning only |z|<~0.9 shows in exactly one mid slice.
  Localize with a ray scan x(z) at a suspect y; "circular arc, then
  exactly-slope-1 line" is a tangent-blended ridge — fit the circle,
  verify the line is its 45° tangent (intercept = a + R√2), author as a
  prism of circle ∪ tangent-quad. (frame_waist tabs, fit residual <0.002.)
- **5.19g Ray-scan an assumed flat face before authoring its halfplane**:
  a bbox extreme only proves a VERTEX, not a face — frame_waist's
  "front face" was the meeting point of two cut lines; rays at 0.2mm
  steps exposed the two slopes in one call.
- **5.19h Constant-x-over-y ray band + ellipse-fit x(z) = elliptical
  prism**: a mid-body bulge whose x-extent is constant along the axis but
  shrinks with |z| faster than any circle is an elliptical-section prism —
  fit (x/a)²+(z/b)²=1 to 3+ ray samples before reaching for lofts.
  (frame_abdomen: (3.2, 2.5) ellipse, max dev 0.005.)
- **5.19i Joint-grammar transfer across socket parts**: frame_head
  reproduced frame_hip_and_shoulder's ENTIRE joint spec verbatim (mouth
  walls through center at |slope| 0.6682, corner-cut flat line offset
  2.906 NOT z-chamfered, leg-0.5 45° chamfers on arc+mouth lines only,
  rim cones on every open face, outer arc r=4.5 about the socket). When a
  new part has a ball socket, diff its traces against the converged
  socket sibling FIRST — one ray per feature confirms; only the
  attachment (stem/tab/rod) is genuinely new. (frame_head: 6/6 at chamfer
  0.003 in 2 authored attempts, from the worst bootstrap in the corpus.)
- **5.19j Spherical-bodied sockets bend the kit's straight corner-chamfer
  line into a conoid**: on a socket whose outer body is a sphere
  (clavicle) rather than a prism block, the corner-cut line appears at z=0
  but its ruling shifts with z — a ruled surface with straight HORIZONTAL
  generators (check: per-z ray rows are collinear), provably not a
  cone/cylinder/revolve. Fit y = C − s(z)·(A − B|x|), s=√(1−(z/Z)²), on a
  ray-sampled grid; build as hulled per-side z-band slabs (0.25mm pitch →
  0.004mm sagitta). **Hull convexifies** — hull each side's convex quad
  separately, never the full-width V-tent polygon. (frame_clavicle:
  6/6+2/2 in ONE authored attempt.)
- **5.20 Test traced walls for arcs about a probed feature center**: a
  DP-traced "flat wall + corner fillet" can really be one large arc
  centered on the socket/feature center — compute each traced boundary
  point's distance to the probed center before fitting local corner arcs.
  (hip_shoulder: six ray samples along the apparent wall+fillet all sat at
  r=4.4996±0.0004 about the socket center.) Corollary: a Kåsa circle fit
  returning a huge radius with ~0 residual (r≈223, res 0.0001) means the
  "arc" is a straight chamfer line — model a line, not a fillet.
- **5.21 Read the chamfered-edge inventory off one near-face section**:
  don't chamfer the whole outline blindly. Section at z = face+0.05 and
  compare each edge's position to the mid-height outline — only the inset
  edges carry the face chamfer; a uniform-offset chamfer fails on exactly
  the others. (hip_shoulder)
- **Dummy 13 kit note**: the socket GRAMMAR repeats across parts (sphere +
  ~20° lead-in cones + mouth planes through the center + corner chamfer
  lines), but **the numbers are per-part, not global**: socket r=2.9075
  (ankle/hip_shoulder), 2.900 (hands), 2.852 (waist), 2.8488 (abdomen);
  cone slopes 0.371 / 0.3515 / 0.3525. Joint BALLS are r=3.000 exactly
  everywhere (thigh, shin, forearm, hips, neck, waist, abdomen). Probe
  every socket; transfer the grammar, re-measure the radii. Mouth-wedge
  wall slope 0.668|x| and corner-chamfer line y=±(0.228x−2.980) have
  matched on hip_shoulder, waist, abdomen, head, AND chest — design
  intent. Chest addendum: spine socket r=2.8501 vs neck socket r=2.900
  exact, with different rim-cone r0 (2.372 vs 2.4709) — even within one
  part the sockets differ; probe each. Chamfer a rectangular HOLE rim
  exactly with hull-of-pinned-slabs (hole rect at inner z, offset rect at
  outer z — the hull diagonal lands exactly on the 45° face; convex
  outlines only). Hips variant: 3 balls at x=−8/0/+8, z=0, one full-length
  X-strut r=1.5 with a chordal flat at z=−1.3, whole part clipped z≥−2.5.
  **Ball centers sit at z=0 even though bbox-center z=0.25** — an
  asymmetric clip shifts the bbox center off the feature line; probe the
  sphere center, never infer it from bbox center.
- `revolve()` output rounds coordinates to **float32**: a subtracted
  revolve whose profile ends exactly on a face plane can land 3e-9 below
  it, leaving a nanometer-thick cap membrane (zero volume, ~πr² of phantom
  surface). Signature: hausdorff stuck high with excess volume ≈ 0, zero
  findings, voxel gates passing. Fix: overshoot subtracted profiles ±0.1
  past face planes; don't butt a union fill against the same radius the
  revolve cuts. (knee_elbow)
- **Per-part vs assembled cuts — classify each cut before ordering ops**:
  a cut that exists only on one member (the strut's chordal flat, above
  the spheres' extent) must be cut on that member BEFORE union; a cut
  spanning members (build-plate clip) is applied to the assembled body
  LAST. Misordering either direction silently refills or over-cuts.

- **5.22 Armor plates are prism-minus-cavity, not shells**: an armor part
  with volume ≈ half its bbox is a full-silhouette prism along its thin
  axis with an interior cavity cross-prism cut, not a wrapped thin shell.
  The band census reads it directly: face-plate bands (large area, holes)
  near the faces, a stable small-area multi-contour band between (the
  connecting wings), thin unstable morph bands at the plate inner faces.
  Model: outline prism − cavity prism between the EXACT measured step
  planes − per-face features. (armor_inner_chest: 6/6+2/2 at chamfer
  0.0001 in ONE authored attempt.)
- **5.23 Ray-grid z-invariance identifies a ruled clearance face**: when
  band traces "morph" near a face, grid-ray the inner face y(x,z) — if
  every z-row is identical the surface is a vertical ruled cylinder; two
  samples give R. The inner face is then max(plane, cylinder) — one
  cylinder subtraction, no lofts. Beware nearby through-holes eating rays
  (empty grid cells may be a tunnel, not missing material).
- **5.24 Groove flare in near-face sections = cylinder with center OUTSIDE
  the face**: a slot whose half-height grows non-linearly toward a face
  (linear would be a 45° chamfer) is a circular groove; three (y,h)
  samples solve (y−y0)²+h²=r² closed-form. The center can sit past the
  face plane (open snap groove). Subtract a flat-ended cylinder; the face
  clips it. (armor_inner_chest snap grooves: r=1.048, center 0.5 outside.)

- **5.25 Freeform-on-all-axes shells: levelSet-interpolate measured
  z-sections instead of band-stacking**: when `probe bands` reads freeform
  on x, y, AND z and the part is a curved shell, skip primitives — slice
  the target at fine uniform pitch, DP each section, and build
  `Manifold.levelSet` over a z-linear blend of per-section 2D SDFs with
  flat end caps. Topology changes between sections interpolate correctly
  for free (genus exact). Snap sharp ledges by inserting a STRADDLE PAIR
  of sections at ledge±0.005 so the blend zone is 0.01mm, not one pitch.
  Guard output with `decompose()` + drop sub-1mm³ shells. (armor_waist,
  hardest bootstrap in the corpus at 9.73: 0/6 → 6/6+2/2 in ONE turn,
  chamfer 0.005. Also hand_grip demo: 0.028 → 0.0093.)
- **5.25b Recipe scaling for small shells**: pitch/res scale with the
  part — a 7mm-class shell at pitch 0.1 / levelSet res 0.08 costs seconds
  and lands chamfer 0.003 (armor_neck, 1 turn); keep 0.15/0.15 for 15mm+
  parts. The ledge scan is the ONLY per-part measurement when the census
  reads freeform-on-all-axes with genus matching the bootstrap.
- **5.25a Make section-SDF levelSet cheap**: per-polygon bbox lower-bound
  early-reject inside sdf2d (still run parity when the +x ray could
  cross), and memoize per (sectionIndex, quantized x,y) — the levelSet
  grid re-queries identical xy columns every layer. 20×16×15mm at res
  0.15 with 115 sections built in ~7s where naive brute force stalls.

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
  reproduce them as internal voids at their probed centers. Use
  sphere/box voids (χ=+2 shells) — the topology gate bridges genus
  conventions (`expectedEngineGenus = 1 − targetComponents +
  targetGenusPerShell`), so torus-void workarounds are obsolete and fail.
- `Manifold.cylinder` rejects radius 0 (`must be >= 0.000001`) — for
  cones-to-a-point use `0.001`, or check whether the target dimple is
  actually a TRUNCATED cone first (§5.15).
- **Subtract voids from the ASSEMBLED body, not from a sub-part** —
  subtracting a dimple/bore from one primitive before unioning it with
  overlapping material silently refills part of the void. Do feature
  subtractions last. (frame_thigh: a shaft prism refilled half of each
  spool dimple → persistent 0.5mm hausdorff.)
- **Hull-of-two-slabs flares: pin the slab OUTER faces exactly on the
  transition planes** — slabs with thickness inside the interval tilt the
  hull diagonal off 45° (0.1-thick slabs cost ~1mm³ at the corners).
- **A two-plane wedge/mouth cutter is the INTERSECTION of its two
  half-space prisms, not the union** — subtracting each half-space
  separately removes everything below EITHER plane and carves both flanks.
  Build `cut = prism1.intersect(prism2)`, subtract once. (frame_abdomen:
  two symmetric 39.7mm³ missing blobs from this.)
- **A bowtie polygon (mirrored half assembled in the wrong point order)
  extrudes to degenerate geometry and unions/subtracts as a SILENT
  no-op** — no error, the feature is just absent. Shoelace-check winding
  before `geom.fromPoints`, and read "this union added nothing" as a
  winding bug, not a placement bug. (frame_head: entire stem missing.)
- **Derive ray-probe surface offsets from the hit point's signed plane
  distance, never from `start_offset − hit.dist` arithmetic** — a sign
  slip there "measures" anti-chamfers (material growing near a face).
- **Grid-search primitive fits: evaluate your hand-derived parameters
  through the same residual function before trusting the search** — a bad
  fit rms is not proof the primitive class is wrong until the known-good
  basin is inside the search ranges. (clavicle: two cone fits returned
  rms 0.15–0.29 purely because the r0 range excluded the true 1.3.)
- **Mouth face-chamfer points contaminate corner-strip ray samples**:
  filter |z|>chamStart hits against the offset chamfer plane, or the fit
  silently blends two surfaces.

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
