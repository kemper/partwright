---
date: "2026-11-01T22:28:00Z"
task: "feat: split a model into printable pieces along its parts"
pr: 1220
areas: [tooling, agents, ai-panel, import-export]
cost: medium
---

## Liked / Worked
- `model:preview` made the seam-quality loop fast: medial-cut lumpiness and the
  jagged plug rim were obvious at `--size 1200` on a cut-out piece and fixed in
  2–3 headless passes, with no browser round-trip.
- The context-budget and Gemini-schema unit tests caught an oversized tool
  schema and a free-keyed object param before CI did.
- A background `work-reviewer` found two real code-loss bugs in the return
  wrapper (leading-dot chains, `api.splitParts(m).add(x)`) that my own tests missed.

## Lacked
- The Google Drive connector caps downloads at 10 MB, so the user's 46 MB
  source model couldn't reach the session at all. A subagent burned a turn
  discovering the cap; the task's main deliverable is blocked on a re-upload.
- `ai.md` sits ~40 chars under its system-prompt ceiling, so a new console
  method could only get a bare one-line entry. (cost: 4 turns trimming)
- `dropSlivers` re-merges via `ofMesh(getMesh())`, so the result's
  `originalID()` is no longer the cut's id. Reading it afterwards silently
  relabelled nothing on clearance runs. (cost: 1 debug round)

## Learned
- A medial lattice field (dSel − dOther) is not a distance: its slope is ~2
  where the surfaces face and ~0 across a neck, so "shift by c" is not an
  offset by c. Normalise by |∇f| inside a band before growing it.
- Model-code `console.log` from inside sandbox helpers (meshSdfOps) IS captured
  in the run's `logs`, so a kernel can return a structured report without new
  Worker plumbing.
- `lexicalMask` keeps only the first `/` of a `//` comment; detect comments
  against the source text, not the mask.

## Longed for
- A way to pull large user files into a cloud session: a Drive download that
  streams to disk instead of returning base64 in the tool result.
- `model:preview --piece N` (or `--component N`) to render one decomposed
  piece by itself, instead of editing the snippet to `decompose()` and pick by
  volume every time.
- An `ai.md` budget report that lists the biggest existing sections, so making
  room for one new line doesn't mean hand-trimming my own text to nothing.
