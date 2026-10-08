# Retro — chibi animals: eval loop + figure API as the SDF oracle

Session built chibi cat/dog SDF figurines, adopted the new `eval:models` vision-judge loop, and made the cat parametric (poses/builds/colorways).

## Liked
- **`eval:models` is the productized version of the hand-rolled sculpt→judge→fix loop** — committed reference + rubric + printability gates + baseline + cost cap, in-container `claude` judge. Replaced my ad-hoc critic agents and is strictly better. The pinned reference set (user's kitten photos) anchored a subjective "chibi" style far better than a rubric alone.
- **The figure API (`sdfFigure.ts`) is a goldmine oracle for SDF figure wisdom.** Every face-quality problem we hit was already solved there.

## Lacked
- **Eval render under-resolves fine features.** Color fixed the biggest gap (#833), but the multi-view contact sheet packs tiles too small, so the judge false-negatives pupil/nose/inner-ear that are clearly present at high-res — capped the score ~58-62 on non-defects (filed #841). High-res single-view `model:preview` is the real source of truth for fine-feature presence.
- **Patterned colorways need multi-region paint.** A single `body` label can't express tabby stripes / tuxedo / calico / siamese points. Solid coats only until stripe/patch labels or in-code paint land (#845).

## Learned
- **Eyes that "stick out" → add EYELIDS, don't shrink the eye.** The figure's `buildEyes` wraps the eyeball in thin lid shells (1.06× concentric sphere sliced by an 18° tilted plane) so it reads as set-into-a-socket, not a ball stuck on. This was the user-visible fix after flatten/inset alone failed. Also: ball-in-ball iris/pupil (crisp radical-circle edge), nested face detail-regions for crisp small features.
- **A standing quadruped is NOT a vertical stretch of the sitting pose.** First attempt produced an upright teddy-bear. A real standing cat needs a *horizontal* spine + four distinct legs to a stable paw footprint + head reaching forward. This is the quadruped-rig problem in miniature.
- **`maxGenus: 0` is too strict for figurines.** A curled tail or touching limbs close a *benign* genus-1 (or genus-3 for 4 legs) handle on a watertight single-component solid — printable in one piece. Relaxed to a defensible ceiling (the `shoulders` case already allows 4). `componentCount`/`isManifold` are the real printability gates, not genus.

## Longed for
- **Eval per-view resolution / a close-up view** so the judge can grade expressive features (#841).
- **Multi-region paint** for coat patterns (stripes/patches/points).
- **A first-class `F.quadruped`/`F.cat` rig** so each new pose isn't hand-built — the parametric `buildCat` is the proto-version; promoting it would make new animals (dog, etc.) and poses cheap.
- A way to run the eval on the colored *bake* for catalog-final QC (current path is the fast preview render).
