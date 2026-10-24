import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ENGINE_WORKER_MESSAGE_TYPES,
  isAllowedEngineMessage,
  parseFrameMessage,
  parseParentMessage,
  parseWorkerStatus,
} from '../../src/sandbox/protocol';
import {
  getEngineSandboxMode,
  isEngineSandboxMode,
  parseSandboxOrigin,
  setEngineSandboxMode,
} from '../../src/sandbox/engineSandboxSetting';

describe('engine sandbox protocol guards', () => {
  it('accepts allow-listed engine messages only', () => {
    expect(isAllowedEngineMessage({ type: 'ready' })).toBe(true);
    expect(isAllowedEngineMessage({ type: 'execute_result', callId: 'exec-1', mesh: null })).toBe(true);
    expect(isAllowedEngineMessage({ type: 'error', callId: null, message: 'x' })).toBe(true);
    expect(isAllowedEngineMessage({ type: 'evil' })).toBe(false);
    expect(isAllowedEngineMessage({ type: '__sandbox_status', coi: true, sab: true })).toBe(false);
    expect(isAllowedEngineMessage(null)).toBe(false);
    expect(isAllowedEngineMessage('ready')).toBe(false);
    expect(isAllowedEngineMessage(['ready'])).toBe(false);
    expect(isAllowedEngineMessage({ type: 'execute_result', callId: 42 })).toBe(false);
    expect(isAllowedEngineMessage({ type: 'execute_result', callId: 'x'.repeat(65) })).toBe(false);
  });

  it('covers every Worker → main type engine.ts handles', () => {
    // Keep in sync with the protocol header in src/geometry/engineWorker.ts.
    for (const t of ['ready', 'execute_preview', 'execute_result', 'validate_result', 'detect_includes_result',
      'exportSTEP_result', 'importSTEPToBrep_result', 'importSTEPToMesh_result', 'clearBrepImports_result',
      'clearBrepShape_result', 'simplify_progress', 'simplify_result', 'enhance_progress', 'enhance_result', 'error']) {
      expect(ENGINE_WORKER_MESSAGE_TYPES.has(t), t).toBe(true);
    }
  });

  it('validates frame → app messages', () => {
    expect(parseFrameMessage({ type: 'frame_ready', coi: true, sab: true })).toEqual({ type: 'frame_ready', coi: true, sab: true });
    expect(parseFrameMessage({ type: 'frame_ready', coi: 'yes', sab: true })).toBeNull();
    expect(parseFrameMessage({ type: 'worker_error', id: 'w1', message: 'boom' })).toEqual({ type: 'worker_error', id: 'w1', message: 'boom' });
    expect(parseFrameMessage({ type: 'worker_error', id: 'w1', message: 7 })?.message).toBe('Sandbox worker error');
    expect(parseFrameMessage({ type: 'spawn_failed', id: '' })).toBeNull();
    expect(parseFrameMessage({ type: 'execute_result' })).toBeNull();
    expect(parseFrameMessage(undefined)).toBeNull();
  });

  it('validates the Worker status handshake', () => {
    expect(parseWorkerStatus({ type: '__sandbox_status', coi: true, sab: false })).toEqual({ type: '__sandbox_status', coi: true, sab: false });
    expect(parseWorkerStatus({ type: '__sandbox_status', coi: 1, sab: true })).toBeNull();
    expect(parseWorkerStatus({ type: 'ready' })).toBeNull();
  });

  it('validates app → frame messages', () => {
    expect(parseParentMessage({ type: 'spawn', id: 'w1' })).toEqual({ type: 'spawn', id: 'w1' });
    expect(parseParentMessage({ type: 'terminate', id: 'w1' })).toEqual({ type: 'terminate', id: 'w1' });
    expect(parseParentMessage({ type: 'eval', id: 'w1' })).toBeNull();
    expect(parseParentMessage({ type: 'spawn' })).toBeNull();
  });
});

describe('engine sandbox setting', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('parses sandbox origins', () => {
    expect(parseSandboxOrigin('https://sandbox.example.com/some/path')).toBe('https://sandbox.example.com');
    expect(parseSandboxOrigin('http://localhost:5203')).toBe('http://localhost:5203');
    expect(parseSandboxOrigin('javascript:alert(1)')).toBeNull();
    expect(parseSandboxOrigin('not a url')).toBeNull();
    expect(parseSandboxOrigin('')).toBeNull();
    expect(parseSandboxOrigin(undefined)).toBeNull();
  });

  it('round-trips the per-browser mode and defaults to off', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
    });
    expect(getEngineSandboxMode()).toBe('off');
    setEngineSandboxMode('opaque');
    expect(getEngineSandboxMode()).toBe('opaque');
    store.set('partwright-engine-sandbox', 'bogus');
    expect(getEngineSandboxMode()).toBe('off');
    setEngineSandboxMode('off');
    expect(store.size).toBe(0); // the default clears the override
    expect(isEngineSandboxMode('origin')).toBe(true);
    expect(isEngineSandboxMode('none')).toBe(false);
  });

  it('survives blocked storage', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
      removeItem: () => { throw new Error('blocked'); },
    });
    expect(getEngineSandboxMode()).toBe('off');
    expect(() => setEngineSandboxMode('opaque')).not.toThrow();
  });
});
