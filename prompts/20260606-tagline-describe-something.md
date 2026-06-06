---
date: 2026-06-06
branch: claude/parkrite-tagline-Ja7AZ
files_changed:
  - index.html
  - src/seo/meta.ts
  - public/og-image.svg
  - public/og-image.png
---

## Human

The app is Partwright. The opening tagline says "Describe a part. Get a
printable model." But the app can now do a lot more than mechanical parts —
voxels, characters, creatures. The word "part" undersells it. Back off the
"part" terminology in the tagline. After discussing options, settled on
"Describe something. Get a printable model." (the name itself stays — it's a
brand, "-wright" = maker).

## Assistant

Swapped "part" → "something" in the tagline everywhere it appears, keeping the
"Describe ___. Get a printable model." skeleton (it's punchy and captures the
describe-to-3D flow; only the limiting noun was the problem).

Two grammatical forms in the source, both updated:
- standalone "Describe a part." → "Describe something." (landing hero in
  `index.html`, og-image SVG/PNG)
- "Describe a part, get a printable 3D model." → "Describe something, get a
  printable 3D model." (the `<meta name="description">` / OG / Twitter card
  descriptions in `index.html`, the long landing blurb, and `src/seo/meta.ts`
  which feeds prerendered per-route meta)

**OG image regenerated, not hand-edited.** `public/og-image.png` is the raster
social preview that Slack/Discord/etc. actually load (`og-image.svg` is just the
source). It's a committed binary with no build step, so I re-rendered it from the
updated SVG in headless Chromium with the repo's self-hosted Sora-800 /
Space Grotesk-400 woff2 fonts embedded as data URIs — so the new PNG is
pixel-faithful to the original except the changed tagline line, rather than
falling back to a generic system font via librsvg.

Verified: build + 687 unit tests green; screenshotted the landing hero in the
browser to confirm the gradient on "printable model." survived and the new
wording reads correctly.
