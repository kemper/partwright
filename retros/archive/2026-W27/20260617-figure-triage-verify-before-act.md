# Retro — "figures still have issues" triage → strongman areola fix (PR #713)

User said a batch of merged figure fixes still left "a bunch" of figures broken.
I triaged all 43 `examples/figure_*.js`, de-noised the findings, fixed the one
certain defect (strongman's hand-rolled areola plug), filed #714 for the rest.

## Liked / Worked
- **Verify-before-act caught massive agent over-reporting.** Six parallel broad-
  triage agents flagged the muscled back (#702) as "still broken" on bodybuilder/
  chef/cornrows/weightlifter — but rendering those backs MYSELF showed normal
  anatomy (trap ramps + spinal furrow); the fix had landed. Same for the
  "superhero areola rod" (actually the chest emblem) and "pose is entirely wrong"
  on grand_jete/lotus_yogi (by-design grounding for printability). Acting on the
  raw agent reports would have meant reworking code that was already correct.
- **Objective stats cut through subjective noise.** `--json` triangleCount is not
  a judgment call: it proved the whole catalog is over the 200k budget (afro_funk
  201k … chef 430k), which became a clean, evidence-backed tracking item (#714).
- **Distinguishing engine bugs from figure-local bugs.** The real remaining defect
  wasn't in `sdfFigure.ts` at all — `figure_strongman.js` hand-rolls its own
  areola coins (F.nipples rides the un-puffed base chest) and had copied the
  pre-#706 plug idiom. A `grep` for `* 2.2` / `sphere(surfR` across examples
  proved it was the ONLY figure with the stale pattern.

## Lacked
- **The broad-triage agents were expensive and low-precision.** Six agents ran
  ~20–30 min each and produced a high false-positive rate (normal anatomy, props,
  intended poses all flagged as defects). A tighter, issue-aligned brief ("check
  ONLY these 4 known repro angles for these 4 known defects, FIXED/PARTIAL/BROKEN")
  would have been faster and far less noisy than open-ended "find all defects."
- **Open GitHub issues read as "still broken" when the fixes had shipped.** #701/
  #702/#703/#706/#707/#691 all had code merged but were left OPEN, which is what
  made it look like nothing was fixed. Close-as-complete (or a verification
  checkbox) at merge time would have told the user — and me — the true state.

## Learned
- A merged "fix: …" PR that leaves its issue open is indistinguishable from an
  unfixed bug to the next reader. The first 20 minutes here were spent
  rediscovering that most fixes had actually landed.
- Engine-level fixes (`F.nipples`) do NOT reach figures that hand-roll the same
  geometry inline. When fixing an engine idiom, grep the examples for copies of
  the OLD idiom in the same pass.

## Longed for
- A **catalog-bake lint that flags known-bad idioms** in example source (e.g. the
  full-depth `(surfR+eps)*2.2` areola tube) so a copied anti-pattern is caught
  mechanically instead of by a 6-agent visual sweep.
- A **per-figure visual-defect snapshot** (standard angles, committed) so figure
  regressions surface in a diff instead of requiring ad-hoc triage agents each time.
- (Tangential) the AI model catalog rolling-window test (`o3-pro` aged out today)
  went red on main and blocked an unrelated PR — a scheduled regen, or test slack
  tracking the generator's own cadence, would stop time-flakes blocking feature CI.
