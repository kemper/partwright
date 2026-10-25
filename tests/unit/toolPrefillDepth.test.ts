// Unit tests for the PR6 prefill-depth helpers (#1085): the registry's `list`
// field type, the "[UI · app note] user applied …" next-turn notes (only for tools the AI
// opened), the strict Customizer override check, and the publish prefill check.

import { describe, expect, test } from 'vitest';
import { afterEach, vi } from 'vitest';
import {
  registerTool, openTool, validatePrefill, notifyToolApplied, drainToolAppliedNotes, formatToolAppliedNote,
  captureToolApplied, clearToolAppliedNotes, UI_APPLIED_NOTE_PREFIX,
} from '../../src/ui/toolRegistry';
import { openViewportPanel, closeViewportPanel } from '../../src/ui/viewportPanelRegistry';
import { executeTool } from '../../src/ai/tools';
import { isLocalOrPrivateHost, fetchRemoteBytes } from '../../src/import/remoteFetch';
import { checkParamOverrides, normalizeParamSchema } from '../../src/geometry/params';
import { checkPublishPrefill } from '../../src/ui/publishModal';

describe('validatePrefill list fields', () => {
  const schema = { names: { type: 'list', of: 'string', maxItems: 2 }, idx: { type: 'list', of: 'integer' } } as const;
  test('accepts arrays of the declared item type', () => {
    expect(validatePrefill(schema, { names: ['a', 'b'], idx: [0, 3] })).toEqual({ value: { names: ['a', 'b'], idx: [0, 3] } });
  });
  test('rejects wrong item types and over-long lists', () => {
    const r = validatePrefill(schema, { names: ['a', 1], idx: [1.5] });
    expect('error' in r && r.error).toMatch(/names must be an array of strings.*idx must be an array of integers/);
    const long = validatePrefill(schema, { names: ['a', 'b', 'c'] });
    expect('error' in long && long.error).toMatch(/at most 2 items/);
  });
});

describe('formatToolAppliedNote', () => {
  test('leads with the tab / tool and lists the rest compactly', () => {
    const line = formatToolAppliedNote('Surface textures', { tab: 'knit', stitchWidth: 3.5, amplitude: 0.123456, seed: 7, scope: null, label: 'hat' });
    expect(line).toBe('[UI · app note] user applied Surface textures: knit {stitchWidth: 3.5, amplitude: 0.1235, seed: 7, label: "hat"}');
  });
  test('`what` overrides the lead; nested objects / arrays are summarised; long lines truncate', () => {
    expect(formatToolAppliedNote('Paint colors', { tool: 'brush', brush: { size: 2, spray: true }, color: [1, 0.2, 0.4] }, 'brush stroke'))
      .toBe('[UI · app note] user applied Paint colors: brush stroke {tool: "brush", brush: {size: 2, spray: true}, color: [1, 0.2, 0.4]}');
    const long = formatToolAppliedNote('X', { text: 'y'.repeat(30), a: Array.from({ length: 50 }, (_, i) => i), b: 'z'.repeat(1000) });
    expect(long.length).toBeLessThanOrEqual(400);
  });
});

describe('notifyToolApplied / drainToolAppliedNotes', () => {
  let n = 0;
  const reg = (state: Record<string, unknown>) => {
    const id = `notes-${++n}`;
    registerTool({ id, title: `Tool ${n}`, open: () => ({ applied: {}, ignored: [] }), getState: () => state, isOpen: () => true });
    return id;
  };

  test('records a note only for a tool the AI opened', async () => {
    drainToolAppliedNotes();
    const aiTool = reg({ tab: 'fuzzy', amplitude: 1 });
    const uiTool = reg({ tab: 'knit' });
    const neverOpened = reg({ tab: 'cable' });
    await openTool(aiTool, undefined, { source: 'ai' });
    await openTool(uiTool, undefined, { source: 'ui' });
    notifyToolApplied(aiTool);
    notifyToolApplied(uiTool);
    notifyToolApplied(neverOpened);
    notifyToolApplied('no-such-tool');
    const notes = drainToolAppliedNotes();
    expect(notes).toEqual([`[UI · app note] user applied Tool ${n - 2}: fuzzy {amplitude: 1}`]);
    expect(drainToolAppliedNotes()).toEqual([]); // drained
  });

  test('a later user open of the same tool stops the notes; latest apply per tool wins', async () => {
    drainToolAppliedNotes();
    const state: Record<string, unknown> = { tool: 'brush', size: 1 };
    const id = reg(state);
    await openTool(id, undefined, { source: 'ai' });
    notifyToolApplied(id);
    state.size = 2;
    notifyToolApplied(id);
    expect(drainToolAppliedNotes()).toEqual([`[UI · app note] user applied Tool ${n}: brush {size: 2}`]);
    await openTool(id, undefined, { source: 'ui' });
    notifyToolApplied(id);
    expect(drainToolAppliedNotes()).toEqual([]);
  });

  test('a rejected open does not mark the tool as AI-opened', async () => {
    drainToolAppliedNotes();
    const id = `notes-${++n}`;
    registerTool({ id, title: 'Rejecting', open: () => ({ error: 'nope' }), getState: () => ({}), isOpen: () => false });
    expect('error' in (await openTool(id, undefined, { source: 'ai' }))).toBe(true);
    notifyToolApplied(id);
    expect(drainToolAppliedNotes()).toEqual([]);
  });

  test('keeps at most a handful of pending notes (oldest dropped)', async () => {
    drainToolAppliedNotes();
    const ids: string[] = [];
    for (let i = 0; i < 9; i++) ids.push(reg({ tab: `t${i}` }));
    for (const id of ids) { await openTool(id, undefined, { source: 'ai' }); notifyToolApplied(id); }
    const notes = drainToolAppliedNotes();
    expect(notes.length).toBe(6);
    expect(notes[notes.length - 1]).toContain(': t8');
  });
});

describe('checkParamOverrides', () => {
  const schema = normalizeParamSchema({
    width: { type: 'number', default: 30, min: 10, max: 120 },
    rows: { type: 'int', default: 2 },
    rounded: { type: 'boolean', default: true },
    style: { type: 'select', default: 'flat', options: ['flat', 'round'] },
    label: { type: 'text', default: 'A', maxLength: 4 },
    accent: { type: 'color', default: '#3b82f6' },
  });
  test('accepts valid values (numbers beyond the slider range allowed, colours normalised)', () => {
    expect(checkParamOverrides(schema, { width: 500, rows: 3, rounded: false, style: 'round', label: 'ab', accent: '#ABC' }))
      .toEqual({ values: { width: 500, rows: 3, rounded: false, style: 'round', label: 'ab', accent: '#aabbcc' } });
  });
  test('rejects unknown keys and every wrong type, naming each', () => {
    const r = checkParamOverrides(schema, { widht: 1, width: '5', rows: 1.5, rounded: 'yes', style: 'cube', label: 'toolong', accent: 'blue' });
    expect('error' in r).toBe(true);
    const msg = 'error' in r ? r.error : '';
    for (const bit of ['unknown parameter "widht"', 'width must be a finite number', 'rows must be an integer', 'rounded must be a boolean', 'style must be one of', 'label must be at most 4', 'accent must be']) {
      expect(msg).toContain(bit);
    }
  });
});

describe('checkPublishPrefill', () => {
  test('validates the platform and the format against that platform', () => {
    expect(checkPublishPrefill({ platform: 'makerworld', format: '3mf-bambu' })).toBeNull();
    expect(checkPublishPrefill({ platform: 'nowhere' })).toMatch(/platform must be one of/);
    expect(checkPublishPrefill({ platform: 'thingiverse', format: '3mf-bambu' })).toMatch(/format must be one of/);
  });
});

describe('applied-note sessions', () => {
  let n = 100;
  /** A tool backed by a docked viewport panel, like the real ones. */
  const regPanel = () => {
    const id = `panel-${++n}`;
    let open = false;
    const entry = { close: () => { open = false; closeViewportPanel(entry); } };
    registerTool({
      id, title: `Panel ${n}`,
      open: () => { open = true; openViewportPanel(entry); return { applied: {}, ignored: [] }; },
      getState: () => ({ tab: 'x' }),
      isOpen: () => open,
      close: () => entry.close(),
    });
    return { id, entry, isOpen: () => open, reopenByUser: () => { open = true; openViewportPanel(entry); } };
  };

  test('notes are app-prefixed', () => {
    expect(formatToolAppliedNote('T', { tab: 'a' }).startsWith(`${UI_APPLIED_NOTE_PREFIX} user applied`)).toBe(true);
  });

  test('closing the AI-opened panel ends its note session (a later user re-open sends nothing)', async () => {
    drainToolAppliedNotes();
    const t = regPanel();
    await openTool(t.id, undefined, { source: 'ai' });
    notifyToolApplied(t.id);
    expect(drainToolAppliedNotes()).toHaveLength(1);
    t.entry.close();          // user closes it (× / Escape)
    t.reopenByUser();         // …and reopens it from its own toolbar button
    notifyToolApplied(t.id);
    expect(drainToolAppliedNotes()).toEqual([]);
  });

  test('another panel replacing it also ends the session', async () => {
    drainToolAppliedNotes();
    const a = regPanel();
    const b = regPanel();
    await openTool(a.id, undefined, { source: 'ai' });
    await openTool(b.id, undefined, { source: 'ui' }); // replaces a
    a.reopenByUser();
    notifyToolApplied(a.id);
    expect(drainToolAppliedNotes()).toEqual([]);
  });

  test('captureToolApplied snapshots now and queues only when called (success-only commits)', async () => {
    drainToolAppliedNotes();
    const t = regPanel();
    await openTool(t.id, undefined, { source: 'ai' });
    const failed = captureToolApplied(t.id, 'Update code');
    expect(failed).not.toBeNull();
    expect(drainToolAppliedNotes()).toEqual([]); // not called → nothing queued
    const ok = captureToolApplied(t.id, 'Update code');
    t.entry.close(); // the commit closes the panel …
    ok?.();          // … the snapshot still lands
    expect(drainToolAppliedNotes()[0]).toContain('Update code');
  });

  test('clearToolAppliedNotes drops pending notes (session change)', async () => {
    const t = regPanel();
    await openTool(t.id, undefined, { source: 'ai' });
    notifyToolApplied(t.id);
    clearToolAppliedNotes();
    expect(drainToolAppliedNotes()).toEqual([]);
  });
});

describe('openTool AI dispatch: customize values need the Run code scope', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  const stubStorage = (scope: Record<string, boolean>) => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
    });
    return import('../../src/ai/settings').then(({ loadSettings, setToggles, saveSettings }) => {
      saveSettings(setToggles(loadSettings(), { scope }));
    });
  };

  test('refuses customize values when runCode is off; allows the open without values', async () => {
    await stubStorage({ runCode: false });
    const openToolApi = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal('window', { partwright: { openTool: openToolApi } });
    const refused = await executeTool('openTool', { id: 'tool-customize', prefill: { values: { width: 3 } } });
    expect(refused.isError || /Run code/.test(refused.content)).toBe(true);
    expect(refused.content).toMatch(/Run code/);
    expect(openToolApi).not.toHaveBeenCalled();
    await executeTool('openTool', { id: 'tool-customize', prefill: {} });
    expect(openToolApi).toHaveBeenCalledTimes(1);
  });

  test('passes customize values through when runCode is on', async () => {
    await stubStorage({ runCode: true });
    const openToolApi = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal('window', { partwright: { openTool: openToolApi } });
    await executeTool('openTool', { id: 'tool-customize', prefill: { values: { width: 3 } } });
    expect(openToolApi).toHaveBeenCalledWith('tool-customize', { values: { width: 3 } }, { source: 'ai' });
  });
});

describe('isLocalOrPrivateHost (AI image-prefill fetch guard)', () => {
  test.each([
    'localhost', 'LOCALHOST', 'api.localhost', 'printer.local', 'printer.local.',
    '127.0.0.1', '127.8.9.10', '10.0.0.5', '172.16.0.1', '172.31.255.255', '192.168.1.20', '169.254.169.254', '0.0.0.0',
    '[::1]', '::1', '::', '[fd12:3456::1]', 'fc00::1', 'fe80::1', '[fe80::abcd]', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:c0a8:101',
  ])('blocks %s', (h) => { expect(isLocalOrPrivateHost(h)).toBe(true); });
  test.each([
    'example.com', 'images.example.org', '8.8.8.8', '172.15.0.1', '172.32.0.1', '192.169.0.1', '11.0.0.1', '2001:4860::8888', 'localhost.example.com', '::ffff:8.8.8.8',
  ])('allows %s', (h) => { expect(isLocalOrPrivateHost(h)).toBe(false); });
});

describe('fetchRemoteBytes options', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  test('passes the redirect mode and reports the caller\'s network-error text', async () => {
    const fetchMock = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchRemoteBytes('https://example.com/a.png', { timeoutMs: 1000, maxBytes: 10, redirect: 'error', networkErrorMessage: 'host must allow CORS' }))
      .rejects.toThrow('host must allow CORS');
    expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].redirect).toBe('error');
  });
  test('defaults to following redirects and rejects a final URL outside allowedProtocols', async () => {
    const res = new Response(new Uint8Array([1, 2]), { status: 200, headers: { 'content-type': 'image/png' } });
    Object.defineProperty(res, 'url', { value: 'http://example.com/a.png' });
    const fetchMock = vi.fn(async () => res);
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchRemoteBytes('https://example.com/a.png', { timeoutMs: 1000, maxBytes: 10, allowedProtocols: ['https:'] }))
      .rejects.toThrow(/unsupported URL/);
    expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].redirect).toBe('follow');
  });
});
