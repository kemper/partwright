// The distilled "photo → stylized bust" workflow, as a single chat prompt.
//
// This is what the Self-Modeling Studio experiment boiled down to: the angle
// generation and silhouette carve didn't help — the value was a disciplined
// prompt that has the primary (vision-capable) AI analyze an attached photo into
// an explicit build spec, then build a stylized bust with a staged verify loop.
// Surfaced as a one-click prompt-library tile + the /portrait slash command; the
// user attaches their photo with the 📷 button and sends.

export const PHOTO_BUST_PROMPT = [
  "Analyze the photo I've attached (use the 📷 button to attach it if you haven't yet) and build a STYLIZED 3D character bust — head, neck, and shoulders — of this person.",
  '',
  'First, study the photo and record a short BUILD SPEC with addSessionNote: head proportions (height:width, jaw, cheeks), hair and beard shape/coverage, any hat or glasses described as simple primitives with exact placement, facial-feature positions (eye height as a % of head height and spacing, nose projection, mouth width/height), and the main colours (skin, hair, beard, hat, clothing). Give sizes relative to head width.',
  '',
  'Then build to that spec with the manifold-js (mesh) engine:',
  '- Start from an ellipsoid head; MIRROR across the X plane for symmetry; blend features with smooth unions (SDF / levelSet / warp / smoothOut), not hard primitive intersections; keep one connected, watertight mesh.',
  '- Work in stages and call renderView after each, fixing proportions before adding detail:',
  '  1. Block the head + neck + shoulders mass and match the proportions first.',
  '  2. Add hair and beard, then any hat — the hat sits ABOVE the brow line and must never cover the eyes or forehead.',
  '  3. Add features (brow, nose, eye sockets + eyes, lips) as small SYMMETRIC additions; renderView front and confirm the eyes and mouth are visible and correctly placed.',
  '  4. Colour LAST, as broad regions — each colour stays within its region (the hat colour belongs only on the hat).',
  '- Aim for a clean, appealing STYLIZED likeness that captures the distinctive features — not photoreal detail. Save progress with runAndSave.',
].join('\n');
