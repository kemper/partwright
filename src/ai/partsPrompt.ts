// The "split an imported mesh into named parts, then paint per part"
// workflow (#1025), as a single chat prompt: the /parts slash command
// prefills it and the user hits send. The tools and tactics live in
// /ai/segmentation.md; this prompt is the loop the AI should run with the
// user — propose, show numbered renders, take feedback, accept, paint.

export const PARTS_PROMPT = [
  'Split the mesh I imported into named parts (e.g. hair, face, eyes, shirt, shorts, shoes) so each one can be painted on its own without colour bleeding into its neighbours.',
  '',
  'Read /ai/segmentation.md first. Then:',
  '',
  '1. Look: renderViews from the front, side and back, and list the parts you see. Call listPartDetectors to see what each detector is best for.',
  '2. Propose: try autoDetectParts first (it finds separately-printed pieces). For a fused shell, either place named seeds on each part (probePixel on your renders → crease-watershed, or random-walker for smoother edges where grooves are faint), or start seedless with auto-merge and name/merge the patches. Use thickness when limbs need splitting from a body with no groove between them. If unsure, comparePartDetectors on 2–3 configurations and pick by the renders and quality.',
  '3. Show me: renderParts (front, side, back) and tell me what you found, by legend number. Ask what is wrong before going further.',
  '4. Refine from my feedback with editParts (addSeed, merge, reassign, split, rename, setColor) and re-render. Repeat until I approve.',
  '5. acceptParts, then paint: one colour per part with paintByLabel / paintByLabels. Details with no groove of their own (a stripe, a logo, ball panels) go on with a normal paint selector plus withinPart so they stay inside their part.',
].join('\n');
