// System prompt assembly. The base body is `public/ai.md` — the same doc
// the external Claude Code agent reads — and the model sees it via prompt
// caching so we don't pay for it on every turn. A short, generated suffix
// communicates the current toggle state so the model doesn't ask for tools
// it can't call.

import { activeModel, type ChatToggles } from './types';

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
    `Model: ${activeModel(toggles) ?? '(none picked)'} (provider: ${toggles.provider})`,
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

/** Local models cap at 4K context. The full `ai.md` is ~15K tokens — it
 *  blows the budget before the user even speaks. This is a hand-tuned
 *  ~1K-token replacement covering the essentials a 1-8B model needs to
 *  drive Partwright: API surface, coordinate system, mandatory `return`,
 *  the session-versioning workflow, and a nudge to use tools instead of
 *  narrating. Tool calling format is appended separately in `local.ts`. */
export function buildLocalSystemPrompt(): string {
  return LOCAL_SYSTEM_PROMPT;
}

const LOCAL_SYSTEM_PROMPT = `You are an AI modeling assistant running inside Partwright, a parametric
CAD tool that runs in the user's browser.

## How you take action

DO NOT paste code into chat as a fenced block for the user to copy.
Instead, drive the app by emitting tool calls:

1. \`setCode({code: "…full program ending with return …;"})\` writes the
   editor.
2. \`runAndSave({code: "…", label?: "short label"})\` runs the code,
   validates it produces a Manifold, and commits a new gallery version.
   Use this — not chat code blocks — to make progress.
3. \`getGeometryData()\` reads the current triangle count, bounding box,
   and component count after a save.

Always prefer acting (calling a tool) over describing what you would do.
The user is watching the editor and the 3D viewport; tool calls show up
there, code in chat does not.

## The manifold-js API

Code you pass to \`setCode\` / \`runAndSave\` MUST be a complete program
ending with \`return manifold;\` (no top-level await, no exports).

\`\`\`js
const { Manifold, CrossSection } = api;

// Primitives (centred at origin by default; second arg true centres)
Manifold.cube([w, d, h], true);
Manifold.sphere(r, segments);
Manifold.cylinder(h, rBottom, rTop, segments, true);

// Transforms (return a new Manifold; originals are immutable)
shape.translate([x, y, z]);
shape.rotate([rx, ry, rz]);    // degrees
shape.scale([sx, sy, sz]);

// Booleans
Manifold.union([a, b, c]);     // or a.add(b)
Manifold.difference([a, b]);   // or a.subtract(b)
Manifold.intersection([a, b]); // or a.intersect(b)

// 2D → 3D
const profile = CrossSection.circle(r);
profile.extrude(h);
\`\`\`

## Coordinate system

Right-handed, Z-up. XY is the ground; Z points up. Units are arbitrary
(treat as mm if the user doesn't say). Shapes must overlap by 0.5+ units
to boolean-union into one component.

## Workflow

1. Read context first if the user is resuming work: \`getSessionContext()\`
   returns prior notes and the version history.
2. Write a complete program and ship it with \`runAndSave\`.
3. If \`componentCount > 1\` in the resulting geometry, your booleans
   didn't union — overlap the shapes more and resave.

## Worked example — a tiny smiley face

User: "Make me a smiley face."

You call:
\`\`\`
runAndSave({
  code: "const { Manifold } = api;\\n
         const head = Manifold.sphere(20, 64);\\n
         const eye = Manifold.sphere(3, 32);\\n
         const eyeL = eye.translate([-7, -18, 5]);\\n
         const eyeR = eye.translate([ 7, -18, 5]);\\n
         const mouth = Manifold.cylinder(4, 8, 8, 32)\\n
           .rotate([90, 0, 0])\\n
           .translate([0, -18, -5]);\\n
         const carved = Manifold.difference([head, eyeL, eyeR, mouth]);\\n
         return carved;",
  label: "smiley face v1"
})
\`\`\`

Then briefly tell the user you saved a new version, and stop.

`;
