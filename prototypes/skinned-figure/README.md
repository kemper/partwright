# Skinned figure prototype

Animate a Character Creator figure in real time **without re-meshing**, and
turn any animation frame back into a printable solid.

The SDF figure builder treats its rig as a one-shot construction aid: it solves
the joints, builds a smooth signed-distance body around them, and meshes it
(~13 s per pose). This prototype adds what a Three.js "animated horse" does:

1. **Mesh once.** `export.mjs` builds the default character in an A-pose with
   the real engine (`previewModel`), then computes linear-blend skin weights
   against 15 rig bones: distance to each bone segment, normalized by the
   bone's own radius, a midline mask so one leg can't claim the other, then
   24 rounds of diffusion along mesh edges so joints blend smoothly.
2. **Skin per frame.** `index.html` / `main.mjs` loads the mesh into a
   `THREE.SkinnedMesh`. Every frame it runs the real `F.rig()` (~0.06 ms) on
   that frame's pose and sets each bone to the rigid transform that carries
   its rest frame onto its posed frame. Frames come from the rig's own FK
   outputs (limb directions, elbow and knee hinges, hand splay, head axes, the
   spine-rotated waist ring), so twist is preserved and the preview uses the
   same joint math as the printable build.
3. **Print any frame.** Animations (`animations.mjs`) are written in rig pose
   parameters (`raiseFwd`, `bend`, `spine.lean`, ...), the same fields the
   Character Creator spec takes. `print-pose.mjs` puts a frame's pose into the
   spec, adds the base, and rebuilds it with the SDF engine, producing a
   watertight, one-piece STL plus editor code.

## Run it

```bash
node prototypes/skinned-figure/export.mjs        # ~20 s → figure.bin / figure.json (gitignored)
npm run dev                                      # then open:
# http://localhost:5173/prototypes/skinned-figure/index.html
node prototypes/skinned-figure/print-pose.mjs walk 0.25    # frame → out/walk-0.25.{js,stl}
node prototypes/skinned-figure/print-pose.mjs '<pose JSON from "Pose for print">'
```

Viewer controls: animation buttons, play/pause + scrub, a skeleton overlay, a
bone-weight heat view, and **Pose for print**, which shows the current frame's
pose JSON for `print-pose.mjs`.

## Known limits (prototype)

- Linear-blend skinning loses volume at deep bends (the "candy wrapper" at a
  fully folded knee or elbow). It's only the preview; the printed frame is
  rebuilt from SDF, so it doesn't inherit these artifacts.
- The weights are a distance heuristic, not bone-heat or geodesic, so a hand
  resting against the thigh in the bind pose would be partly claimed by the
  leg. The A-pose avoids that for this figure.
- One figure, humanoid only. The rig has no quadruped preset yet.
- Garments are skinned with the body, so a skirt or cape would follow the
  legs rigidly instead of draping.
