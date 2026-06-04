// Classification of fatal WASM-kernel faults.
//
// The geometry engines run inside a long-lived Web Worker that owns a single
// manifold-3d (and, lazily, OpenSCAD / OpenCASCADE) WASM instance. WebAssembly
// linear memory only ever *grows* — it is never returned to the OS — so a heavy
// run can push the heap to its ceiling. When a later allocation or access then
// traps, the kernel raises a `WebAssembly.RuntimeError` such as
// "memory access out of bounds". Critically, such a trap can leave the module's
// C++ state half-mutated: every *subsequent* call into the same instance can
// fault instantly (we have seen ~1 ms "executionTimeMs" failures), so the only
// reliable recovery is to discard the Worker and boot a fresh module.
//
// This module is intentionally dependency-free (pure string matching) so it can
// be imported from both the main-thread engine client and the sandbox engine,
// and exercised in the fast unit tier.

/** Substrings that mark a WASM trap which poisons the kernel instance. Matched
 *  case-insensitively against an error message. These are emitted by Emscripten
 *  builds (manifold-3d / OpenSCAD / OpenCASCADE) when memory is exhausted or the
 *  module aborts; once seen, the Worker must be recycled rather than reused. */
const FATAL_WASM_PATTERNS: readonly string[] = [
  'memory access out of bounds',
  'out of bounds memory access',
  'cannot enlarge memory',
  'out of memory',
  'table index is out of bounds',
  'null function or function signature mismatch',
  'unreachable', // wasm `unreachable` trap (Emscripten abort)
  'aborted',
  'runtimeerror',
];

/** True when `message` indicates a WASM trap that corrupts the kernel instance,
 *  meaning the owning Worker should be recycled so the next run starts clean. */
export function isFatalWasmFault(message: string | null | undefined): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return FATAL_WASM_PATTERNS.some((p) => m.includes(p));
}

/** Whether the fault is specifically a memory-exhaustion trap (vs. a generic
 *  abort), so callers can offer the "reduce complexity" mitigation. */
export function isWasmMemoryFault(message: string | null | undefined): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return (
    m.includes('memory access out of bounds') ||
    m.includes('out of bounds memory access') ||
    m.includes('cannot enlarge memory') ||
    m.includes('out of memory')
  );
}

/** Actionable hint for a fatal WASM fault, or undefined if the message isn't
 *  one. Surfaced to the user in place of the raw, opaque trap text. */
export function wasmFaultHint(message: string | null | undefined): string | undefined {
  if (isWasmMemoryFault(message)) {
    return (
      'The geometry kernel ran out of memory. This model is too large or complex for the ' +
      'available WebAssembly heap — try fewer parts/links, a lower circular-segment quality ' +
      '(Quality setting / setCircularSegments), or simplifying the geometry. The engine is ' +
      'reset automatically, so your next run starts from a clean state.'
    );
  }
  if (isFatalWasmFault(message)) {
    return (
      'The geometry kernel hit a fatal WASM error and has been reset. This is usually caused by ' +
      'degenerate geometry, a self-intersection, or an invalid boolean — try simplifying the ' +
      'operation or checking input dimensions. Your next run starts from a clean state.'
    );
  }
  return undefined;
}
