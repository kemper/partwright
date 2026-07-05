# Dummy 13 — Reverse-Engineered Design Spec

**Dummy 13** is soozafone's print-in-place articulated action figure (CC-BY-4.0).
This document is the distilled, durable reference for its design system, as
reverse-engineered by the inverse-CAD v2 loop (`scripts/inverse-cad/`,
`PLAYBOOK.md`) from the original STLs: 21 frame/hand parts
(`scripts/inverse-cad/converged/dummy13/`) and 16 armor parts
(`scripts/inverse-cad/converged/dummy13-armor/`). Every part passes all 6 MUST
acceptance gates (topology match, hausdorff P99 ≤ 0.4 mm, hausdorff max ≤ 0.8 mm,
volume IoU ≥ 0.95, worst finding ≤ 4 mm³, volume ±2%) against its source STL,
verified with exact point→triangle signed distance. **Mean chamfer distance:
0.0083 mm across the 21 frame parts (worst 0.0284 mm, the hands); ~0.0036 mm
across the 16 armor parts** — three armor parts are bit-exact or at the
tessellation floor.

**Attribution / license:** all geometry described here derives from soozafone's
Dummy 13, licensed CC-BY-4.0. Any redistribution of the reconstructions or
derivatives must credit soozafone and carry the license. Source STLs live in
`.plans/inverse-cad/target-stls/` (frame) and `.plans/inverse-cad/armor-stls/`
(armor) — both sets are force-added to git despite the `.plans/` ignore rule,
so re-verification works from a fresh clone.

**What this doc is for.** A future session should be able to (a) design a NEW
part that mates with the kit — correct ball/socket/clip interfaces — without
re-measuring anything, (b) understand each existing part's architecture at a
glance, and (c) know which reconstructions are semantic CAD vs levelSet
section-tables. Every number below cites the part(s) it was measured on. All
units mm; parts are Z-up, print-flat on z=0 (or clipped at a z plane).

---

## 1. The joint system

### 1.1 Balls — r = 3.000, exactly, everywhere

Every joint ball probe-fit in the kit came back **sphere r = 3.000 with rms 0
and inlier fraction 1.0** (or within fit noise of it). Measured on:
adapter_stand, frame_abdomen (chest ball), frame_chest (both shoulder balls),
frame_clavicle_2x, frame_forearm_2x (elbow), frame_hips (all 3 balls),
frame_neck (both balls), frame_shin_2x (knee), frame_waist (hip ball). Design
intent: the kit's Ø6 joint spec. Fit is achieved by varying the **socket**
radius per part (below), never the ball.

**Center conventions — two traps:**

- **Ball centers sit on the feature line, not the bbox center.** frame_hips'
  balls are at z=0 even though the bbox center is z=0.25 — the asymmetric
  build-plate clip (whole part clipped z ≥ −2.5) shifts the bbox center off
  the feature line. Probe the sphere center; never infer it from the bbox.
- Two center-height conventions by part family: **center-frame parts**
  (hips, waist, abdomen, neck, chest) put ball centers at z=0 and clip the
  assembly at z=−2.5; **limb parts** (shin, forearm; thigh/upper_arm have no
  ball) sit z ∈ [0,5] with the ball center at z=2.5, clipped flat at z=0 by
  the plate (the sphere would reach z=−0.5). In both frames the ball is
  clipped 2.5 below its center.
- Limb ball anchor: **center = ymin + 3** (ball tangent to the part's −y bbox
  face; frame_shin ball at y=−28 of bbox −31…, frame_forearm at y=−15).

### 1.2 Sockets — grammar is kit-wide, radii are per-part

The socket grammar repeats (sphere + ~20° lead-in cones + mouth wedge through
the center + corner-chamfer line), but **the numbers are deliberately
per-part — always re-measure the radius** (PLAYBOOK Dummy-13 kit note):

| Socket | Radius | Measured on |
|---|---|---|
| Hip/shoulder ring | **2.9075** | frame_hip_and_shoulder_4x (probe fit, inliers 0.988) |
| Ankle ring | **2.9046** | frame_ankle_2x (probe fit, 99.1% inliers) — the PLAYBOOK kit note and converged README round this to "2.9075 ankle/hip_shoulder"; the ankle's own notes say 2.9046. Treat 2.905–2.9075 as the same design radius; re-probe if it matters. |
| Wrist (all 6 hands) | **2.900 exact** | hand_grip_left/right, hand_open_left/right, hand_fist_left/right — rms 0, center exactly [0,0,0] in every hand |
| Clavicle cavity | **2.900 exact** | frame_clavicle_2x (rms 0) |
| Chest neck socket (opens +y) | **2.900 exact** | frame_chest (rms 0) |
| Head socket | **2.8979** | frame_head (@ (0,−0.013,2.5)) |
| Chest spine socket (opens −y) | **2.8501** | frame_chest — differs from the neck socket **within the same part**; probe each socket independently |
| Waist socket | **2.852** | frame_waist (ray-verified axisymmetric at 4 azimuths) |
| Abdomen socket | **2.8488** | frame_abdomen (ray-verified at 3 angles) |

Reading: parts nearer the torso core get tighter sockets (2.85-class), distal
joints looser (2.90-class). r=3.000 ball − socket radius = 0.09…0.15
interference — these are snap-fit friction joints, not clearance fits.

### 1.3 Lead-in cones (socket rim entry chamfers)

Every open socket face carries a conical lead-in, ~20° from vertical (NOT
45°). Per-part specs, r(d) with d = depth from the face:

| Part | r at face (r0) | slope | Measured on |
|---|---|---|---|
| frame_hip_and_shoulder_4x | 2.4709 | 0.3678 | ray ladder, both faces |
| frame_ankle_2x | 2.4649 | 0.3708 | ray, both faces (cone meets sphere at depth ≈0.64) |
| frame_clavicle_2x | 2.4689 | 0.3678 | ray at 0.1 steps, both faces |
| frame_head | 2.469 | 0.368 | both faces |
| frame_chest (neck socket) | 2.4709 | 0.3678 | == hip_shoulder values exactly |
| frame_chest (spine socket) | 2.372 | 0.3678 | from z=2.45/2.25 sections |
| frame_abdomen | 2.3677 | 0.3525 | 4 ray samples (0.3513–0.3529) |
| frame_waist | 2.3675 | 0.3515 | hourglass form: r(z)=1.4888+0.3515·\|z\| from center; sphere/cone crossover at \|z\|=1.873 |

Pattern: the 2.90-class sockets take r0≈2.47/slope≈0.368; the 2.85-class
take r0≈2.37/slope≈0.352. Cones are on **both** z faces of every double-open
socket ("hourglass"): hip_shoulder, ankle, clavicle, head, chest (both),
abdomen, waist.

**Hourglass revolve variant** (no sphere): frame_knee_and_elbow_4x's sockets
are a revolve about Z — counterbore r=2.4 depth 0.4 on both faces, exact 45°
cones (r = 2.8−z and r = z), cylindrical waist r=1.5407 for z ∈ [1.259, 1.541].
These grip the limb **spool** (§5.1), not a ball.

### 1.4 Mouth-wedge grammar

Ball-socket parts open their mouth as a wedge of two vertical planes
**passing exactly through the socket center**:

- Wall slope **y = ±0.6682·|x|** (0.66818 = tan 33.75°, i.e. a 112.5° notional
  opening). Confirmed identical on frame_hip_and_shoulder_4x, frame_waist,
  frame_abdomen (mirrored, −0.6682), frame_head (opens −y), frame_chest (both
  sockets), frame_clavicle_2x — design intent, not coincidence.
- frame_knee_and_elbow_4x uses the same through-center rule with a **110°**
  wedge (edge lines at 40°→150°, mirrored 30°→140°); even a channel wall
  segment passes through the center. Rule: **any mouth/channel cut line on a
  socket part passes through that socket's center** — verified three times on
  knee_elbow, plus every part above.
- **Corner-chamfer line** between mouth wall and outer arc:
  **y = ±(0.2279·x − 2.9803)**, endpoints at r=4.0 on the mouth line and
  r=4.5 on the arc. Measured on frame_hip_and_shoulder_4x; repeated exactly
  (mirrored) on frame_abdomen and frame_chest; frame_waist measured
  0.228/2.9806 (same line to noise); frame_head carries the identical line as
  unchamfered flats (offset 2.9062 along n=(±0.2224, −0.9749) — same
  line spec). On frame_clavicle_2x's spherical body the line becomes a
  **conoid** (ruled surface, z-modulated: cut y < −0.3215 − s(z)·(2.6138 −
  0.2168·|x|), s=√(1−(z/3.3882)²)) — the one place the straight line bends.
- **Socket body outline**: the outer wall of every socket block is an **arc
  r=4.500 about the socket center** (hip_shoulder, ankle, waist, chest,
  knee_elbow; clavicle uses a full sphere r=4.500). A DP trace disguises this
  as "flat wall + corner fillet" — always test traced boundary points against
  the probed center first (PLAYBOOK §5.20).
- **Face chamfers**: 45°, leg 0.5, on top AND bottom faces, but only on a
  per-part inventory of edges (typically: outer arc, side walls, mouth lines;
  NOT corner-cut lines, tab ends, or cavity rims). Read the inventory from a
  z = face+0.05 section before chamfering anything (PLAYBOOK §5.21).

### 1.5 Armor clip mechanics

The armor is a friction/snap overlay on the frame. Measured interface numbers:

- **Knee-pivot cluster** (armor_thigh_2x): everything at the top references
  ONE axis — X through (y=0, z=22). Swing-notch floor = cylinder
  **r=4.7511** about that axis (clipped |x| ≤ 1.6, y ≤ 0); **pivot boss
  spheres r=0.9959** at (±3.197, 0, 22) on the prong inner faces; tab top
  z=17.25 = 22 − 4.75 (tangent to the swing circle). Fit the shared axis
  once, reuse for every feature (PLAYBOOK §5.31).
- **Snap detents** (armor_forearm_2x): spheres **r=1.000 exact** at
  (±3.3, 0.5, 3.5) — center sits **0.6 OUTSIDE the inner wall** (x=2.7), so
  only a 0.4-proud spherical cap (ρ=0.8 ring at the wall) protrudes into the
  cavity. Clip with `.intersect(body)`, add LAST after all cuts.
  armor_shin_2x has the same idea as ~270-facet detent bumps on the inner
  walls at (x≈±2.3..2.6, y≈10.3..11.7, z≈3.0..4.2).
- **Snap grooves** (armor_inner_chest): open X-axis cylinder grooves
  r=1.0477 centered at (y=±4.4983, z=5) — center ~0.5 outside the y=±4 face
  (likely design intent r=1.05 @ y=4.5). Snaps over the frame chest's r=1.5
  strut region.
- **Clearance bores r=3.1** (frame-thickness + 0.1 rule):
  armor_upper_arm_2x bore = cylinder r=3.100 (144-gon, decoded from the
  tangent-plane fan) mating the frame fork's r=3.1 cavity;
  armor_inner_chest inner clearance cylinder r=3.100 about Z (clears the
  frame chest's spine socket block); the **frame** thigh/upper_arm fork
  cavity itself is r=3.1 (= ball r3.0 + 0.1) — the knee/elbow C-clip that
  snaps over the shin/forearm ball.
- **Clearance arithmetic** (armor_thigh_2x): bore half-width 2.6 = frame
  octagon half-width 2.5 + 0.1; ball-clearance pocket r=3.2 = hips ball 3.0
  + 0.2, pocket depth 5.2 = frame thickness 5 + 0.2. Rule of thumb: **+0.1
  per side sliding clearance, +0.2 radial around balls.**
- **Wall thickness** where measured: armor_upper_arm ~1.0–1.5 (varies with
  outer taper); armor_waist ~1.5–2.
- Armor shells carry **no sockets** — the frame owns all ball joints
  (armor_foot notes: the frame_ankle socket was never needed).

---

## 2. Frame part catalog (21 parts)

Fidelity columns from `converged/dummy13/README.md` / each part's
`metrics.json`: chamfer (mm), hausdorff max (mm), volume IoU. All 21 pass
6/6 MUST; all except the six hands also pass 2/2 SHOULD (hands miss only
area-ratio, a staircase modeling-style limit). Code style: **CSG** =
parametric primitive composition; **traced** = digitized slice-stack /
traced polygons.

| Part | Chamfer | Hmax | IoU | Style |
|---|---:|---:|---:|---|
| adapter_stand | 0.0008 | 0.069 | 0.9991 | CSG (revolved traced r(y) polyline + probed keyhole) |
| frame_abdomen | 0.0022 | 0.343 | 0.9978 | CSG |
| frame_ankle_2x | 0.0026 | 0.119 | 0.9949 | CSG (keyhole = traced 13-pt polygon) |
| frame_chest | 0.0067 | 0.353 | 0.9927 | CSG |
| frame_clavicle_2x | 0.0009 | 0.048 | 0.9990 | CSG + hulled conoid bands |
| frame_forearm_2x | 0.0005 | 0.094 | 0.9996 | CSG (fully parametric) |
| frame_head | 0.0031 | 0.122 | 0.9938 | CSG (stem bulb traced) |
| frame_hip_and_shoulder_4x | 0.0039 | 0.296 | 0.9948 | CSG |
| frame_hips | 0.0005 | 0.086 | 0.9992 | CSG |
| frame_knee_and_elbow_4x | 0.0034 | 0.046 | 0.9964 | CSG over traced base outline |
| frame_neck | 0.0004 | 0.003 | 0.9995 | CSG |
| frame_shin_2x | 0.0003 | 0.091 | 0.9998 | CSG (fully parametric) |
| frame_thigh_2x | 0.0013 | 0.086 | 0.9978 | CSG (slot = traced 11-pt polygon) |
| frame_upper_arm_2x | 0.0017 | 0.087 | 0.9982 | CSG (thigh transfer) |
| frame_waist | 0.0009 | 0.089 | 0.9991 | CSG |
| hand_fist_left | 0.0216 | 0.739 | 0.9762 | traced (0.4/0.2 mm z-bands + probed socket) |
| hand_fist_right | 0.0217 | 0.683 | 0.9760 | traced (mirror of fist_left) |
| hand_grip_left | 0.0284 | 0.287 | 0.9556 | traced (0.4 mm z-bands + socket + debris voids) |
| hand_grip_right | 0.0282 | 0.288 | 0.9550 | traced (mirror of grip_left, box voids) |
| hand_open_left | 0.0235 | 0.198 | 0.9635 | traced (0.4 mm z-bands + socket) |
| hand_open_right | 0.0234 | 0.198 | 0.9631 | traced (mirror of open_left) |

Architecture, per part (details + every measured number in each part's
`notes.md`):

- **adapter_stand** — keyhole hanger: ball r3 at (0,−5.5,2.5), concave traced
  neck r(y) (NOT cones, NOT a fillet arc) flaring to a r4.0 flange at y=−1..0,
  prismatic keyhole loop z 0..3 (outer circle R1.4997 + straight foot x=±1.2;
  inner void r0.6592 + slot x=±0.36). Genus 1. Clipped flat z=0.
- **frame_abdomen** — spine segment: belly disc r4.5 (z ±2.5, 45° leg-0.5 arc
  chamfers), socket r2.8488 + cones + mouth wedge + corner lines (§1.2–1.4),
  elliptical bulge prism (3.2 × 2.5), body Y-cylinder r3 → chamfer → D-neck
  r1.5 (flat z=−1.3) → ball r3 at (0,13,0). Everything clipped z ±2.5.
- **frame_ankle_2x** — socket ring (disk r4.5 + mouth wedge with rays through
  the socket center) + neck rect + lobe disk r1.5 + traced keyhole through-hole
  (genus 1); socket r2.9046 at z=2.5 + ~20° entry cones both faces; 45° 0.5
  chamfers on ring face edges only, built as exact cone/wedge envelopes.
- **frame_chest** — hub: TWO hip_shoulder-grammar socket blocks (spine r2.8501
  opens −y; neck r2.900 opens +y) + plate (column, octagon bar, slot 3.0×3.2 —
  genus hole), struts r1.5 with z=−1.3 chordal flat into shoulder balls r3 at
  (±6,14,0), prismatic arm slabs. Genus 2. Full §5.11 exact chamfer set.
- **frame_clavicle_2x** — ball-to-socket bridge: outer body is a SPHERE r4.5
  (not a prism block), cavity r2.900 + cones + mouth wedge; corner cut becomes
  a ruled conoid (§1.4); neck cylinder r1.5 (NO flat); ball r3 at (0,7,0).
- **frame_forearm_2x** — the limb archetype (§5.1) at short length: elbow ball
  r3 (0,−15,2.5), D-neck, end-face chamfer, oct(2.5) shaft, window slab
  z 1.0..4.1, wrist spool at (0,0). Genus 1.
- **frame_head** — hip_shoulder sibling, mirrored (mouth opens −y): ring disc
  r4.5, socket r2.8979 + cones, mouth wedge 0.6682, corner flats (unchamfered),
  keyhole stem plate z 0..3 with slot (genus 1 handle).
- **frame_hip_and_shoulder_4x** — the canonical socket block: socket r2.9075 +
  cones + mouth wedge + corner chamfer line + r4.5 arc body, tab (leg-1.0
  chamfers), rod r1.5, rear block cylinder r2.9995 clipped flat z=0.
- **frame_hips** — 3 balls r3 at x=−8/0/+8 (z=0), one X-strut r1.5 with
  chordal flat at z=−1.3 (cut on the strut BEFORE union), whole part clipped
  z ≥ −2.5.
- **frame_knee_and_elbow_4x** — double-C bridge: two hourglass sockets (§1.3)
  at (0,0)/(6,0), mirror plane x=3, eye lobe r1.5 @ (3,3.6) with keyhole
  (genus 1), 90° V-notch at bottom (sharp miter), 110° mouth wedges. Clips
  onto the limb spools.
- **frame_neck** — two balls r3 at y=0/y=10, mid sphere r2.45 at (0,5,0)
  (NOT a spool), neck cylinder r1.5 with NO chordal flat, octagonal Y-prism
  shaft y 3..7 (x ±1.5, 45° chamfers to ±1.2 at z=±2.5), clipped z ≥ −2.5.
- **frame_shin_2x** — limb archetype, long: knee ball r3 (0,−28,2.5), D-neck
  (flat clears the thigh channel shelf), shaft-face chamfer, oct(2.5) shaft,
  window z 1.0..4.1, ankle spool. Genus 1.
- **frame_thigh_2x** — NOT the two-ball archetype: spool at (0,0) (hip pivot),
  window (genus 1), oct(2.5) shaft y 0..14.5, 45° flare to hw 4, fork block —
  the knee **C-clip**: curved slot (genus 2), fork cavity r3.1 + wall bump
  r2.0 (0.5-thick flex wall), snap channel r1.6 with z<0.9 tip shelf
  (genus 3).
- **frame_upper_arm_2x** — the thigh with the shaft 8 mm shorter (oct
  y 0..6.5); every feature beyond the shaft face shifted −8; spool/window/
  fork/slot byte-identical. Genus 3.
- **frame_waist** — disc r4.5 + shoulder block, hourglass socket r2.852
  (§1.3), mouth wedge + corner lines, tangent-blended side tabs (circle
  r0.5986 @ x=±3.0529 + 45° tangent lines), D-neck (flat z=−1.3), ball r3 at
  (0,11,0). Uniform 0.5 chamfer on the whole plan outline, both faces.
- **hands (6)** — organic sculpts, digitized: fine z-band slice stacks
  (0.4 mm; 0.2 mm above the z=2.5 ledge on the fists), band edges snapped to
  measured ledges, each band extruded +0.01 overlap (weld trap), socket rebuilt
  by exact `Manifold.sphere(2.9, 96)` subtraction, internal debris shells (in
  grip/fist targets) reproduced as small box voids. Rights are exact
  `.mirror([1,0,0])` copies of the converged lefts. (An earlier torus-void
  variant of hand_grip_left predated a topology-gate fix; the checked-in
  candidate is the corrected levelSet version — all six hands now use the
  genLevelSet generator with box debris voids where needed.)

---

## 3. Armor part catalog (16 parts)

All 16 pass 6/6 MUST + 2/2 SHOULD. Style: **CSG** = exact facet-census /
probe-driven decode; **levelSet** = SDF interpolation of measured z-sections
(digitized, faithful, not semantic). Numbers from each part's notes/metrics.

| Part | Chamfer | Hmax | IoU | Style |
|---|---:|---:|---:|---|
| armor_abdomen | 0.0025 | 0.092 | 0.9979 | levelSet (stock genLevelSet) |
| armor_crotch | 0.0215 | 0.529 | 0.9722 | traced prism (bootstrap; see gap note) |
| armor_foot_2x | 0.0019 | 0.060 | 0.9982 | levelSet (86 sections, 2 ledges) |
| armor_forearm_2x | **0.000** | 0.003 | 0.9989 | CSG (facet-census decode; near bit-exact) |
| armor_head | 0.0048 | 0.128 | 0.9957 | levelSet (stock) |
| armor_hip_2x | 0.0024 | 0.092 | 0.9950 | levelSet (stock) |
| armor_inner_chest | 0.0001 | 0.007 | 0.9996 | CSG (probe-driven) |
| armor_knee_2x | **0.0000** | 0.000 | 1.0000 | CSG (hull + polygon; **bit-exact**) |
| armor_neck | 0.0027 | 0.049 | 0.9956 | levelSet (55 sections, 1 ledge) |
| armor_outer_chest | 0.0045 | 0.118 | 0.9960 | levelSet (138 sections, 5 ledges) |
| armor_shin_2x | 0.0061 | 0.098 | 0.9930 | levelSet (95 sections + SDF clamp) |
| armor_shoulder_2x | 0.0037 | 0.118 | 0.9827 | levelSet (stock) |
| armor_thigh_2x | 0.0010 | 0.039 | 0.9984 | CSG (measured restructure) |
| armor_toe_2x | 0.0016 | 0.057 | 0.9968 | levelSet (39 sections, 1 contour-birth) |
| armor_upper_arm_2x | **0.000** | 0.000 | 0.9949* | CSG (hull-of-exact-verts; distances bit-exact, *IoU at voxel floor) |
| armor_waist | 0.005 | 0.132 | 0.9953 | levelSet (115 sections, 6 ledges) |

- **armor_abdomen** — belt plate, x-mirror, 16×11.34×15.5, genus 1
  through-tunnel. Census names every flat wall (see notes) but curved
  front/back fans routed it to levelSet.
- **armor_crotch** — ⚠ NO notes.md exists. From state/metrics: converged at
  the deterministic bootstrap itself (attempt 0), 6/6+2/2, genus 0; the
  candidate is a single traced z-prism (one 5 mm-tall extruded outline,
  prismaticScore 0.8). Weakest fidelity in the corpus (chamfer 0.0215) but
  all gates pass. No measured-structure writeup exists.
- **armor_foot_2x** — curved foot shell, 8×16.19×8, genus 1 vertical tunnel;
  ledges z=3.0025 (big) and 6.4025 (contour birth).
- **armor_forearm_2x** — clip-shell tube, genus 4 (ring + windowed side
  walls ×2 + roofed ridge channel); octagon tube hw 3.5, ASYMMETRIC side
  bulges (+x is a 45° plan chamfer, −x a flat y=−1.5 face — "2x" parts can be
  non-mirror in small features, §5.34), transverse window with 8 three-plane
  corner miters, snap detent spheres r=1.000 (§1.5).
- **armor_head** — helmet, z-mirror about z=5.75, NOT x-mirror (asymmetric
  visor), 14×17.5×11.5, genus 0; stepped rear slot, interior ledges
  z=1.05/10.45.
- **armor_hip_2x** — arch cap 12×8×10.8, genus 0; base block with 45° plan
  corners, cylinder-fan arch, a linear-erosion 45° rear band (inset sweep —
  prism along no axis, §5.25c), crown slot, ball-clearance scoop dish in the
  cavity back wall.
- **armor_inner_chest** — NOT a shell: Y-prismatic chest silhouette minus a
  cavity cross-prism (|y|<2.5 exact) minus clearance cylinder r=3.100 (Z axis)
  minus central rect tunnel (1.6×z 1.9..5.3, through both plates); 4 open
  snap grooves r=1.0477 (§1.5). Genus 3. x- and y-symmetric.
- **armor_knee_2x** — **bit-exact**: convex decagon-plan hood =
  `Manifold.hull` of 40 exact welded verts, minus one X-axis cavity prism
  (polygonized circle r=1.5 c(y0,z1) + 30° tangent tent + bottom flare),
  polygon points hardcoded float32-verbatim from the vertex list.
- **armor_neck** — small saddle shell 7×7×5.14, genus 0; one ledge z=4.4025.
- **armor_outer_chest** — biggest piece, wrap-around shell 18×15.02×20,
  genus 2 (collar ring + front-plate window); 5 ledges (2.005, 10.005,
  11.895, 15.305, 16.005).
- **armor_shin_2x** — shell over the frame shin, genus 3 (square ring tube,
  side-window frame, covered-channel ring); knee hump, snap nubs; needed the
  §5.25d SDF clamp for the flat deck at z=7.3.
- **armor_shoulder_2x** — dome-hood plate, genus 0; back wall y=−2, flat side
  walls |x|=4.5, interior ledges z=0.8/2.0, curved roundover fans.
- **armor_thigh_2x** — sleeve: chamfered-rect plan (x±4.5, y±6, 45° corner
  cuts that SHEAR with the walls, §5.30), planar front wall y=6.60606−
  0.151515z, circular-arc back wall (r=81.2869 c(y=75.29,z=4.00), tangent to
  y=−6 at z=4), front scoop, knee-pivot cluster on one axis (§1.5), bore
  hw 2.6 + ball pocket r3.2. Genus 1.
- **armor_toe_2x** — toe cap 8×7×3.5, genus 0; no area ledges, one contour
  birth at z=3.0075.
- **armor_upper_arm_2x** — clip shell: **convex outer** = hull of 26 exact
  outer verts/side (109 facet planes total), cavity = union of 5 convex
  prisms + bore cylinder r=3.100 (144-gon, vertex phase 1.25°). Genus 1
  (floor+ceiling bridge band). Zero fitted numbers — all census readouts.
- **armor_waist** — wrap shell 20×16×15.2, genus 2 (apron through-hole +
  front window); inner J-profile is X-prismatic but the outer tapers;
  6 ledges (1.5, 2.0, 3.0, 4.0, 12.0, 12.2).

---

## 4. Shared archetypes

### 4.1 The limb archetype (shin ≡ forearm; thigh ≡ upper_arm)

Transferred verbatim between siblings, re-verified by chord math (PLAYBOOK
§5.18). Y-long, z ∈ [0,5], x-symmetric:

- **Ball end** (shin/forearm only): r=3.000, center (0, ymin+3, 2.5), clipped
  flat at z=0 by the plate.
- **D-neck**: circle r=1.5 about (y-axis at z=2.5) with a chordal flat at
  world **z=1.2** (i.e. 1.3 below the axis — the same 1.3 offset as the
  center-frame parts' z=−1.3 flats on hips/waist/abdomen/chest struts). The
  flat does not continue onto the ball. frame_neck and clavicle necks have
  NO flat — ray it, don't assume.
- **Shaft-end face chamfer**: 0.5 × 45° around the full perimeter.
- **Shaft**: chamfered octagon 5×5 (half-width 2.5, 0.5 × 45° on the four
  long edges).
- **Window** (the genus handle): slab void z 1.0..4.1 (asymmetric walls
  1.0/0.9), from the shaft face (spool center −5) past the spool, leaving
  z 0..1 and 4.1..5 bridges.
- **Spool** (pivot end, gripped by knee_and_elbow's hourglass): vertical
  cylinder r=2.5 at (0, ymax−2.5), 45° V-groove pinching to r=1.5 at z=2.5
  (groove z 1.5..3.5), 0.5 face chamfers (r=2.0 at z=0/5), truncated-cone
  **dimples r=1.0→r=0.5, depth 0.5, flat floor** on both faces — subtract the
  dimples from the FINAL body (last), or the shaft prism refills them.
- **Fork end** (thigh/upper_arm instead of a ball): 45° flare hw 2.5→4, fork
  block, curved slot, C-clip cavity r=3.1 + wall bump r=2.0 (flex wall 0.5
  thick), entry channel r=1.6 with z<0.9 tip shelf. Measured on frame_thigh_2x;
  upper_arm is the same shifted −8 in y.

### 4.2 The socket-block grammar

sphere (per-part radius, §1.2) + lead-in cones both faces (§1.3) + mouth
wedge 0.6682 through the center (§1.4) + outer arc r=4.5 about the center +
corner-chamfer line y=±(0.228x−2.980) + 45° leg-0.5 face chamfers on a
per-part edge inventory. Instantiated on: hip_shoulder, ankle (variant),
head (mirrored), waist, abdomen (double-faced disc), chest (twice),
clavicle (spherical body).

### 4.3 Armor classes

- **Plate (prism-minus-cavity)**: volume ≈ 50% of bbox → full-silhouette
  prism along the thin axis − cavity cross-prism at exact measured planes −
  clearance cylinders/grooves. (armor_inner_chest; PLAYBOOK §5.22.)
- **Clip-shell (convex hull − convex openings)**: low-poly faceted exports
  decode exactly from a facet census; outer body convex → hull of exact
  welded vertices, cavity = union of convex prisms; detents added last.
  (armor_upper_arm, armor_knee, armor_forearm; §5.26–5.28.)
- **Freeform shell (levelSet section-table)**: volume ≪ 50% of bbox +
  census stays near tris/2 (curved fans) → `Manifold.levelSet` over
  z-interpolated measured sections with straddle pairs at ledges (§5.25).
  These candidates are **faithful digitizations, not semantic CAD** — the
  notes' census structure maps are the spec if a CSG rebuild is ever wanted.
  (waist, outer_chest, neck, foot, toe, shin, hip, head, abdomen, shoulder.)

### 4.4 Mirror pairs and "2x/4x" parts

- Exact mirror pairs (right = left `.mirror([1,0,0])`, verified by bbox
  negation + probe before flipping): hand_grip, hand_open, hand_fist.
- "2x"/"4x" frame parts (ankle, clavicle, forearm, hip_and_shoulder,
  knee_and_elbow, shin, thigh, upper_arm) are ONE geometry printed N times —
  they are individually x-symmetric, no left/right variants.
- Armor "2x" parts: one geometry printed twice, but NOT necessarily
  internally mirror-symmetric — armor_forearm's −x bulge differs from +x
  (§5.34). Census-diff the ± facet areas before assuming symmetry.

---

## 5. Reuse guide — designing a new part that mates with the kit

1. **To hang a new part on an existing ball** (wrist, ankle, hip, shoulder,
   neck, chest): give it the socket-block grammar (§4.2). Pick the socket
   radius by joint class — 2.900 for a distal/hand-class fit (measured on 4
   hands + clavicle + chest neck), 2.9075/2.9046 for the ring-class
   (hip_shoulder/ankle), 2.85-class only for torso-core stiffness. Add
   lead-in cones r0≈2.47, slope≈0.368 (both faces if double-open), mouth
   wedge y=±0.6682|x| through the center, outer arc r=4.5 about the center.
2. **To give a new part a ball**: sphere r=3.000 exactly; D-neck r=1.5 with
   the chordal flat 1.3 below the neck axis; clip 2.5 below the ball center
   for the print bed.
3. **To mate the knee/elbow hourglass clip**: give the part a spool (§4.1
   spec: r2.5, V-groove to r1.5, dimples r1.0→0.5×0.5) — the clip's
   counterbore r2.4 / 45° cones / waist r1.5407 grip it.
4. **To clip armor over a frame member**: +0.1 per side over the frame
   octagon (bore hw 2.6 over hw 2.5), +0.2 radial around balls (pocket r3.2
   over r3.0), r=3.1 bores over fork/socket blocks; snap detents = r=1.0
   spheres with centers ~0.6 outside the wall (0.4 proud); pivots on one
   shared axis with boss spheres r≈1.0 and swing clearance r≈4.75 about it
   (measured on armor_thigh).
5. **Where the code lives**: each part's reconstruction is
   `scripts/inverse-cad/converged/dummy13[-armor]/<part>/candidate.js` —
   manifold-js snippets runnable in the Partwright sandbox or via
   `npm run model:preview -- <candidate.js>`. Measured dimensions and
   design-intent findings: the sibling `notes.md`. Gate results:
   `metrics.json`; attempt history: `state.json`.
6. **To re-verify a candidate against its STL**:
   `node scripts/inverse-cad/eval.mjs .plans/inverse-cad/target-stls/<part>.stl scripts/inverse-cad/converged/dummy13/<part>/candidate.js`
   (armor: `.plans/inverse-cad/armor-stls/` + `converged/dummy13-armor/`).
   The STLs are checked in (force-added past the `.plans/` ignore rule).
7. **Working method** (probes, gates, tactics, traps — e.g. float32 revolve
   membranes, hull convexification, per-part-vs-assembled cut ordering):
   `scripts/inverse-cad/PLAYBOOK.md`, especially §5.18 (sibling transfer +
   limb archetype), the §5 "Dummy 13 kit note", and §5.22–5.36 (armor).

### Known gaps / conflicts in the source notes

- **armor_crotch has no notes.md** — only state/metrics + the bootstrap
  candidate. No measured structure map exists for it.
- **Ankle socket radius**: frame_ankle_2x notes say r=2.9046; the PLAYBOOK
  kit note and converged README both say "2.9075 (ankle/hip_shoulder)".
  Probably the same design radius reported at different fit precision;
  re-probe if a new part needs the exact value.
- **Corner-chamfer line constants** vary in the 3rd decimal across parts
  (0.2279/2.9803 hip_shoulder·abdomen·chest, 0.228/2.9806 waist, offset-form
  2.9062 head) — treat y=±(0.228x−2.980) as the design line.

- A planned semantic rebuild (`src/geometry/dummy13.ts`, mentioned in the
  converged README) does not exist yet.
