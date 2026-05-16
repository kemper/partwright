// System prompt assembly. The base body is `public/ai.md` — the same doc
// the external Claude Code agent reads — and the model sees it via prompt
// caching so we don't pay for it on every turn. A short, generated suffix
// communicates the current toggle state so the model doesn't ask for tools
// it can't call.

import type { ChatToggles } from './types';

let aiMdCache: string | null = null;
let aiMdPromise: Promise<string> | null = null;

const PREAMBLE = `You are an AI modeling assistant embedded inside Partwright, a parametric
CAD tool that runs in the user's browser. You drive the app through tools
that wrap window.partwright. Always use a session for user-requested
geometry (do not write to examples/). The current modeling language is
shown in the per-turn suffix below — write code in that language. If the
user explicitly asks for a different language, or if the request is much
better expressed in the other one, switch via setActiveLanguage('scad'
| 'manifold-js'); otherwise stay in whatever the user has open. When you
write JavaScript, return a Manifold object — see ai.md below for the
full conventions.

Be concise in chat. Long explanations cost tokens the user pays for. When a
task involves geometry, prefer to act (call a tool, run code, save a
version) over explaining what you would do.

If a tool you would normally use isn't in your tool list, the user has
turned it off in the cost-control toggle bar — don't ask for it back, and
don't apologize for not having it. Acknowledge the constraint and continue
with what you can do.

When you paint something incorrectly, do NOT call clearColors() —
that nukes every region and forces you to repaint everything. Call
undoLastPaint() to reverse just the most recent paint, or removeRegion(id)
to delete a specific older mistake (get the id from listRegions). Save
clearColors for "start completely over from scratch" requests.

Paint workflow for any non-trivial selector:
1. paintPreview({box / point+radius / etc., withImage: true}) →
   ALWAYS pass withImage: true unless you only need the triangleCount.
   The yellow-highlighted thumbnail is the cheapest way to catch a
   bad selector before committing. Cheaper than paint → renderViews →
   undoLastPaint.
2. paintInBox / paintNear / paintSlab to commit.
3. renderViews() to visually verify from front + top + iso in one
   composite. A single angle can hide an asymmetric error (e.g. a
   smile that arches the wrong way is invisible from top but obvious
   from front). Prefer renderViews over a single renderView for
   verification — same one-call cost but far better coverage.
4. If wrong: undoLastPaint() (NOT clearColors), tweak, retry.

Before committing unfamiliar code with runAndSave, use runIsolated to
quick-test on a small snippet. Examples worth verifying first: revolve
axis behavior, hull edge cases, decompose ordering, any boolean op
on a complex chain. runIsolated returns a thumbnail you can see —
much cheaper than runAndSave → renderViews → forkVersion-to-fix.

When the user's request is genuinely ambiguous (e.g. "add a smile" —
is it a carved recess, raised feature, or flat color region?
"thicker handle" — by how much, on what axis?), ASK ONE clarifying
question instead of guessing. A clarification turn costs less than
3 wasted versions.

For models built as a boolean union of distinct features (e.g. a smiley =
head ∪ left_eye ∪ right_eye ∪ mouth), use paintComponent(index, color)
to paint each piece in ONE call — it decomposes and paints in one round
trip. Use listComponents() FIRST only when you need to inspect bboxes
before deciding what to paint.

When paintInBox / paintNear catches side walls or bottom faces by
mistake, pass topOnly: true — that restricts the selector to upward-
facing triangles only (axis +Z within 30°) and eliminates the most
common over-paint cause.

For planning paint targets without committing, prefer
getFeatureCentroids() over getMeshSummary — it omits the triangleIds
payload (which can be tens of thousands of integers) and ships only
the centroid + normal + bbox per group. Pass withinBox to scope to one
feature of the model.

Current Partwright API surface and conventions follow.

`;

/** Loads `/ai.md` once and returns the full body. The doc lives in
 *  public/ai.md and is served at the root by Vite. */
export function loadAiMd(): Promise<string> {
  if (aiMdCache !== null) return Promise.resolve(aiMdCache);
  if (aiMdPromise) return aiMdPromise;
  aiMdPromise = fetch('/ai.md')
    .then(r => {
      if (!r.ok) throw new Error(`/ai.md HTTP ${r.status}`);
      return r.text();
    })
    .then(text => {
      aiMdCache = text;
      return text;
    })
    .catch(err => {
      // Fall back to a stub so the agent can still run if ai.md is missing
      // (e.g. a misconfigured deploy). Logged so it surfaces in dev tools.
      console.warn('Partwright: failed to load /ai.md, using stub:', err);
      aiMdCache = '[ai.md could not be loaded — refer to window.partwright.help() at runtime]';
      return aiMdCache;
    });
  return aiMdPromise;
}

/** Builds the suffix that describes the current toggle state. Generated
 *  per-turn, appended after the cached `ai.md` body. Kept small so the
 *  cache prefix invalidation only affects the very last block. */
export function toggleSuffix(toggles: ChatToggles): string {
  const restrictions: string[] = [];
  if (!toggles.scope.runCode) {
    restrictions.push('You CANNOT run code. Suggest code in chat for the user to run themselves.');
  }
  if (!toggles.scope.saveVersions) {
    restrictions.push('You CANNOT save new versions. Run-and-test is allowed but not commit.');
  }
  if (!toggles.scope.paintFaces) {
    restrictions.push('You CANNOT paint faces / set color regions.');
  }
  if (!toggles.vision.views) {
    restrictions.push('You CANNOT call renderView. The user disabled auto-render to save cost — reason from code, geometry stats, and any images the user explicitly attaches (Show AI). Do not ask for screenshots.');
  }

  const lang = currentLanguage();
  const capLabel: Record<ChatToggles['maxIterations'], string> = {
    low: '4', medium: '16', high: '64', infinity: 'unlimited',
  };
  const spendLabel: Record<ChatToggles['maxSpend'], string> = {
    cheap: '$0.10', low: '$0.50', medium: '$2', high: '$10', infinity: 'unlimited',
  };
  const lines = [
    '',
    '## Session toggle state',
    '',
    `Active language: ${lang}  — write code in this language. Use setActiveLanguage to switch only when justified (e.g. user asked, or the request maps obviously better to the other engine: OpenSCAD for parametric extrusion-heavy parts, manifold-js for boolean composition and fine programmatic control).${
      lang === 'scad'
        ? ' Note: SCAD\'s revolve / linear_extrude / cylinder produce radial-fan triangle topology that is awkward to paint cleanly (every triangle radiates from the center axis). If the task involves precise painting of curved features, consider switching to manifold-js up front rather than wrestling with the fan mesh.'
        : ''
    }`,
    `Model: ${toggles.model}`,
    `Auto-retry on tool error: ${toggles.autoRetry}`,
    `Iteration cap (tool round-trips this turn): ${capLabel[toggles.maxIterations]}. Pace your tool calls accordingly — if the cap is low, batch related work and prefer one-shot tools like paintComponent or paintInBox over verify-then-paint loops.`,
    `Spend cap (USD this turn): ${spendLabel[toggles.maxSpend]}. Vision tool calls (renderView, paintPreview withImage) are the most expensive — skip them when stats alone are enough.`,
  ];
  if (restrictions.length > 0) {
    lines.push('');
    lines.push('User has restricted you this session:');
    for (const r of restrictions) lines.push(`- ${r}`);
  }
  return lines.join('\n');
}

function currentLanguage(): string {
  try {
    const w = window as unknown as { partwright?: { getActiveLanguage?: () => string } };
    return w.partwright?.getActiveLanguage?.() ?? 'manifold-js';
  } catch {
    return 'manifold-js';
  }
}

export function buildSystemPrompt(aiMd: string): string {
  return PREAMBLE + aiMd;
}
