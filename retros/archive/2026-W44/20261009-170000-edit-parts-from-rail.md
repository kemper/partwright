# Retro — edit parts from the Objects rail (#1003)

**Liked:** Treating the rail selection as a *scope* (one `scope: {label}` field
on paint descriptors) instead of per-tool part modes. It kept ~10 paint tools
consistent with a handful of edits. Routing every rail action through the
matching `window.partwright` method gave API parity for free.

**Lacked:** No world→screen helper for e2e, so interactive paint checks meant
reading coordinates off a screenshot. A long smooth-brush drag also refines
asynchronously for tens of seconds, and `listRegions()` reports 0 triangles
until it finishes. I mistook that for a scope bug for three runs.

**Learned:**
- Region triangles are assigned in more places than the resolver. The async
  worker brush footprints bypassed it, and only a real UI drag caught it.
- The editor auto-formats code on save, so any generated code that is parsed
  back later (the piece-filter spec line) must tolerate reformatting.
- `reresolveModelRegions` scrambled the code-colour underlay on full rebuilds.
  This is a long-standing bug that a unit test would never have hit.

**Longed for:** A `partwright.waitForPaintIdle()` (or a promise on the async
reconcile), so tests and agents can wait for smooth strokes deterministically.
Also a `projectToScreen(point)` debug API for interaction specs.
