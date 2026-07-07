---
date: 2026-06-18
task: Bambu/Orca 3MF GUI crash — root-caused from a macOS crash report (PR #681, #729)
---

## Liked
- **The user's crash report was decisive where every headless tool had failed.**
  Three prior sessions guessed at the Bambu GUI crash (filament_colour length? bed
  shape? preset resolution?) because the GUI can't run under `xvfb`. The macOS
  `.ips` report ended it in one read: faulting frame `Plater::priv::load_files`,
  `EXC_BAD_ACCESS at 0x0`, and register `x10 = 0x746e656d616c6966` = the ASCII
  bytes "filament". That register alone named the subsystem (filament binding) and
  the bug class (null deref). Decoding GP registers as ASCII is a cheap, high-yield
  move on any SIGSEGV.

## Lacked
- A standing habit of **asking for the crash report immediately** when blocked on a
  consumer-app crash we can't reproduce. The user offered logs a full session
  earlier; I should have taken them up on it before the next speculative push. When
  the only validator you have (Bambu CLI `--slice`) exercises a *different code
  path* than the one that crashes (GUI `load_project`), a green headless run is not
  evidence — recognise that and go get the real signal.

## Learned
- **Headless validators can be the wrong code path, not just a weaker one.** The
  Bambu CLI sliced our file clean for several iterations while the GUI crashed,
  because `--slice` and `Plater::load_project` are different loaders. "It slices in
  the CLI" proved nothing about GUI load. Match the validator to the *exact* failing
  path, or treat it as non-evidence.
- **A partial config is worse than none.** Naming a filament preset id while
  omitting the per-filament arrays (`filament_colour`, `filament_type`, …) made
  `load_files` index off the end of an empty array → null deref. The fix was to
  ship the *complete* config from a known-good reference, not to keep trimming.

## Longed for
- **A documented "validate an export against its real consumer" playbook** that
  states up front which consumer code path each harness exercises (Bambu CLI =
  slice loader, NOT GUI project loader; OrcaSlicer ≠ Bambu at all). The slicer
  harness in `/tmp/slicer-spike` is powerful but its *blind spot* (the GUI crash
  path) cost several round-trips. Writing the blind spot down next to the harness
  would have set expectations correctly from the first iteration.
- A quick **"decode crash-report registers as ASCII"** note in the debugging docs —
  it turned an opaque address into the answer instantly.
