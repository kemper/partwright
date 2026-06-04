// Unit tests for the fatal-WASM-fault classifier. The module is intentionally
// dependency-free (pure string matching) so it runs in the fast Node tier and
// can be shared by the main-thread engine client and the sandbox engine.

import { describe, test, expect } from 'vitest';
import { isFatalWasmFault, isWasmMemoryFault, wasmFaultHint } from '../../src/geometry/workerFaults';

describe('isFatalWasmFault', () => {
  test('flags the manifold-3d OOM trap', () => {
    // The exact message from the chain-at-100-links session.
    expect(isFatalWasmFault('memory access out of bounds')).toBe(true);
  });

  test('flags other Emscripten heap/abort traps', () => {
    expect(isFatalWasmFault('Cannot enlarge memory arrays')).toBe(true);
    expect(isFatalWasmFault('out of memory')).toBe(true);
    expect(isFatalWasmFault('table index is out of bounds')).toBe(true);
    expect(isFatalWasmFault('null function or function signature mismatch')).toBe(true);
    expect(isFatalWasmFault('unreachable')).toBe(true);
    expect(isFatalWasmFault('Aborted(OOM)')).toBe(true);
  });

  test('is case-insensitive', () => {
    expect(isFatalWasmFault('Memory Access Out Of Bounds')).toBe(true);
  });

  test('does NOT flag ordinary user errors that leave the kernel healthy', () => {
    expect(isFatalWasmFault('Code must return a Manifold object.')).toBe(false);
    expect(isFatalWasmFault('function _Cylinder called with 2 arguments, expected 3')).toBe(false);
    expect(isFatalWasmFault('Missing field: "x"')).toBe(false);
    expect(isFatalWasmFault('sweep requires a path with at least 2 points')).toBe(false);
    expect(isFatalWasmFault('')).toBe(false);
    expect(isFatalWasmFault(null)).toBe(false);
    expect(isFatalWasmFault(undefined)).toBe(false);
  });
});

describe('isWasmMemoryFault', () => {
  test('distinguishes memory exhaustion from a generic abort', () => {
    expect(isWasmMemoryFault('memory access out of bounds')).toBe(true);
    expect(isWasmMemoryFault('out of memory')).toBe(true);
    // A bare `unreachable` abort is fatal but not specifically a memory fault.
    expect(isWasmMemoryFault('unreachable')).toBe(false);
    expect(isWasmMemoryFault('Code must return a Manifold object.')).toBe(false);
  });
});

describe('wasmFaultHint', () => {
  test('memory faults get the "reduce complexity" mitigation', () => {
    const hint = wasmFaultHint('memory access out of bounds');
    expect(hint).toBeDefined();
    expect(hint).toMatch(/ran out of memory/i);
    expect(hint).toMatch(/circular-segment|fewer parts|simplif/i);
  });

  test('non-memory fatal faults get the generic reset hint', () => {
    const hint = wasmFaultHint('unreachable');
    expect(hint).toBeDefined();
    expect(hint).toMatch(/reset/i);
  });

  test('returns undefined for ordinary user errors', () => {
    expect(wasmFaultHint('Code must return a Manifold object.')).toBeUndefined();
    expect(wasmFaultHint(null)).toBeUndefined();
  });
});
