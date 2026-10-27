// Console output from model code. Model code runs as `new Function(...)` in
// the engine Worker, so a plain `console.log` only reaches the Worker's
// DevTools console — an agent driving the app (console API, in-app AI) never
// sees it, and debugs by throwing JSON in an Error instead. Each run gets its
// own capturing `console`, passed to the model function as a parameter (so it
// shadows the global for model code only, never for engine internals or a
// concurrent async run), and the captured lines ride back on the run result
// as `MeshResult.logs`. Output still mirrors to the real console.

import { getConfig } from '../config/appConfig';

export interface ModelLogLimits {
  /** Most lines kept per run; later lines are counted, not stored. */
  maxLines: number;
  /** Most characters kept per run, across all lines. */
  maxChars: number;
}

/** The main thread's limits, set per execute message (the Worker's own
 *  getConfig() only sees defaults). */
let workerLimits: ModelLogLimits | null = null;

export function setModelLogLimits(limits: ModelLogLimits | null): void {
  workerLimits = limits;
}

export interface ModelLog {
  /** The `console` handed to model code. */
  console: Console;
  /** Captured lines, or undefined when the run logged nothing. */
  lines(): string[] | undefined;
}

/** Compile model code the way every JS engine runs it: strict mode, `api`
 *  and the per-run `console` as parameters. Throws a SyntaxError for bad
 *  code, so the engines' validate() paths use it too. */
export function compileModel(jsCode: string): (api: unknown, console: Console) => unknown {
  return new Function('api', 'console', `"use strict";\n${jsCode}`) as (api: unknown, console: Console) => unknown;
}

export function createModelLog(limits?: ModelLogLimits): ModelLog {
  const cfg = getConfig().renderer;
  const { maxLines, maxChars } = limits ?? workerLimits ?? { maxLines: cfg.modelLogMaxLines, maxChars: cfg.modelLogMaxChars };
  const real = globalThis.console;
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
  const level = (name: 'log' | 'info' | 'debug' | 'warn' | 'error', prefix: string) => (...args: unknown[]) => {
    push(prefix, args);
    real[name](...args);
  };

  // Everything else (time, group, count, …) falls through to the real console.
  const modelConsole = Object.assign(Object.create(real) as Console, {
    log: level('log', ''),
    info: level('info', ''),
    debug: level('debug', ''),
    dir: level('log', ''),
    table: level('log', ''),
    warn: level('warn', 'warn: '),
    error: level('error', 'error: '),
    assert: (cond?: unknown, ...args: unknown[]) => {
      if (!cond) push('assert: ', args.length > 0 ? args : ['Assertion failed']);
      real.assert(!!cond, ...args);
    },
  });

  return {
    console: modelConsole,
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
 *  everything else as compact JSON (cycles and typed arrays made safe). */
export function formatValue(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v === undefined || v === null || typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint' || typeof v === 'symbol') return String(v);
  if (typeof v === 'function') return `[Function ${v.name || 'anonymous'}]`;
  if (v instanceof Error) return `${v.name}: ${v.message}`;
  const summary = summarize(v);
  if (summary !== null) return summary;
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(v, (_k, val: unknown) => {
      if (typeof val === 'bigint') return String(val);
      if (typeof val === 'function') return `[Function ${(val as { name?: string }).name || 'anonymous'}]`;
      if (val && typeof val === 'object') {
        const s = summarize(val);
        if (s !== null) return s;
        if (seen.has(val)) return '[Circular]';
        seen.add(val);
      }
      return val;
    }) ?? String(v);
  } catch {
    return Object.prototype.toString.call(v);
  }
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/** A short description for values JSON can't show usefully, else null. */
function summarize(v: unknown): string | null {
  if (!v || typeof v !== 'object') return null;
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
  return null;
}
