// Unit tests for the engine WASM heap formatting helpers. Pure logic → fast
// Node tier.

import { describe, test, expect } from 'vitest';
import {
  WASM_HEAP_MAX_BYTES,
  formatEngineMemory,
  engineHeapPercent,
  isEngineHeapHigh,
  engineHeapWarning,
} from '../../src/geometry/engineMemory';

const MB = 1024 * 1024;

describe('WASM_HEAP_MAX_BYTES', () => {
  test('matches manifold-3d\'s compiled getHeapMax() (4 GiB − 64 KiB page)', () => {
    expect(WASM_HEAP_MAX_BYTES).toBe(4294901760);
    // ~4096 MB.
    expect(Math.round(WASM_HEAP_MAX_BYTES / (1024 * 1024))).toBe(4096);
  });
});

describe('formatEngineMemory', () => {
  test('reports MB used, the ceiling, and a percentage', () => {
    expect(formatEngineMemory(1850 * 1024 * 1024)).toBe('1850 MB / 4096 MB (45%)');
  });

  test('a fault far below the ceiling reads as a low percentage', () => {
    // The fragmentation case: only ~1.2 GB in use when the grow failed.
    const s = formatEngineMemory(1200 * 1024 * 1024);
    expect(s).toMatch(/^1200 MB \/ 4096 MB \(29%\)$/);
  });

  test('the boot heap (16 MB) is ~0%', () => {
    expect(formatEngineMemory(16 * 1024 * 1024)).toBe('16 MB / 4096 MB (0%)');
  });

  test('full ceiling reads as 100%', () => {
    expect(formatEngineMemory(WASM_HEAP_MAX_BYTES)).toBe('4096 MB / 4096 MB (100%)');
  });
});

describe('engineHeapPercent', () => {
  test('is the unrounded share of the ceiling', () => {
    expect(engineHeapPercent(WASM_HEAP_MAX_BYTES)).toBe(100);
    expect(engineHeapPercent(WASM_HEAP_MAX_BYTES / 2)).toBe(50);
  });
});

describe('isEngineHeapHigh', () => {
  test('fires at or above the threshold', () => {
    expect(isEngineHeapHigh(WASM_HEAP_MAX_BYTES / 2, 50)).toBe(true);
    expect(isEngineHeapHigh(2100 * MB, 50)).toBe(true);
    expect(isEngineHeapHigh(1900 * MB, 50)).toBe(false);
  });

  test('an ordinary run (boot heap) is not high', () => {
    expect(isEngineHeapHigh(16 * MB, 50)).toBe(false);
  });

  test('unmeasured heap (non-manifold-js engine) never fires', () => {
    expect(isEngineHeapHigh(undefined, 10)).toBe(false);
  });

  test('a threshold of 100 or more disables it, even at the ceiling', () => {
    expect(isEngineHeapHigh(WASM_HEAP_MAX_BYTES, 100)).toBe(false);
    expect(isEngineHeapHigh(WASM_HEAP_MAX_BYTES, 150)).toBe(false);
  });

  test('a threshold of 0 fires for any measured heap', () => {
    expect(isEngineHeapHigh(16 * MB, 0)).toBe(true);
  });
});

describe('engineHeapWarning', () => {
  test('names the heap reading and the cheap fixes', () => {
    const w = engineHeapWarning(2400 * MB, 50);
    expect(w).toBeDefined();
    expect(w).toContain('2400 MB / 4096 MB (59%)');
    expect(w).toMatch(/memory access out of bounds/);
    expect(w).toMatch(/Manifold\.compose/);
    expect(w).toMatch(/segment count/);
  });

  test('is undefined below the threshold, when unmeasured, or when disabled', () => {
    expect(engineHeapWarning(100 * MB, 50)).toBeUndefined();
    expect(engineHeapWarning(undefined, 50)).toBeUndefined();
    expect(engineHeapWarning(WASM_HEAP_MAX_BYTES, 100)).toBeUndefined();
  });
});
