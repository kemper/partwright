---
session: "5ecjfq"
timestamp: "2026-11-15T04:29:50Z"
sequence: 5
tools: [work-reviewer]
---

## Human

No new request. This is the repo's standing review pass over the new
`slicer-cli check` command before the PR is merged.

## Assistant

## Key decisions

**The output folder is only ever replaced if this command owns it.** The first
version wiped `--out` unconditionally, and the script is pre-approved for
agents, so `--out .` or `--out ~` would have deleted the repo or home
directory without a prompt. Now the folder must be under the tool's own
`.partwright/slicer-check/`, or be new or empty, or carry a marker file the
command wrote on an earlier run. Any folder that contains the input, the repo,
the home directory or the filesystem root is refused outright, and all
argument validation happens before anything is deleted. I chose a marker file
over "never allow a custom folder" because agents and CI both want to choose
where artifacts go.

**A crash is a failure, not a skip.** The slicer's exit status was ignored and
a missing result file was treated like "slicing was skipped", so a segfault
mid-slice reported `ok`. "Skipped by the caller", "not attempted because the
file never loaded" and "attempted" are now separate states; an attempted run
with no result, a non-zero result code, or a non-zero exit all fail. Each
run's result file is deleted before the run so a crash can't be read as the
previous run's success, and a render that fails after the first one now fails
a `slicer-renders` check instead of being dropped.

**Our own reader failing is a check, not a warning.** It is the app's import
path reading the app's own export, so `reader-parses` now counts toward `ok`.

**Filament use is decided on the raw weight.** Rounding to two decimals before
testing "> 0" would have failed a legitimately tiny painted accent.

**Same-named objects pair by plate, then by position with a warning.** Order
is not guaranteed to match between the file and the slicer's per-plate list.

**`check` never installs anything.** It used to fall into the wrapper's
auto-install, which printed text and exited without JSON. It now reports what
is missing as JSON and names the install command.

**What I left.** Each model-file check leaves one more session in the daemon's
private profile. Deleting sessions from a test tool felt riskier than the
clutter in a gitignored profile.
