---
session: "5ecjfq"
timestamp: "2026-11-15T04:22:19Z"
sequence: 4
---

## Human

Said that testing against the real slicer engine is useful while building
features but is not something the site or tool itself can use, and asked for a
PR with the scripting and agent instructions needed for agents to use it as a
testing / validation tool. Left the ordering of the remaining work to me.

## Assistant

## Key decisions

**One command that answers "is this print job right?" in JSON.** The raw
slicer CLI needs two invocations, a result file per run, and knowledge of its
field names. `slicer-cli check` hides that: it returns `ok`, a list of named
checks, warnings, both views of the file, and a contact sheet, and exits
non-zero on failure so it can gate a loop the way `--expect-components` does
for `model:preview`.

**Cross-check two independent readers, don't just ask the slicer.** The report
compares what OUR 3MF parser sees (objects, sizes, which filament slots have
triangles) with what the slicer extruded. That is the check that matters for
paint: a filament our reader says is painted but the slicer never extrudes
means the paint encoding was lost. It also removes the earlier worry that our
reader and writer could share a misreading unnoticed.

**Model input goes through the real app, not the headless preview path.**
`build3MFProject` runs fine in Node, but the colours it is handed would come
from the headless preview's colour resolution, which is not the code a user's
export runs. Given a `.js`/`.scad`, the command drives the warm-browser daemon
and calls `export3MFObjectsData`, so the file under test is what a user would
download. `--current` covers what one code file can't express (several
objects, brush paint).

**Wait for the app after an edit.** The daemon's page full-reloads when a
source file changes, and "edit the exporter, then check" is the main use. The
first version failed on exactly that. A model check now starts from a fresh
page (so it tests the current source) and polls until the API is back.

**Pure logic split out and unit-tested.** The slicer is not installed in CI,
so the comparison logic lives in `scripts/slicer-cli/report.mjs` with no I/O
and has vitest coverage; only the orchestration needs the real binary.

**Instructions say when to look.** The first model I ran passed every check
while its paint band exported as a diagonal wedge (paint is per triangle, the
box side is two triangles). So the skill and CLAUDE.md say plainly that green
checks do not prove paint placement and name the checkpoints for reading the
contact sheet, and they repeat the limit that the CLI is not the GUI loader.

**Where the instructions live.** A `/slicer-check` skill carries the full
guide; CLAUDE.md gets a short section plus a row in the verification table;
the reviewer agent is told to expect a check result on 3MF-path PRs. Kept the
tool described as development-only everywhere, per the owner's framing.

**What I skipped.** No "paint coarseness" metric yet (it would have flagged
the wedge automatically), and no CI job, since the binary is not available
there.
