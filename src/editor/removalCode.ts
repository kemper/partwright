// Code edits behind the object list's part/piece delete (✕). Deleting a part or
// piece doesn't bake the mesh — it writes one line at the top of the code
// (`api.removePart('name')` / `api.removePiece([x, y, z])` in the JS engines,
// `remove_part("name");` / `remove_piece([x, y, z]);` in OpenSCAD), so the model
// stays parametric and the deletion is visible (and undoable) in the source.
// Pure string/array helpers so they unit-test in the vitest tier.

/** The line that deletes the part `name` (`'scad'` for OpenSCAD syntax). */
export function removePartCall(name: string, lang: 'js' | 'scad' = 'js'): string {
  return lang === 'scad' ? `remove_part(${JSON.stringify(name)});` : `api.removePart(${JSON.stringify(name)});`;
}

/** The line that deletes the separate piece touching `point`. */
export function removePieceCall(point: readonly [number, number, number], lang: 'js' | 'scad' = 'js'): string {
  const xyz = `[${point.map(formatCoord).join(', ')}]`;
  return lang === 'scad' ? `remove_piece(${xyz});` : `api.removePiece(${xyz});`;
}

/** The trailing comment a piece removal carries, naming the piece the way the
 *  object list showed it (its removal call only records a point), e.g.
 *  `// piece 3 ("wheel")`. `index` is 0-based. */
export function removePieceComment(index: number, part?: string): string {
  return `// piece ${index + 1}${part ? ` (${JSON.stringify(part)})` : ''}`;
}

function formatCoord(v: number): string {
  const r = Math.round(v * 1e4) / 1e4;
  return String(Object.is(r, -0) ? 0 : r);
}

/** Insert `line` near the top of `code` — after any leading comment/blank lines
 *  (so a header comment stays first) but before any statement, because
 *  `api.removePart` must run before the `api.label` it cancels. Returns `code`
 *  unchanged when the same removal call is already there (a trailing comment
 *  on either side doesn't count). */
export function insertRemovalLine(code: string, line: string): string {
  const lines = code.split('\n');
  const call = stripTrailingComment(line);
  if (lines.some(l => stripTrailingComment(l.trim()) === call)) return code;
  let i = 0;
  let inBlock = false;
  for (; i < lines.length; i++) {
    const t = lines[i].trim();
    if (inBlock) {
      if (t.includes('*/')) inBlock = false;
      continue;
    }
    if (t === '' || t.startsWith('//')) continue;
    if (t.startsWith('/*')) {
      if (!t.includes('*/')) inBlock = true;
      continue;
    }
    break;
  }
  lines.splice(i, 0, line);
  return lines.join('\n');
}

function stripTrailingComment(line: string): string {
  const i = line.indexOf(');');
  return i >= 0 && /^\s*\/\//.test(line.slice(i + 2)) ? line.slice(0, i + 2) : line.trim();
}

/** A removal written into an object's code — what "Recover deleted" lists.
 *  `syntax` is which form it was written in (JS `api.remove*` or OpenSCAD
 *  `remove_*`). */
export type RemovalLine =
  | { kind: 'part'; name: string; syntax: 'js' | 'scad'; call: string; source: string }
  | { kind: 'piece'; point: [number, number, number]; label?: string; syntax: 'js' | 'scad'; call: string; source: string };

const NUM = String.raw`(-?\d+(?:\.\d+)?(?:e[-+]?\d+)?)`;
const PART_RE = /^(api\.removePart|remove_part)\(\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*\)\s*;?\s*(?:\/\/.*)?$/;
const PIECE_RE = new RegExp(String.raw`^(api\.removePiece|remove_piece)\(\s*\[\s*${NUM}\s*,\s*${NUM}\s*,\s*${NUM}\s*\]\s*\)\s*;?\s*(?:\/\/\s*(.*?))?\s*$`, 'i');

const SIMPLE_ESCAPES: Record<string, string> = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', '0': '\0' };

function isRemovalStart(line: string): boolean {
  return line.startsWith('api.remove') || line.startsWith('remove_p');
}

/** Decode a single- or double-quoted JS string literal (as matched by
 *  PART_RE). Handles the common escapes; null for a malformed \u escape. */
function parseQuoted(lit: string): string | null {
  const body = lit.slice(1, -1);
  let out = '';
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c !== '\\') { out += c; continue; }
    const e = body[++i];
    if (e === 'u') {
      const hex = body.slice(i + 1, i + 5);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) return null;
      out += String.fromCharCode(parseInt(hex, 16));
      i += 4;
    } else {
      out += SIMPLE_ESCAPES[e] ?? e;
    }
  }
  return out;
}

/** Every `api.removePart` / `api.removePiece` (or OpenSCAD `remove_part` /
 *  `remove_piece`) call in `code` written on a line of its own (the shape the
 *  object list's ✕ writes, or a hand-written equivalent), in source order. `call` is the canonical form (what
 *  {@link removePartCall} / {@link removePieceCall} would write) — a stable id
 *  for the removal; `source` is the exact trimmed line. A piece's `label` is its
 *  trailing comment (see {@link removePieceComment}). */
export function findRemovalLines(code: string): RemovalLine[] {
  const out: RemovalLine[] = [];
  for (const raw of code.split('\n')) {
    const source = raw.trim();
    if (!isRemovalStart(source)) continue;
    const pm = PART_RE.exec(source);
    if (pm) {
      const syntax = pm[1] === 'remove_part' ? 'scad' : 'js';
      const name = parseQuoted(pm[2]);
      if (name) out.push({ kind: 'part', name, syntax, call: removePartCall(name, syntax), source });
      continue;
    }
    const qm = PIECE_RE.exec(source);
    if (qm) {
      const syntax = qm[1] === 'remove_piece' ? 'scad' : 'js';
      const point: [number, number, number] = [Number(qm[2]), Number(qm[3]), Number(qm[4])];
      const label = qm[5]?.trim();
      out.push({ kind: 'piece', point, ...(label ? { label } : {}), syntax, call: removePieceCall(point, syntax), source });
    }
  }
  return out;
}

/** Remove the line holding the removal whose canonical `call` matches (see
 *  {@link findRemovalLines}) — the inverse of {@link insertRemovalLine}.
 *  Returns `code` unchanged when no such line exists. */
export function removeRemovalLine(code: string, call: string): string {
  const lines = code.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!isRemovalStart(t)) continue;
    const hit = findRemovalLines(t)[0];
    if (hit && hit.call === call) {
      lines.splice(i, 1);
      return lines.join('\n');
    }
  }
  return code;
}

/** A point on the surface of a piece, for `api.removePiece`: the centroid of
 *  its largest triangle (a big triangle keeps the point well inside one face,
 *  and the choice is deterministic). Null for an empty triangle list. */
export function pieceAnchorPoint(
  mesh: { vertProperties: Float32Array; triVerts: Uint32Array; numProp: number },
  triangles: Iterable<number>,
): [number, number, number] | null {
  const { vertProperties: vp, triVerts: tv, numProp: np } = mesh;
  let best: [number, number, number] | null = null;
  let bestArea = -1;
  for (const t of triangles) {
    const a = tv[t * 3] * np, b = tv[t * 3 + 1] * np, c = tv[t * 3 + 2] * np;
    const ux = vp[b] - vp[a], uy = vp[b + 1] - vp[a + 1], uz = vp[b + 2] - vp[a + 2];
    const vx = vp[c] - vp[a], vy = vp[c + 1] - vp[a + 1], vz = vp[c + 2] - vp[a + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    const area = cx * cx + cy * cy + cz * cz;
    if (area > bestArea) {
      bestArea = area;
      best = [
        (vp[a] + vp[b] + vp[c]) / 3,
        (vp[a + 1] + vp[b + 1] + vp[c + 1]) / 3,
        (vp[a + 2] + vp[b + 2] + vp[c + 2]) / 3,
      ];
    }
  }
  return best;
}
