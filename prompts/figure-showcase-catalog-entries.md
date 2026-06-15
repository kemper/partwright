---
title: 20 full-body figure catalog entries showcasing recent figure-API features
date: 2026-06-15
tracking: "#689"
---

## Human

The user recently merged a variety of figure features (ears, noses, eyelids,
feet/toes, body-size axes, nipples, belly buttons, eye-gaze direction, hair
improvements). They asked to use ~10 subagents to create ~20 new catalog
entries that combine many of the new features together, so they can observe the
combined quality. Requirements: full-body only (no busts), a wide variety of
body positions to exercise the body mechanics, high quality, and distinct from
what is already in the catalog. Open a PR so they can see the entries on the PR
preview URL.

## Assistant

**Approach.** Fanned the creative/geometry work out to 10 `model-sculpt`
subagents (2 figures each = 20), because that work is parallelizable and the
visual render→look→adjust loop is best owned in a disposable context that
returns only text. The serial, single-writer parts — the colored thumbnail
bake, manifest assembly, lint/test, commit — were kept on the main agent.

**Why batch the bakes.** `build-catalog-entry.cjs` drives a real browser against
the dev server; writing into `public/` triggers a Vite full-page reload, so a
subagent writing a palette file mid-bake destroyed the bake's execution context
("Execution context was destroyed"). The fix was to bake *all 20 at once after
every subagent finished writing* (no concurrent `public/` writes), plus a
4-attempt retry wrapper for any residual reload race.

**Feature/pose coverage** was designed up front so the set spans the new axes:
muscle/weight/bust/age body-size; nipples+areola and navel on bare-torso
figures (boxer, capoeira, monk, thinker, surfer, expecting, power-stance);
eyelids across blink/wink-approximation/sleepy/closed/almond/hooded; eye-gaze
direction (up/down/side/over-the-hand); ears (bald monk); the full hair system
(box braids, locs, coily afro, bun, ponytail, beanie); feet+toes; and a wide
pose range (airborne jump, kick, overhead lockout, one-leg balance, all-fours
crawl, kneel, cross-legged lotus, seated-on-plinth, deep crouch, spine arch,
throwing twist).

**Quality gate.** Each figure was verified headless (`model:preview`:
`isManifold`, `componentCount===1`, multi-angle incl. underside). After baking,
audited every entry's paint-label resolution: found two figures (crawling baby,
power stance) whose eyes were buried inside the head → 0 paintable triangles
(blank faces); a follow-up subagent pushed the eyeballs proud of the face and
re-verified. Two back-facing thumbnails (baby, surfer) were re-baked with pinned
`THUMB_AZIMUTH/ELEVATION` so the catalog tile shows the face.

**Discovered gap (filed in #689):** `F.face.eyes` has no per-eye lid override
(`lidsL`/`lidsR`), so a literal one-eye wink can't be expressed — only uniform
`lids`. The skater-kid figure approximates a wink with hooded lids + smirk +
corner gaze.
