---
session: "01QnZGNL"
timestamp: "2026-10-27T14:36:28Z"
---

## Human

Please fix kemper/partwright#1131 (switching objects saves a duplicate version
when the current version has Customizer overrides).

## Assistant

## Key decisions

**Fix**: `preserveCurrentEditsIfNeeded` (src/main.ts) now passes the live
`currentParamValues` to both `currentPartIsDirty` and `saveVersion`, matching
the explicit save path. It also passes `surfaceTexture: currentSurfaceTextureForSave()`
so a genuine preserve-save keeps the persisted texture like the explicit save does.

**Test placement**: the console `changeObject`/`changePart` does not run the
preserve step; only the Objects-rail click (`selectPart`) does. A first API-only
test passed even without the fix, so the e2e test in tests/customizer.spec.ts
drives the switch by clicking `#parts-list` rows. Verified it fails without the
fix (3 versions instead of 2) and passes with it.
