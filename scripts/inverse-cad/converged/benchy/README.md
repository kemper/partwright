# benchy — converged reconstruction (first foreign mesh)

The classic [3DBenchy](https://www.3dbenchy.com/) tugboat (© Creative
Tools, **CC BY-ND 4.0**), reverse-engineered by the inverse-CAD v2 loop as
the Phase 5 genericity proof ([#878](https://github.com/kemper/partwright/issues/878)):
the first target not designed by the Dummy 13 author, and the first
watertight-but-self-touching internet mesh (502 non-manifold edges — the
voxel-solid genus fallback, PLAYBOOK §5.37, was built for it).

`target.stl` is the unmodified original, redistributed verbatim with
attribution as CC BY-ND 4.0 permits, so the verification below is
reproducible from a fresh clone. `candidate.js` is the reconstruction
(levelSet section interpolation, 265 measured z-sections, ledge-exact SDF
override — zero free parameters, every number measured).

## Final gates (best = attempt 5 of 6 used; all green)

| gate | value | threshold |
|---|---|---|
| hausdorff P99 (MUST) | 0.0604 | ≤ 0.4mm |
| hausdorff max (MUST) | 0.1623 | ≤ 0.8mm |
| volume IoU (MUST) | 0.9957 | ≥ 0.95 |
| worst finding (MUST) | 1.92mm³ | ≤ 4mm³ |
| topology (MUST) | genus 5/5, comp 1/1 | equal |
| volume ratio (MUST) | 0.999 | 1 ± 0.02 |
| chamfer (SHOULD) | 0.0082mm | ≤ 0.12mm |
| area ratio (SHOULD) | 1.0178 | 1 ± 0.04 |

The five handles, measured (not folklore): the bow hawsepipe pierces both
bulwark walls with open air between them (2 handles), and the cabin
interior opens through the rear doorway, windshield, and two side windows
(3 handles). The chimney bore and stern deck pocket are blind — verified,
not assumed.

## Reproduce

```bash
node scripts/inverse-cad/eval.mjs scripts/inverse-cad/converged/benchy/target.stl \
  scripts/inverse-cad/converged/benchy/candidate.js --samples 20000
```

Catalog entry: `public/catalog/benchy-reconstruction.partwright.json`
(the same candidate with a `simplify(0.04)` decimation pass, re-verified
empirically after decimation).
