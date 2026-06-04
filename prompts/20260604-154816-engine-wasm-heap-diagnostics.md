---
session: "ecstatic-sagan"
timestamp: "2026-06-04T15:48:16Z"
model: claude-opus-4-8
tools: [Bash, Read, Edit, Write, Playwright]
sequence: 3
---

## Human

Dubious that the chain actually reached 4 GB of memory. Could I track the
real WASM heap usage via the diagnostics menu somehow?

## Assistant

## Key decisions

**Context** — the doubt is well-founded: "memory access out of bounds" often
trips *below* 4 GB because growing the heap needs a single contiguous
ArrayBuffer, which fragmentation / per-tab limits can block at ~1–2 GB. So
showing the actual heap high-water mark is genuinely informative.

**Feasibility** — confirmed the prebuilt manifold-3d@3.3.2 exposes `Module["HEAPU8"]`,
so the worker can read `HEAPU8.byteLength` (the grown heap size; WASM memory
never shrinks, so post-run it's the high-water mark).

**Implementation** — report the manifold-js heap high-water in the diagnostics:
- `src/geometry/engineMemory.ts` (new, pure → unit tier): `WASM_HEAP_MAX_BYTES`
  (= manifold's compiled `getHeapMax()`, 4 GiB − 64 KiB) and `formatEngineMemory`
  → e.g. `"1850 MB / 4096 MB (45%)"`. The percentage of the 4 GB ceiling is the
  tell — a low % at fault time means a fragmentation failure, not true exhaustion.
- `engineWorker.ts`: read the manifold heap after each manifold-js run (only —
  other engines own separate heaps) and post `engineHeapBytes` on both the
  success and error `execute_result`.
- `engine.ts` / `types.ts`: thread `engineHeapBytes` through `MeshResult`.
- `main.ts`: surface it in the **Data panel** for every run (via
  `withSessionContext` → `engineMemory`) so users can watch it climb, in the
  **engine-error diagnostic-log detail** (so an OOM shows how far memory really
  grew), and in `executeIsolated` stats (so the AI agent's `runIsolated` sees it
  too). Mutated the `Record<string,unknown>` stats rather than spreading it —
  spreading drops the index signature and broke `.status` access downstream.

**Verification** — browser-checked end to end: heap reads 16 MB at boot, climbs
to 144 MB after a multi-sphere union, and the fault path carries the high-water
too. Unit test for the formatter/constant; the e2e recovery spec now also asserts
the `"N MB / 4096 MB (P%)"` readout on both a normal run and the fault.
