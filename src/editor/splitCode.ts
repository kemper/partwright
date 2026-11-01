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

/** The last top-level `return EXPR`. EXPR runs to a `;` outside any
 *  bracket, or to the end of a line unless the expression visibly continues
 *  (the next line starts with, or this line ends with, an operator / `.` /
 *  `?` / `:` / `,`), so a leading-dot chain or a multi-line ternary is taken
 *  whole. Comments end a line (their text is blanked in the mask but the
 *  delimiters are kept), so a trailing `// note` stays outside the span. */
function findTopReturn(code: string, masked: string, depth: Int32Array): ReturnSpan | null {
  const re = /\breturn\b/g;
  let at: number | null = null;
  for (let m = re.exec(masked); m; m = re.exec(masked)) if (depth[m.index] === 0) at = m.index;
  if (at === null) return null;
  let i = at + 'return'.length;
  while (i < masked.length && /[ \t]/.test(masked[i])) i++;
  const exprStart = i;
  const CONT = /[.?:,+\-*/%&|^<>=]/;
  let level = 0;
  let lastSig = exprStart; // end (exclusive) of the last non-blank expression char
  // The mask keeps a comment's first `/` and blanks the rest, so read the
  // second char from the source (a `/` inside a string is blanked in the mask).
  const isComment = (k: number) => masked[k] === '/' && (code[k + 1] === '/' || code[k + 1] === '*');
  const skipComment = (k: number): number => {
    if (code[k + 1] === '/') { while (k < masked.length && masked[k] !== '\n') k++; return k; }
    const close = code.indexOf('*/', k + 2);
    return close < 0 ? masked.length : close + 2;
  };
  while (i < masked.length) {
    const c = masked[i];
    if (isComment(i)) { i = skipComment(i); continue; }
    if (c === '(' || c === '[' || c === '{') level++;
    else if (c === ')' || c === ']' || c === '}') { if (level === 0) break; level--; }
    else if (level === 0 && c === ';') break;
    else if (level === 0 && c === '\n') {
      // Continue when this line ended with an operator or the next
      // non-blank, non-comment char continues the expression.
      const prev = masked[lastSig - 1];
      let j = i + 1;
      for (;;) {
        while (j < masked.length && /\s/.test(masked[j])) j++;
        if (j < masked.length && isComment(j)) { j = skipComment(j); continue; }
        break;
      }
      const next = masked[j];
      const nextIsArrowOrCompare = next === '=' && masked[j + 1] !== '=';
      if (!(prev && CONT.test(prev)) && !(next && CONT.test(next) && !nextIsArrowOrCompare)) break;
      i = j;
      continue;
    }
    if (!/\s/.test(c)) lastSig = i + 1;
    i++;
  }
  const exprEnd = lastSig;
  if (exprEnd <= exprStart) return null;
  return { at, exprStart, exprEnd };
}

/** If EXPR is exactly `api.splitParts(INNER, OPTS?)` — the call's own closing
 *  paren ends the expression — the span of INNER. `api.splitParts(m).add(x)`
 *  is not a wrap (editing it would drop the `.add`). */
function splitCallInner(masked: string, start: number, end: number): { innerStart: number; innerEnd: number } | null {
  const head = /^api\.splitParts\s*\(/.exec(masked.slice(start, end));
  if (!head) return null;
  let i = start + head[0].length;
  const innerStart = i;
  let level = 0;
  let innerEnd = -1;
  for (; i < end; i++) {
    const c = masked[i];
    if (c === '(' || c === '[' || c === '{') level++;
    else if (c === ')' || c === ']' || c === '}') {
      if (level === 0) break; // the call's closing paren
      level--;
    } else if (c === ',' && level === 0 && innerEnd < 0) innerEnd = i;
  }
  if (i >= end || masked[i] !== ')') return null;
  // Nothing but whitespace may follow the call's closing paren.
  if (masked.slice(i + 1, end).trim() !== '') return null;
  if (innerEnd < 0) innerEnd = i;
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
