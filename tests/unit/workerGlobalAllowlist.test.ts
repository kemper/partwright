import { describe, it, expect } from 'vitest';
import {
  planAllowlistAudit,
  isInertDescriptor,
  symbolLabel,
  ALLOWED_GLOBAL,
  ALLOWED_NAVIGATOR,
  GLOBAL_ALLOWLIST,
  NAVIGATOR_ALLOWLIST,
  type ChainEntry,
} from '../../src/geometry/workerGlobalAllowlist';
import { LOCKDOWN_GLOBALS, NAVIGATOR_PROPS } from '../../src/geometry/workerLockdown';

const entry = (owner: string, label: string, inert = false): ChainEntry => ({ owner, label, symbol: false, inert });
const symEntry = (owner: string, sym: symbol): ChainEntry => ({ owner, label: symbolLabel(sym), symbol: true, inert: false });

describe('planAllowlistAudit', () => {
  it('removes present, non-allowlisted names and keeps allowlisted ones', () => {
    const plan = planAllowlistAudit([
      entry('self', 'Math'),
      entry('WorkerGlobalScope.prototype', 'setTimeout'),
      entry('self', 'OffscreenCanvas'),
      entry('WorkerGlobalScope.prototype', 'createImageBitmap'),
      entry('self', 'MessageChannel'),
    ], ALLOWED_GLOBAL);
    expect(plan.remove).toEqual(['MessageChannel', 'OffscreenCanvas', 'createImageBitmap']);
    expect(plan.offending.map((e) => `${e.owner}.${e.label}`)).toEqual([
      'self.OffscreenCanvas', 'WorkerGlobalScope.prototype.createImageBitmap', 'self.MessageChannel',
    ]);
  });

  it('accepts inert entries for any name (pinned undefined, WebIDL constants)', () => {
    const plan = planAllowlistAudit([
      entry('self', 'fetch', true),
      entry('DedicatedWorkerGlobalScope.prototype', 'TEMPORARY', true),
      entry('self', 'SomeFutureStorageApi'),
    ], ALLOWED_GLOBAL);
    expect(plan.remove).toEqual(['SomeFutureStorageApi']);
  });

  it('reports a name once even when several prototypes hold it', () => {
    const plan = planAllowlistAudit([
      entry('self', 'NewThing'),
      entry('WorkerGlobalScope.prototype', 'NewThing'),
    ], ALLOWED_GLOBAL);
    expect(plan.remove).toEqual(['NewThing']);
    expect(plan.offending).toHaveLength(2);
  });

  it('handles symbol labels: brand tags pass, unknown symbols are removed', () => {
    expect(symbolLabel(Symbol.toStringTag)).toBe('@@toStringTag');
    expect(symbolLabel(Symbol.for('x'))).toBe('@@for(x)');
    expect(symbolLabel(Symbol('toStringTag'))).toBe('@@unique(toStringTag)');
    const plan = planAllowlistAudit([
      symEntry('WorkerGlobalScope.prototype', Symbol.toStringTag),
      symEntry('self', Symbol('Symbol.toStringTag')),
      symEntry('self', Symbol.for('x')),
    ], ALLOWED_GLOBAL);
    expect(plan.remove).toEqual(['@@for(x)', '@@unique(Symbol.toStringTag)']);
  });

  it('keeps string and symbol labels in separate namespaces', () => {
    // A string key spelled like an allowed symbol label is not allowed, and a
    // symbol whose label reads like an allowed string name is not either.
    const plan = planAllowlistAudit([
      entry('self', '@@toStringTag'),
      { owner: 'self', label: 'setTimeout', symbol: true, inert: false },
      entry('self', 'setTimeout'),
      symEntry('self', Symbol.toStringTag),
    ], ALLOWED_GLOBAL);
    expect(plan.offending.map((e) => `${e.symbol ? 'sym' : 'str'}:${e.label}`)).toEqual(['str:@@toStringTag', 'sym:setTimeout']);
  });

  it('applies the navigator allowlist separately', () => {
    const plan = planAllowlistAudit([
      entry('WorkerNavigator.prototype', 'hardwareConcurrency'),
      entry('WorkerNavigator.prototype', 'userAgent'),
      entry('WorkerNavigator.prototype', 'gpu'),
      entry('WorkerNavigator.prototype', 'permissions'),
      entry('WorkerNavigator.prototype', 'storage', true),
    ], ALLOWED_NAVIGATOR);
    expect(plan.remove).toEqual(['gpu', 'permissions']);
  });
});

describe('isInertDescriptor', () => {
  it('treats primitive data values as inert and objects/functions/accessors as not', () => {
    for (const value of [undefined, null, 0, 1, 'x', true, 1n, Symbol('s')]) {
      expect(isInertDescriptor({ value, writable: false, configurable: false }), String(value)).toBe(true);
    }
    expect(isInertDescriptor({ value: {}, writable: true })).toBe(false);
    expect(isInertDescriptor({ value: () => 1, writable: true })).toBe(false);
    expect(isInertDescriptor({ get: () => undefined, configurable: true })).toBe(false);
  });
});

describe('allowlist contents', () => {
  it('never allowlists a denylisted capability (inert pins cover those)', () => {
    for (const name of LOCKDOWN_GLOBALS) expect(ALLOWED_GLOBAL.names.has(name), name).toBe(false);
    for (const name of NAVIGATOR_PROPS) expect(ALLOWED_NAVIGATOR.names.has(name), name).toBe(false);
  });

  it('keeps what model code and the engines rely on', () => {
    for (const name of ['WebAssembly', 'TextDecoder', 'TextEncoder', 'performance', 'setTimeout', 'clearTimeout',
      'queueMicrotask', 'structuredClone', 'crypto', 'console', 'Blob', 'URL', 'location', 'navigator',
      'WorkerGlobalScope', 'importScripts', 'onmessage', 'postMessage', 'SharedArrayBuffer', 'Atomics']) {
      expect(ALLOWED_GLOBAL.names.has(name), name).toBe(true);
    }
    expect(ALLOWED_NAVIGATOR.names.has('hardwareConcurrency')).toBe(true);
  });

  it('gives every group a justification and no duplicate names across groups', () => {
    for (const groups of [GLOBAL_ALLOWLIST, NAVIGATOR_ALLOWLIST]) {
      const seen = new Map<string, string>();
      for (const [key, group] of Object.entries(groups)) {
        expect(group.why.length, key).toBeGreaterThan(10);
        expect(group.names.length + (group.symbols?.length ?? 0), key).toBeGreaterThan(0);
        for (const s of group.symbols ?? []) expect(s, key).toMatch(/^@@/);
        for (const n of group.names) {
          // objectPrototype is shared by both chains on purpose.
          expect(seen.get(n), `${n} listed in both ${seen.get(n)} and ${key}`).toBeUndefined();
          seen.set(n, key);
        }
      }
    }
  });
});
