import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  STATUS_MESSAGE_TYPE as APP_STATUS_TYPE,
  isAllowedEngineMessage,
  parseFrameMessage,
  parseWorkerStatus,
} from '../../src/sandbox/protocol';
import {
  STATUS_MESSAGE_TYPE as FRAME_STATUS_TYPE,
  allowedParentOrigins,
  parseParentMessage,
} from '../../src/sandbox/frameProtocol';
import { ENGINE_WORKER_MESSAGE_TYPES } from '../../src/geometry/workerMessageValidation';
import {
  getEngineSandboxMode,
  isEngineSandboxMode,
  isRemovedEngineSandboxMode,
  originModeAvailable,
  parseSandboxOrigin,
  resolveDefaultEngineSandboxMode,
  resolveEngineSandboxMode,
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

  it('allow-lists exactly the message types engineWorker.ts posts', () => {
    // Every `type: '…'` literal the engine Worker posts back to the main
    // thread must be on the shared allow-list, and the list must not carry
    // types the Worker never sends. (Main → Worker types are only *read* there,
    // via `msg.type === '…'`, so they don't match this pattern.)
    // Comments are stripped first: the file's protocol header lists both
    // directions as `{ type: '…' }` examples.
    const src = readFileSync(resolve(__dirname, '../../src/geometry/engineWorker.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    const posted = new Set([...src.matchAll(/\btype:\s*'([A-Za-z_]+)'/g)].map(m => m[1]));
    expect(posted.size).toBeGreaterThan(10);
    expect([...posted].sort()).toEqual([...ENGINE_WORKER_MESSAGE_TYPES].sort());
  });

  it('keeps the app and frame copies of the status type identical', () => {
    expect(APP_STATUS_TYPE).toBe(FRAME_STATUS_TYPE);
  });

  it('accepts parent messages only from the app origins', () => {
    expect([...allowedParentOrigins(undefined)]).toEqual([]);
    // Only the configured app origins — never the frame's own (sandbox) origin.
    expect([...allowedParentOrigins('https://www.example.com, https://example.com/x, junk')])
      .toEqual(['https://www.example.com', 'https://example.com']);
    expect(allowedParentOrigins('javascript:alert(1)').size).toBe(0);
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

  it('round-trips the per-browser mode and defaults to off without a sandbox host', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
    });
    // The unit tier has no VITE_SANDBOX_ORIGIN: the default is 'off'.
    expect(getEngineSandboxMode()).toBe('off');
    setEngineSandboxMode('origin');
    expect(getEngineSandboxMode()).toBe('origin');
    store.set('partwright-engine-sandbox', 'bogus');
    expect(getEngineSandboxMode()).toBe('off');
    setEngineSandboxMode('off');
    expect(store.size).toBe(0); // the default clears the override
    expect(isEngineSandboxMode('origin')).toBe(true);
    expect(isEngineSandboxMode('opaque')).toBe(false);
    expect(isEngineSandboxMode('none')).toBe(false);
  });

  it("migrates a saved 'opaque' choice: removed from storage, back to the default", () => {
    const store = new Map<string, string>([['partwright-engine-sandbox', 'opaque']]);
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
    });
    expect(isRemovedEngineSandboxMode('opaque')).toBe(true);
    expect(getEngineSandboxMode()).toBe('off');
    expect(store.has('partwright-engine-sandbox')).toBe(false);
  });

  it("defaults to 'origin' only when this page can use the configured sandbox host", () => {
    const base = { buildDefault: undefined, sandboxOrigin: 'https://sandbox.example.com', appOrigins: 'https://www.example.com,https://example.com', pageOrigin: 'https://www.example.com' };
    expect(resolveDefaultEngineSandboxMode(base)).toBe('origin');
    expect(resolveDefaultEngineSandboxMode({ ...base, pageOrigin: 'https://example.com' })).toBe('origin');
    // No / invalid sandbox origin, no app origins, a page the frame won't accept
    // (a preview deploy), or the sandbox host itself: off.
    expect(resolveDefaultEngineSandboxMode({ ...base, sandboxOrigin: undefined })).toBe('off');
    expect(resolveDefaultEngineSandboxMode({ ...base, sandboxOrigin: 'javascript:x' })).toBe('off');
    expect(resolveDefaultEngineSandboxMode({ ...base, appOrigins: undefined })).toBe('off');
    expect(resolveDefaultEngineSandboxMode({ ...base, pageOrigin: 'https://abc123.preview.example.dev' })).toBe('off');
    expect(resolveDefaultEngineSandboxMode({ ...base, sandboxOrigin: 'https://www.example.com' })).toBe('off');
    expect(resolveDefaultEngineSandboxMode({ ...base, pageOrigin: null })).toBe('off');
    // VITE_ENGINE_SANDBOX names the build default; 'opaque' there is ignored.
    expect(resolveDefaultEngineSandboxMode({ ...base, buildDefault: 'off' })).toBe('off');
    expect(resolveDefaultEngineSandboxMode({ ...base, buildDefault: 'opaque' })).toBe('origin');
    expect(originModeAvailable(base)).toBe(true);
    // An explicit stored choice wins (the kill switch); a removed one doesn't.
    expect(resolveEngineSandboxMode({ ...base, stored: 'off' })).toBe('off');
    expect(resolveEngineSandboxMode({ ...base, stored: 'opaque' })).toBe('origin');
    expect(resolveEngineSandboxMode({ ...base, stored: null })).toBe('origin');
  });

  it('survives blocked storage', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
      removeItem: () => { throw new Error('blocked'); },
    });
    expect(getEngineSandboxMode()).toBe('off');
    expect(() => setEngineSandboxMode('origin')).not.toThrow();
  });
});
