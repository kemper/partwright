// Code edit behind `partwright.splitIntoPieces`: wrap the model's final
// top-level `return EXPR;` as `return api.splitParts(EXPR, { … });`, update the
// options of an existing wrap in place, or unwrap it again. Matching runs on
// the lexically masked source (surfaceCodegen.lexicalMask), so text inside
// strings or comments is never edited. Pure — unit-tested in
// tests/unit/splitParts.test.ts.

import { lexicalMask } from '../surface/surfaceCodegen';

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** Source literal for an options value (numbers to 6 significant digits,
 *  non-identifier keys quoted). */
export function formatSplitValue(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return String(Number(v.toPrecision(6)));
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'string') return `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  if (Array.isArray(v)) return `[${v.map(formatSplitValue).join(', ')}]`;
  const entries = Object.entries(v as Record<string, unknown>)
    .filter(([, val]) => val !== undefined)
    .map(([k, val]) => `${IDENT.test(k) ? k : formatSplitValue(k)}: ${formatSplitValue(val)}`);
  return entries.length > 0 ? `{ ${entries.join(', ')} }` : '{}';
}

interface ReturnSpan {
  /** Index of the `return` keyword. */
  at: number;
  /** Start / end (exclusive) of the returned expression. */
  exprStart: number;
  exprEnd: number;
}

/** The last top-level `return EXPR` (EXPR ends at a `;` or newline outside any
 *  bracket, or at the end of the code). */
function findTopReturn(code: string, masked: string, depth: Int32Array): ReturnSpan | null {
  const re = /\breturn\b/g;
  let at: number | null = null;
  for (let m = re.exec(masked); m; m = re.exec(masked)) if (depth[m.index] === 0) at = m.index;
  if (at === null) return null;
  let i = at + 'return'.length;
  while (i < masked.length && /[ \t]/.test(masked[i])) i++;
  const exprStart = i;
  let level = 0;
  for (; i < masked.length; i++) {
    const c = masked[i];
    if (c === '(' || c === '[' || c === '{') level++;
    else if (c === ')' || c === ']' || c === '}') { if (level === 0) break; level--; }
    else if (level === 0 && (c === ';' || c === '\n')) break;
  }
  let exprEnd = i;
  while (exprEnd > exprStart && /\s/.test(code[exprEnd - 1])) exprEnd--;
  if (exprEnd <= exprStart) return null;
  return { at, exprStart, exprEnd };
}

/** If EXPR is `api.splitParts(INNER, OPTS?)`, the span of INNER. */
function splitCallInner(masked: string, start: number, end: number): { innerStart: number; innerEnd: number } | null {
  const head = /^api\.splitParts\s*\(/.exec(masked.slice(start, end));
  if (!head) return null;
  let i = start + head[0].length;
  const innerStart = i;
  let level = 0;
  for (; i < end; i++) {
    const c = masked[i];
    if (c === '(' || c === '[' || c === '{') level++;
    else if (c === ')' || c === ']' || c === '}') { if (level === 0) break; level--; }
    else if (c === ',' && level === 0) break;
  }
  if (i >= end) return null;
  // The call must close at the end of the expression.
  if (masked.slice(start, end).trimEnd().slice(-1) !== ')') return null;
  let innerEnd = i;
  while (innerEnd > innerStart && /\s/.test(masked[innerEnd - 1])) innerEnd--;
  return { innerStart, innerEnd };
}

/** Wrap the final return in api.splitParts (or update an existing wrap's
 *  options). Null when the code has no top-level return. */
export function upsertSplitCall(code: string, opts: Record<string, unknown>): { code: string; call: string; replaced: boolean } | null {
  const { masked, depth } = lexicalMask(code);
  const ret = findTopReturn(code, masked, depth);
  if (!ret) return null;
  const existing = splitCallInner(masked, ret.exprStart, ret.exprEnd);
  const inner = existing ? code.slice(existing.innerStart, existing.innerEnd) : code.slice(ret.exprStart, ret.exprEnd);
  const optText = formatSplitValue(opts);
  const call = optText === '{}' ? `api.splitParts(${inner})` : `api.splitParts(${inner}, ${optText})`;
  return { code: code.slice(0, ret.exprStart) + call + code.slice(ret.exprEnd), call, replaced: !!existing };
}

/** Unwrap `return api.splitParts(EXPR, …)` back to `return EXPR`. Null when
 *  the final return isn't a split. */
export function removeSplitCall(code: string): string | null {
  const { masked, depth } = lexicalMask(code);
  const ret = findTopReturn(code, masked, depth);
  if (!ret) return null;
  const existing = splitCallInner(masked, ret.exprStart, ret.exprEnd);
  if (!existing) return null;
  return code.slice(0, ret.exprStart) + code.slice(existing.innerStart, existing.innerEnd) + code.slice(ret.exprEnd);
}

/** The `[splitParts] {json}` report line a run printed (last one wins). */
export function parseSplitReport(logs: readonly string[] | undefined | null): { pieces: Record<string, unknown>[]; warnings: string[] } | null {
  if (!logs) return null;
  for (let i = logs.length - 1; i >= 0; i--) {
    const line = logs[i];
    const at = line.indexOf('[splitParts] ');
    if (at < 0) continue;
    try {
      const j = JSON.parse(line.slice(at + '[splitParts] '.length));
      if (j && Array.isArray(j.pieces) && Array.isArray(j.warnings)) return j;
    } catch { /* a truncated log line */ }
  }
  return null;
}
