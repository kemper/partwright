// Pure model for the code minimap (src/editor/codeMinimap.ts): a tiny
// line-oriented tokenizer that classifies each non-whitespace run well enough to
// color a 1px-per-character overview, plus a prefix/suffix line diff used to mark
// the region that changed since the minimap last rendered. Dependency-free so it
// runs in the vitest unit tier.

export type MinimapTokenKind = 'text' | 'keyword' | 'string' | 'number' | 'comment' | 'punct' | 'call' | 'property';

export interface MinimapRun {
  /** Start column (inclusive). */
  start: number;
  /** End column (exclusive). */
  end: number;
  kind: MinimapTokenKind;
}

export type MinimapLanguage = 'js' | 'scad';

const JS_KEYWORDS = new Set([
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do', 'of', 'in',
  'new', 'class', 'extends', 'import', 'export', 'from', 'default', 'switch', 'case', 'break',
  'continue', 'try', 'catch', 'finally', 'throw', 'typeof', 'instanceof', 'async', 'await',
  'yield', 'this', 'super', 'null', 'undefined', 'true', 'false', 'void', 'delete',
]);

const SCAD_KEYWORDS = new Set([
  'module', 'function', 'if', 'else', 'for', 'let', 'use', 'include', 'true', 'false', 'undef',
  'each', 'return', 'intersection_for',
]);

interface TokenizerState {
  inBlockComment: boolean;
  /** Inside a JS template literal that spans lines. */
  inTemplate: boolean;
}

const isIdentStart = (c: string): boolean => /[A-Za-z_$]/.test(c);
const isIdentPart = (c: string): boolean => /[A-Za-z0-9_$]/.test(c);
const isDigit = (c: string): boolean => c >= '0' && c <= '9';
const isSpace = (c: string): boolean => c === ' ' || c === '\t';

/** Index just past the closing `quote` starting the scan at `from`, honoring
 *  backslash escapes, or -1 when the line ends first. */
function findClosingQuote(line: string, from: number, quote: string): number {
  for (let i = from; i < line.length; i++) {
    const c = line[i];
    if (c === '\\') { i++; continue; }
    if (c === quote) return i + 1;
  }
  return -1;
}

function pushRun(runs: MinimapRun[], start: number, end: number, kind: MinimapTokenKind): void {
  if (end <= start) return;
  const last = runs[runs.length - 1];
  // Merge contiguous runs of the same kind so the renderer draws fewer rects.
  if (last && last.kind === kind && last.end === start) last.end = end;
  else runs.push({ start, end, kind });
}

function tokenizeLine(line: string, lang: MinimapLanguage, state: TokenizerState, maxCols: number): MinimapRun[] {
  const runs: MinimapRun[] = [];
  // Past `maxCols` the scan still runs (to carry comment/string state onto the
  // next line) but emits nothing, so a huge inline-data line costs no allocations.
  const emit = (start: number, end: number, kind: MinimapTokenKind): void => {
    if (start < maxCols) pushRun(runs, start, Math.min(end, maxCols), kind);
  };
  const n = line.length;
  const keywords = lang === 'scad' ? SCAD_KEYWORDS : JS_KEYWORDS;
  let i = 0;

  // Carry-over constructs from the previous line.
  if (state.inBlockComment) {
    const close = line.indexOf('*/');
    if (close < 0) { emit(0, n, 'comment'); return runs; }
    emit(0, close + 2, 'comment');
    state.inBlockComment = false;
    i = close + 2;
  } else if (state.inTemplate) {
    const close = findClosingQuote(line, 0, '`');
    if (close < 0) { emit(0, n, 'string'); return runs; }
    emit(0, close, 'string');
    state.inTemplate = false;
    i = close;
  }

  // Last non-whitespace character seen, for the `.prop` heuristic.
  let prevSignificant = '';
  while (i < n) {
    const c = line[i];
    if (isSpace(c)) { i++; continue; }
    const next = line[i + 1] ?? '';

    if (c === '/' && next === '/') {
      emit(i, n, 'comment');
      break;
    }
    if (c === '/' && next === '*') {
      const close = line.indexOf('*/', i + 2);
      if (close < 0) {
        emit(i, n, 'comment');
        state.inBlockComment = true;
        break;
      }
      emit(i, close + 2, 'comment');
      i = close + 2;
      prevSignificant = '/';
      continue;
    }
    if (c === '"' || c === "'" || (c === '`' && lang === 'js')) {
      const close = findClosingQuote(line, i + 1, c);
      if (close < 0) {
        emit(i, n, 'string');
        if (c === '`') state.inTemplate = true;
        break;
      }
      emit(i, close, 'string');
      i = close;
      prevSignificant = c;
      continue;
    }
    if (isDigit(c) || (c === '.' && isDigit(next))) {
      let j = i + 1;
      while (j < n && /[0-9A-Za-z_.]/.test(line[j])) j++;
      emit(i, j, 'number');
      i = j;
      prevSignificant = '0';
      continue;
    }
    if (isIdentStart(c)) {
      let j = i + 1;
      while (j < n && isIdentPart(line[j])) j++;
      const word = line.slice(i, j);
      let k = j;
      while (k < n && isSpace(line[k])) k++;
      let kind: MinimapTokenKind;
      if (keywords.has(word)) kind = 'keyword';
      else if (line[k] === '(') kind = 'call';
      else if (prevSignificant === '.') kind = 'property';
      else kind = 'text';
      emit(i, j, kind);
      i = j;
      prevSignificant = 'a';
      continue;
    }
    emit(i, i + 1, 'punct');
    prevSignificant = c;
    i++;
  }
  return runs;
}

/** Classify every line's non-whitespace runs. Tabs should already be expanded
 *  by the caller so run columns map 1:1 onto rendered columns. Runs are
 *  clipped to the first `maxCols` columns (nothing past them is ever drawn). */
export function tokenizeMinimapLines(lines: readonly string[], lang: MinimapLanguage, maxCols = Infinity): MinimapRun[][] {
  const state: TokenizerState = { inBlockComment: false, inTemplate: false };
  return lines.map((line) => tokenizeLine(line, lang, state, maxCols));
}

/** The span of `next` lines (0-based, inclusive) that differ from `prev`,
 *  found by trimming the common prefix and suffix. Returns null when the two
 *  are identical, when there's no meaningful baseline (`prev` empty), or when
 *  effectively the whole document changed (a session/version swap) — none of
 *  which is worth highlighting as "what just changed". A pure deletion
 *  reports the single line where text was removed. */
export function changedLineRange(prev: readonly string[], next: readonly string[]): { from: number; to: number } | null {
  if (prev.length === 0 || (prev.length === 1 && prev[0] === '')) return null;
  const max = Math.min(prev.length, next.length);
  let head = 0;
  while (head < max && prev[head] === next[head]) head++;
  if (head === prev.length && head === next.length) return null;
  let tail = 0;
  while (
    tail < max - head &&
    prev[prev.length - 1 - tail] === next[next.length - 1 - tail]
  ) tail++;
  const from = head;
  // A pure deletion leaves to < from; anchor it on the line where text vanished.
  const to = Math.max(from, next.length - 1 - tail);
  const clampedFrom = Math.min(from, Math.max(0, next.length - 1));
  const clampedTo = Math.min(to, Math.max(0, next.length - 1));
  // Nearly everything changed — a wholesale replacement, not an edit.
  const changed = clampedTo - clampedFrom + 1;
  if (next.length >= 4 && changed / next.length >= 0.9) return null;
  return { from: clampedFrom, to: clampedTo };
}
