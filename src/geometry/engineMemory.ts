// Engine WASM heap reporting helpers.
//
// "memory access out of bounds" is what a user sees when the manifold-3d kernel
// can't grow its heap any further. The nominal ceiling is the 32-bit WASM limit,
// but in practice a grow can fail well below it (the browser must hand back a
// single *contiguous* ArrayBuffer, which address-space fragmentation or per-tab
// limits can block at ~1–2 GB). Surfacing the heap high-water mark in the
// diagnostics therefore answers the real question — "did I actually hit the
// ceiling, or fail far below it?" — instead of leaving users to guess.

/** Hard ceiling of a 32-bit WASM linear memory, matching manifold-3d's compiled
 *  `getHeapMax()` (`4294901760` = 4 GiB − one 64 KiB page). The kernel's heap
 *  grows up to here and no further; a 32-bit address space cannot address more.
 *  A structural constant (the wasm32 limit), not a tunable knob. */
export const WASM_HEAP_MAX_BYTES = 4294901760;

const BYTES_PER_MB = 1024 * 1024;

/** Human-readable heap usage, e.g. `"1850 MB / 4096 MB (45%)"`. The percentage
 *  is of the 4 GiB wasm32 ceiling, so a fault at a low percentage is the signal
 *  that the grow failed on fragmentation rather than truly exhausting 4 GB. */
export function formatEngineMemory(bytes: number): string {
  const mb = Math.round(bytes / BYTES_PER_MB);
  const maxMb = Math.round(WASM_HEAP_MAX_BYTES / BYTES_PER_MB);
  const pct = Math.round((bytes / WASM_HEAP_MAX_BYTES) * 100);
  return `${mb} MB / ${maxMb} MB (${pct}%)`;
}
