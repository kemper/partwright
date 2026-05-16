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
geometry (do not write to examples/). When you write code, return a
Manifold object — see ai.md below for the full conventions.

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
1. paintPreview({box / point+radius / etc.}) → check triangleCount, bbox.
   If the count looks wildly wrong (way too many or zero), adjust the
   selector args before committing. paintPreview is free of side effects
   — use it liberally.
2. paintInBox / paintNear / paintSlab to commit.
3. If wrong: undoLastPaint() (NOT clearColors), tweak, retry.

For models built as a boolean union of distinct features (e.g. a smiley =
head ∪ left_eye ∪ right_eye ∪ mouth), call listComponents() FIRST to get
the bbox of each piece, then paintInBox({box: component.boundingBox,
color}) per component. Don't guess world coordinates.

For getMeshSummary on a complex model, scope queries with withinBox to
the feature you care about — full-mesh summaries on hundreds of groups
charge tokens for data you will discard.

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
    restrictions.push('You CANNOT see the rendered model. Reason from code and geometry stats only — do not ask for screenshots.');
  }

  const lines = [
    '',
    '## Session toggle state',
    '',
    `Model: ${toggles.model}`,
    `Auto-retry on tool error: ${toggles.autoRetry}`,
  ];
  if (restrictions.length > 0) {
    lines.push('');
    lines.push('User has restricted you this session:');
    for (const r of restrictions) lines.push(`- ${r}`);
  }
  return lines.join('\n');
}

export function buildSystemPrompt(aiMd: string): string {
  return PREAMBLE + aiMd;
}
