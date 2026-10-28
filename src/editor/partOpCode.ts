// Code edits behind the Parts panel's arrange / copy / group actions. Each
// action writes `api.movePart(…)`, `api.rotatePart(…)`, `api.copyPart(…)`, …
// lines into a block near the top of the code (after any header comments and
// removal lines), so the model stays parametric and every edit is visible and
// undoable in the source. The engine applies them after the code runs
// (src/geometry/partOps.ts), in the order written.
//
// Repeated edits are folded: a move of a part merges into that part's last
// move when nothing after it touches the part (so arrow-key nudges don't pile
// up lines), and two turns about the same single axis add up. Pure
// string/array helpers so they unit-test in the vitest tier.

import type { PartOp, Vec3 } from '../geometry/partOps';

function num(v: number): string {
  const r = Math.round(v * 1e4) / 1e4;
  return String(Object.is(r, -0) ? 0 : r);
}
const vec = (v: Vec3) => `[${v.map(num).join(', ')}]`;
const str = (s: string) => JSON.stringify(s);

/** The line that declares `op`. */
export function formatPartOp(op: PartOp): string {
  switch (op.kind) {
    case 'move': return `api.movePart(${str(op.part)}, ${vec(op.offset)});`;
    case 'rotate': return `api.rotatePart(${str(op.part)}, ${vec(op.degrees)});`;
    case 'scale': return op.factor[0] === op.factor[1] && op.factor[1] === op.factor[2]
      ? `api.scalePart(${str(op.part)}, ${num(op.factor[0])});`
      : `api.scalePart(${str(op.part)}, ${vec(op.factor)});`;
    case 'mirror': return `api.mirrorPart(${str(op.part)}, ${str(op.axis)});`;
    case 'copy': return `api.copyPart(${str(op.part)}, ${str(op.as)}, ${vec(op.offset)});`;
    case 'group': return `api.groupParts([${op.parts.map(str).join(', ')}], ${str(op.as)});`;
    case 'cut': return `api.cutWithPart(${str(op.part)});`;
  }
}

const LINE_RE = /^api\.(movePart|rotatePart|scalePart|mirrorPart|copyPart|groupParts|cutWithPart)\((.*)\)\s*;?\s*(?:\/\/.*)?$/;

/** Parse one trimmed line written by {@link formatPartOp} (or a hand-written
 *  equivalent in the same JSON-friendly form). Null when it isn't one. */
export function parsePartOpLine(line: string): PartOp | null {
  const m = LINE_RE.exec(line.trim());
  if (!m) return null;
  let args: unknown[];
  try {
    // Single-quoted strings → JSON strings (no escapes inside, the common case).
    const json = `[${m[2].replace(/'([^'\\]*)'/g, (_, s: string) => JSON.stringify(s))}]`;
    args = JSON.parse(json) as unknown[];
  } catch {
    return null;
  }
  const isVec = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every(n => typeof n === 'number');
  const isName = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
  const [a, b, c] = args;
  switch (m[1]) {
    case 'movePart': return isName(a) && isVec(b) ? { kind: 'move', part: a, offset: b } : null;
    case 'rotatePart': return isName(a) && isVec(b) ? { kind: 'rotate', part: a, degrees: b } : null;
    case 'scalePart':
      if (!isName(a)) return null;
      if (typeof b === 'number') return { kind: 'scale', part: a, factor: [b, b, b] };
      return isVec(b) ? { kind: 'scale', part: a, factor: b } : null;
    case 'mirrorPart': return isName(a) && (b === 'x' || b === 'y' || b === 'z') ? { kind: 'mirror', part: a, axis: b } : null;
    case 'copyPart': return isName(a) && isName(b) && (c === undefined || isVec(c)) ? { kind: 'copy', part: a, as: b, offset: (c as Vec3 | undefined) ?? [0, 0, 0] } : null;
    case 'groupParts': return Array.isArray(a) && a.every(isName) && isName(b) ? { kind: 'group', parts: a as string[], as: b } : null;
    case 'cutWithPart': return isName(a) ? { kind: 'cut', part: a } : null;
  }
  return null;
}

/** Every part-edit line in `code`, in order, with its line index. */
export function findPartOpLines(code: string): { index: number; op: PartOp }[] {
  const out: { index: number; op: PartOp }[] = [];
  code.split('\n').forEach((raw, index) => {
    const op = parsePartOpLine(raw);
    if (op) out.push({ index, op });
  });
  return out;
}

/** Names an op reads or writes. */
function namesOf(op: PartOp): string[] {
  if (op.kind === 'group') return [...op.parts, op.as];
  if (op.kind === 'copy') return [op.part, op.as];
  return [op.part];
}

const singleAxis = (d: Vec3): number => {
  const nz = d.map((v, i) => (Math.abs(v) > 1e-9 ? i : -1)).filter(i => i >= 0);
  return nz.length === 1 ? nz[0] : -1;
};

/** Where new part-edit lines go: after the last existing one at the top of
 *  the code, else after the leading comments and removal lines. */
function insertionIndex(lines: string[]): number {
  let i = 0;
  let last = -1;
  let inBlock = false;
  for (; i < lines.length; i++) {
    const t = lines[i].trim();
    if (inBlock) { if (t.includes('*/')) inBlock = false; continue; }
    if (t === '' || t.startsWith('//')) continue;
    if (t.startsWith('/*')) { if (!t.includes('*/')) inBlock = true; continue; }
    if (parsePartOpLine(t)) { last = i; continue; }
    if (/^(api\.removePart|api\.removePiece)\(/.test(t)) continue;
    break;
  }
  if (last >= 0) return last + 1;
  // Not past the first statement: back up over trailing blank lines so the
  // block sits right under the header.
  while (i > 0 && lines[i - 1].trim() === '') i--;
  return i;
}

/** `code` with `ops` added, folding each into an earlier line where that
 *  can't change the result (see the module comment). A move or turn that
 *  folds to nothing removes the line. */
export function addPartOps(code: string, ops: readonly PartOp[]): string {
  const lines = code.split('\n');
  for (const op of ops) {
    const existing = lines.map((l, index) => ({ index, op: parsePartOpLine(l) })).filter((x): x is { index: number; op: PartOp } => !!x.op);
    let folded = false;
    if (op.kind === 'move' || op.kind === 'rotate') {
      // The last line touching this part, if it's the same kind and nothing
      // later reads or writes the part.
      const touching = existing.filter(x => namesOf(x.op).includes(op.part));
      const last = touching[touching.length - 1];
      if (last && last.op.kind === op.kind && last.op.part === op.part) {
        if (op.kind === 'move' && last.op.kind === 'move') {
          const sum: Vec3 = [last.op.offset[0] + op.offset[0], last.op.offset[1] + op.offset[1], last.op.offset[2] + op.offset[2]];
          if (sum.every(v => Math.abs(v) < 1e-9)) lines.splice(last.index, 1);
          else lines[last.index] = formatPartOp({ ...last.op, offset: sum });
          folded = true;
        } else if (op.kind === 'rotate' && last.op.kind === 'rotate') {
          const ax = singleAxis(op.degrees);
          if (ax >= 0 && singleAxis(last.op.degrees) === ax) {
            let deg = (last.op.degrees[ax] + op.degrees[ax]) % 360;
            if (deg > 180) deg -= 360;
            if (deg <= -180) deg += 360;
            if (Math.abs(deg) < 1e-9) lines.splice(last.index, 1);
            else {
              const d: Vec3 = [0, 0, 0];
              d[ax] = deg;
              lines[last.index] = formatPartOp({ ...last.op, degrees: d });
            }
            folded = true;
          }
        }
      }
    }
    if (!folded) lines.splice(insertionIndex(lines), 0, formatPartOp(op));
  }
  return lines.join('\n');
}

/** `code` with every part-edit line's references to part `from` renamed to `to`. */
export function renamePartInOps(code: string, from: string, to: string): string {
  const rn = (n: string) => (n === from ? to : n);
  return code.split('\n').map((raw) => {
    const op = parsePartOpLine(raw);
    if (!op || !namesOf(op).includes(from)) return raw;
    const indent = raw.slice(0, raw.length - raw.trimStart().length);
    const next: PartOp = op.kind === 'group' ? { ...op, parts: op.parts.map(rn), as: rn(op.as) }
      : op.kind === 'copy' ? { ...op, part: rn(op.part), as: rn(op.as) }
      : { ...op, part: rn(op.part) };
    return indent + formatPartOp(next);
  }).join('\n');
}

/** The part names the code's edit lines create (copies and groups) — parts
 *  that exist only because of a line, so deleting one removes its lines. */
export function partsCreatedByOps(code: string): Set<string> {
  const out = new Set<string>();
  for (const { op } of findPartOpLines(code)) if (op.kind === 'copy' || op.kind === 'group') out.add(op.as);
  return out;
}

/** `code` without the line that creates `name` (a copy or a group) and every
 *  later edit line that depends on it — including copies made from it, and
 *  theirs. A copy is gone after this; a group splits back into its parts
 *  (ungroup). Unchanged when no line creates `name`. */
export function removeCreatedPart(code: string, name: string): string {
  const lines = code.split('\n');
  const ops = findPartOpLines(code);
  const creator = ops.find(x => (x.op.kind === 'copy' || x.op.kind === 'group') && x.op.as === name);
  if (!creator) return code;
  const drop = new Set<number>([creator.index]);
  const gone = new Set<string>([name]);
  for (const x of ops) {
    if (x.index <= creator.index) continue;
    const reads = x.op.kind === 'group' ? x.op.parts : [x.op.part];
    if (!reads.some(n => gone.has(n))) continue;
    drop.add(x.index);
    if (x.op.kind === 'copy' || x.op.kind === 'group') gone.add(x.op.as);
  }
  return lines.filter((_, i) => !drop.has(i)).join('\n');
}
