---
session: "fvIqe7"
timestamp: "2026-06-07T15:03:45Z"
model: claude-opus-4-8
tools: [playwright]
sequence: 2
---

## Human

I also notice that whenever I make changes to the code, the interactive pane
re-renders and I lose my angle/perspective in that case too. If your change
already fixes that, fantastic. If not, please ensure that when I'm editing the
code, whatever perspective/angle I've set in the interactive view doesn't reset.

## Assistant

## Key decisions

The first commit deliberately scoped the live-edit case *out* — genuine
new-code runs kept auto-framing — so this wasn't fixed yet. Extended
preservation to the interactive editing path.

**Change**: `runCode` (the RAF wrapper that every interactive entry point routes
through — editor debounced auto-run, the Run button, the command-palette "Run"
action, Customizer param change/reset, voxel-paint deactivate, diff "use this
code") now defaults to `preserveCamera: true` when calling `runCodeSync`. A
caller can still opt out with `preserveCamera: false`.

**Why this is the right seam**: Programmatic runs — `partwright.run` /
`runAndSave` (console + AI agent), import/merge flows, `openSession` — call
`runCodeSync` *directly*, not through `runCode`, so they keep auto-framing. That
preserves the framing behavior the AI/agent and the viewport-reset-view +
thumbnail-camera specs depend on, while interactive human edits keep the angle.

**Safety net unchanged**: `captureCameraToPreserve`'s same-session +
model-already-shown gate still auto-frames the *first* render of a session even
when it comes via `runCode(defaultCode)` (e.g. opening from the landing page or
creating a session). So "don't reset my angle" applies to re-renders within a
session; opening a fresh session still frames its model. "Reset View" remains
the explicit re-frame escape hatch.

**Verification**: Added a third case to
`tests/viewport-camera-persistence.spec.ts` — orbit, then physically edit the
code in the CodeMirror editor (Ctrl/Cmd-A + type a smaller cube), and assert the
camera angle/distance survive the debounced auto-run. Confirmed visually with
before/after screenshots (model shrank, perspective identical). Re-ran all
camera-adjacent specs (viewport-reset-view, version-nav-language,
thumbnail-camera, paint-camera-passthrough) — all green.
