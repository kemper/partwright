// Code rewrites behind the Objects rail's part / piece actions (#1003):
// "Go to code", "Rename part", "Bake colour into code" and the piece filters
// ("Extract to new object", "Delete piece"). Pure string transforms over the
// object's source — no editor or engine state — so they run in the unit tier.
//
// They work on what users and agents actually write: a part is named by a
// quoted string literal (`api.label(shape, 'handle')`, SCAD `label("handle")`,
// `BREP.label(s, 'handle')`, `api.paint.label('handle', …)`, a surface op's
// `label: 'handle'`), so every rewrite keys on that literal.

/** Every `'name'` / `"name"` / `` `name` `` literal (exact match, no
 *  interpolation) in `code`, as [start, end) offsets of the whole literal. */
function quotedLiteralRanges(code: string, name: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const re = /(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    if (m[1] === '`' && m[2].includes('${')) continue;
    if (m[2] === name) out.push([m.index, m.index + m[0].length]);
  }
  return out;
}

/** Where part `name` is declared: the first quoted literal on a line that
 *  calls `label(` (api.label / SCAD label / BREP.label), else the first literal
 *  anywhere. Returns 1-based `line` plus the literal's offsets, or null. */
export function findLabelSource(code: string, name: string): { from: number; to: number; line: number } | null {
  const ranges = quotedLiteralRanges(code, name);
  if (ranges.length === 0) return null;
  const lineStart = (i: number) => code.lastIndexOf('\n', i - 1) + 1;
  const declares = ranges.find(([from]) => /\blabel\s*\(/.test(code.slice(lineStart(from), from)) && !/paint\s*\.\s*label\s*\($/.test(code.slice(lineStart(from), from).trimEnd()));
  const [from, to] = declares ?? ranges[0];
  const line = code.slice(0, from).split('\n').length;
  return { from, to, line };
}

/** Rename part `from` → `to` everywhere it's named by a string literal (its
 *  label, paint and surface scopes), keeping each literal's quote style. */
export function renameLabelInCode(code: string, from: string, to: string): { code: string; count: number } {
  const ranges = quotedLiteralRanges(code, from);
  if (ranges.length === 0 || from === to) return { code, count: 0 };
  let out = '';
  let last = 0;
  for (const [a, b] of ranges) {
    const q = code[a];
    const escaped = to.replace(/\\/g, '\\\\').split(q).join(`\\${q}`);
    out += code.slice(last, a) + q + escaped + q;
    last = b;
  }
  return { code: out + code.slice(last), count: ranges.length };
}

/** Index of the final top-level `return` line (no indentation), or -1. */
function lastTopLevelReturn(code: string): number {
  const re = /^return\b/gm;
  let idx = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) idx = m.index;
  return idx;
}

/** Write part `name`'s colour into the code as `api.paint.label(name, hex)`
 *  (manifold-js) — updating an existing call for that part, or inserting one
 *  just before the final top-level `return`. Returns null when there's no
 *  top-level return to anchor on. */
export function upsertPaintLabelInCode(code: string, name: string, hex: string): string | null {
  const literal = `'${name.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  // An existing api.paint.label('name', '#…') call → swap its colour.
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const existing = new RegExp(`(api\\.paint\\.label\\(\\s*(['"\`])${esc}\\2\\s*,\\s*)(['"\`])#?[0-9a-fA-F]{3,8}\\3`);
  if (existing.test(code)) return code.replace(existing, `$1'${hex}'`);
  const at = lastTopLevelReturn(code);
  if (at < 0) return null;
  const line = `api.paint.label(${literal}, '${hex}');\n`;
  return code.slice(0, at) + line + code.slice(at);
}

/** A piece's identity for the filters below: its bounding-box centre and size
 *  at the time it was picked. Matched to the nearest component of the model
 *  on every run, so small parameter edits keep tracking the same piece. */
export type PieceBox = [number, number, number, number, number, number];

const FILTER_MARK = '// Partwright piece filter';

/** Wrap the object's code so the result keeps (`keep`) or drops (`drop`) the
 *  pieces matching `boxes`. The original code runs untouched inside a function;
 *  a second filter of the same mode appends to the existing list instead of
 *  wrapping twice. Returns null when the code has no top-level `return`. */
export function wrapWithPieceFilter(code: string, mode: 'keep' | 'drop', boxes: PieceBox[]): string | null {
  const round = (b: PieceBox) => b.map(v => Math.round(v * 1e4) / 1e4);
  const existing = parsePieceFilter(code);
  if (existing && existing.mode === mode) {
    const all = [...existing.boxes, ...boxes].map(round);
    return code.replace(existing.specLine, specLine(mode, all));
  }
  if (lastTopLevelReturn(code) < 0) return null;
  const body = code.replace(/\s+$/, '').split('\n').map(l => (l.length > 0 ? `  ${l}` : l)).join('\n');
  return [
    `${FILTER_MARK} — ${mode === 'keep' ? 'keeps only' : 'removes'} the listed pieces (matched by bounding box).`,
    specLine(mode, boxes.map(round)),
    'const __pwModel = (() => {',
    body,
    '})();',
    'return (function __pwFilterPieces(model, spec) {',
    "  if (!model || typeof model.decompose !== 'function') throw new Error('Piece filter: the code must return a Manifold.');",
    '  const pieces = model.decompose();',
    '  const score = (m, b) => {',
    '    const { min, max } = m.boundingBox();',
    '    let s = 0;',
    '    for (let k = 0; k < 3; k++) s += Math.abs((min[k] + max[k]) / 2 - b[k]) + Math.abs(max[k] - min[k] - b[k + 3]);',
    '    return s;',
    '  };',
    '  const hit = new Set(spec.boxes.map(b => pieces.reduce((best, m, i) => (score(m, b) < score(pieces[best], b) ? i : best), 0)));',
    "  const kept = pieces.filter((_, i) => (spec.mode === 'keep') === hit.has(i));",
    "  if (kept.length === 0) throw new Error('Piece filter: no pieces left.');",
    '  return kept.length === 1 ? kept[0] : api.Manifold.compose(kept);',
    '})(__pwModel, __pwPieces);',
    '',
  ].join('\n');
}

function specLine(mode: 'keep' | 'drop', boxes: number[][]): string {
  return `const __pwPieces = ${JSON.stringify({ mode, boxes })};`;
}

/** The piece filter this code already carries, if any. */
export function parsePieceFilter(code: string): { mode: 'keep' | 'drop'; boxes: PieceBox[]; specLine: string } | null {
  if (!code.startsWith(FILTER_MARK)) return null;
  // The editor's auto-format may have spread the spec over several lines,
  // re-quoted it or added trailing commas — normalise back to JSON.
  const m = /^const __pwPieces = (\{[\s\S]*?\});/m.exec(code);
  if (!m) return null;
  const json = m[1]
    .replace(/'/g, '"')
    .replace(/([{,]\s*)(mode|boxes)\s*:/g, '$1"$2":')
    .replace(/,\s*([\]}])/g, '$1');
  try {
    const spec = JSON.parse(json) as { mode?: unknown; boxes?: unknown };
    if ((spec.mode !== 'keep' && spec.mode !== 'drop') || !Array.isArray(spec.boxes)) return null;
    return { mode: spec.mode, boxes: spec.boxes as PieceBox[], specLine: m[0] };
  } catch {
    return null;
  }
}
