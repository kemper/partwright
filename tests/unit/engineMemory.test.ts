// Unit tests for the engine WASM heap formatting helpers. Pure logic → fast
// Node tier.

import { describe, test, expect } from 'vitest';
import { WASM_HEAP_MAX_BYTES, formatEngineMemory } from '../../src/geometry/engineMemory';

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
