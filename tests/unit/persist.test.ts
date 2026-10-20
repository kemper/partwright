// Unit tests for the persistent-storage request helper (src/storage/persist.ts).
// Node 22 exposes a real `navigator` global that `Object.defineProperty` can
// override, so this stubs the Storage API the same way the browser tests did
// — no browser needed. Moved out of tests/persist.spec.ts, which used to pay
// a ~2s page boot per test just to reach these assertions.
//
// Each test relies on a fresh module import (vi.resetModules() +
// dynamic import) so the module-level `granted`/`inFlight` singletons in
// persist.ts reset between tests — don't consolidate into one shared import,
// or the cached grant leaks across tests.

import { afterEach, describe, expect, test, vi } from 'vitest';

// Each test overrides navigator.storage; put the original descriptor back so
// nothing leaks past this file even if vitest's isolation settings change.
const originalStorage = Object.getOwnPropertyDescriptor(navigator, 'storage');

afterEach(() => {
  vi.resetModules();
  if (originalStorage) Object.defineProperty(navigator, 'storage', originalStorage);
  else delete (navigator as { storage?: unknown }).storage;
});

describe('Persistent storage', () => {
  test('requestPersistentStorage calls persist() and is idempotent once granted', async () => {
    let persistCalls = 0;
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: {
        persisted: async () => false,
        persist: async () => { persistCalls++; return true; },
      },
    });
    const mod = await import('../../src/storage/persist');
    const first = await mod.requestPersistentStorage();
    // Second call should short-circuit on the cached grant, not re-request.
    const second = await mod.requestPersistentStorage();

    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(persistCalls).toBe(1);
  });

  test('an already-persisted origin never re-requests', async () => {
    let persistCalls = 0;
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: {
        persisted: async () => true,
        persist: async () => { persistCalls++; return true; },
      },
    });
    const mod = await import('../../src/storage/persist');
    const granted = await mod.requestPersistentStorage();

    expect(granted).toBe(true);
    expect(persistCalls).toBe(0);
  });

  test('a denied request is not cached — a later call can still succeed', async () => {
    let allow = false;
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: {
        persisted: async () => false,
        persist: async () => allow,
      },
    });
    const mod = await import('../../src/storage/persist');
    const denied = await mod.requestPersistentStorage();
    allow = true; // engagement improved (e.g. user saved a key)
    const granted = await mod.requestPersistentStorage();

    expect(denied).toBe(false);
    expect(granted).toBe(true);
  });

  test('soft-fails when the Storage API is unavailable', async () => {
    Object.defineProperty(navigator, 'storage', { configurable: true, value: undefined });
    const mod = await import('../../src/storage/persist');
    const result = await mod.requestPersistentStorage();

    expect(result).toBe(false);
  });
});
