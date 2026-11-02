---
session: "ad71db73"
timestamp: "2026-11-01T21:50:00Z"
tools: [subagent, model-preview, playwright]
---

## Human

My AI agent tried to chop up a 3MF figure for printing and failed:
it cut with hand-placed planes and guessed cylinders, never used detectParts,
left jagged arm skin on the torso and cut through the eyes. Its feedback asked
for: segment-first instructions, a "split by part" tool with smooth seams, a
cut preview with stray-fragment list, a groove finder, cheap single-piece
renders, and using annotations. [Attached: the failed 11-object 3MF.] What
should we build? — Then: create the new tools as recommended, have an agent use
them to do a high-quality split of the figure from Google Drive, and fix the
instructions as needed.

## Assistant

## Key decisions

**Reuse, don't invent.** `editPart` already had a private `splitPart` that cuts
a solid along the surface halfway between one part's faces and the rest (a
lattice field → levelSet → exact booleans). The missing link was N-way and
print-oriented, so the field half became `medialField` (editPart unchanged) and
`api.splitParts` builds on it. Export Split → Parts (#1176) already writes one
3MF object per part but kept fused labels together — after a split nothing is
fused, so that path now yields one object per piece with no export changes.

**Peel, don't partition.** Pieces are cut one at a time from the remainder
(plugs first, then smallest first; the largest is kept), so every pair of
neighbours shares exactly one cut surface and fits back exactly, regardless of
lattice accuracy. A simultaneous N-way Voronoi would leave gaps/overlaps at
triple junctions.

**Seam modes from the failure cases.** Flat (best-fit plane of the seam loop,
applied only near the part via max(plane, medial − margin)) for necks/legs —
glue- and print-friendly; auto picks it when the seam is one near-planar loop
(seams against already-cut pieces are ignored, else a head with an eye never
reads as planar). Medial for long fused contacts (the arm on the belly) with
extra blur passes (`smoothing`, default 4) — one pass left visibly lumpy faces.
Plug for eyes: the part's projected outline (closed, opened to remove the
triangle-edge zigzag, then grown past it) extruded along the mean normal, so
the socket is straight-walled with optional clearance instead of a cone.

**Cut faces take their piece's label** (per-triangle originalID rewrite), so
the rail, paint-by-label and export-by-part see one part per piece and no
"Unlabeled" slivers. Loose bits under `minFragment` go back across the seam;
real multi-solid pieces are reported as warnings.

**Report through the run log.** The kernel prints one `[splitParts] {json}`
line; the console method parses it and adds piece↔part checks from
listObjectParts — no new Worker message plumbing.

**Preview by default, code as source of truth.** `splitIntoPieces` wraps the
final return in `api.splitParts(…)` (lexically masked edit, updates in place,
`remove` unwraps); preview explodes the pieces and does not save. The UI modal
(palette + Tools menu) calls the same method. Instructions: a "Split into
printable pieces" section in segmentation.md, pointers in printing/deform, and
a `/split` slash-command prompt that forbids hand-placed planes and requires
per-seam inspection. The AI tool schema was trimmed (and `seams` made an array)
to stay inside the context-budget and Gemini schema tests.

**Not built:** a separate groove finder (seeded crease-watershed with
maxRadius already returns the closed groove region) and a plane-cut preview
(it would encourage the workflow that failed).

## Assistant (review follow-up)

A read-only review of the diff found two code-loss bugs in the return
wrapper and six kernel/UI issues; all fixed with regression tests:

- **Wrapper:** a return now runs past newlines while the expression visibly
  continues (leading-dot chains, ternaries, trailing operators), trailing
  comments stay outside the span, and `api.splitParts(m).add(x)` is not
  treated as an existing wrap (editing it would have dropped `.add(x)`).
- **Medial clearance** was a shifted difference-of-distances (gap ≈ c/2 at
  facing surfaces, ballooning across a neck). It now normalises the field by
  its gradient within a band around the cut, and fills any sealed pocket the
  subtraction opens.
- **Labels:** only cut faces and faces of the split's own parts are
  relabelled; parts left out of `parts` (and plain geometry) keep their ids.
  Cut-face ids are recorded from the raw level set (a re-merged solid has no
  single originalID — the first attempt relabelled nothing on clearance runs).
- **Faces that don't steer cuts:** pieces already peeled and parts not being
  split are excluded from later medial fields, so an unlisted eye rides along
  with its head instead of being stranded and dropped.
- **Honest reporting:** dropped fragments are warnings with their volume, kept
  separate from fragments handed back across a seam; a run that times out
  restores the code; the modal reports a split that ran but didn't save.
- Preview spread moved to `ui.splitPreviewExplode` (Advanced Settings).

## Assistant (figure run follow-up)

The user's 46 MB source model couldn't come through the Drive connector (10 MB
cap); their "anyone with the link" Drive URL downloaded directly. An agent then
drove the real app through the warm daemon: simplify to ~400k triangles,
seeded thickness + crease-watershed detection, accept, splitParts (plug eyes,
medial arms/tail, flat neck/legs, 0.15 clearance), seam-by-seam inspection,
Bambu export — 11 clean, assemblable pieces.

Fixes from what that run hit:
- **Separate shells**: splitParts now handles each physically separate shell
  on its own. A shell carrying 2+ pieces is cut; a shell belonging to one
  piece (the figure's fins) passes through, and if it's sunk into a neighbour it is
  trimmed back to that surface (`trimOverlaps`, default true) with its trimmed
  faces relabelled. Cutting the fins against the ear they were sunk into had
  carved whole ears; leaving them out dropped them as "fragments".
- **Memory**: the cut chain frees intermediates as it goes (rest copies,
  raw level sets, decompose handles in dropSlivers/pieceVolumes). The run had
  peaked at 3.1 GB of the 4 GB engine heap.
- **Daemon**: `detectChromiumExecutable` also checks `chrome-linux64/` like
  playwright.config.ts does.
Pre-existing bugs the run surfaced were filed rather than widened into this
PR (#1221 black paint exports blue, #1222 smooth-edge accept scrambles
imported paint, #1223 seam-polish / inspection follow-ups).

The rerun of the figure through the official `splitIntoPieces` (fins left to the new
separate-shell path) matched the agent's manual workaround piece-for-piece and
peaked at 1.46 GB instead of 3.1 GB. Docs now describe separate shells and
`trimOverlaps`, and an e2e test covers a sunk fin plus a free-standing shell.

## Human

Do you need to improve the tools more? Did you have the agent give you
feedback on the process?

## Assistant

Asked the figure-splitting agent for a process retrospective from the in-app AI's point of
view (docs + AI tools only). Folded the cheap, confident parts into the
instructions now: a "Recipe: a fused figurine" in segmentation.md (seeded
thickness, then lock and crease-watershed; chin-underside head seed; extra
torso seeds at crotch/buttocks; maxRadius-capped tail; seam per body part;
~400k-triangle simplify), real cost numbers (~150 s / ~1.5 GB per 11-piece
split), and a corrected warning that a smooth accept scrambles imported paint
(#1222) instead of "edges can shift slightly". The /split prompt points at the
recipe. Tool work it ranked (paint scramble, a per-piece seam preview with an
undercut check, a cheaper re-run, residual memory) is tracked in #1221–#1223
and left for the user to prioritise.

## Human

Remove references to the figure's name from the PR description, and check
whether other PR descriptions reference model names.

## Assistant

The repo is public, so the figure's name was scrubbed everywhere this branch
and its issues carried it (PR description, docs, code comments, test comment,
this log, the follow-up issues, the Visual proof comment re-uploaded under
neutral file names). Older commit messages and comment edit history still
carry it; rewriting those needs a force-push / manual revision deletion, left
to the user's call.

## Assistant (budget after syncing main)

`main` had gone over the AI context budget after kemper/partwright#1198, and
this PR adds a tool schema plus an `ai.md` line on top. Merged `main`, took the
same budget fix as kemper/partwright#1225 (cherry-picked, so the two merge
cleanly), and trimmed the rest inside the segmentation area rather than raising
a ceiling: shorter `detectParts` / `autoDetectParts` / seed / denoise
descriptions (the details live in segmentation.md), the split tool's schema
without its rarely-needed knobs (`resolution`, `smoothing`, `explode`,
`label`, seam `normal` — the console method still takes them), and a shorter
`acceptParts` line in `ai.md`.
