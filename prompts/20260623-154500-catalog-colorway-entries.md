---
session: "sharpbell"
timestamp: "2026-06-23T15:45:00Z"
sequence: 12
---

## Human

make a new pr with new catalog entries

## Assistant

## Key decisions

**Five baked catalog presets from the parametric cat/dog colourway models** —
the "make them usable in the app" step (the cat/dog previously lived only in the
eval corpus). Each is a real `/catalog` entry users can open and tweak:

- Tabby Cat (stripes), Calico Cat (patches), Siamese Cat (gradient points)
- Brindle Pup (stripes), Dalmatian Pup (spots)

**Bake mechanics.** `scripts/build-catalog-entry.cjs` has no param override, so
each preset is baked from a temp copy of `evals/cases/chibi-{cat,dog}/model.js`
with the `pattern` default flipped to that colourway (the customizer params stay,
so an opened entry still exposes Pose/Build/Ears/Tail/Face/Pattern). The temp
sources aren't committed — the baked `.partwright.json` embeds the final code +
thumbnail. Thumbnails are gitignored sidecars (the real one is embedded base64),
consistent with every existing entry.

**Face palette must exclude `body`.** The coat is painted in-code by
`api.paint.pattern`; the bake's `--palette-file` applies the *face* labels
(eye/iris/nose/muzzle/…) as byLabel paint AFTER the run. A `body` key would
byLabel-clobber the in-code coat, so the bake palettes are the per-colourway
palettes with `body` stripped.

**Stacked on #852.** These entries' embedded code calls `api.paint.pattern`,
which only exists on the #852 branch — so this PR is stacked: branch off
`claude/sharp-bell-597q5s`, opened into `main`, and must merge **after** #852
(rebase onto main once #852 lands; the diff then shows only the catalog files).

**Verification.** All five thumbnails render correct coats + colored faces +
eye colours; `tests/catalog.spec.ts` (10 tests) green with the new entries
(they auto-classify as Customizable via `hasParams`); opened Tabby Cat in-app
end-to-end — imports, renders striped, and the parametric customizer is
populated. No engine/src changes in this PR — catalog data only.
