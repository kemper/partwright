// Console output from model code. Model code runs as `new Function(...)` in
// the engine Worker, so a plain `console.log` only reaches the Worker's
// DevTools console — an agent driving the app (console API, in-app AI) never
// sees it, and debugs by throwing JSON in an Error instead. The Worker runs
// each engine call inside `log.run(...)`, which points the console's methods at
// this run's capture for the duration of that SYNCHRONOUS call (model code
// only ever runs synchronously, so no other run can interleave) and restores
// them after. The captured lines ride back on the run result as
// `MeshResult.logs`; output still mirrors to the real console.
//
// The engines' own `new Function('api', …)` calls are deliberately left
// untouched: CodeQL reports each as a known, by-design "Code injection" alert,
// and changing those lines would mint new alerts (see the release skill).

import { getConfig } from '../config/appConfig';

export interface ModelLogLimits {
  /** Most lines kept per run; later lines are counted, not stored. */
  maxLines: number;
  /** Most characters kept per run, across all lines. */
  maxChars: number;
}

export interface ModelLog {
  /** Run `fn` with console output captured into this log. */
  run<T>(fn: () => T): T;
  /** Captured lines, or undefined when the run logged nothing. */
  lines(): string[] | undefined;
}

type Level = 'log' | 'info' | 'debug' | 'dir' | 'table' | 'warn' | 'error' | 'assert';
const LEVELS: readonly Level[] = ['log', 'info', 'debug', 'dir', 'table', 'warn', 'error', 'assert'];
const PREFIX: Partial<Record<Level, string>> = { warn: 'warn: ', error: 'error: ' };

/** A capture for one run. `limits` default to the app config (in a Worker
 *  that is the defaults, so the main thread passes its own on the message). */
export function createModelLog(limits?: ModelLogLimits): ModelLog {
  const cfg = getConfig().renderer;
  const { maxLines, maxChars } = limits ?? { maxLines: cfg.modelLogMaxLines, maxChars: cfg.modelLogMaxChars };
  const out: string[] = [];
  let chars = 0;
  let dropped = 0;

  const push = (prefix: string, args: unknown[]): void => {
    if (out.length >= maxLines || chars >= maxChars) { dropped++; return; }
    let line = prefix + args.map(a => formatValue(a)).join(' ');
    if (chars + line.length > maxChars) line = line.slice(0, Math.max(0, maxChars - chars)) + '…';
    chars += line.length;
    out.push(line);
  };

  return {
    run<T>(fn: () => T): T {
      const c = globalThis.console as unknown as Record<Level, (...args: unknown[]) => void>;
      const saved = LEVELS.map(k => [k, c[k]] as const);
      const originalError = c.error;
      for (const [k, original] of saved) {
        // A failed assert mirrors as an error itself: the real console.assert
        // may print through console.warn/error, which would capture it twice.
        c[k] = k === 'assert'
          ? (cond?: unknown, ...args: unknown[]) => {
              if (cond) return;
              push('assert: ', args.length > 0 ? args : ['Assertion failed']);
              originalError.call(globalThis.console, 'Assertion failed:', ...args);
            }
          : (...args: unknown[]) => {
              push(PREFIX[k] ?? '', args);
              original.apply(globalThis.console, args);
            };
      }
      try {
        return fn();
      } finally {
        for (const [k, original] of saved) c[k] = original;
      }
    },
    lines: () => {
      if (out.length === 0 && dropped === 0) return undefined;
      return dropped > 0 ? [...out, `… ${dropped} more log line${dropped === 1 ? '' : 's'} dropped (limit ${maxLines} lines / ${maxChars} characters per run)`] : [...out];
    },
  };
}

/** Attach a run's captured lines to its result (when there are any). */
export function withLogs<T extends object>(result: T, log: ModelLog): T & { logs?: string[] } {
  const lines = log.lines();
  return lines ? { ...result, logs: lines } : result;
}

/** One console argument as text: strings as-is, solids as a one-line summary,
 *  everything else as compact JSON (cycles, typed arrays, errors and WASM
 *  handles made safe). */
export function formatValue(v: unknown): string {
  if (typeof v === 'string') return v;
  const plain = toPlain(v, [], 0);
  return typeof plain === 'string' && plain !== v ? plain : JSON.stringify(plain) ?? String(v);
}

const MAX_DEPTH = 6;
const round = (n: number) => Math.round(n * 1000) / 1000;

/** `v` as JSON-safe data. `ancestors` is the path from the root, so an object
 *  reached twice through different branches prints twice and only a true
 *  cycle prints as "[Circular]". */
function toPlain(v: unknown, ancestors: object[], depth: number): unknown {
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : String(v);
  if (v === undefined || typeof v === 'bigint' || typeof v === 'symbol') return String(v);
  if (typeof v === 'function') return `[Function ${v.name || 'anonymous'}]`;
  if (typeof v !== 'object') return String(v);
  if (v instanceof Error) return `${v.name}: ${v.message}`;
  const summary = summarize(v);
  if (summary !== null) return summary;
  if (ancestors.includes(v)) return '[Circular]';
  if (depth >= MAX_DEPTH) return Array.isArray(v) ? `[Array(${v.length})]` : '[Object]';
  const path = [...ancestors, v];
  if (Array.isArray(v)) return v.map(e => toPlain(e, path, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (val === undefined || typeof val === 'symbol') continue; // as JSON.stringify drops them
    out[k] = toPlain(val, path, depth + 1);
  }
  return out;
}

/** A short description for values JSON can't show usefully, else null. */
function summarize(v: object): string | null {
  if (ArrayBuffer.isView(v) && !(v instanceof DataView)) {
    const arr = v as unknown as ArrayLike<number> & { constructor: { name: string } };
    const head = Array.from({ length: Math.min(arr.length, 8) }, (_, i) => arr[i]);
    return `${arr.constructor.name}(${arr.length}) [${head.join(', ')}${arr.length > 8 ? ', …' : ''}]`;
  }
  const o = v as Record<string, unknown>;
  // A manifold-3d Manifold: its size is what model code wants to see.
  if (typeof o.getMesh === 'function' && typeof o.boundingBox === 'function' && typeof o.numTri === 'function') {
    try {
      const bb = (o.boundingBox as () => { min: number[]; max: number[] })();
      return `Manifold{tris: ${(o.numTri as () => number)()}, bbox: [[${bb.min.map(round).join(', ')}], [${bb.max.map(round).join(', ')}]]}`;
    } catch {
      return 'Manifold{deleted}';
    }
  }
  if (typeof o.toPolygons === 'function' && typeof o.area === 'function') {
    try {
      return `CrossSection{area: ${round((o.area as () => number)())}}`;
    } catch {
      return 'CrossSection{deleted}';
    }
  }
  // A BREP shape wraps a replicad/OpenCASCADE object that references the
  // whole Emscripten module; never walk into it.
  if ('_shape' in o && typeof o.fillet === 'function') return 'BrepShape';
  if ('HEAP8' in o || 'HEAPU8' in o) return '[WASM module]';
  return null;
}
