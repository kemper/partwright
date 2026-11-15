---
session: "5ecjfq"
timestamp: "2026-11-15T03:41:15Z"
sequence: 2
---

## Human

Merged the allow-rule PR and asked for the slicer test to be run: does the real
slicer's command line start in the cloud container, and do its plate renders
show painted colours on a 3MF exported by this app?

## Assistant

## Key decisions

**Result first.** Yes on both counts. A three-colour painted test block built
with `build3MFProject` renders with all three filaments in the slicer's own
plate PNG (~1 s) and slices cleanly (~2 s, three filaments reported with
per-filament grams). Getting there needed three things the first version of the
wrapper did not know about, so this change fixes the wrapper rather than leaving
the recipe in chat.

**xvfb was the wrong assumption.** The pinned build's windowing layer is
compiled Wayland-only, so an X server is never consulted. `run` now starts a
throwaway headless `weston` on a private socket and tears it down afterwards.
The runtime dir is created under a short temp path because Unix socket paths are
capped near 108 bytes; the first attempt under the long scratch path failed on
exactly that.

**A GLX shim instead of patching or rebuilding.** The build's GL loader is
GLX-flavoured and treats any GLX start-up failure as fatal, while the context
it actually creates is an OSMesa (software) one. A ~20-line preload library
answers the five GLX calls made during start-up and routes function lookups to
OSMesa. Chose this over building the slicer from source (hours, and a much
larger trust surface) and over giving up on its renderer: the shim is our own
code, touches nothing in the slicer, and is compiled at install time from a
committed source file.

**System packages are explicit.** `install` reports missing packages and stops;
`install --apt` installs them. Kept apt behind a flag so the script never
changes a developer machine's packages as a side effect. Verified by removing
`weston` and running both paths.

**Documented as a checker, not a preview engine.** The docs state the limits
that matter for anyone relying on it: seven fixed camera angles, 512 px, no
underside view, and the CLI's project loader is not the desktop app's.

**What I skipped.** No convenience subcommand that bundles render + slice into
one JSON report, and no environment setup script. Both depend on how the 3MF
previewer is designed, which the owner has not decided yet.
