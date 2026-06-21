---
session: "sharpbell"
timestamp: "2026-06-21T19:45:00Z"
model: claude-opus-4-8
sequence: 4
---

## Human

The eyes still protrude away from the face. Maybe you should look at the human
figure API for wisdom on how to make eyes.

## Assistant

## Key decisions

Read the figure API's `buildEyes` (`src/geometry/sdfFigure.ts`) as the user
suggested — the wisdom there is **eyelids**, not eye size. The figure's eyes
don't bug out because two thin shell caps (a `LID_SCALE=1.06` concentric sphere
sliced by a `LID_TILT_DEG=18°` forward-tilted plane, upper+lower) wrap the
eyeball so only a central band shows — it reads as an eye set INTO a socket, not
a ball stuck on. Our cat had the ball-in-ball iris/pupil but no lids, so the
bare hemisphere protruded.

Ported the lid recipe onto the chibi-cat (`upper:0.30, lower:0.12` almond), with
a `.label('lids')` region colored orange (fur) in the palette — so the eye
opening shows white/green/pupil framed by orange fur. The eyeball stays a whole
sphere behind the lids (genus-clean). Result: from the SIDE the head silhouette
is now smooth with zero eye protrusion (the user's complaint), while the front
stays big-eyed.

**Adaptations the sculptor had to make vs the verbatim figure recipe** (worth
noting for reuse): (1) removed the eye sockets — `smoothSubtract` sockets +
lid caps created topological tunnels (genus spiked to 5+); (2) recessed the eye
center (y -7.8 → -6.8) so the lid-margin z sits inside the solid head at the
lateral eye position, avoiding a floating-rim genus trap. Net genus stays 1
(within the relaxed gate). Top/bottom lids leave a sliver of lateral sclera
visible only from extreme rear-3/4 — fully wrapping the sides would need a
subtract ring (raises genus) or a fully-recessed eye; the clean choice was kept.

Trade-off surfaced to the user: at upper-lid 0.30 the eyes read slightly
heavy-lidded; offered to dial to ~0.22 for a more alert round look. Pushed onto
#842 (the user had marked it ready-for-review; this is a normal pre-merge
improvement).
