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

// The "cut an imported figure into printable pieces" workflow: the /split
// slash command prefills it. Same detect → accept start as /parts, then
// splitIntoPieces instead of paint. The lesson behind it: an agent that
// hand-places planes and boxes across fused contacts (an arm lying on a belly,
// a sculpted eye) leaves jagged skin and wrong seams; cutting along accepted
// part boundaries with per-seam modes does not.
export const SPLIT_PROMPT = [
  'Cut the mesh I imported into separate pieces I can print and glue (or press-fit) back together.',
  '',
  'Read /ai/segmentation.md first, including "Split into printable pieces". Do NOT cut with hand-placed planes or boxes across parts that are fused together. Then:',
  '',
  '1. Look: renderViews from the front, side and back, and list the pieces you would cut it into. Ask me if a piece is unclear, or ask me to mark the cuts with the Annotate tool and read them with listAnnotations.',
  '2. Find the parts: detectParts with a named seed on every piece (probePixel on your renders → crease-watershed; thickness with the "Limbs and torso" preset where a limb has no groove). renderParts, show me, refine with editParts until I approve, then acceptParts.',
  '3. Choose a seam per piece: flat for necks, wrists and legs (auto picks it when the seam is near-planar), medial for long fused contacts such as an arm along the body, plug for inserts such as eyes (straight socket walls; add a small clearance for a press fit).',
  '4. Preview: splitIntoPieces (preview is the default). Look at EVERY seam from the angle that shows its cut faces (renderView, zoomed in) and read the warnings: one solid per piece, no stray skin left on a neighbour. Fix by changing that seam\'s mode, resolution or the part boundary, and preview again. Show me the pulled-apart render.',
  '5. When I approve: splitIntoPieces with the same options and preview:false, then offer the 3MF export with one object per piece (export3MFObjects with split: parts).',
].join('\n');
