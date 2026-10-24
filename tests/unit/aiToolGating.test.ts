// Gating invariants for the in-app AI tool list (src/ai/tools.ts) plus the
// dispatch of the tools that wrap existing window.partwright methods (#1085).
//
// A tool that sits in ALL_TOOLS but in no gating set is silently never
// offered: buildToolList filters it out under every toggle combination, so the
// model can't call it and nothing errors. That is how `evalAgainstImport`
// shipped dead — /reconstruct told the model to verify with a tool it was
// never given. The first test pins "every tool is reachable" so it can't
// happen again; the rest pin the specific gates of the new tools and drive
// their dispatch against a stubbed `window.partwright`.

import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  ALL_TOOL_NAMES,
  CONFIRM_REQUIRED_TOOLS,
  OBJECT_TARGETABLE_TOOLS,
  RETRY_SAFE_TOOLS,
  buildToolList,
  executeTool,
  isModelChangingTool,
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

  test('new read tools are always-on, plan-mode and retry-safe', () => {
    const paused = names(toggles({ scope: { runCode: false, saveVersions: false, paintFaces: false, sessionNotes: false }, planFirst: false }));
    const plan = names(toggles({ planFirst: true }));
    for (const n of ['listAnnotations', 'diffVersions', 'getMeasurement', 'getViewState', 'getPalette', 'getUnits', 'listSessions']) {
      expect(paused.has(n), `${n} always offered`).toBe(true);
      expect(plan.has(n), `${n} in plan mode`).toBe(true);
      expect(RETRY_SAFE_TOOLS.has(n), `${n} retry-safe`).toBe(true);
      expect(isModelChangingTool(n), `${n} not model-changing`).toBe(false);
    }
    // Metadata/organization setters are always on but stay out of plan mode.
    for (const n of ['setUnits', 'setObjectGroup']) {
      expect(paused.has(n)).toBe(true);
      expect(plan.has(n)).toBe(false);
    }
  });

  test('version + transform tools follow the save scopes', () => {
    const saveOnly = names(toggles({ scope: { ...ALL_ON, runCode: false }, planFirst: false }));
    const noSave = names(toggles({ scope: { ...ALL_ON, saveVersions: false }, planFirst: false }));
    // rename/delete don't execute code: saveVersions alone is enough.
    expect(saveOnly.has('renameVersion')).toBe(true);
    expect(saveOnly.has('deleteVersion')).toBe(true);
    // mirrorModel re-runs/bakes the model, like placeModel: it needs runCode too.
    expect(saveOnly.has('mirrorModel')).toBe(false);
    for (const n of ['renameVersion', 'deleteVersion', 'mirrorModel']) expect(noSave.has(n)).toBe(false);
    expect(CONFIRM_REQUIRED_TOOLS.has('deleteVersion')).toBe(true);
    expect(RETRY_SAFE_TOOLS.has('deleteVersion')).toBe(false);
    expect(isModelChangingTool('mirrorModel')).toBe(true);
    expect(isModelChangingTool('deleteVersion')).toBe(true);
    expect(isModelChangingTool('renameVersion')).toBe(false);
    for (const n of ['mirrorModel', 'diffVersions', 'renameVersion', 'deleteVersion']) expect(OBJECT_TARGETABLE_TOOLS.has(n)).toBe(true);
  });

  test('note edit/delete ride the session-notes scope', () => {
    const on = names(toggles({ scope: ALL_ON, planFirst: false }));
    const off = names(toggles({ scope: { ...ALL_ON, sessionNotes: false }, planFirst: false }));
    for (const n of ['updateSessionNote', 'deleteSessionNote']) {
      expect(on.has(n)).toBe(true);
      expect(off.has(n)).toBe(false);
    }
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

  test('listAnnotations merges strokes, texts and count, downsampling strokes', async () => {
    const points = Array.from({ length: 50 }, (_, i) => [i, 0, i * 2] as [number, number, number]);
    stubApi({
      listAnnotations: () => [{ id: 's1', color: [1, 0, 0], width: 4, pointCount: 50, points, camera: { position: [0, 0, 1], target: [0, 0, 0], up: [0, 1, 0] } }],
      listTextAnnotations: () => [{ id: 't1', text: 'shorter here', anchor: [1, 2, 3] }],
      getAnnotationCount: () => 2,
    });
    const r = await executeTool('listAnnotations', { maxPointsPerStroke: 5 });
    expect(r.isError).toBe(false);
    const out = JSON.parse(r.content);
    expect(out.count).toBe(2);
    expect(out.texts[0].text).toBe('shorter here');
    const s = out.strokes[0];
    expect(s.pointCount).toBe(50);
    expect(s.points).toHaveLength(5);
    expect(s.points[0]).toEqual([0, 0, 0]);
    expect(s.points[4]).toEqual([49, 0, 98]);
    expect(s.bbox).toEqual({ min: [0, 0, 0], max: [49, 0, 98] });
    expect(s.centroid).toEqual([24.5, 0, 49]);

    const none = JSON.parse((await executeTool('listAnnotations', { maxPointsPerStroke: 0 })).content);
    expect(none.strokes[0].points).toBeUndefined();
    expect(none.strokes[0].bbox).toBeTruthy();
  });

  test('getMeasurement combines interactive state, point distance and Z probe', async () => {
    const calls = stubApi({
      getMeasurement: () => ({ active: false, point1: null, point2: null, distance: null }),
      measureBetween: () => 5,
      measureAt: () => ({ hits: [0, 10] }),
    });
    const r = JSON.parse((await executeTool('getMeasurement', { from: [0, 0, 0], to: [3, 4, 0], at: [1, 2] })).content);
    expect(r.interactive.active).toBe(false);
    expect(r.between).toEqual({ from: [0, 0, 0], to: [3, 4, 0], distance: 5, delta: [3, 4, 0] });
    expect(r.at).toEqual({ hits: [0, 10] });
    expect(calls.find(c => c.method === 'measureAt')?.args).toEqual([[1, 2]]);

    const half = JSON.parse((await executeTool('getMeasurement', { from: [0, 0, 0] })).content);
    expect(half.error).toMatch(/both `from` and `to`/);
  });

  test('query fans the new keys out without passing them to the console query()', async () => {
    const calls = stubApi({
      query: () => ({ boundingBox: { min: [0, 0, 0], max: [1, 1, 1] }, stats: {} }),
      checkContainment: () => null,
      pointInside: (p) => (p as number[])[0] < 1,
      componentBounds: () => [{ index: 0 }],
      analyzeProfile: () => ({ features: [], transitions: [], summary: 'flat' }),
    });
    const r = JSON.parse((await executeTool('query', {
      boundingBox: true, containment: true, pointsInside: [[0, 0, 0], [5, 5, 5]], componentBounds: true, zProfile: true, zProfileSamples: 12,
    })).content);
    const q = calls.find(c => c.method === 'query');
    expect(q?.args).toEqual([{ boundingBox: true }]);
    expect(r.boundingBox).toBeTruthy();
    expect(r.containment).toEqual([]);
    expect(r.pointsInside).toEqual([{ point: [0, 0, 0], inside: true }, { point: [5, 5, 5], inside: false }]);
    expect(r.componentBounds).toEqual([{ index: 0 }]);
    expect(r.zProfile.summary).toBe('flat');
    expect(calls.find(c => c.method === 'analyzeProfile')?.args).toEqual([12]);
  });

  test('diffVersions returns a compact line diff instead of both sources', async () => {
    stubApi({
      diffVersions: () => ({
        a: { id: 'va', index: 1, label: 'v1', code: 'const a = 1;\nreturn a;' },
        b: { id: 'vb', index: 2, label: 'v2', code: 'const a = 2;\nreturn a;' },
        codeChanged: true,
        statDiff: { volume: { prev: 1, next: 8 } },
      }),
    });
    const r = JSON.parse((await executeTool('diffVersions', { a: 1, b: 2 })).content);
    expect(r.codeChanged).toBe(true);
    expect(r.codeDiff).toMatchObject({ changed: true, added: 1, removed: 1 });
    expect(r.codeDiff.diff).toContain('- const a = 1;');
    expect(r.codeDiff.diff).toContain('+ const a = 2;');
    expect(r.a).toEqual({ id: 'va', index: 1, label: 'v1' });
    expect(r.codeA).toBeUndefined();
    const withCode = JSON.parse((await executeTool('diffVersions', { a: 1, b: 2, includeCode: true })).content);
    expect(withCode.codeB).toBe('const a = 2;\nreturn a;');
  });

  test('version, unit, group and note tools forward the right arguments', async () => {
    const calls = stubApi({ getUnits: () => 'in' });
    await executeTool('renameVersion', { index: 3, label: 'final' });
    await executeTool('deleteVersion', { index: 2 });
    await executeTool('setObjectGroup', { objects: ['Lid', 'Base'], group: '' });
    await executeTool('updateSessionNote', { id: 'n1', text: '[TODO] done' });
    await executeTool('deleteSessionNote', { id: 'n2' });
    const units = JSON.parse((await executeTool('setUnits', { unit: 'in' })).content);
    const by = (m: string) => calls.find(c => c.method === m)?.args;
    expect(by('renameVersion')).toEqual([{ index: 3 }, 'final']);
    expect(by('deleteVersion')).toEqual([{ index: 2 }]);
    expect(by('setObjectGroup')).toEqual([['Lid', 'Base'], null]);
    expect(by('updateSessionNote')).toEqual(['n1', '[TODO] done']);
    expect(by('deleteSessionNote')).toEqual(['n2']);
    expect(by('setUnits')).toEqual(['in']);
    expect(units).toEqual({ unit: 'in' });
  });
});
