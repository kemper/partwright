// Unit tests for the tool registry (src/ui/toolRegistry.ts) — the leaf that
// lets the AI open a tool panel for the user with fields pre-set — plus the
// AI tool gating of openTool / closeTool / getUiState in src/ai/tools.ts.

import { describe, expect, test, vi } from 'vitest';
import {
  registerTool, getTool, listTools, getOpenTool, openTool,
  validatePrefill, parsePrefillColor, checkRange, type PrefillSchema,
} from '../../src/ui/toolRegistry';
import { openViewportPanel, closeViewportPanel, onViewportPanelOpen } from '../../src/ui/viewportPanelRegistry';
import { buildToolList, executeTool } from '../../src/ai/tools';
import { loadSettings, setToggles } from '../../src/ai/settings';

const SCHEMA: PrefillSchema = {
  tab: { type: 'enum', values: ['fuzzy', 'knit'] },
  amplitude: { type: 'number', min: 0, max: 10 },
  count: { type: 'number', integer: true },
  on: { type: 'boolean' },
  text: { type: 'string', maxLength: 5 },
  at: { type: 'vec3' },
  scale: { type: 'numberOrVec3', min: 0.01 },
  color: { type: 'color' },
  brush: { type: 'object', fields: { size: { type: 'number', min: 0 } } },
  free: { type: 'object' },
};

describe('validatePrefill', () => {
  test('accepts and normalizes valid values', () => {
    const r = validatePrefill(SCHEMA, {
      tab: 'knit', amplitude: 2, count: 3, on: true, text: 'abc', at: [1, 2, 3], scale: 2,
      color: '#ff0000', brush: { size: 1 }, free: { anything: 1 },
    });
    expect('value' in r).toBe(true);
    if ('value' in r) {
      expect(r.value.color).toEqual([1, 0, 0]);
      expect(r.value.scale).toBe(2);
      expect(r.value.free).toEqual({ anything: 1 });
    }
  });

  test('undefined / null prefill is an empty value', () => {
    expect(validatePrefill(SCHEMA, undefined)).toEqual({ value: {} });
    expect(validatePrefill(SCHEMA, null)).toEqual({ value: {} });
  });

  test('rejects unknown keys at the top level and in nested objects with fields', () => {
    const top = validatePrefill(SCHEMA, { nope: 1 });
    expect('error' in top && top.error).toMatch(/unknown key "nope".*allowed: tab, amplitude/);
    const nested = validatePrefill(SCHEMA, { brush: { size: 1, radius: 2 } });
    expect('error' in nested && nested.error).toMatch(/unknown key "brush\.radius"/);
  });

  test('rejects wrong types and out-of-range values, listing every problem', () => {
    const r = validatePrefill(SCHEMA, { tab: 'waffle', amplitude: 11, count: 1.5, on: 'yes', text: 'toolong', at: [1, 2], scale: [1, 0, 1], color: [2, 0, 0] });
    expect('error' in r).toBe(true);
    if ('error' in r) {
      for (const frag of ['tab must be one of', 'amplitude must be <= 10', 'count must be an integer', 'on must be a boolean',
        'text must be at most 5', 'at must be [x, y, z]', 'scale values must be >= 0.01', 'color must be']) {
        expect(r.error).toContain(frag);
      }
    }
  });

  test('a tool without a schema takes no prefill', () => {
    expect(validatePrefill(undefined, {})).toEqual({ value: {} });
    const r = validatePrefill(undefined, { a: 1 });
    expect('error' in r && r.error).toMatch(/takes no prefill/);
  });

  test('non-object prefill is an error', () => {
    expect('error' in validatePrefill(SCHEMA, [1, 2])).toBe(true);
    expect('error' in validatePrefill(SCHEMA, 'x')).toBe(true);
  });
});

describe('parsePrefillColor / checkRange', () => {
  test('colors', () => {
    expect(parsePrefillColor('#fff')).toEqual([1, 1, 1]);
    expect(parsePrefillColor('00ff00')).toEqual([0, 1, 0]);
    expect(parsePrefillColor([0.1, 0.2, 0.3])).toEqual([0.1, 0.2, 0.3]);
    expect(parsePrefillColor([1, 2, 3])).toBeNull();
    expect(parsePrefillColor('#ggg')).toBeNull();
    expect(parsePrefillColor(5)).toBeNull();
  });
  test('checkRange reports the live range', () => {
    const errs: string[] = [];
    expect(checkRange('x', 5, 0, 10, errs)).toBe(true);
    expect(checkRange('x', 11, 0, 10, errs)).toBe(false);
    expect(checkRange('y', -1, 0, Infinity, errs)).toBe(false);
    expect(errs[0]).toMatch(/x must be in \[0, 10\]/);
    expect(errs[1]).toMatch(/y must be in \[0, ∞\]/);
  });
});

describe('registry + openTool', () => {
  test('register / get / list / getOpenTool', () => {
    let open = false;
    registerTool({ id: 'test-a', title: 'A', isOpen: () => open, open: () => { open = true; } });
    expect(getTool('test-a')?.title).toBe('A');
    expect(listTools().some(t => t.id === 'test-a')).toBe(true);
    expect(getOpenTool()?.id).not.toBe('test-a');
    open = true;
    expect(getOpenTool()?.id).toBe('test-a');
    open = false;
  });

  test('validates against the schema before the opener runs, then reports applied', async () => {
    const opener = vi.fn(() => ({ applied: { tab: 'knit' }, ignored: ['on'] }));
    registerTool({ id: 'test-b', title: 'B', prefillSchema: SCHEMA, isOpen: () => false, open: opener });
    const bad = await openTool('test-b', { bogus: 1 });
    expect('error' in bad && bad.error).toMatch(/unknown key "bogus"/);
    expect(opener).not.toHaveBeenCalled();
    const ok = await openTool('test-b', { tab: 'knit', color: '#000' }, { note: 'hi', source: 'ai' });
    expect(ok).toEqual({ ok: true, id: 'test-b', applied: { tab: 'knit' }, ignored: ['on'] });
    expect(opener).toHaveBeenCalledWith({ tab: 'knit', color: [0, 0, 0] }, { note: 'hi', source: 'ai' });
    // No prefill → the opener gets undefined (a plain open).
    await openTool('test-b');
    expect(opener).toHaveBeenLastCalledWith(undefined, { source: 'ui' });
  });

  test('unknown id, disabled tool, opener error and throw all become {error}', async () => {
    expect('error' in await openTool('no-such-tool')).toBe(true);
    registerTool({ id: 'test-c', title: 'C', enabled: () => false, isOpen: () => false, open: () => {} });
    expect((await openTool('test-c')) as { error: string }).toHaveProperty('error');
    registerTool({ id: 'test-d', title: 'D', isOpen: () => false, open: () => ({ error: 'stitchWidth must be in [1, 9]' }) });
    expect(await openTool('test-d')).toEqual({ error: 'openTool("test-d"): stitchWidth must be in [1, 9]' });
    registerTool({ id: 'test-e', title: 'E', isOpen: () => false, open: () => { throw new Error('boom'); } });
    expect(await openTool('test-e')).toEqual({ error: 'openTool("test-e"): boom' });
  });

  test('an AI/API open does not fire the viewport-panel open listeners (no AI-panel step-aside)', async () => {
    const listener = vi.fn();
    onViewportPanelOpen(listener);
    const panel = { close: () => closeViewportPanel(panel) };
    registerTool({ id: 'test-f', title: 'F', isOpen: () => false, open: () => openViewportPanel(panel) });
    await openTool('test-f', undefined, { source: 'ai' });
    expect(listener).not.toHaveBeenCalled();
    panel.close();
    await openTool('test-f'); // a user (ui) open still steps the AI panel aside
    expect(listener).toHaveBeenCalledTimes(1);
    panel.close();
    // On a phone (narrow layout) the chat is full-screen: an AI open steps it aside too.
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
    try {
      await openTool('test-f', undefined, { source: 'ai' });
      expect(listener).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
      panel.close();
    }
  });

  test('getOpenTool prefers the docked panel over an overlay mode', () => {
    let measureOn = true;
    let panelOn = false;
    registerTool({ id: 'test-overlay', title: 'Overlay', overlay: true, isOpen: () => measureOn, open: () => {} });
    registerTool({ id: 'test-docked', title: 'Docked', isOpen: () => panelOn, open: () => {} });
    expect(getOpenTool()?.id).toBe('test-overlay');
    panelOn = true;
    expect(getOpenTool()?.id).toBe('test-docked');
    // An unregistered docked panel (e.g. Customize) is the focus: no registered
    // tool is reported (getUiState says 'other'), not the overlay beside it.
    panelOn = false;
    const customize = { close: () => closeViewportPanel(customize) };
    openViewportPanel(customize, { silent: true });
    expect(getOpenTool()).toBeNull();
    customize.close();
    expect(getOpenTool()?.id).toBe('test-overlay');
    measureOn = false;
  });
});

describe('AI tool gating for the UI hand-off tools', () => {
  test('openTool/closeTool outside plan mode; getUiState always (incl. plan mode)', () => {
    const base = loadSettings();
    const normal = buildToolList(base.toggles).map(t => t.name);
    expect(normal).toEqual(expect.arrayContaining(['openTool', 'closeTool', 'getUiState']));
    const plan = buildToolList(setToggles(base, { planFirst: true }).toggles).map(t => t.name);
    expect(plan).toContain('getUiState');
    expect(plan).not.toContain('openTool');
    expect(plan).not.toContain('closeTool');
  });

  test('the openTool id enum + description come from the registry', () => {
    registerTool({ id: 'test-g', title: 'G tool', prefillSchema: { size: { type: 'number' } }, isOpen: () => false, open: () => {} });
    const def = buildToolList(loadSettings().toggles).find(t => t.name === 'openTool')!;
    const id = def.input_schema.properties.id as { enum?: string[] };
    expect(id.enum).toContain('test-g');
    expect(def.description).toContain('test-g — G tool: size');
  });
});

describe('openTool AI tool: prefillJson fallback', () => {
  test('parses an object, rejects null / arrays / scalars / bad JSON without calling the API', async () => {
    const openToolApi = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal('window', { partwright: { openTool: openToolApi } });
    try {
      const ok = await executeTool('openTool', { id: 'tool-surface', prefillJson: '{"tab":"knit"}' });
      expect(ok.isError).toBe(false);
      expect(openToolApi).toHaveBeenLastCalledWith('tool-surface', { tab: 'knit' }, { source: 'ai' });
      // An explicit non-empty prefill wins over prefillJson.
      await executeTool('openTool', { id: 'tool-surface', prefill: { tab: 'fur' }, prefillJson: '{"tab":"knit"}' });
      expect(openToolApi).toHaveBeenLastCalledWith('tool-surface', { tab: 'fur' }, { source: 'ai' });
      openToolApi.mockClear();
      for (const bad of ['null', '[1,2]', '5', '"knit"', '{nope']) {
        const r = await executeTool('openTool', { id: 'tool-surface', prefillJson: bad });
        expect(r.content).toMatch(/prefillJson/);
      }
      expect(openToolApi).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('the agent Worker sees the UI tool catalogue', () => {
  test('buildToolList uses a passed catalogue (the Worker has no registry)', () => {
    const def = buildToolList(loadSettings().toggles, [{ id: 'worker-only', title: 'From main', prefillKeys: 'a, b' }])
      .find(t => t.name === 'openTool')!;
    expect((def.input_schema.properties.id as { enum?: string[] }).enum).toEqual(['worker-only']);
    expect(def.description).toContain('worker-only — From main: a, b');
  });

  test('the Worker client snapshots the registry into the run_turn message', async () => {
    vi.resetModules();
    vi.doMock('../../src/geometry/engine', () => ({ cancelCurrentExecution: () => {} }));
    const posted: Array<{ type: string; input?: { uiTools?: Array<{ id: string; title: string; prefillKeys: string }> } }> = [];
    class FakeWorker {
      onmessage: unknown = null;
      onmessageerror: unknown = null;
      onerror: unknown = null;
      postMessage(m: (typeof posted)[number]) { posted.push(m); }
      terminate() {}
      addEventListener() {}
    }
    vi.stubGlobal('Worker', FakeWorker);
    try {
      // Fresh module graph: the client and the registry it snapshots share it.
      const reg = await import('../../src/ui/toolRegistry');
      reg.registerTool({ id: 'test-worker', title: 'W', prefillSchema: { size: { type: 'number' } }, isOpen: () => false, open: () => {} });
      const client = await import('../../src/ai/agentWorkerClient');
      void client.runTurn({ toggles: loadSettings().toggles, sessionId: 's', history: [], userBlocks: [] });
      const msg = posted.find(m => m.type === 'run_turn');
      expect(msg?.input?.uiTools).toEqual(expect.arrayContaining([{ id: 'test-worker', title: 'W', prefillKeys: 'size' }]));
    } finally {
      vi.unstubAllGlobals();
      vi.doUnmock('../../src/geometry/engine');
    }
  });
});
