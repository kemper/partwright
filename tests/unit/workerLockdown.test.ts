import { describe, it, expect } from 'vitest';
import {
  lockdownGlobalScope,
  verifyLockdown,
  toAppAssetPath,
  LOCKDOWN_GLOBALS,
  NAVIGATOR_PROPS,
} from '../../src/geometry/workerLockdown';

// A fake Worker global with the same shape as Chromium's: a few members on the
// instance ([Global] interfaces), more on WorkerGlobalScope.prototype, an
// EventTarget base, and a navigator whose storage accessors live on its
// prototype. Every function is a sentinel so "still reachable" is observable.
function fakeWorkerGlobal() {
  const sentinel = (name: string) => Object.assign(function () { return name; }, { sentinel: name });
  const eventTargetProto = { addEventListener: sentinel('addEventListener') };
  const navProto = Object.create(Object.prototype, {
    storage: { get: () => ({ getDirectory: sentinel('getDirectory') }), configurable: true, enumerable: true },
    locks: { get: () => ({ request: sentinel('request') }), configurable: true, enumerable: true },
    serviceWorker: { get: () => ({ register: sentinel('register') }), configurable: true, enumerable: true },
    hardwareConcurrency: { get: () => 8, configurable: true, enumerable: true },
  });
  const nav = Object.create(navProto);
  const wgsProto = Object.create(eventTargetProto, {
    constructor: { value: function WorkerGlobalScope() {}, configurable: true, writable: true },
    fetch: { value: sentinel('fetch'), configurable: true, writable: true },
    indexedDB: { get: () => ({ open: sentinel('open') }), configurable: true },
    caches: { get: () => ({ open: sentinel('cachesOpen') }), configurable: true },
    importScripts: { value: sentinel('importScripts'), configurable: true, writable: true },
    navigator: { get: () => nav, configurable: true },
    fonts: { get: () => ({ add: sentinel('fonts.add') }), configurable: true },
  });
  let handler: unknown = null;
  const dedicatedProto = Object.create(wgsProto, {
    constructor: { value: function DedicatedWorkerGlobalScope() {}, configurable: true, writable: true },
    postMessage: { value: sentinel('postMessage'), configurable: true, writable: true },
    onmessage: { get: () => handler, set: (v) => { handler = v; }, configurable: true },
    close: { value: sentinel('close'), configurable: true, writable: true },
  });
  const g = Object.create(dedicatedProto) as Record<string, unknown>;
  for (const name of ['XMLHttpRequest', 'WebSocket', 'EventSource', 'WebTransport', 'Worker', 'SharedWorker', 'BroadcastChannel', 'IDBFactory', 'FontFace']) {
    Object.defineProperty(g, name, { value: sentinel(name), configurable: true, writable: true });
  }
  g.onmessage = sentinel('handler');
  return { g, nav, wgsProto, dedicatedProto };
}

function anyOnChain(root: object, name: string): unknown {
  for (let o: object | null = root; o; o = Object.getPrototypeOf(o)) {
    const d = Object.getOwnPropertyDescriptor(o, name);
    if (!d) continue;
    const v = 'value' in d ? d.value : d.get?.call(root);
    if (v !== undefined) return v;
  }
  return undefined;
}

describe('lockdownGlobalScope', () => {
  it('removes network/storage globals from the instance and every prototype', () => {
    const { g, wgsProto, dedicatedProto } = fakeWorkerGlobal();
    expect(verifyLockdown(g).length).toBeGreaterThan(0);
    const report = lockdownGlobalScope(g);
    expect(report.stillReachable).toEqual([]);

    for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'WebTransport', 'indexedDB', 'IDBFactory', 'caches', 'Worker', 'SharedWorker', 'BroadcastChannel', 'FontFace', 'fonts']) {
      expect(g[name], name).toBeUndefined();
      expect(anyOnChain(g, name), `${name} via chain`).toBeUndefined();
      expect((Object.getPrototypeOf(g) as Record<string, unknown>)[name], `${name} via proto`).toBeUndefined();
      expect(((g.constructor as { prototype?: Record<string, unknown> } | undefined)?.prototype ?? {})[name]).toBeUndefined();
    }
    expect(Object.getOwnPropertyDescriptor(wgsProto, 'fetch')).toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(wgsProto, 'indexedDB')).toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(dedicatedProto, 'close')).toBeUndefined();
    expect(report.removed).toContain('WorkerGlobalScope.prototype.fetch');
  });

  it('pins removed names so model code cannot re-add them', () => {
    const { g } = fakeWorkerGlobal();
    lockdownGlobalScope(g);
    expect(() => { 'use strict'; g.fetch = () => 'evil'; }).toThrow(TypeError);
    expect(() => Object.defineProperty(g, 'indexedDB', { value: {} })).toThrow(TypeError);
    expect(() => { delete g.fetch; }).toThrow(TypeError);
    expect(g.fetch).toBeUndefined();
    // Re-adding on a prototype is shadowed by the pinned own `undefined`.
    (Object.getPrototypeOf(g) as Record<string, unknown>).fetch = () => 'evil';
    expect(g.fetch).toBeUndefined();
  });

  it('scrubs navigator storage/locks/serviceWorker but keeps harmless members', () => {
    const { g, nav } = fakeWorkerGlobal();
    lockdownGlobalScope(g);
    for (const name of ['storage', 'locks', 'serviceWorker']) {
      expect((nav as Record<string, unknown>)[name], name).toBeUndefined();
      expect(anyOnChain(nav, name)).toBeUndefined();
    }
    expect((nav as { hardwareConcurrency: number }).hardwareConcurrency).toBe(8);
    expect(NAVIGATOR_PROPS).toContain('storage');
  });

  it('keeps importScripts a frozen, throwing function (Emscripten env detection)', () => {
    const { g } = fakeWorkerGlobal();
    lockdownGlobalScope(g);
    expect(typeof g.importScripts).toBe('function');
    expect(Object.isFrozen(g.importScripts)).toBe(true);
    expect(() => (g.importScripts as () => void)()).toThrow(/disabled/);
    expect(() => (g.close as () => void)()).toThrow(/disabled/);
  });

  it('pins the message channel so it cannot be hijacked', () => {
    const { g } = fakeWorkerGlobal();
    const original = g.onmessage;
    lockdownGlobalScope(g);
    expect(g.onmessage).toBe(original);
    expect(() => { g.onmessage = () => 'hijack'; }).toThrow(TypeError);
    expect(() => { g.postMessage = () => 'hijack'; }).toThrow(TypeError);
    expect(typeof g.postMessage).toBe('function');
  });

  it('is idempotent', () => {
    const { g } = fakeWorkerGlobal();
    lockdownGlobalScope(g);
    const again = lockdownGlobalScope(g);
    expect(again.removed).toEqual([]);
    expect(again.stillReachable).toEqual([]);
  });

  it('fails closed when a binding cannot be removed', () => {
    const { g, wgsProto } = fakeWorkerGlobal();
    Object.defineProperty(wgsProto, 'WebSocketStream', { value: function WebSocketStream() {}, configurable: false, writable: false });
    const report = lockdownGlobalScope(g);
    expect(report.stillReachable).toContain('WebSocketStream');
  });

  it('covers the names called out in #1090', () => {
    for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'WebSocketStream', 'EventSource', 'WebTransport', 'indexedDB', 'caches', 'CacheStorage', 'Worker', 'SharedWorker', 'BroadcastChannel']) {
      expect(LOCKDOWN_GLOBALS).toContain(name);
    }
    expect(NAVIGATOR_PROPS).toEqual(expect.arrayContaining(['storage', 'locks']));
  });
});

describe('toAppAssetPath', () => {
  const origin = 'https://app.example';
  it('accepts same-origin paths and absolute same-origin URLs', () => {
    expect(toAppAssetPath('/openscad-libs/BOSL2/_manifest.json', origin)).toBe('/openscad-libs/BOSL2/_manifest.json');
    expect(toAppAssetPath('/assets/replicad_single-AbC123.wasm', origin)).toBe('/assets/replicad_single-AbC123.wasm');
    expect(toAppAssetPath('/@fs/home/u/node_modules/x/y.wasm?v=1', origin)).toBe('/@fs/home/u/node_modules/x/y.wasm?v=1');
    expect(toAppAssetPath('https://app.example/v1/assets/x.wasm', origin)).toBe('/v1/assets/x.wasm');
  });
  it('rejects anything that could leave the origin', () => {
    for (const bad of [
      'https://evil.example/x', 'http://app.example/x', 'https://app.example.evil.example/x',
      '//evil.example/x', '/\\evil.example/x', '/\t/evil.example', '/\n/evil.example', ' /x',
      'evil.example/x', 'data:text/plain,hi', 'blob:https://app.example/1', '/x#frag', '/a b', '',
      '/', 'https://app.example', 'javascript:alert(1)',
    ]) {
      expect(toAppAssetPath(bad, origin), JSON.stringify(bad)).toBeNull();
    }
    expect(toAppAssetPath({ toString: () => '/x' }, origin)).toBeNull();
    expect(toAppAssetPath(42, origin)).toBeNull();
  });
  it('without a known origin only accepts plain paths', () => {
    expect(toAppAssetPath('/fonts/a.ttf', null)).toBe('/fonts/a.ttf');
    expect(toAppAssetPath('https://app.example/fonts/a.ttf', null)).toBeNull();
  });
});
