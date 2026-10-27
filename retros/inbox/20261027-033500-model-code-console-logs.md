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
  with a "new" Code-injection alert that only an admin can dismiss. Nothing
  warns about this before the push. The release skill knew the by-design
  sites, but feature work had no equivalent note. (cost: one red check plus
  a PR comment)
- I subscribed to a guessed PR number (#1147) before reading the
  create_pull_request result (#1155). Always take the number from the result.

## Learned
- `new Function('api', 'console', body)` keeps syntax-diagnostic line numbers
  unchanged: the parameter list sits on the header line.
- A replicad `WrappingObj` has an enumerable `oc` that points at the whole
  Emscripten module. Any generic serializer that walks objects must stop at
  BREP shapes.

## Longed for
- A CLAUDE.md line under Module Layering / security: "any change to a line
  that calls `new Function` on model code creates a new CodeQL alert that
  needs an admin dismissal; say so in the PR up front."
