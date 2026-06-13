---
date: "2026-06-13"
task: "feat: sole follows foot curvature via slice technique + welt/flush style option"
pr: 634
areas: [figure, sdf, docs, catalog, examples]
---

## Human

The soles still don't look right — it's like welding a cuboid onto rounded feet. Would it be easier to color the bottom band, or make the sole follow the foot's curvature? Let's discuss. (After demos:) I like both flush and welt — use options/parameters so either works, make welt the default. Take more previews, at least 4 angles each.

## Assistant

Root cause: the sole was a `roundedBox` smooth-welded onto a rounded last → two mismatched shapes. Demoed two techniques from 4 angles each (colored): paint-band vs slice. Paint-band mis-colored the flat bottom face (paint-by-Z-band is ambiguous at the base); the slice technique with a real `sole` label colors the whole sole solid, bottom included. User picked: support both flush and welt via options, welt default.

Implemented the **slice technique**: the footwear last now reaches the ground, and the sole is a horizontal SLICE off the bottom of the shoe's OWN solid (`shoe ∩ {groundZ ≤ z ≤ soleTopZ}`), so it follows the foot's curvature exactly. `sole.style: 'welt'` (default) inflates that slice outward by `lip` so it sits proud of the upper (classic shoe sole); `'flush'` keeps the upper's outline. Upper = `shoe ∩ {z ≥ soleTopZ − weld}`; the two overlap and their union reconstructs the full shoe, so skin coverage is preserved by construction.

Options: `sole: { style: 'welt'|'flush', thickness, lip (alias overhang), label }`. Verified: coverage probe **0 uncovered** for shoes/boots × welt/flush × neutral/posed; typecheck + 1319 unit tests green; colored multi-angle bakes (iso/side/underside) of superhero (boots) and sneakers — natural sole following the curvature, clean dark underside, no skin. Docs + sneakers example updated to `style`/`lip`; both catalog entries rebaked.
