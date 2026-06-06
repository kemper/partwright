---
session: "LfcFC"
timestamp: "2026-06-05T00:00:00Z"
model: claude-opus-4-8
tools: [playwright]
sequence: 1
---

## Human

After several iterations on the Self-Modeling Studio (photo → 3D), the user's
test results stayed poor and they concluded: "I don't think the image angles
matter at all. Should we pivot this into just an image upload and a prompt
generation? If so, why even bother with the separate import modal; couldn't we
just let people tell the primary AI to analyze the image and create the
dimensions needed?" They chose to collapse the feature to a prompt.

## Assistant

## Key decisions

**Agreed the elaborate feature distilled down to a prompt.** The multi-angle
generation, the visual-hull carve, the Gemini image/vision calls, presets,
styles, and per-session persistence were all machinery around what turned out
to be one durable thing: a disciplined "analyze the photo into a build spec,
then build a stylized bust with a staged verify loop" prompt. The primary
vision-capable AI can already see an attached photo and use the modeling tools,
so the modal added complexity without lifting the quality ceiling (LLM-authored
geometry can't do organic faces — that's unchanged by *how* the reference is
fed).

**Collapsed to a one-click prompt, kept the genuinely-reusable bit.** Added
`src/ai/photoModelPrompt.ts` (`PHOTO_BUST_PROMPT`), surfaced as a `/portrait`
slash command and a "stylized bust from your photo" prompt-library tile — the
user attaches the photo with the existing 📷 button and sends. Kept the
`getReferenceImages` tool (independently useful: "attach images, the AI reads
them as one labeled grid").

**Removed the rest as dead weight:** the Studio modal, `recon/visualHull` +
`recon/studioModel`, `ai/geminiImage` + `ai/geminiVision`, the
`reconstructFromSilhouettes`/`reconstructFromCurrentModel`/`openSelfModelingStudio`
console APIs, the toolbar entry, `Session.studioImport` persistence + its
export/import round-trip, and the `appConfig.recon` section + its advanced-
settings UI. Net: large deletion, small addition.

**Test fix from the addition:** the new `/portrait` command went *before*
`/help` in `SLASH_COMMANDS` so the existing "ArrowUp wraps to the last command
(/help)" e2e kept holding; added a golden-path e2e asserting `/portrait`
prefills the modeling prompt.

**Honest framing to the user:** this is about simplicity, not better output —
the quality ceiling is the procedural-code paradigm. The real break past it
remains an image→3D *mesh* generator, which the app can't import yet.
