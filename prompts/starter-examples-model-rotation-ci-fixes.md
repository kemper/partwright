---
session: "gf44vx"
timestamp: "2026-06-09T11:22:00Z"
model: claude-opus-4-8
---

## Human

(PR #524 CI follow-up) Several e2e shards failed after the first push. Investigate
and fix.

## Assistant

## Key decisions

**Two distinct failure classes, one root each.**

**1. Import-into-fresh-editor tests broke (inbox-persistence, relief, stl-import,
voxel-engine — the "import-target modal appeared when it shouldn't" cluster).**
Root cause: `isStarterCode` compares the editor's `getValue()` against the raw
`STARTER_JS_CODES` source, but `setValue` runs the editor's `js-beautify`
auto-formatter — which reflowed my multi-var `const r = 2.5, hx = 11, ...` onto
separate lines and added a trailing newline. So a freshly-seeded starter no
longer string-matched its source, `currentPartIsExpendable()` returned false,
and imports popped the target modal instead of landing directly. On `main` this
was masked because the fresh-editor paths ran `runCode(defaultCode)` *without*
`setValue` (keeping `initEditor`'s raw buffer); I changed them to
`seedManifoldStarter()` (setValue + runCode) so rotation updates the editor
text, which exposed the mismatch. Fix: **pre-beautified the five starter files
through the exact `applyFormat` js-beautify options so they're idempotent** —
now `getValue()` equals the source whether auto-format is on or off, and
recognition is consistent. Verified the files still render (`componentCount: 1`,
manifold) after beautifying.

**2. `feedback-a11y` export-toast test broke.** The starters are self-colored via
`api.label`, so STL export now correctly raises the "STL can't carry colour —
colours will be dropped" confirm (`colorDropped`), where the uncoloured
`basic_shapes` exported silently. This is desired behaviour, not a bug. Updated
the test to click "Export anyway" past the confirm before asserting the toast.
Audited every other UI-STL-export test: export-safety/paint-palette/versions-tab
run their own geometry, and inbox-persistence's export test uses the console
`exportSTL()` (modal-free), so none else were affected.

**`voxel-engine:114` updated for the now-consistent semantics.** It switched to
manifold-js and relied on the switch-seeded starter being *un*recognized (the
formatting quirk) to force the import-target modal. With recognition now
consistent, switching to manifold-js leaves a genuinely expendable starter, so
the .vox re-import lands directly as a voxel session (probe-confirmed: lang
`voxel`, code `voxels.decode(...)`). That's a consistency *improvement* — a fresh
unedited starter shouldn't nag on import regardless of how it was seeded —so I
dropped the modal-dismiss step and kept the regression guard (re-import must flip
back to voxel, not dump raw bytes). Other modal tests (import-target,
import-paint-reset) set up real saved work, so they were unaffected and still
pass.
