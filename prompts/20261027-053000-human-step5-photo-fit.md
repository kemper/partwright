---
session: "01U8g7w9"
timestamp: "2026-10-27T05:30:00Z"
sequence: 6
---

## Human

Overnight: do all the remaining steps of kemper/partwright#1151. This commit
is step 5, photo → character fitting.

## Assistant

## Key decisions

**A CLI fit for repo agents first** (`npm run human:fit`). It reuses one
headless preview session: build a candidate, render its silhouette, compare
it with the photo. A body builds in ~0.4 s, so a 120-build search takes about
a minute. Exposing this to the in-app AI (a browser method) is a follow-up.

**Coordinate descent over named slider dimensions**, not a gradient method.
Silhouette scores are pixel-noisy, and a dozen bounded dimensions converge in
tens of builds. The optimizer and parameter model are pure
(`src/human/humanFit.ts`) and unit-tested on a synthetic bowl.

**Own objective: IoU re-aligned over a small horizontal shift.** The first
run used the photo-match score directly and stalled at 0.72 against a 0.97
ceiling. A probe showed why: the scorer centres each silhouette on its
bounding box, so raising one arm shifts the whole body sideways. One arm's
angle swung the score from 0.22 to 0.97, which leaves a local search stuck.
Re-aligning made the landscape smooth. The scorer's segmentation and
normalisation are still reused.

**Verified on synthetic targets with known sliders.** From the front alone:
weight and arm angles recovered closely; gender was traded against hips. With
a side photo, gender/bust/belly separate too (0.25 against a true 0.1). The
docs say to add a side photo.
