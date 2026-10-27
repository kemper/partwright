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
 *  code, so the engines' validate() paths use it too. This is THE place user
 *  model code becomes a function, by design — it only ever runs inside the
 *  locked-down engine Worker (workerLockdown.ts). CodeQL reports it as "Code
 *  injection"; that alert is the known, expected one (release skill). */
export function compileModel(jsCode: string): (api: unknown, console: Console) => unknown {
  try {
    return new Function('api', 'console', `"use strict";\n${jsCode}`) as (api: unknown, console: Console) => unknown;
  } catch (e) {
    // `const console = …` at the top of model code now collides with the
    // parameter; say why instead of a bare redeclaration error.
    if (e instanceof SyntaxError && /\bconsole\b/.test(e.message) && /already been declared|redeclaration/i.test(e.message)) {
      throw new SyntaxError(`${e.message}. \`console\` is provided to model code (what it prints comes back as \`logs\`), like \`api\` — rename your variable.`);
    }
    throw e;
  }
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
