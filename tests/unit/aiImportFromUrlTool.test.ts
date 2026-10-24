// The AI importFromUrl tool (#1085 review): it defaults to a NEW OBJECT when
// the session holds real work, never imports code-bearing sources (the
// dispatch passes geometryOnly), names the landing target in the confirm
// dialog, and only counts as model-changing when it combines into the
// current object.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { aiDefaultImportTarget, describeToolConfirmation, isModelChangingTool, executeTool } from '../../src/ai/tools';

type Api = Record<string, (...args: unknown[]) => unknown>;

function stubApi(state: { session?: boolean; version?: boolean; code?: string; object?: string }, extra: Api = {}): Api {
  return {
    getSessionState: () => ({
      session: state.session ? { id: 's1', name: 'S' } : null,
      currentPart: state.session ? { id: 'p1', name: state.object ?? 'Object 1' } : null,
      currentVersion: state.version ? { index: 1, label: 'v1' } : null,
    }),
    getCode: () => state.code ?? '',
    getCurrentObject: () => (state.session ? { id: 'p1', name: state.object ?? 'Object 1' } : null),
    ...extra,
  };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('aiDefaultImportTarget', () => {
  it('is a new session with no session or only a blank starter object', () => {
    expect(aiDefaultImportTarget(stubApi({}))).toBe('new-session');
    expect(aiDefaultImportTarget(stubApi({ session: true, code: '' }))).toBe('new-session');
  });

  it('is a new object when the object has a saved version or edited code', () => {
    expect(aiDefaultImportTarget(stubApi({ session: true, version: true }))).toBe('new-object');
    expect(aiDefaultImportTarget(stubApi({ session: true, code: 'const { Manifold } = api;\nreturn Manifold.sphere(3);' }))).toBe('new-object');
  });
});

describe('describeToolConfirmation', () => {
  it('names where an importFromUrl lands', () => {
    vi.stubGlobal('window', { partwright: stubApi({ session: true, version: true, object: 'Lid' }) });
    expect(describeToolConfirmation('importFromUrl', { url: 'https://x.test/a.stl' })).toBe('import https://x.test/a.stl as a new object in this session');
    expect(describeToolConfirmation('importFromUrl', { url: 'https://x.test/a.stl', target: 'new-session' })).toBe('import https://x.test/a.stl into a NEW session');
    expect(describeToolConfirmation('importFromUrl', { url: 'https://x.test/a.stl', target: 'current-object' })).toMatch(/COMBINE it into "Lid"/);
  });

  it('names the setting for setAppConfig', () => {
    expect(describeToolConfirmation('setAppConfig', { setting: 'ui.defaultQuality', value: 64 })).toMatch(/ui\.defaultQuality to 64/);
  });
});

describe('importFromUrl dispatch', () => {
  it('passes geometryOnly and the computed default target', async () => {
    const importFromUrl = vi.fn(async () => ({ kind: 'remote' }));
    vi.stubGlobal('window', { partwright: stubApi({ session: true, version: true }, { importFromUrl }) });
    await executeTool('importFromUrl', { url: 'https://x.test/a.stl' });
    expect(importFromUrl).toHaveBeenCalledWith('https://x.test/a.stl', { target: 'new-object', geometryOnly: true });
  });
});

describe('isModelChangingTool(importFromUrl)', () => {
  it('only counts a combine into the current object', () => {
    expect(isModelChangingTool('importFromUrl', { target: 'current-object' })).toBe(true);
    expect(isModelChangingTool('importFromUrl', { target: 'new-object' })).toBe(false);
    expect(isModelChangingTool('importFromUrl')).toBe(false);
  });
});
