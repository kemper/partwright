# Face lab — fast headless review of figure faces

Bust-only snippets for iterating on `api.sdf.figure` face features without
building (or waiting for) a whole figure. Each bust renders in ~5 s with paint
resolved headlessly, and the bust shape keeps the same coarse-grid +
`faceDetail` refine path a full figure uses, so what you see here is what a
catalog figure's face will look like.

```bash
# One bust, face-on (front = azimuth 270):
npm run model:preview -- examples/faces/bust_smile.js --view 270,-2

# All four side by side:
node bin/partwright.mjs compare examples/faces/bust_smile.js \
  examples/faces/bust_open_teeth.js examples/faces/bust_lips.js \
  examples/faces/bust_chibi.js --view 270,-2 --png /tmp/face-lab.png
```

| File | Shows |
|---|---|
| `bust_smile.js` | carved smile line (default mouth), iris-style eyes (white + iris + pupil), arched brows |
| `bust_open_teeth.js` | open mouth: carved cavity + `mouthAccents` teeth band and lip ring |
| `bust_lips.js` | `'lips'` mouth style as a painted accent, solid single-colour eyes |
| `bust_chibi.js` | chibi proportions — features scale with `rig.r.head` |

Each file paints its own labels via `api.paint.label(...)`, so the preview
PNG shows the final colours and `stats.paintOps` proves every label resolved
to visible triangles (a 0-count op warns — that's how buried features are
caught). See `/ai/figure.md` for the API.
