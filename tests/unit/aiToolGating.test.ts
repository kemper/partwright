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
  confirmToolLabel,
  preConfirmToolResult,
  declinedToolMessage,
} from '../../src/ai/tools';
import { computeCodeDiff } from '../../src/ai/codeDiff';
import { CARD_TOOL_ACK } from '../../src/ai/planReply';
import { loadSettings, setToggles } from '../../src/ai/settings';
import type { ChatToggles } from '../../src/ai/types';

const ALL_ON = { runCode: true, saveVersions: true, paintFaces: true, sessionNotes: true };

function toggles(partial: Parameters<typeof setToggles>[1] = {}): ChatToggles {
  return setToggles(loadSettings(), partial).toggles;
}
const names = (t: ChatToggles) => new Set(buildToolList(t).map(d => d.name));

describe('AI tool gating invariants', () => {
  test('every tool in the schema list is offered when every toggle is on', () => {
    // Plan-only tools (proposePlan) are offered in plan mode, not with it off.
    const offered = new Set([
      ...names(toggles({ scope: ALL_ON, vision: { views: true }, autoResume: true, planFirst: false })),
      ...names(toggles({ scope: ALL_ON, vision: { views: true }, autoResume: true, planFirst: true })),
    ]);
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

  test('PR5 wrappers sit in the right gates', () => {
    const all = names(toggles({ scope: ALL_ON, vision: { views: true }, planFirst: false }));
    const paused = names(toggles({ scope: { runCode: false, saveVersions: false, paintFaces: false, sessionNotes: false }, vision: { views: false }, planFirst: false }));
    const noPaint = names(toggles({ scope: { ...ALL_ON, paintFaces: false }, planFirst: false }));
    const saveOnly = names(toggles({ scope: { ...ALL_ON, runCode: false }, planFirst: false }));
    const plan = names(toggles({ planFirst: true, vision: { views: true } }));
    // Paint-scoped.
    for (const n of ['editPalette', 'replaceColor', 'paintAirbrush']) {
      expect(all.has(n), n).toBe(true);
      expect(noPaint.has(n), `${n} needs paintFaces`).toBe(false);
      expect(RETRY_SAFE_TOOLS.has(n), `${n} not retried`).toBe(false);
    }
    expect(isModelChangingTool('replaceColor')).toBe(true);
    expect(isModelChangingTool('paintAirbrush')).toBe(true);
    expect(isModelChangingTool('editPalette')).toBe(false);
    // Save-scoped: healCurrent re-shapes the live mesh (needs runCode too);
    // saveAllObjects only snapshots, so saveVersions alone is enough.
    expect(saveOnly.has('healCurrent')).toBe(false);
    expect(saveOnly.has('saveAllObjects')).toBe(true);
    expect(isModelChangingTool('healCurrent')).toBe(true);
    // Always-on, even with every scope paused.
    for (const n of ['setRegionVisibility', 'importImageAsVoxels', 'listCatalog', 'exportModel', 'setReferenceGeometry', 'clearReferenceGeometry']) {
      expect(paused.has(n), `${n} always offered`).toBe(true);
    }
    expect(RETRY_SAFE_TOOLS.has('setRegionVisibility')).toBe(true);
    // Read-only catalog listing: plan mode + retry-safe.
    expect(plan.has('listCatalog')).toBe(true);
    expect(RETRY_SAFE_TOOLS.has('listCatalog')).toBe(true);
    // Section render needs the Views toggle; it is a plan-mode read.
    expect(all.has('renderSection')).toBe(true);
    expect(paused.has('renderSection')).toBe(false);
    expect(plan.has('renderSection')).toBe(true);
    // Downloads / new sessions need the user's OK and are never auto-retried.
    for (const n of ['exportModel', 'importImageAsVoxels']) {
      expect(CONFIRM_REQUIRED_TOOLS.has(n)).toBe(true);
      expect(plan.has(n)).toBe(false);
    }
    expect(isModelChangingTool('exportModel')).toBe(false);
    for (const n of ['healCurrent', 'replaceColor', 'setRegionVisibility', 'paintAirbrush', 'renderSection']) expect(OBJECT_TARGETABLE_TOOLS.has(n), n).toBe(true);
  });

  test('forkVersion follows the save scope (it runs code and commits a version)', () => {
    const noSave = names(toggles({ scope: { ...ALL_ON, saveVersions: false }, planFirst: false }));
    const noRun = names(toggles({ scope: { ...ALL_ON, runCode: false }, planFirst: false }));
    expect(noSave.has('forkVersion')).toBe(false);
    expect(noRun.has('forkVersion')).toBe(false);
    expect(isModelChangingTool('forkVersion')).toBe(true);
  });

  test('every object param declares its fields (Gemini can fill it)', () => {
    // Gemini sanitizes an object with no `properties` to `properties: {}` and
    // then sends it empty — a required `box` arrives as {} and the call fails
    // every time. Genuinely free-form maps instead carry a `<key>Json` string
    // sibling the model can fill.
    const FREE_FORM = new Set(['setParams.values', 'applySurfaceTexture.opts', 'openTool.prefill', 'exportModel.split']);
    const bad: string[] = [];
    const walk = (tool: string, path: string, schema: Record<string, unknown>, siblings: Record<string, unknown>) => {
      const props = schema.properties as Record<string, Record<string, unknown>> | undefined;
      if (path && schema.type === 'object' && (!props || Object.keys(props).length === 0)) {
        const key = `${tool}.${path}`;
        const leaf = path.split('.').pop()!;
        if (!FREE_FORM.has(key)) bad.push(key);
        else if (!(`${leaf}Json` in siblings)) bad.push(`${key} (free-form but no ${leaf}Json fallback)`);
      }
      // A shared shape must not grow stray fields (an insertion that landed in
      // the wrong block once nested paintInCylinder's top-level smooth knobs
      // inside normalCone, where the API never reads them).
      if (path.split('.').pop() === 'normalCone' && props) {
        const keys = Object.keys(props).sort().join(',');
        if (keys !== 'angleDeg,axis') bad.push(`${tool}.${path} has fields {${keys}}`);
      }
      for (const [k, v] of Object.entries(props ?? {})) walk(tool, path ? `${path}.${k}` : k, v, props!);
    };
    const all = buildToolList(toggles({ scope: ALL_ON, vision: { views: true }, autoResume: true, planFirst: false }));
    for (const t of all) walk(t.name, '', t.input_schema as unknown as Record<string, unknown>, {});
    expect(bad).toEqual([]);
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
    // Both lists: plan-only tools (proposePlan) are sent to Gemini too.
    const all = [
      ...buildToolList(toggles({ scope: ALL_ON, vision: { views: true }, autoResume: true, planFirst: false })),
      ...buildToolList(toggles({ scope: ALL_ON, vision: { views: true }, autoResume: true, planFirst: true })),
    ];
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

describe('card tools (askUser / proposePlan)', () => {
  test('askUser is offered in every mode, proposePlan only while planning', () => {
    const off = names(toggles({ scope: ALL_ON, planFirst: false }));
    const plan = names(toggles({ scope: ALL_ON, planFirst: true }));
    const none = names(toggles({ scope: { runCode: false, saveVersions: false, paintFaces: false, sessionNotes: false }, planFirst: false }));
    expect(off.has('askUser')).toBe(true);
    expect(none.has('askUser')).toBe(true);
    expect(plan.has('askUser')).toBe(true);
    expect(plan.has('proposePlan')).toBe(true);
    expect(off.has('proposePlan')).toBe(false);
  });

  test('they validate their input and acknowledge without touching the API', async () => {
    const calls = stubApi();
    const ok = await executeTool('askUser', { questions: [{ question: 'How tall?', options: [{ label: '60 mm' }] }] });
    expect(ok.isError).toBe(false);
    expect(ok.content).toBe(CARD_TOOL_ACK);
    expect((await executeTool('proposePlan', { summary: 'A vase.', steps: ['Revolve.'] })).content).toBe(CARD_TOOL_ACK);
    expect((await executeTool('askUser', { questions: [] })).isError).toBe(true);
    expect((await executeTool('askUser', { questions: [{ question: 'x?', options: [{}] }] })).isError).toBe(true);
    expect((await executeTool('proposePlan', { summary: 'A vase.' })).isError).toBe(true);
    expect(calls).toEqual([]);
  });
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
    const calls = stubApi({ getUnits: () => 'in', listSessionNotes: () => [{ id: 'n1' }, { id: 'n2' }] });
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

  test('note edit/delete refuse ids that are not in the active session', async () => {
    const calls = stubApi({ listSessionNotes: () => [{ id: 'mine' }] });
    const upd = JSON.parse((await executeTool('updateSessionNote', { id: 'other-tab', text: 'x' })).content);
    const del = JSON.parse((await executeTool('deleteSessionNote', { id: 'other-tab' })).content);
    expect(upd.error).toMatch(/no note with id "other-tab"/);
    expect(del.error).toMatch(/no note with id "other-tab"/);
    expect(calls.some(c => c.method === 'updateSessionNote' || c.method === 'deleteSessionNote')).toBe(false);
  });

  test('setObjectGroup needs an explicit group; null and a name pass through', async () => {
    const calls = stubApi();
    const missing = JSON.parse((await executeTool('setObjectGroup', { objects: ['Lid'] })).content);
    const wrong = JSON.parse((await executeTool('setObjectGroup', { objects: ['Lid'], group: 3 })).content);
    expect(missing.error).toMatch(/group/);
    expect(wrong.error).toMatch(/group/);
    expect(calls.filter(c => c.method === 'setObjectGroup')).toHaveLength(0);
    await executeTool('setObjectGroup', { objects: ['Lid'], group: null });
    await executeTool('setObjectGroup', { objects: ['Lid'], group: 'Hardware' });
    expect(calls.filter(c => c.method === 'setObjectGroup').map(c => c.args[1])).toEqual([null, 'Hardware']);
  });

  test('query rejects unknown keys and malformed pointsInside before touching the API', async () => {
    const calls = stubApi();
    const unknown = JSON.parse((await executeTool('query', { bbox: true, boundingBox: true })).content);
    expect(unknown.error).toMatch(/unknown key\(s\) "bbox"/);
    const bad = JSON.parse((await executeTool('query', { pointsInside: [[0, 0]] })).content);
    expect(bad.error).toMatch(/pointsInside\[0\]/);
    const many = JSON.parse((await executeTool('query', { pointsInside: Array.from({ length: 201 }, () => [0, 0, 0]) })).content);
    expect(many.error).toMatch(/at most 200/);
    expect(calls.some(c => c.method === 'query' || c.method === 'pointInside')).toBe(false);
  });

  test('diffVersions clamps maxDiffLines and truncates very long lines', async () => {
    const long = 'x'.repeat(5000);
    stubApi({
      diffVersions: () => ({
        // Diff: "+ <long line>" then "- old" — two changed lines.
        a: { id: 'a', index: 1, label: 'v1', code: 'keep\nold' },
        b: { id: 'b', index: 2, label: 'v2', code: `${long}\nkeep` },
        codeChanged: true,
        statDiff: {},
      }),
    });
    const r = JSON.parse((await executeTool('diffVersions', { a: 1, b: 2, maxDiffLines: 0 })).content);
    const shown = (r.codeDiff.diff as string).split('\n');
    // Clamped to 1 changed line, plus the "more changed lines" footer.
    expect(shown).toHaveLength(2);
    expect(shown[0].length).toBeLessThan(260);
    expect(shown[0]).toMatch(/… \(5000 chars\)$/);
    expect(computeCodeDiff('a', 'b').diff).toBe('- a\n+ b');
  });

  test('free-form maps accept a JSON-string fallback; assertPaint folds its range param', async () => {
    const calls = stubApi();
    const ok = await executeTool('setParams', { valuesJson: '{"width":50}' });
    expect(ok.isError).toBe(false);
    expect(calls.find(c => c.method === 'setParams')?.args[0]).toEqual({ width: 50 });
    const badJson = await executeTool('setParams', { valuesJson: '{width' });
    expect(badJson.content).toContain('valuesJson is not valid JSON');
    const missing = await executeTool('setParams', {});
    expect(missing.content).toContain('values is required');

    await executeTool('applySurfaceTexture', { id: 'knit', optsJson: '{"amplitude":0.5}' });
    expect(calls.find(c => c.method === 'applySurfaceTexture')?.args[1]).toEqual({ amplitude: 0.5 });

    await executeTool('assertPaint', { region: 'sock', expectedTriangleRange: { min: 10 } });
    expect(calls.find(c => c.method === 'assertPaint')?.args[0]).toEqual({ region: 'sock', expectedTriangleCount: { min: 10 } });
    const both = await executeTool('assertPaint', { region: 'sock', expectedTriangleCount: 3, expectedTriangleRange: { min: 1 } });
    expect(both.content).toContain('not both');
  });

  test('an object target that arrives as a digit string resolves as an index', async () => {
    const calls = stubApi({
      listObjects: () => [
        { id: 'a', name: 'Base', order: 0, isCurrent: true },
        { id: 'b', name: 'Lid', order: 1, isCurrent: false },
      ],
    });
    await executeTool('getCode', { object: '1' });
    expect(calls.find(c => c.method === 'changeObject')?.args[0]).toBe('b');
  });

  test('executeTool does not mutate the caller\'s input (retries reuse it)', async () => {
    stubApi({ listObjects: () => [{ id: 'o1', name: 'Lid', order: 0, isCurrent: true }] });
    const input = { object: 'Lid', boundingBox: true };
    await executeTool('query', input);
    expect(input).toEqual({ object: 'Lid', boundingBox: true });
  });

  test('an { error } result is flagged isError; a success is not', async () => {
    stubApi({ getUnits: () => 'mm', replaceColor: () => ({ error: 'replaceColor(opts.from) must have exactly 3 elements' }), listRegions: () => [] });
    const bad = await executeTool('replaceColor', { from: [1], to: [0, 0, 1] });
    expect(bad.isError).toBe(true);
    expect(JSON.parse(bad.content).error).toMatch(/exactly 3/);
    expect((await executeTool('getUnits', {})).isError).toBe(false);
    // Arrays and nested errors are not top-level failures.
    expect((await executeTool('listRegions', {})).isError).toBe(false);
  });

  test('editPalette routes each op and rejects keys the op does not take', async () => {
    const calls = stubApi({ getPalette: () => ({ id: 'p1', slots: [] }) });
    const add = JSON.parse((await executeTool('editPalette', { op: 'addFilament', name: 'PLA Red', hex: '#ff0000' })).content);
    expect(add.palette).toEqual({ id: 'p1', slots: [] });
    await executeTool('editPalette', { op: 'updateFilament', id: 's1', hex: '#00ff00' });
    await executeTool('editPalette', { op: 'removeFilament', id: 's2' });
    await executeTool('editPalette', { op: 'setCapacity', capacity: 4 });
    await executeTool('editPalette', { op: 'setConstrained', constrained: true });
    await executeTool('editPalette', { op: 'setActive', id: 'p2' });
    const by = (m: string) => calls.find(c => c.method === m)?.args;
    expect(by('addFilament')).toEqual([{ name: 'PLA Red', hex: '#ff0000' }]);
    expect(by('updateFilament')).toEqual(['s1', { hex: '#00ff00' }]);
    expect(by('removeFilament')).toEqual(['s2']);
    expect(by('setPaletteCapacity')).toEqual([4]);
    expect(by('setPaletteConstrained')).toEqual([true]);
    expect(by('setActivePalette')).toEqual(['p2']);
    const extra = JSON.parse((await executeTool('editPalette', { op: 'removeFilament', id: 's2', hex: '#000000' })).content);
    expect(extra.error).toMatch(/does not take hex/);
    const missing = JSON.parse((await executeTool('editPalette', { op: 'addFilament', name: 'x' })).content);
    expect(missing.error).toMatch(/needs hex/);
    const empty = JSON.parse((await executeTool('editPalette', { op: 'updateFilament', id: 's1' })).content);
    expect(empty.error).toMatch(/at least one/);
    const badOp = JSON.parse((await executeTool('editPalette', { op: 'toString' })).content);
    expect(badOp.error).toMatch(/op must be one of/);
  });

  test('exportModel picks the single- or multi-object exporter and resolves object names', async () => {
    const calls = stubApi({
      listObjects: () => [{ id: 'o1', name: 'Base', order: 0, isCurrent: true }, { id: 'o2', name: 'Lid', order: 1, isCurrent: false }],
      exportSTL: () => undefined,
      export3MFObjects: () => ({ ok: true, filename: 'x.3mf', parts: 2 }),
      exportSTEP: () => ({ ok: false, error: 'No BREP shape available.' }),
    });
    expect(JSON.parse((await executeTool('exportModel', { format: 'stl' })).content)).toEqual({ ok: true, format: 'stl' });
    const proj = JSON.parse((await executeTool('exportModel', { format: '3mf-objects', objects: ['Lid', 'o1'] })).content);
    expect(proj).toEqual({ ok: true, format: '3mf-objects', filename: 'x.3mf', parts: 2 });
    expect(calls.find(c => c.method === 'export3MFObjects')?.args).toEqual([['o2', 'o1'], undefined]);
    await executeTool('exportModel', { format: '3mf', objects: ['Base'] });
    expect(calls.filter(c => c.method === 'export3MFObjects')[1].args).toEqual([['o1'], undefined, { bambu: false }]);
    expect(JSON.parse((await executeTool('exportModel', { format: 'step' })).content)).toEqual({ error: 'No BREP shape available.' });
    const unknown = JSON.parse((await executeTool('exportModel', { format: 'stl', objects: ['Nope'] })).content);
    expect(unknown.error).toMatch(/"Nope"/);
    const vox = JSON.parse((await executeTool('exportModel', { format: 'vox', objects: ['Base'] })).content);
    expect(vox.error).toMatch(/only the current object/);
    // split / exclude route a single-object export through the multi-object
    // exporter for the current object.
    await executeTool('exportModel', { format: '3mf', split: { Base: 'pieces' }, exclude: ['Base · Piece 2'] });
    expect(calls.filter(c => c.method === 'export3MFObjects')[2].args).toEqual([['o1'], undefined, { bambu: false, split: { Base: 'pieces' }, exclude: ['Base · Piece 2'] }]);
    const badSplit = JSON.parse((await executeTool('exportModel', { format: 'stl', split: { Base: 'halves' } })).content);
    expect(badSplit.error).toMatch(/"pieces", "parts" or "whole"/);
    const stepSplit = JSON.parse((await executeTool('exportModel', { format: 'step', split: { Base: 'pieces' } })).content);
    expect(stepSplit.error).toMatch(/can't split/);
  });

  test('confirm labels name the export format + objects and the voxel image', async () => {
    stubApi({ listObjects: () => [{ id: 'o1', name: 'Base', order: 0, isCurrent: true }, { id: 'o2', name: 'Lid', order: 1, isCurrent: false }] });
    expect(await confirmToolLabel('exportModel', { format: 'stl' })).toBe('download an STL file of object "Base"');
    expect(await confirmToolLabel('exportModel', { format: '3mf-objects' })).toBe('download a Bambu Studio / OrcaSlicer 3MF project of every object in this session');
    expect(await confirmToolLabel('exportModel', { format: 'glb', objects: ['o2', 'Base'] })).toBe('download a GLB file of objects "Lid", "Base"');
    expect(await confirmToolLabel('importImageAsVoxels', { imageRef: 2 })).toBe('turn reference image 2 into voxel art in a NEW session');
    expect(await confirmToolLabel('importImageAsVoxels', { src: 'data:image/png;base64,AAAA' })).toBe('turn an embedded image into voxel art in a NEW session');
    expect(await confirmToolLabel('exportModel', { format: 'stl', objects: ['Lid', 'Base'], filename: 'kit' })).toBe('download a .zip of STL files of objects "Lid", "Base" named "kit"');
  });

  test('a painted single-object OBJ export is labelled as a .zip', async () => {
    stubApi({
      listObjects: () => [{ id: 'o1', name: 'Base', order: 0, isCurrent: true }],
      listRegions: () => [{ id: 1 }],
      getModelColors: () => ({ count: 0 }),
    });
    expect(await confirmToolLabel('exportModel', { format: 'obj' })).toBe('download a .zip of an OBJ file and its .mtl colours of object "Base"');
  });

  test('export / voxel declines say nothing happened', () => {
    expect(declinedToolMessage('exportModel')).toMatch(/nothing was downloaded/);
    expect(declinedToolMessage('importImageAsVoxels')).toMatch(/no voxel session was created/);
  });

  test('pre-confirm uses the live API to refuse unknown objects and missing reference images', () => {
    stubApi({
      listObjects: () => [{ id: 'o1', name: 'Base', order: 0, isCurrent: true }],
      getImages: () => [{ src: 'data:image/png;base64,AAAA' }],
    });
    expect(JSON.parse(preConfirmToolResult('exportModel', { format: 'glb', objects: ['Nope'] })!.content).error).toMatch(/"Nope"/);
    expect(preConfirmToolResult('exportModel', { format: 'glb', objects: ['Base'] })).toBeNull();
    expect(JSON.parse(preConfirmToolResult('importImageAsVoxels', { imageRef: 3 })!.content).error).toMatch(/index 3/);
    expect(preConfirmToolResult('importImageAsVoxels', { imageRef: 1 })).toBeNull();
    // null means "not given".
    expect(preConfirmToolResult('exportModel', { format: 'stl', objects: null, filename: null })).toBeNull();
    expect(preConfirmToolResult('importImageAsVoxels', { imageRef: null, src: 'https://example.com/a.png' })).toBeNull();
  });

  test('preConfirmToolResult refuses doomed calls before the prompt', () => {
    // Code-bearing URLs are refused exactly as the geometry-only dispatch would.
    for (const url of ['https://example.com/model.partwright.json', 'https://example.com/a.js', 'https://example.com/a.scad', '#share=abc']) {
      const r = preConfirmToolResult('importFromUrl', { url });
      expect(r?.isError, url).toBe(true);
      expect(JSON.parse(r!.content).error).toMatch(/contains model code/);
    }
    expect(preConfirmToolResult('importFromUrl', { url: 'https://example.com/part.stl' })).toBeNull();
    expect(preConfirmToolResult('exportModel', { format: 'dwg' })?.isError).toBe(true);
    expect(preConfirmToolResult('exportModel', { format: 'stl' })).toBeNull();
    expect(preConfirmToolResult('importImageAsVoxels', { src: 'file:///etc/passwd' })?.isError).toBe(true);
    expect(preConfirmToolResult('importImageAsVoxels', {})?.isError).toBe(true);
    expect(preConfirmToolResult('importImageAsVoxels', { src: 'https://example.com/a.png' })).toBeNull();
    expect(preConfirmToolResult('importImageAsVoxels', { imageRef: 1 })).toBeNull();
    expect(preConfirmToolResult('deleteVersion', { index: 1 })).toBeNull();
  });

  test('importImageAsVoxels resolves imageRef against the reference images', async () => {
    const calls = stubApi({ getImages: () => [{ src: '' }, { src: 'data:image/png;base64,AAAA' }] });
    await executeTool('importImageAsVoxels', { imageRef: 1, maxSize: 32 });
    expect(calls.find(c => c.method === 'importImageAsVoxels')?.args).toEqual(['data:image/png;base64,AAAA', { maxSize: 32 }]);
    const none = JSON.parse((await executeTool('importImageAsVoxels', { imageRef: 5 })).content);
    expect(none.error).toMatch(/no reference image at index 5/);
  });

  test('setReferenceGeometry converts a hex colour; healCurrent maps "no model" to an error', async () => {
    const calls = stubApi({ healCurrent: () => null });
    await executeTool('setReferenceGeometry', { code: 'return api.Manifold.cube(1);', color: '#00ff80', opacity: 0.5 });
    expect(calls.find(c => c.method === 'setReferenceGeometry')?.args).toEqual(['return api.Manifold.cube(1);', { color: 0x00ff80, opacity: 0.5 }]);
    const bad = JSON.parse((await executeTool('setReferenceGeometry', { code: 'x', color: 'red' })).content);
    expect(bad.error).toMatch(/#rrggbb/);
    const heal = JSON.parse((await executeTool('healCurrent', {})).content);
    expect(heal.error).toMatch(/no model loaded/);
  });

  test('confirmToolLabel names the version, its label and the object', async () => {
    stubApi({
      listObjects: () => [{ id: 'o1', name: 'Base', order: 0, isCurrent: true }, { id: 'o2', name: 'Lid', order: 1, isCurrent: false }],
      listVersions: () => [{ index: 3, label: 'final' }],
    });
    expect(await confirmToolLabel('deleteVersion', { index: 3 })).toBe("permanently delete version 3 'final' of object Base");
    // A non-current target: listVersions() reads the current object, so the label is omitted.
    expect(await confirmToolLabel('deleteVersion', { index: 3, object: 'Lid' })).toBe('permanently delete version 3 of object Lid');
    expect(await confirmToolLabel('importImageAsRelief', {})).toBe('import an image as a 3D relief');
  });
});
