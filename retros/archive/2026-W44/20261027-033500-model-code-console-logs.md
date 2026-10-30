---
date: "2026-10-27T03:35:00Z"
task: "feat: return model code console output as logs from run results"
pr: 1155
areas: [tooling, agents, ci, docs]
cost: low
---

## Liked / Worked
- Wrapping each engine's `run` (move the body into a function and attach
  `logs` with `withLogs`) put the field on every early return without
  touching dozens of return sites.
- The `work-reviewer` pass found three real issues I'd missed: BREP shapes
  stringifying the whole OpenCASCADE module, a `runAndSave` race across its
  save awaits, and the `const console` redeclaration.

## Lacked
- Moving the sandbox's `new Function` into a shared helper turned CodeQL red
  with a "new" Code-injection alert. The owner couldn't dismiss it from the
  UI either, so I reworked the design to leave those lines byte-identical to
  main. Nothing warns about this before the push. The release skill knew the
  by-design sites, but feature work had no equivalent note. (cost: a red
  check, a PR comment, and a second implementation)
- I subscribed to a guessed PR number (#1147) before reading the
  create_pull_request result (#1155). Always take the number from the result.

## Learned
- Model code only ever runs synchronously (even replicad's async run
  evaluates it before its first await). So a per-run console capture can
  override the console's methods for the duration of the synchronous
  `engine.run()` call and restore them after, with no cross-run mixing and
  no change to the sandbox's `new Function` lines.
- Node's `console.assert` prints through `console.warn`. A capture that
  forwards to the original assert records a failed assert twice.
- A replicad `WrappingObj` has an enumerable `oc` that points at the whole
  Emscripten module. Any generic serializer that walks objects must stop at
  BREP shapes.

## Longed for
- A CLAUDE.md line under Module Layering / security: "never edit or move the
  engines' `new Function('api', …)` lines. Any change mints a new CodeQL
  Code-injection alert that fails PR checks and may not be dismissible. Work
  around them instead."
