# Retro — Cancel button dead during initial deep-link render (PR #772)

## Liked
- A throwaway Playwright spep on `/editor?catalog=archer.partwright.json` nailed
  the repro in one run: snapshotting `status` + cancel-button visibility on a
  timeline showed the render ticking to "Ready" at ~23s *despite* the click.
- Instrumenting the click handler (and then a direct DOM `el.click()` with an
  `elementFromPoint` + duplicate-id count check) was decisive: it proved the
  handler *never fired* even though the button was the sole topmost element —
  which redirected the hunt from "terminate() doesn't interrupt WASM" (wrong) to
  "the listener isn't attached yet" (right).

## Lacked
- No structural guard against "visible-but-dead control": a button can be shown
  by one code path (the run timer un-hides it) while its handler is wired by a
  different, later code path. There's no lint or test that ties a control's
  visibility to its listener being attached.
- The initial-load ordering is implicit: `main()` is a ~13k-line async function
  that `await`s the first render (`syncEditorFromURL`) partway through, so any
  handler attached *below* that await is silently inert for the whole first
  render. Nothing flags this; it's discoverable only by reading the await chain.

## Learned
- `worker.terminate()` *does* forcibly interrupt synchronous WASM mid-compute —
  so when a "cancel" appears not to work, suspect the wiring (did the handler run
  at all?) before suspecting the cancel mechanism. The console.debug already in
  `restartEngineWorker` is a free tell: no `[EngineWorker] … cancelled` line ⇒
  `cancelCurrentExecution` never ran.
- Catalog figures load via `?catalog=` deep-link → `syncEditorFromURL` →
  `loadCatalogFileIntoEditor` → `importSessionPayload` → `loadVersionIntoEditor`
  → `runCodeSync`, and that whole chain is awaited inside `main()` before the
  rest of `main()`'s event wiring runs.

## Longed for
- A cheap convention: attach interaction handlers for always-present chrome
  (toolbar/status-row buttons) in a dedicated early "wire controls" pass that
  runs *before* any awaited initial render, so a slow first load can never leave
  a visible control inert. Hoisting the few forward-referenced `let`s (here
  `surfaceCarveCancel`) is the only cost.
