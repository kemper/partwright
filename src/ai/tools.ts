// Tool bridge: defines the schemas the model sees and dispatches calls to
// window.partwright. The set of tools the model receives is filtered by the
// per-session scope toggles (see settings.ts). Disabled tools are removed
// from the request payload entirely — the model can't call what isn't there.

import type { ChatToggles } from './types';

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ToolExecResult {
  content: string;
  isError: boolean;
}

const ALL_TOOLS: ToolDefinition[] = [
  {
    name: 'getCode',
    description: 'Read the current code in the editor. Always available. Returns the full source as a string.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'setCode',
    description: 'Replace the editor contents. Does NOT auto-run — call runAndSave or runCode after to render.',
    input_schema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'New editor contents (must be a complete program ending in `return manifold;`).' },
      },
      required: ['code'],
    },
  },
  {
    name: 'runCode',
    description: 'Run the given code (or the editor contents if `code` is omitted) and return the resulting geometry stats. Does NOT save a version. Use for quick iteration before committing.',
    input_schema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Optional code to run instead of editor contents.' },
      },
    },
  },
  {
    name: 'runAndSave',
    description: 'Run code and commit the result as a new gallery version in the current session. The preferred way to make progress — leaves a versioned record. Returns geometry stats and the saved version number.',
    input_schema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Code to run (overwrites the editor with the run-passing variant).' },
        label: { type: 'string', description: 'Short label for the gallery (e.g. "tapered legs"). Defaults to v<index>.' },
      },
      required: ['code'],
    },
  },
  {
    name: 'getGeometryData',
    description: 'Read the current geometry stats (volume, surfaceArea, vertexCount, triangleCount, isManifold, componentCount, boundingBox). Cheap — no re-execution.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'getMeshSummary',
    description: 'Group triangles by coplanar regions and return per-group bounds + centroids. Useful before painting to know which face is where.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'getSessionContext',
    description: 'Read the current session: notes, version history with labels, current version. Call FIRST when resuming work — gives you what was decided previously.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'listVersions',
    description: 'List versions in the current session: { id, index, label, timestamp, status }.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'loadVersion',
    description: 'Load a previously saved version by index. Updates the editor and viewport. Use to compare against an earlier state.',
    input_schema: {
      type: 'object',
      properties: {
        index: { type: 'integer', description: '1-based version index.' },
      },
      required: ['index'],
    },
  },
  {
    name: 'addSessionNote',
    description: 'Append a durable note to the session log. Notes survive compaction and are visible to future agents. Prefix with one of [REQUIREMENT], [DECISION], [FEEDBACK], [MEASUREMENT], [ATTEMPT], [TODO].',
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Note body, prefixed with a tag.' },
      },
      required: ['text'],
    },
  },
  {
    name: 'listSessionNotes',
    description: 'Read all session notes ordered by time. Cheaper than getSessionContext when you only want notes.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'paintRegion',
    description: 'Paint the coplanar region containing a point with the given color. Best paint primitive when you know exactly where to click.',
    input_schema: {
      type: 'object',
      properties: {
        point: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3, description: '[x, y, z] world point on the face.' },
        normal: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3, description: 'Optional normal hint to disambiguate at edges.' },
        color: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3, description: '[r, g, b] in 0..1.' },
        name: { type: 'string', description: 'Optional human-readable region name.' },
        tolerance: { type: 'number', description: 'Coplanarity angle tolerance in degrees.' },
      },
      required: ['point', 'color'],
    },
  },
  {
    name: 'paintFaces',
    description: 'Paint a specific set of triangle ids. Use after findFaces() to act on a query result.',
    input_schema: {
      type: 'object',
      properties: {
        triangleIds: { type: 'array', items: { type: 'integer' } },
        color: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
        name: { type: 'string' },
      },
      required: ['triangleIds', 'color'],
    },
  },
  {
    name: 'findFaces',
    description: 'Search for triangles matching a box / normal / color predicate. Returns { triangleIds, count }. Use before paintFaces to target by geometry.',
    input_schema: {
      type: 'object',
      properties: {
        box: { type: 'object', description: '{min: [x,y,z], max: [x,y,z]}' },
        normal: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
        normalTolerance: { type: 'number' },
        color: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
        region: { type: 'string' },
        maxResults: { type: 'integer' },
      },
    },
  },
  {
    name: 'clearColors',
    description: 'Remove all color regions from the current version. Restores the unlocked, code-only state.',
    input_schema: { type: 'object', properties: {} },
  },
];

const ALWAYS_AVAILABLE = new Set([
  'getCode',
  'setCode',
  'getGeometryData',
  'getMeshSummary',
  'getSessionContext',
  'listVersions',
  'loadVersion',
  'addSessionNote',
  'listSessionNotes',
  'findFaces',
]);

const RUN_GATED = new Set(['runCode']);
const SAVE_GATED = new Set(['runAndSave', 'loadVersion']);
const PAINT_GATED = new Set(['paintRegion', 'paintFaces', 'clearColors']);

export function buildToolList(toggles: ChatToggles): ToolDefinition[] {
  return ALL_TOOLS.filter(t => {
    if (ALWAYS_AVAILABLE.has(t.name)) return true;
    if (RUN_GATED.has(t.name)) return toggles.scope.runCode;
    if (SAVE_GATED.has(t.name)) {
      // loadVersion is non-mutating but gating it under saveVersions keeps
      // the model from rewinding state when the user has paused commits.
      return t.name === 'loadVersion' ? toggles.scope.saveVersions : (toggles.scope.runCode && toggles.scope.saveVersions);
    }
    if (PAINT_GATED.has(t.name)) return toggles.scope.paintFaces;
    return false;
  });
}

type PartwrightAPI = Record<string, (...args: unknown[]) => unknown>;

function getApi(): PartwrightAPI {
  const w = window as unknown as { partwright?: PartwrightAPI };
  if (!w.partwright) {
    throw new Error('window.partwright is not ready — the Partwright engine has not finished initializing.');
  }
  return w.partwright;
}

/** Dispatches a tool call to window.partwright and stringifies the result.
 *  Errors are caught and returned with isError: true so the loop can feed
 *  them back to the model for self-correction. */
export async function executeTool(name: string, input: Record<string, unknown>): Promise<ToolExecResult> {
  try {
    // Pre-flight: code-writing tools must match the active session
    // language. The agent loop will retry with the corrected language
    // when this errors, which is faster and clearer than letting the
    // wrong-language code reach the engine and fail with a parse error.
    if (name === 'setCode' || name === 'runAndSave' || name === 'runCode') {
      const code = typeof input.code === 'string' ? input.code : '';
      if (code.length > 0) {
        const mismatch = detectLanguageMismatch(code);
        if (mismatch) return { content: mismatch, isError: true };
      }
    }
    const api = getApi();
    const result = await dispatch(api, name, input);
    if (result === undefined) return { content: '(ok)', isError: false };
    if (typeof result === 'string') return { content: result, isError: false };
    return { content: JSON.stringify(result, null, 2), isError: false };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: msg, isError: true };
  }
}

/** Returns an error message when the supplied code clearly doesn't match
 *  the active session language, or null when it looks plausible. The
 *  detector is intentionally conservative — false positives bounce the
 *  model into a wasted retry, so we only flag patterns we're highly
 *  confident about (`Manifold.` API calls in a SCAD session, `module ` /
 *  trailing `;` blocks with no `return` in a JS session). */
function detectLanguageMismatch(code: string): string | null {
  const lang = readActiveLanguage();
  if (lang === null) return null;
  if (lang === 'scad') {
    // Strong JS markers in a SCAD session — manifold-3d API calls and
    // explicit `return` statements (SCAD has no return keyword).
    if (/\bManifold\s*\./.test(code) || /\bCrossSection\s*\./.test(code) || /^\s*return\s+/m.test(code) || /\bconst\s*\{\s*Manifold\b/.test(code)) {
      return 'Language mismatch: this session is OpenSCAD (.scad) but the code looks like manifold-js (JavaScript). Rewrite using SCAD syntax: `cube([w,d,h], center=true);`, `cylinder(h=…, r1=…, r2=…, $fn=64);`, `translate([x,y,z]) <child>;`, `union() { ... }`, etc. No `return`, no `Manifold.` calls.';
    }
  } else {
    // Strong SCAD markers in a JS session — `module name() {}` /
    // `function foo() = …` / `$fn = …;` are SCAD-only constructs.
    if (/^\s*module\s+\w+\s*\(/m.test(code) || /^\s*\$fn\s*=/m.test(code) || /^\s*function\s+\w+\s*\([^)]*\)\s*=/m.test(code)) {
      return 'Language mismatch: this session is manifold-js (JavaScript) but the code uses OpenSCAD-only syntax (`module`, `$fn`, or function-equals). Rewrite using the manifold-js API: `const { Manifold, CrossSection } = api;`, `Manifold.cube(...)`, `.translate(...)`, ending with `return manifold;`.';
    }
  }
  return null;
}

/** Read the live engine language without forcing every consumer of
 *  `tools.ts` to import the engine module statically. The function lives
 *  in `src/geometry/engine.ts` and is already loaded by the app shell at
 *  startup, so a require-style lookup via `window.partwright` is safe. */
function readActiveLanguage(): 'manifold-js' | 'scad' | null {
  try {
    const w = window as unknown as { partwright?: { getActiveLanguage?: () => 'manifold-js' | 'scad' } };
    const lang = w.partwright?.getActiveLanguage?.();
    return lang === 'manifold-js' || lang === 'scad' ? lang : null;
  } catch {
    return null;
  }
}

async function dispatch(api: PartwrightAPI, name: string, input: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'getCode':
      return api.getCode();
    case 'setCode':
      return api.setCode(input.code as string);
    case 'runCode':
      return api.run(input.code as string | undefined);
    case 'runAndSave':
      return api.runAndSave(input.code as string, input.label as string | undefined);
    case 'getGeometryData':
      return api.getGeometryData();
    case 'getMeshSummary':
      return api.getMeshSummary();
    case 'getSessionContext':
      return api.getSessionContext();
    case 'listVersions':
      return api.listVersions();
    case 'loadVersion':
      return api.loadVersion({ index: input.index as number });
    case 'addSessionNote':
      return api.addSessionNote(input.text as string);
    case 'listSessionNotes':
      return api.listSessionNotes();
    case 'paintRegion':
      return api.paintRegion(input);
    case 'paintFaces':
      return api.paintFaces(input);
    case 'findFaces':
      return api.findFaces(input);
    case 'clearColors':
      return api.clearColors();
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
