// Gating invariants for the in-app AI tool list (src/ai/tools.ts) plus the
// dispatch of the tools that wrap existing window.partwright methods (#1085).
//
// A tool that sits in ALL_TOOLS but in no gating set is silently never
// offered: buildToolList filters it out under every toggle combination, so the
// model can't call it and nothing errors. That is how `evalAgainstImport`
// shipped dead — /reconstruct told the model to verify with a tool it was
// never given. The first test pins "every tool is reachable" so it can't
// happen again; the dispatch test pins "every tool has a dispatch case".

import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  ALL_TOOL_NAMES,
  CONFIRM_REQUIRED_TOOLS,
  OBJECT_TARGETABLE_TOOLS,
  RETRY_SAFE_TOOLS,
  buildToolList,
  executeTool,
} from '../../src/ai/tools';
import { loadSettings, setToggles } from '../../src/ai/settings';
import type { ChatToggles } from '../../src/ai/types';

const ALL_ON = { runCode: true, saveVersions: true, paintFaces: true, sessionNotes: true };

function toggles(partial: Parameters<typeof setToggles>[1] = {}): ChatToggles {
  return setToggles(loadSettings(), partial).toggles;
}
const names = (t: ChatToggles) => new Set(buildToolList(t).map(d => d.name));

describe('AI tool gating invariants', () => {
  test('every tool in the schema list is offered when every toggle is on', () => {
    const offered = names(toggles({ scope: ALL_ON, vision: { views: true }, autoResume: true, planFirst: false }));
    const ungated = ALL_TOOL_NAMES.filter(n => !offered.has(n));
    // A failure here means a tool was added to ALL_TOOLS without being put in
    // a gating set (ALWAYS_AVAILABLE / RUN_GATED / SAVE_GATED / PAINT_GATED /
    // NOTES_GATED / VIEWS_GATED / …) — buildToolList would never offer it.
    expect(ungated).toEqual([]);
  });

  test('tool names are unique', () => {
    expect(new Set(ALL_TOOL_NAMES).size).toBe(ALL_TOOL_NAMES.length);
  });

  test('every name in the side sets refers to a real tool (no typos)', () => {
    const all = new Set(ALL_TOOL_NAMES);
    for (const set of [CONFIRM_REQUIRED_TOOLS, RETRY_SAFE_TOOLS, OBJECT_TARGETABLE_TOOLS]) {
      expect([...set].filter(n => !all.has(n))).toEqual([]);
    }
  });

  test('confirm-required tools are never auto-retried', () => {
    expect([...CONFIRM_REQUIRED_TOOLS].filter(n => RETRY_SAFE_TOOLS.has(n))).toEqual([]);
  });

  test('evalAgainstImport is offered by default and in plan mode, and is retry-safe', () => {
    expect(names(toggles({ scope: ALL_ON, planFirst: false })).has('evalAgainstImport')).toBe(true);
    // Read-only: still offered with every mutating scope paused.
    expect(names(toggles({ scope: { runCode: false, saveVersions: false, paintFaces: false, sessionNotes: false }, planFirst: false })).has('evalAgainstImport')).toBe(true);
    expect(names(toggles({ planFirst: true })).has('evalAgainstImport')).toBe(true);
    expect(RETRY_SAFE_TOOLS.has('evalAgainstImport')).toBe(true);
  });

  test('tool schemas stay inside the Gemini-safe keyword subset', () => {
    // Gemini 400s the WHOLE tool list on an unknown JSON-Schema keyword.
    // sanitizeSchemaForGemini strips the STRIPPED set; everything else must
    // be in SAFE. Unions (oneOf/anyOf) and other keywords are not allowed.
    const SAFE = new Set(['type', 'description', 'properties', 'required', 'items', 'enum', 'minimum', 'maximum', 'minItems', 'maxItems']);
    const STRIPPED = new Set(['$schema', 'additionalProperties', 'exclusiveMinimum', 'exclusiveMaximum']);
    const bad: string[] = [];
    const walk = (schema: Record<string, unknown>, path: string) => {
      for (const [k, v] of Object.entries(schema)) {
        if (!SAFE.has(k) && !STRIPPED.has(k)) bad.push(`${path}.${k}`);
        if (k === 'properties' && v && typeof v === 'object') {
          for (const [pk, pv] of Object.entries(v)) if (pv && typeof pv === 'object') walk(pv as Record<string, unknown>, `${path}.${pk}`);
        }
        if (k === 'items' && v && typeof v === 'object') walk(v as Record<string, unknown>, `${path}[]`);
      }
    };
    const all = buildToolList(toggles({ scope: ALL_ON, vision: { views: true }, autoResume: true, planFirst: false }));
    for (const t of all) walk(t.input_schema as unknown as Record<string, unknown>, t.name);
    expect(bad).toEqual([]);
  });
});

// ── Dispatch through executeTool against a stubbed window.partwright ────────

type Call = { method: string; args: unknown[] };

function stubApi(overrides: Record<string, (...args: unknown[]) => unknown> = {}) {
  const calls: Call[] = [];
  const api = new Proxy({} as Record<string, (...args: unknown[]) => unknown>, {
    get(_t, prop: string) {
      return (...args: unknown[]) => {
        calls.push({ method: prop, args });
        const fn = overrides[prop];
        return fn ? fn(...args) : { ok: true };
      };
    },
  });
  vi.stubGlobal('window', { partwright: api });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AI tool dispatch', () => {
  test('every tool has a dispatch case (no "Unknown tool")', async () => {
    stubApi({ listObjects: () => [] });
    vi.stubGlobal('fetch', async () => new Response('# doc', { status: 200 }));
    const unknown: string[] = [];
    for (const name of ALL_TOOL_NAMES) {
      const r = await executeTool(name, {});
      if (r.content.startsWith('Unknown tool')) unknown.push(name);
    }
    expect(unknown).toEqual([]);
  });
});
